import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ayar } from "./config.js";
import { get } from "./http.js";
import { yayinlariOku, jsonSatirlariniOku } from "./catalog-stream.js";
import { adayAdresi, pdfAdaylariniBirlestir } from "./pdf-candidates.js";
import { doiAnahtari, doiAdresi } from "./doi.js";
import { eslestir, tokenlar } from "./normalize.js";
import { isbnDogrula } from "./isbn.js";
import type { PdfAdayi, Sorgu, Work } from "./types.js";

export const KITAP_KAYNAKLARI = {
  oapen: {
    ad: "OAPEN",
    url: "https://memo.oapen.org/file/oapen/OAPENLibrary.json",
    host: "library.oapen.org",
  },
  doab: {
    ad: "DOAB",
    url: "https://memo.doabooks.org/file/oapen/DOAB.json",
    host: "directory.doabooks.org",
  },
} as const;
export type KitapKaynagi = keyof typeof KITAP_KAYNAKLARI;
export interface KatalogBasligi {
  surum: 1;
  kaynak: KitapKaynagi;
  url: string;
  alindi: string;
  kayitSayisi: number;
  okunan: number;
  atlanan: number;
  tam: true;
}
export function katalogYolu(kaynak: KitapKaynagi) {
  return path.join(ayar.dataDir, "catalogs", `${kaynak}.jsonl`);
}
export function katalogSurumu(kaynak: KitapKaynagi): string {
  try {
    const s = fs.statSync(katalogYolu(kaynak));
    return `v3:${s.mtimeMs}:${s.size}`;
  } catch {
    return "v3:hazir-degil";
  }
}
const str = (v: unknown, limit = 2000): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, limit) : undefined;
const dizi = (v: unknown) =>
  Array.isArray(v) ? v.flatMap((x) => (str(x, 500) ? [str(x, 500)!] : [])) : [];
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function yayindanEser(kaynak: KitapKaynagi, yayin: unknown): Work | undefined {
  const y = obj(yayin),
    md = obj(y.metadata),
    k = KITAP_KAYNAKLARI[kaynak];
  const baslik = str(md.title, 1000),
    link = adayAdresi(str(md.identifier));
  if (
    !baslik ||
    !link ||
    new URL(link).hostname !== k.host ||
    !["book", "chapter"].includes(String(md.docType))
  )
    return undefined;
  const doi = doiAnahtari(str(md.doi));
  const lisans = str(md.licence, 500);
  const linkNesneleri = Array.isArray(y.links) ? y.links : [y.links];
  const adaylar = linkNesneleri.flatMap((v): PdfAdayi[] => {
    const l = obj(v);
    if (l.type !== "application/pdf") return [];
    const hrefler = Array.isArray(l.href) ? l.href : [l.href];
    return hrefler.flatMap((v): PdfAdayi[] => {
      let url = str(v);
      const linkDoi = doiAnahtari(url);
      if (url && !/^https?:/i.test(url) && linkDoi) url = `https://doi.org/${linkDoi}`;
      const adres = adayAdresi(url);
      return adres
        ? [
            {
              url: adres,
              kaynak,
              kayitUrl: link,
              doi,
              lisans,
              baglantiTuru: /\.pdf(?:[?#]|$)/i.test(adres) ? "pdf" : "kayit",
              durum: "aday",
            },
          ]
        : [];
    });
  });
  const pdfAdaylari = pdfAdaylariniBirlestir(adaylar);
  const isbnler = [
    ...new Set(
      dizi(md.isbn)
        .map(isbnDogrula)
        .filter((i): i is string => Boolean(i)),
    ),
  ];
  const yil = Number(md.published),
    sayfa = Number(md.numberOfPages);
  return {
    kaynak,
    kaynakAd: k.ad,
    tur: "kitap",
    baslik,
    altBaslik: str(md.subtitle, 1000),
    yazarlar: dizi(md.author).slice(0, 30), // Editörler yazar olarak uydurulmaz.
    yil: Number.isInteger(yil) && yil >= 1000 && yil <= 2100 ? yil : undefined,
    ozet: str(md.description, 1200),
    konular: dizi(md.subject).slice(0, 14),
    dil: dizi(md.language)[0],
    yayinci: str(md.publisher, 500),
    // Birden fazla biçimin ISBN'sinden PDF baskısı için keyfi seçim yapılmaz.
    isbn: md.docType === "book" && isbnler.length === 1 ? isbnler[0] : undefined,
    doi,
    link,
    pdf: pdfAdaylari.find((a) => a.baglantiTuru === "pdf")?.url,
    pdfAdaylari,
    erisim: "acik",
    belgeTuru: md.docType === "chapter" ? "kitap-bolumu" : "kitap",
    kunyeTuru: "eser",
    sayfaSayisi:
      md.docType === "book" && Number.isInteger(sayfa) && sayfa > 0 && sayfa <= 100000
        ? sayfa
        : undefined,
    kapak: adayAdresi(str(obj(y.images).href)),
  };
}

/** Tam resmî akış biterse atomik yayımlar; başarısız güncelleme önceki indeksi korur. */
export async function katalogGuncelle(
  kaynak: KitapKaynagi,
  ilerleme: (adet: number) => void = () => undefined,
): Promise<KatalogBasligi> {
  const yanit = await get(KITAP_KAYNAKLARI[kaynak].url, {
    timeoutMs: 600000,
    tekrar: 0,
    header: { accept: "application/json" },
  });
  if (!yanit.body) throw Error("Katalog boş yanıt döndürdü");
  const klasor = path.dirname(katalogYolu(kaynak));
  await fsp.mkdir(klasor, { recursive: true });
  const gecici = path.join(klasor, `${kaynak}-${randomUUID()}.part`);
  const dosya = await fsp.open(gecici, "wx");
  let okunan = 0,
    atlanan = 0,
    beklenen: number | undefined;
  const kayitlar = new Map<string, Work>();
  try {
    for await (const yayin of yayinlariOku(
      yanit.body as unknown as AsyncIterable<Uint8Array>,
      (v) => {
        if (Array.isArray(v))
          beklenen = v
            .map((x) => obj(x).numberOfItems)
            .find((x): x is number => typeof x === "number");
      },
    )) {
      okunan++;
      const eser = yayindanEser(kaynak, yayin);
      if (eser) kayitlar.set(eser.link, eser);
      else atlanan++;
      if (okunan % 10000 === 0) ilerleme(okunan);
    }
    if (!okunan || !kayitlar.size || !Number.isInteger(beklenen) || beklenen !== okunan)
      throw Error(`Katalog eksik: bildirilen ${beklenen ?? "?"}, okunan ${okunan}`);
    const baslik: KatalogBasligi = {
      surum: 1,
      kaynak,
      url: KITAP_KAYNAKLARI[kaynak].url,
      alindi: new Date().toISOString(),
      kayitSayisi: kayitlar.size,
      okunan,
      atlanan,
      tam: true,
    };
    await dosya.write(JSON.stringify(baslik) + "\n");
    for (const w of kayitlar.values()) await dosya.write(JSON.stringify(w) + "\n");
    await dosya.sync();
    await dosya.close();
    await fsp.rename(gecici, katalogYolu(kaynak));
    bellek.delete(kaynak);
    return baslik;
  } catch (e) {
    await yanit.body.cancel().catch(() => undefined);
    await dosya.close().catch(() => undefined);
    await fsp.rm(gecici, { force: true });
    throw e;
  }
}

interface Indeks {
  baslik: KatalogBasligi;
  eserler: Work[];
  tokenIndeksi: Map<string, number[]>;
  isbnIndeksi: Map<string, number[]>;
}
const bellek = new Map<string, { surum: string; is: Promise<Indeks> }>();
async function katalogOku(kaynak: KitapKaynagi): Promise<Indeks> {
  const surum = `${katalogYolu(kaynak)}:${katalogSurumu(kaynak)}`;
  const mevcut = bellek.get(kaynak);
  if (mevcut?.surum === surum) return mevcut.is;
  const is = (async () => {
    const akim = fs.createReadStream(katalogYolu(kaynak));
    const eserler: Work[] = [],
      tokenIndeksi = new Map<string, number[]>(),
      isbnIndeksi = new Map<string, number[]>();
    let baslik: KatalogBasligi | undefined;
    try {
      for await (const deger of jsonSatirlariniOku(akim)) {
        if (!baslik) {
          baslik = deger as KatalogBasligi;
          if (
            baslik.surum !== 1 ||
            !baslik.tam ||
            baslik.kaynak !== kaynak ||
            !Number.isInteger(baslik.kayitSayisi)
          )
            throw Error("Katalog başlığı geçersiz");
          continue;
        }
        const w = deger as Work;
        // Önceki indekslerde bölüm kaydına taşınmış üst kitap alanlarını da düzelt.
        if (w.belgeTuru === "kitap-bolumu") {
          w.isbn = undefined;
          w.sayfaSayisi = undefined;
        }
        if (!w.baslik || w.kaynak !== kaynak || !Array.isArray(w.yazarlar) || !adayAdresi(w.link))
          throw Error("Katalog kaydı geçersiz");
        const i = eserler.length;
        eserler.push(w);
        for (const t of tokenlar(`${w.baslik} ${w.altBaslik ?? ""}`)) {
          const a = tokenIndeksi.get(t) ?? [];
          a.push(i);
          tokenIndeksi.set(t, a);
        }
        if (w.isbn) {
          const a = isbnIndeksi.get(w.isbn) ?? [];
          a.push(i);
          isbnIndeksi.set(w.isbn, a);
        }
      }
    } finally {
      akim.destroy();
    }
    if (!baslik || baslik.kayitSayisi !== eserler.length)
      throw Error("Katalog eksik/bozuk; yeniden güncelleyin");
    return { baslik, eserler, tokenIndeksi, isbnIndeksi };
  })();
  bellek.set(kaynak, { surum, is });
  try {
    return await is;
  } catch (e) {
    if (bellek.get(kaynak)?.is === is) bellek.delete(kaynak);
    throw e;
  }
}

export async function katalogdaAra(kaynak: KitapKaynagi, sorgu: Sorgu): Promise<Work[]> {
  let indeks: Indeks;
  try {
    indeks = await katalogOku(kaynak);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(
        `${KITAP_KAYNAKLARI[kaynak].ad} indeksi hazır değil. npm run sources:sync -- ${kaynak} komutuyla resmî üstveriyi indirin.`,
        { cause: e },
      );
    throw e;
  }
  const adaylar = new Set(tokenlar(sorgu.baslik).flatMap((t) => indeks.tokenIndeksi.get(t) ?? []));
  const isbn = isbnDogrula(sorgu.isbn);
  if (isbn) for (const i of indeks.isbnIndeksi.get(isbn) ?? []) adaylar.add(i);
  return [...adaylar]
    .map((i) => {
      const w = indeks.eserler[i]!;
      const es = eslestir(
        { baslik: sorgu.baslik, yazarlar: sorgu.yazar ? [sorgu.yazar] : [], yil: sorgu.yil },
        w,
      );
      return { w, es, kesin: Boolean(isbn && isbn === w.isbn) };
    })
    .filter((a) => a.kesin || a.es.baslik >= 0.3)
    .sort((a, b) => Number(b.kesin) - Number(a.kesin) || b.es.puan - a.es.puan)
    .slice(0, Math.min(50, sorgu.limit * 2))
    .map(({ w }) => {
      const doiUrl = doiAdresi(w.doi);
      return {
        ...w,
        pdfAdaylari: pdfAdaylariniBirlestir(
          w.pdfAdaylari,
          doiUrl
            ? [
                {
                  url: doiUrl,
                  kaynak,
                  kayitUrl: w.link,
                  doi: w.doi,
                  baglantiTuru: "kayit",
                  durum: "aday",
                },
              ]
            : [],
        ),
      };
    });
}
