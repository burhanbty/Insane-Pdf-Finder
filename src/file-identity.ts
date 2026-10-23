import fs from "node:fs/promises";
import { normalizeMetin, tokenlar, yazarParcalari } from "./normalize.js";
import { doiAnahtari } from "./doi.js";
import { isbnDogrula } from "./isbn.js";
import { istekSinyali } from "./deadline.js";

export interface EserKimligi {
  baslik: string;
  yazarlar?: string[];
  doi?: string;
  isbn?: string;
  baski?: string;
}
export interface DosyaDogrulamasi {
  durum: "dogrulandi" | "belirsiz" | "uyusmuyor";
  aciklama: string;
  kanitlar: string[];
  kontrolZamani: string;
  sayfaSayisi?: number;
  incelenenSayfa?: number;
}

/** Yalnızca belgenin ön künye bölümünü değerlendirir; kaynakçadaki DOI kanıt sayılmaz. */
export function kimligiKarsilastir(
  kimlik: EserKimligi,
  baslik: string,
  onMetin: string,
): DosyaDogrulamasi {
  const sonuc: DosyaDogrulamasi = {
    durum: "belirsiz",
    aciklama: "Dosya açıldı; eser kimliği için yeterli kanıt bulunamadı.",
    kanitlar: [],
    kontrolZamani: new Date().toISOString(),
  };
  const on = onMetin
    .split(/\b(?:references|bibliography|kaynakça|kaynaklar)\b/i)[0]!
    .slice(0, 16000);
  const norm = normalizeMetin(`${baslik}\n${on}`);
  const beklenen = tokenlar(kimlik.baslik);
  const bulunan = new Set(tokenlar(norm));
  const metinTokenlari = tokenlar(on);
  const baslikVar =
    beklenen.length >= 3 &&
    metinTokenlari.some((_t, i) => {
      const pencere = new Set(metinTokenlari.slice(i, i + Math.ceil(beklenen.length * 1.5)));
      return beklenen.filter((t) => pencere.has(t)).length / beklenen.length >= 0.9;
    });
  const metadataBaslik = normalizeMetin(baslik);
  const genel =
    /^(?:untitled|document|microsoft word|microsoft powerpoint|fulltext|thesis|tez|article|makale|book|kitap)\b/;
  const gucluBaslik = tokenlar(baslik).length >= 3 && !genel.test(metadataBaslik);
  const metadataUyum =
    normalizeMetin(kimlik.baslik) === metadataBaslik ||
    (beklenen.length >= 3 &&
      beklenen.filter((t) => tokenlar(baslik).includes(t)).length / beklenen.length >= 0.9);
  if (gucluBaslik && !metadataUyum && !baslikVar) {
    return {
      ...sonuc,
      durum: "uyusmuyor",
      aciklama: "PDF başlığı istenen eserle uyuşmuyor.",
      kanitlar: [`PDF başlığı: ${baslik.slice(0, 300)}`],
    };
  }
  const doi = doiAnahtari(kimlik.doi);
  // DOI'ler ancak ön bölümde ve başlık kanıtıyla değerlendirilir.
  const doiler = [...on.slice(0, 5000).matchAll(/10\.\d{4,9}\/[^\s<>"\]]+/gi)]
    .map((m) => doiAnahtari(m[0].replace(/[.,;)]+$/, "")))
    .filter(Boolean);
  const onDoi = [...on.slice(0, 2000).matchAll(/\bdoi\s*:\s*(10\.\d{4,9}\/[^\s<>"\]]+)/gi)]
    .map((m) => doiAnahtari(m[1]!.replace(/[.,;)]+$/, "")))
    .filter(Boolean);
  if (doi && onDoi.length === 1 && !onDoi.includes(doi))
    return {
      ...sonuc,
      durum: "uyusmuyor",
      aciklama: "PDF ön künyesinde bildirilen DOI istenen eserle uyuşmuyor.",
    };
  if (baslikVar) sonuc.kanitlar.push("Ön sayfalarda başlık kelimeleri bulundu");
  if (metadataUyum) sonuc.kanitlar.push("PDF üstverisindeki başlık uyuşuyor");
  const isbn = isbnDogrula(kimlik.isbn);
  const isbnler = [
    ...on.matchAll(
      /\bISBN(?:-1[03])?\s*:?\s*((?:97[89][ -]?)?\d(?:[ -]?\d){8}[ -]?[\dXx])(?!\d)/gi,
    ),
  ]
    .map((m) => isbnDogrula(m[1]))
    .filter(Boolean);
  if (isbn && isbnler.length && !isbnler.includes(isbn)) {
    return {
      ...sonuc,
      durum: "uyusmuyor",
      aciklama: "PDF içindeki ISBN istenen baskıyla uyuşmuyor.",
    };
  }
  const baski = /\b(\d+)\s*(?:st|nd|rd|th)?\s*(?:edition|baski)\b/.exec(normalizeMetin(on));
  const hedefBaski = kimlik.baski?.match(/\d+/)?.[0];
  if (hedefBaski && baski && Number(hedefBaski) !== Number(baski[1]))
    return {
      ...sonuc,
      durum: "uyusmuyor",
      aciklama: "PDF içindeki baskı numarası istenen baskıyla uyuşmuyor.",
    };
  if (isbn && isbnler.includes(isbn)) sonuc.kanitlar.push("PDF içindeki ISBN uyuşuyor");
  if (doi && doiler.includes(doi)) sonuc.kanitlar.push("Ön bölümde DOI bulundu");
  const yazarVar = kimlik.yazarlar?.some((y) =>
    yazarParcalari(y).soyad.some((s) => s.length >= 3 && bulunan.has(s)),
  );
  if (yazarVar) sonuc.kanitlar.push("Ön sayfalarda yazar soyadı bulundu");
  if (
    baslikVar &&
    /\b(?:book review|review of|kitap elestirisi|kitap tanitimi|sample chapter|preview|table of contents)\b/.test(
      normalizeMetin(on.slice(0, 1200)) + " " + metadataBaslik,
    )
  )
    return {
      ...sonuc,
      durum: "belirsiz",
      aciklama: "Dosya bir eleştiri, önizleme veya bölüm olabilir; tam eser doğrulanamadı.",
    };
  const baskiEksik = (isbn && !isbnler.includes(isbn)) || (hedefBaski && !baski);
  if (
    (baslikVar || metadataUyum) &&
    (yazarVar || (doi && doiler.includes(doi)) || (isbn && isbnler.includes(isbn))) &&
    !baskiEksik
  ) {
    sonuc.durum = "dogrulandi";
    sonuc.aciklama =
      "PDF başlığı ve kimlik kanıtları eserle eşleşti; kontrol ön sayfalarla sınırlıdır.";
  } else if (baskiEksik)
    sonuc.aciklama = "Dosya açıldı; istenen ISBN veya baskı dosya içinden doğrulanamadı.";
  return sonuc;
}

/** Büyük dosyalarda bellek sınırlı; OCR ve bütün kitap içeriği doğrulaması yapılmaz. */
export async function pdfKimliginiDogrula(
  yol: string,
  kimlik: EserKimligi,
): Promise<DosyaDogrulamasi> {
  const signal = istekSinyali.getStore();
  signal?.throwIfAborted();
  if ((await fs.stat(yol)).size > 40 * 1024 * 1024)
    return {
      durum: "belirsiz",
      aciklama: "Dosya 40 MB doğrulama sınırını aşıyor; içerik incelenmedi.",
      kanitlar: [],
      kontrolZamani: new Date().toISOString(),
    };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const yukleme = pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(yol)),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const iptal = () => {
    void yukleme.destroy().catch(() => undefined);
  };
  signal?.addEventListener("abort", iptal, { once: true });
  try {
    const belge = await yukleme.promise;
    const md = await belge.getMetadata();
    const info = md.info as Record<string, unknown>;
    const parcalar: string[] = [];
    const n = Math.min(4, belge.numPages);
    for (let i = 1; i <= n; i++) {
      signal?.throwIfAborted();
      const p = await belge.getPage(i);
      const t = await p.getTextContent();
      parcalar.push(t.items.map((v) => ("str" in v ? v.str : "")).join(" "));
      p.cleanup();
    }
    const sonuc = kimligiKarsilastir(
      kimlik,
      typeof info.Title === "string" ? info.Title : "",
      parcalar.join("\n"),
    );
    return { ...sonuc, sayfaSayisi: belge.numPages, incelenenSayfa: n };
  } catch (e) {
    signal?.throwIfAborted();
    // Bozuk, şifreli ve açılamayan dosyalar alternatif kopyaya geçmelidir.
    throw new Error(`PDF açılamadı veya kimliği okunamadı: ${(e as Error).message}`, { cause: e });
  } finally {
    signal?.removeEventListener("abort", iptal);
    await yukleme.destroy();
  }
}

export function kimlikGirdisi(v: unknown): EserKimligi | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Geçersiz eser kimliği");
  const g = v as Record<string, unknown>;
  if (typeof g.baslik !== "string" || !g.baslik.trim() || g.baslik.length > 1000)
    throw Error("Geçersiz eser başlığı");
  const sonuc: EserKimligi = { baslik: g.baslik.trim() };
  if (g.yazarlar !== undefined) {
    if (
      !Array.isArray(g.yazarlar) ||
      g.yazarlar.length > 20 ||
      g.yazarlar.some((y) => typeof y !== "string" || y.length > 300)
    )
      throw Error("Geçersiz eser yazarları");
    sonuc.yazarlar = g.yazarlar;
  }
  for (const a of ["doi", "isbn", "baski"] as const) {
    if (g[a] === undefined || g[a] === "") continue;
    if (typeof g[a] !== "string" || g[a].length > 300) throw Error("Geçersiz eser kimlik alanı");
    if (a === "doi" && !doiAnahtari(g[a])) throw Error("Geçersiz DOI");
    if (a === "isbn" && !isbnDogrula(g[a])) throw Error("Geçersiz ISBN");
    sonuc[a] = g[a];
  }
  return sonuc;
}
