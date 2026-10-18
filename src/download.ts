import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import fs from "node:fs";
import { ayar } from "./config.js";
import { get } from "./http.js";
import { normalizeMetin } from "./normalize.js";
import { pdfImzasi } from "./body.js";
import { pdfYanitiniBul } from "./pdf-resolver.js";
import { sureSinirli } from "./deadline.js";

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
}

export interface Indirilebilir {
  url: string;
  varsayilanAd: string;
  alternatifler?: string[];
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
): Promise<IndirmeSonucu> {
  return sureSinirli(() => indirDosya(hedef, ipucuTur), 120_000);
}

async function indirDosya(
  hedef: Indirilebilir,
  ipucuTur?: "pdf" | "epub" | "metin",
): Promise<IndirmeSonucu> {
  const u = guvenliUrl(hedef.url);
  if (!u) throw new Error("Geçersiz indirme adresi");

  await fs.promises.mkdir(ayar.downloadsDir, { recursive: true });

  // Once HEAD/GET ile gercek dosya tipini ve boyutu ogren.
  const cevap =
    ipucuTur === "pdf"
      ? await pdfYanitiniBul([u.toString(), ...(hedef.alternatifler ?? []).slice(0, 5)])
      : await get(u.toString(), {
          disAg: true,
          tekrar: 0,
          yonlendir: true,
          timeoutMs: 90_000,
          boslukMs: 400,
        });

  const icerikTipi = String(cevap.headers.get("content-type") ?? "").toLowerCase();
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

  try {
    const govde = cevap.body;
    if (!govde) throw new Error("Boş yanıt gövdesi");

    await pipeline(
      Readable.fromWeb(govde as Parameters<typeof Readable.fromWeb>[0]),
      async function* (kaynak) {
        for await (const parca of kaynak) {
          const b = parca as Buffer;
          yazilan += b.byteLength;
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
    await fs.promises.rename(gecici, yol);
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
