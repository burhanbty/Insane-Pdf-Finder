import type { SourceModule, Sorgu, Work } from "../types.js";

type AnnaKayit = {
  baslik: string;
  yazarlar: string[];
  yayinci?: string;
  yil?: number;
  dil?: string;
  boyut?: string;
  uzanti?: string;
  ozet?: string;
  kapak?: string;
  md5: string;
  ayna: string;
};

/*
 * Anna's Archive'ın arama sonuçları için kullanılan aynalar.
 * .is aynası 2026'da bazı istemcilerde JS-hydrated sonuçlara geçtiği için
 * burada önce server-rendered HTML döndürdüğü bilinen aynaları deniyoruz.
 */
const AYNALAR = [
  "https://annas-archive.gl",
  "https://annas-archive.org",
  "https://annas-archive.li",
  "https://annas-archive.se",
  "https://annas-archive.pk",
  "https://annas-archive.gd",
] as const;

const TARAYICI_UA =
  "Mozilla/5.0 (X11; Linux x86_64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const MD5_LINK_RE = /\/md5\/([a-f0-9]{32})/gi;

function htmlCoz(metin: string): string {
  return metin
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) =>
      String.fromCodePoint(Number.parseInt(d, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlMetin(html: string): string {
  return htmlCoz(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\t\r ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim(),
  );
}

function tekSatirMetin(html: string): string {
  return htmlMetin(html).replace(/\s+/g, " ").trim();
}

function yilCoz(metin?: string): number | undefined {
  if (!metin) return undefined;

  const yillar = [
    ...metin.matchAll(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/g),
  ];

  if (yillar.length === 0) return undefined;

  // Metadata satırında bazen birden fazla tarih oluyor; en sondaki genelde
  // baskı/kayıt yılına en yakın bilgi.
  const yil = Number(yillar[yillar.length - 1][1]);
  return Number.isFinite(yil) ? yil : undefined;
}

function yazarlariAyir(metin?: string): string[] {
  const temiz = metin?.trim();
  if (!temiz) return [];

  // Virgül çoğu kayıtta "Soyad, Ad" biçiminin parçası olduğu için virgülden
  // bölmüyoruz. Noktalı virgül daha güvenilir bir yazar ayıracı.
  const yazarlar = temiz
    .split(/\s*;\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

  return [...new Set(yazarlar)];
}

function mutlakUrl(url: string | undefined, ayna: string): string | undefined {
  if (!url) return undefined;

  const temiz = htmlCoz(url.trim());
  if (!temiz) return undefined;

  try {
    return new URL(temiz, ayna).toString();
  } catch {
    return undefined;
  }
}

function kartBaslangici(html: string, index: number): number {
  // Güncel sonuç kartı: <div class="flex  pt-3 pb-3 ...">
  // En yakın üst "flex" div'i kartın dış kabı oluyor.
  const cift = html.lastIndexOf('<div class="flex', index);
  const tek = html.lastIndexOf("<div class='flex", index);
  return Math.max(cift, tek, 0);
}

function kartBitisi(html: string, index: number): number {
  const cift = html.indexOf('<div class="flex', index + 100);
  const tek = html.indexOf("<div class='flex", index + 100);

  const adaylar = [cift, tek].filter((x) => x >= 0);
  if (adaylar.length === 0) return Math.min(html.length, index + 12_000);
  return Math.min(...adaylar);
}

function metaBilgisiCoz(kart: string): {
  dil?: string;
  uzanti?: string;
  boyut?: string;
  yil?: number;
} {
  // Örnek:
  // English [en] · EPUB · 0.4MB · 2014 · 📕 Book (fiction) · ...
  const metaHtml =
    kart.match(
      /<div\b[^>]*class=["'][^"']*text-gray-800[^"']*font-semibold[^"']*["'][^>]*>([\s\S]{0,1500}?)(?:<a\b|<script\b|<\/div>)/i,
    )?.[1] ??
    kart.match(
      /<div\b[^>]*class=["'][^"']*font-semibold[^"']*text-sm[^"']*["'][^>]*>([\s\S]{0,1500}?)(?:<a\b|<script\b|<\/div>)/i,
    )?.[1];

  const meta = metaHtml ? tekSatirMetin(metaHtml) : "";
  if (!meta) return {};

  const parcalar = meta
    .split("·")
    .map((x) => x.trim())
    .filter(Boolean);

  let dil: string | undefined;
  let uzanti: string | undefined;
  let boyut: string | undefined;
  let yil: number | undefined;

  for (const parca of parcalar) {
    const dilEslesme = parca.match(/\[([a-z]{2,3})\]/i);
    if (!dil && dilEslesme) {
      dil = dilEslesme[1].toLowerCase();
      continue;
    }

    if (!boyut && /^\d+(?:[.,]\d+)?\s*(?:B|KB|MB|GB|TB)$/i.test(parca)) {
      boyut = parca;
      continue;
    }

    if (!yil) {
      const bulunanYil = yilCoz(parca);
      if (bulunanYil) {
        yil = bulunanYil;
        continue;
      }
    }

    const token = parca.toLowerCase();
    if (
      !uzanti &&
      /^[a-z][a-z0-9]{0,5}$/i.test(token) &&
      !parca.includes("[") &&
      !["book", "paper", "journal"].includes(token)
    ) {
      uzanti = token;
    }
  }

  return { dil, uzanti, boyut, yil };
}

function kartiCoz(kart: string, md5: string, ayna: string): AnnaKayit | undefined {
  const baslikHtml = kart.match(
    /<a\b[^>]*class=["'][^"']*js-vim-focus[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
  )?.[1];

  const baslik = baslikHtml ? tekSatirMetin(baslikHtml) : "";
  if (!baslik) return undefined;

  const yazarHtml = kart.match(
    /<a\b[^>]*>\s*<span\b[^>]*mdi--user-edit[^>]*><\/span>\s*([\s\S]*?)<\/a>/i,
  )?.[1];
  const yazar = yazarHtml ? tekSatirMetin(yazarHtml) : undefined;

  const yayinciHtml = kart.match(
    /<a\b[^>]*>\s*<span\b[^>]*mdi--company[^>]*><\/span>\s*([\s\S]*?)<\/a>/i,
  )?.[1];
  const yayinci = yayinciHtml ? tekSatirMetin(yayinciHtml) : undefined;

  const ozetHtml = kart.match(
    /<div\b[^>]*class=["'][^"']*text-gray-600[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  )?.[1];
  const ozet = ozetHtml ? tekSatirMetin(ozetHtml).slice(0, 700) : undefined;

  const resimTag = kart.match(/<img\b[^>]*object-cover[^>]*>/i)?.[0];
  const resimSrc = resimTag?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  const kapak = mutlakUrl(resimSrc, ayna);

  const dosyaYoluHtml = kart.match(
    /<div\b[^>]*class=["'][^"']*font-mono[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  )?.[1];
  const dosyaYolu = dosyaYoluHtml ? tekSatirMetin(dosyaYoluHtml) : undefined;

  const meta = metaBilgisiCoz(kart);

  let uzanti = meta.uzanti;
  if (!uzanti && dosyaYolu) {
    const ext = dosyaYolu.match(/\.([a-z0-9]{1,8})\s*$/i)?.[1];
    if (ext) uzanti = ext.toLowerCase();
  }

  return {
    baslik,
    yazarlar: yazarlariAyir(yazar),
    yayinci,
    yil: meta.yil ?? yilCoz(yayinci),
    dil: meta.dil,
    boyut: meta.boyut,
    uzanti,
    ozet,
    kapak,
    md5: md5.toLowerCase(),
    ayna,
  };
}

function sonuclariCoz(html: string, ayna: string, limit: number): AnnaKayit[] {
  const sonuc: AnnaKayit[] = [];
  const gorulen = new Set<string>();

  for (const eslesme of html.matchAll(MD5_LINK_RE)) {
    const md5 = eslesme[1].toLowerCase();
    if (gorulen.has(md5)) continue;
    gorulen.add(md5);

    const index = eslesme.index ?? 0;
    const baslangic = kartBaslangici(html, index);
    const bitis = kartBitisi(html, index);
    const kart = html.slice(baslangic, bitis);

    const kayit = kartiCoz(kart, md5, ayna);
    if (!kayit) continue;

    sonuc.push(kayit);
    if (sonuc.length >= limit) break;
  }

  return sonuc;
}

function botKontroluMu(html: string): boolean {
  return (
    /<title>\s*(?:just a moment|checking your browser)/i.test(html) ||
    /ddos-guard/i.test(html) ||
    /cf-chl-/i.test(html) ||
    /enable javascript and cookies to continue/i.test(html)
  );
}

function jsHydratedSonucMu(html: string): boolean {
  // 2026'da bazı aynalarda kartlar HTML'de bulunuyor ama /md5/... bağlantıları
  // app.js tarafından sonradan ekleniyor. Bunu gerçek "0 sonuç" sanmıyoruz.
  const kartVar =
    /js-(?:aa)?record-list-fallback-cover/i.test(html) ||
    /js-book-list-fallback-cover/i.test(html) ||
    /showing\s+\d+\s+results/i.test(html) ||
    /results\s+\d+\s*[-–]\s*\d+/i.test(html);

  return kartVar && !/\/md5\/[a-f0-9]{32}/i.test(html);
}

function gercekBosSonucMu(html: string): boolean {
  return (
    /no (?:files|results|records) (?:were )?found/i.test(html) ||
    /\b0\s+(?:results|records)\b/i.test(html) ||
    /results\s+0\s*[-–]\s*0/i.test(html)
  );
}

async function htmlGetir(url: string): Promise<string> {
  const controller = new AbortController();
  const zamanAsimi = setTimeout(() => controller.abort(), 20_000);

  try {
    const cevap = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": TARAYICI_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
        "Cache-Control": "no-cache",
      },
    });

    if (!cevap.ok) {
      throw new Error(`${new URL(url).host} HTTP ${cevap.status}`);
    }

    const html = await cevap.text();

    if (botKontroluMu(html)) {
      throw new Error(`${new URL(url).host} bot kontrolü döndürdü`);
    }

    return html;
  } finally {
    clearTimeout(zamanAsimi);
  }
}

function aramaUrlOlustur(ayna: string, sorgu: Sorgu, terimler: string): string {
  const u = new URL("/search", ayna);
  u.searchParams.set("q", terimler);

  // Güncel arayüzde Journal articles sekmesi index=journals kullanıyor.
  if (sorgu.tur === "makale") {
    u.searchParams.set("index", "journals");
  }

  return u.toString();
}

async function annaAra(sorgu: Sorgu, terimler: string, limit: number): Promise<AnnaKayit[]> {
  let sonHata: unknown;

  for (const ayna of AYNALAR) {
    try {
      const url = aramaUrlOlustur(ayna, sorgu, terimler);
      const html = await htmlGetir(url);
      const kayitlar = sonuclariCoz(html, ayna, limit);

      if (kayitlar.length > 0) return kayitlar;

      if (gercekBosSonucMu(html)) {
        return [];
      }

      if (jsHydratedSonucMu(html)) {
        sonHata = new Error(`${new URL(ayna).host} JS-hydrated sonuç sayfası döndürdü`);
        continue;
      }

      // Sayfa geldi ama beklenen Anna's Archive sonuç yapısını bulamadık.
      sonHata = new Error(`${new URL(ayna).host} sonuç HTML'i parse edilemedi`);
    } catch (hata) {
      sonHata = hata;
    }
  }

  if (sonHata instanceof Error) {
    throw new Error(`Anna's Archive aynaları başarısız: ${sonHata.message}`);
  }

  throw new Error("Anna's Archive aynaları başarısız");
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const baslik = sorgu.baslik.trim();
  if (!baslik) return [];

  const terimler = sorgu.yazar
    ? `${baslik} ${sorgu.yazar.trim()}`.trim()
    : baslik;

  const limit = Math.max(1, Math.min(50, sorgu.limit));
  let kayitlar = await annaAra(sorgu, terimler, limit);

  if (sorgu.yil) {
    kayitlar = kayitlar.filter((k) => k.yil === sorgu.yil);
  }

  return kayitlar.slice(0, limit).map((k): Work => {
    const dosyaBilgisi = [
      k.uzanti ? `Dosya türü: ${k.uzanti.toUpperCase()}` : undefined,
      k.boyut ? `Boyut: ${k.boyut}` : undefined,
    ]
      .filter(Boolean)
      .join(" • ");

    const ozet = [k.ozet, dosyaBilgisi || undefined]
      .filter(Boolean)
      .join(" • ") || undefined;

    return {
      kaynak: "annas-archive",
      kaynakAd: "Anna's Archive",
      tur: sorgu.tur,
      baslik: k.baslik,
      yazarlar: k.yazarlar,
      yil: k.yil,
      yayinci: k.yayinci,
      dil: k.dil,
      ozet,
      kapak: k.kapak,

      // Doğrudan dosya URL'si üretmiyoruz; yalnızca kayıt/detay sayfasına gider.
      link: `${k.ayna}/md5/${encodeURIComponent(k.md5)}`,
      erisim: "yonlendir",
    };
  });
}

const kaynak: SourceModule = {
  id: "annas-archive",
  ad: "Anna's Archive",
  tur: ["kitap", "makale"],
  aciklama: "Anna's Archive üzerinde kitap ve makale kayıtları arar",
  ara,
};

export default kaynak;
