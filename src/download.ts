import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { ayar } from "./config.js";
import { get } from "./http.js";
import { normalizeMetin } from "./normalize.js";
import { pdfImzasi } from "./body.js";
import { pdfYanitiniBul } from "./pdf-resolver.js";
import { istekSinyali, sureSinirli } from "./deadline.js";
import { pdfKimliginiDogrula, type EserKimligi, type DosyaDogrulamasi } from "./file-identity.js";

/*
 * Indirme: uzak PDF/tam metni downloads/ klasorune akis halinde yazar.
 * Tum dosya once bellek degil, dogrudan diske akar; boylece 200 MB'lik bir
 * PDF sunucu bellegini sigirmaz.
 */

const EN_FAZLA_BAYT = 300 * 1024 * 1024;

function epubImzasi(b: Buffer): boolean {
  return (
    b.length >= 58 &&
    b.readUInt32LE(0) === 0x04034b50 &&
    b.readUInt16LE(8) === 0 &&
    b.readUInt16LE(26) === 8 &&
    b.readUInt16LE(28) === 0 &&
    b.subarray(30, 38).toString() === "mimetype" &&
    b.subarray(38, 58).toString() === "application/epub+zip"
  );
}

export interface IndirmeSonucu {
  dosya: string;
  yol: string;
  boyut: number;
  tur: "pdf" | "epub" | "metin" | "bilinmiyor";
  mevcut?: boolean;
  dogrulama?: DosyaDogrulamasi;
  kopyaDenemesi?: number;
}

export interface Indirilebilir {
  url: string;
  varsayilanAd: string;
  alternatifler?: string[];
  kimlik?: EserKimligi;
}

export interface IndirmeSecenekleri {
  signal?: AbortSignal;
  tekillestir?: boolean;
  kopyaDenemesi?: (sira: number) => void;
  ilerleme?: (durum: {
    alinan: number;
    toplam?: number;
    asama: "baglaniyor" | "indiriliyor" | "dogrulaniyor";
  }) => void;
}

// Aynı anda biten iki indirme de aynı içerik için ikinci dosya oluşturmasın.
let bitirmeSirasi: Promise<unknown> = Promise.resolve();
async function ayniDosyayiBul(
  yol: string,
  boyut: number,
  ozet: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const kok = path.dirname(yol);
  const dosyalar = await fs.promises.readdir(kok, { withFileTypes: true });
  for (const d of dosyalar) {
    signal.throwIfAborted();
    if (!d.isFile() || path.extname(d.name) !== path.extname(yol)) continue;
    const aday = path.join(kok, d.name);
    try {
      if ((await fs.promises.lstat(aday)).size !== boyut) continue;
      // Sembolik bağlantılar ve kök dışına yönelen dosyalar kullanılmaz.
      const st = await fs.promises.lstat(aday);
      if (
        !st.isFile() ||
        path.dirname(await fs.promises.realpath(aday)) !== (await fs.promises.realpath(kok))
      )
        continue;
      const hash = createHash("sha256");
      for await (const b of fs.createReadStream(aday, { signal })) hash.update(b);
      if (hash.digest("hex") === ozet) return aday;
    } catch (hata) {
      signal.throwIfAborted();
      if ((hata as NodeJS.ErrnoException).code !== "ENOENT") throw hata;
    }
  }
  return undefined;
}

/** Dosya adini guvenli hale getirir: yol gezintisi ve kural disi karakter yok. */
export function dosyaAdiTemizle(ad: string, uzanti: ".pdf" | ".epub" | ".txt"): string {
  const temiz = normalizeMetin(ad)
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);

  const govde = temiz || "icerik";
  return `${govde}${uzanti}`;
}

/** Ayni isimde dosya varsa sonuna sayi ekler. */
export function benzersizYol(klasor: string, ad: string): string {
  const musait = (yol: string) => !fs.existsSync(yol) && !fs.existsSync(`${yol}.part`);
  let yol = path.join(klasor, ad);
  if (musait(yol)) return yol;

  const uzanti = path.extname(ad);
  const temel = path.basename(ad, uzanti);
  for (let i = 2; i < 500; i++) {
    yol = path.join(klasor, `${temel}_${i}${uzanti}`);
    if (musait(yol)) return yol;
  }
  return path.join(klasor, `${temel}_${Date.now()}${uzanti}`);
}

/** Dosya adini diskte atomik olarak ayirir; baska indirme ayni adi alamaz. */
async function indirmeYoluAyir(klasor: string, ad: string): Promise<string> {
  for (;;) {
    const yol = benzersizYol(klasor, ad);
    const gecici = `${yol}.part`;
    let dosya: fs.promises.FileHandle;
    try {
      dosya = await fs.promises.open(gecici, "wx");
    } catch (hata) {
      if ((hata as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw hata;
    }
    await dosya.close();
    // Aday secilirken diger indirme bitip .part -> asil ad yapmis olabilir.
    if (fs.existsSync(yol)) {
      await fs.promises.rm(gecici, { force: true });
      continue;
    }
    return yol;
  }
}

/** Guvenli mi: yalnizca http(s). */
function guvenliUrl(aday: string): URL | null {
  try {
    const u = new URL(aday);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * URL'den indirir. Yaygin tip belirleyicilerinden (Google Docs export vb.)
 * gercek PDF adresine yonlendirmeyi takip eder.
 */
export async function indir(
  hedef: Indirilebilir,
  ipucuTur?: "pdf" | "epub" | "metin",
  secenek: IndirmeSecenekleri = {},
): Promise<IndirmeSonucu> {
  return sureSinirli(
    () => {
      const signal = AbortSignal.any([
        istekSinyali.getStore()!,
        ...(secenek.signal ? [secenek.signal] : []),
      ]);
      return istekSinyali.run(signal, () => indirDosya(hedef, ipucuTur, { ...secenek, signal }));
    },
    120_000,
    true,
  );
}

async function indirDosya(
  hedef: Indirilebilir,
  ipucuTur?: "pdf" | "epub" | "metin",
  secenek: IndirmeSecenekleri = {},
): Promise<IndirmeSonucu> {
  const signal = secenek.signal!;
  signal.throwIfAborted();
  secenek.ilerleme?.({ alinan: 0, asama: "baglaniyor" });
  const u = guvenliUrl(hedef.url);
  if (!u) throw new Error("Geçersiz indirme adresi");

  await fs.promises.mkdir(ayar.downloadsDir, { recursive: true });

  // Once HEAD/GET ile gercek dosya tipini ve boyutu ogren.
  if (ipucuTur === "pdf") {
    let sonuc: IndirmeSonucu | undefined;
    let sira = 0;
    await pdfYanitiniBul([u.toString(), ...(hedef.alternatifler ?? []).slice(0, 5)], {
      deneme: (n) => {
        sira = n;
        secenek.kopyaDenemesi?.(n);
      },
      kabul: async (r) => {
        const altSignal = istekSinyali.getStore()!;
        sonuc = await yanitiKaydet(r, hedef, ipucuTur, { ...secenek, signal: altSignal });
      },
    });
    return { ...sonuc!, kopyaDenemesi: sira };
  }
  const cevap = await get(u.toString(), {
    disAg: true,
    tekrar: 0,
    yonlendir: true,
    timeoutMs: 90_000,
    boslukMs: 400,
  });
  return yanitiKaydet(cevap, hedef, ipucuTur, secenek);
}

async function yanitiKaydet(
  cevap: Response,
  hedef: Indirilebilir,
  ipucuTur: "pdf" | "epub" | "metin" | undefined,
  secenek: IndirmeSecenekleri,
): Promise<IndirmeSonucu> {
  const signal = secenek.signal!;

  const icerikTipi = String(cevap.headers.get("content-type") ?? "").toLowerCase();
  const uzunluk = Number(cevap.headers.get("content-length"));
  const toplam =
    Number.isSafeInteger(uzunluk) && uzunluk > 0 && !cevap.headers.get("content-encoding")
      ? uzunluk
      : undefined;
  if (Number(cevap.headers.get("content-length")) > EN_FAZLA_BAYT) {
    await cevap.body?.cancel();
    throw new Error("Dosya 300 MB sınırını aşıyor");
  }
  const tur: IndirmeSonucu["tur"] =
    ipucuTur ??
    (icerikTipi.includes("pdf")
      ? "pdf"
      : icerikTipi.includes("text") || icerikTipi.includes("plain")
        ? "metin"
        : "bilinmiyor");

  const uzanti = tur === "epub" ? ".epub" : tur === "pdf" ? ".pdf" : ".txt";
  let yol: string;
  try {
    yol = await indirmeYoluAyir(ayar.downloadsDir, dosyaAdiTemizle(hedef.varsayilanAd, uzanti));
  } catch (hata) {
    await cevap.body?.cancel().catch(() => undefined);
    throw hata;
  }

  const gecici = `${yol}.part`;
  const cikis = fs.createWriteStream(gecici, { flags: "r+" });
  let yazilan = 0;
  let ilk = Buffer.alloc(0);
  const hash = createHash("sha256");
  let mevcut = false;
  let dogrulama: DosyaDogrulamasi | undefined;

  try {
    const govde = cevap.body;
    if (!govde) throw new Error("Boş yanıt gövdesi");

    await pipeline(
      Readable.fromWeb(govde as Parameters<typeof Readable.fromWeb>[0]),
      async function* (kaynak) {
        for await (const parca of kaynak) {
          const b = parca as Buffer;
          yazilan += b.byteLength;
          hash.update(b);
          secenek.ilerleme?.({ alinan: yazilan, toplam, asama: "indiriliyor" });
          if (yazilan > EN_FAZLA_BAYT) {
            throw new Error(`Dosya ${EN_FAZLA_BAYT / 1024 / 1024} MB sınırını aşıyor`);
          }
          if (ilk.length < 512) ilk = Buffer.concat([ilk, b.subarray(0, 512 - ilk.length)]);
          if (tur === "pdf" && ilk.length >= 5 && !pdfImzasi(ilk))
            throw new Error("Kaynak PDF yerine farklı içerik döndürdü");
          if (tur === "epub" && ilk.length >= 58 && !epubImzasi(ilk))
            throw new Error("Kaynak geçerli EPUB içeriği döndürmedi");
          yield b;
        }
      },
      cikis,
      { signal },
    );
    if (!yazilan) throw new Error("Boş dosya indirilemez");
    if (tur === "pdf" && !pdfImzasi(ilk))
      throw new Error("Kaynak PDF yerine farklı içerik döndürdü");
    if (tur === "epub" && !epubImzasi(ilk)) {
      throw new Error("Kaynak geçerli EPUB içeriği döndürmedi");
    }
    if (
      tur === "metin" &&
      (/html/i.test(icerikTipi) ||
        /<!doctype\s+html|<html[\s>]/i.test(ilk.toString()) ||
        ilk.includes(0))
    ) {
      throw new Error("Kaynak düz metin yerine farklı içerik döndürdü");
    }
    secenek.ilerleme?.({ alinan: yazilan, toplam, asama: "dogrulaniyor" });
    if (tur === "pdf" && hedef.kimlik) {
      dogrulama = await pdfKimliginiDogrula(gecici, hedef.kimlik);
      if (dogrulama.durum === "uyusmuyor") throw new Error(dogrulama.aciklama);
    }
    const bitir = async () => {
      signal.throwIfAborted();
      const bulunan = secenek.tekillestir
        ? await ayniDosyayiBul(yol, yazilan, hash.digest("hex"), signal)
        : undefined;
      signal.throwIfAborted();
      if (bulunan) {
        await fs.promises.rm(gecici);
        yol = bulunan;
        mevcut = true;
      } else await fs.promises.rename(gecici, yol);
    };
    if (secenek.tekillestir) {
      const sira = bitirmeSirasi.catch(() => undefined).then(bitir);
      bitirmeSirasi = sira;
      await sira;
    } else await bitir();
  } catch (hata) {
    cikis.destroy();
    await fs.promises.rm(gecici, { force: true });
    throw hata;
  }

  return {
    dosya: path.basename(yol),
    yol,
    boyut: yazilan,
    tur,
    ...(dogrulama ? { dogrulama } : {}),
    ...(mevcut ? { mevcut } : {}),
  };
}

export interface KayitliDosya {
  dosya: string;
  boyut: number;
  tarih: string;
  tur: string;
}

export async function indirilenleriListele(): Promise<KayitliDosya[]> {
  try {
    const dosyalar = await fs.promises.readdir(ayar.downloadsDir, { withFileTypes: true });
    const cikti: KayitliDosya[] = [];
    for (const d of dosyalar) {
      if (!d.isFile() || d.name.startsWith(".") || d.name.endsWith(".part")) continue;
      const tam = path.join(ayar.downloadsDir, d.name);
      const st = await fs.promises.stat(tam);
      cikti.push({
        dosya: d.name,
        boyut: st.size,
        tarih: st.mtime.toISOString(),
        tur: d.name.endsWith(".pdf")
          ? "pdf"
          : d.name.endsWith(".epub")
            ? "epub"
            : d.name.endsWith(".txt")
              ? "metin"
              : "bilinmiyor",
      });
    }
    return cikti.sort((a, b) => b.tarih.localeCompare(a.tarih));
  } catch {
    return [];
  }
}
