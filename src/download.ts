import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import fs from "node:fs";
import { ayar } from "./config.js";
import { get } from "./http.js";
import { normalizeMetin } from "./normalize.js";

/*
 * Indirme: uzak PDF/tam metni downloads/ klasorune akis halinde yazar.
 * Tum dosya once bellek degil, dogrudan diske akar; boylece 200 MB'lik bir
 * PDF sunucu bellegini sigirmaz.
 */

const EN_FAZLA_BAYT = 300 * 1024 * 1024;

export interface IndirmeSonucu {
  dosya: string;
  yol: string;
  boyut: number;
  tur: "pdf" | "metin" | "bilinmiyor";
}

export interface Indirilebilir {
  url: string;
  varsayilanAd: string;
}

/** Dosya adini guvenli hale getirir: yol gezintisi ve kural disi karakter yok. */
export function dosyaAdiTemizle(ad: string, uzanti: ".pdf" | ".txt"): string {
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
  let yol = path.join(klasor, ad);
  if (!fs.existsSync(yol)) return yol;

  const temel = ad.replace(/\.(pdf|txt)$/, "");
  const uzanti = ad.endsWith(".pdf") ? ".pdf" : ".txt";
  for (let i = 2; i < 500; i++) {
    yol = path.join(klasor, `${temel}_${i}${uzanti}`);
    if (!fs.existsSync(yol)) return yol;
  }
  return path.join(klasor, `${temel}_${Date.now()}${uzanti}`);
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
  ipucuTur?: "pdf" | "metin",
): Promise<IndirmeSonucu> {
  const u = guvenliUrl(hedef.url);
  if (!u) throw new Error("Geçersiz indirme adresi");

  await fs.promises.mkdir(ayar.downloadsDir, { recursive: true });

  // Once HEAD/GET ile gercek dosya tipini ve boyutu ogren.
  const cevap = await get(u.toString(), {
    yonlendir: true,
    timeoutMs: 20_000,
    boslukMs: 400,
  });

  const icerikTipi = String(cevap.headers.get("content-type") ?? "").toLowerCase();
  const tur: IndirmeSonucu["tur"] =
    ipucuTur ??
    (icerikTipi.includes("pdf")
      ? "pdf"
      : icerikTipi.includes("text") || icerikTipi.includes("plain")
        ? "metin"
        : "bilinmiyor");

  const uzanti: ".pdf" | ".txt" = tur === "pdf" ? ".pdf" : ".txt";
  const yol = benzersizYol(ayar.downloadsDir, dosyaAdiTemizle(hedef.varsayilanAd, uzanti));

  const gecici = `${yol}.part`;
  const cikis = fs.createWriteStream(gecici);
  let yazilan = 0;

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
          yield b;
        }
      },
      cikis,
    );
  } catch (hata) {
    cikis.destroy();
    await fs.promises.rm(gecici, { force: true });
    throw hata;
  }

  await fs.promises.rename(gecici, yol);

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
        tur: d.name.endsWith(".pdf") ? "pdf" : d.name.endsWith(".txt") ? "metin" : "bilinmiyor",
      });
    }
    return cikti.sort((a, b) => b.tarih.localeCompare(a.tarih));
  } catch {
    return [];
  }
}
