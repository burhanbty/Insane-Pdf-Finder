import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ayar } from "./config.js";
import type { KaynakInfo, SourceModule } from "./types.js";
import { kaynakHazirligi } from "./source-state.js";

/*
 * Kaynak kayit sistemi.
 *
 * src/sources/ klasorundeki her .ts dosyasi otomatik yuklenir ve varsayilan
 * export'u SourceModule olmalidir. Yeni bir kaynak eklemek icin:
 *
 *   src/sources/benim-sitem.ts  dosyasini olusturup asagidaki sekilde
 *   yazman yeterli; burada hicbir degisiklik gerekmez.
 *
 *   export default {
 *     id: "benim-sitem",
 *     ad: "Benim Sitem",
 *     tur: ["kitap", "makale"],
 *     aciklama: "Ne yaptigini bir cumleyle yaz",
 *     hazirMi: () => Boolean(process.env.BENIM_API_KEY),   // istege bagli
 *     ara: async (sorgu) => [ ... Work[] ... ],
 *   };
 */

let kayitli: SourceModule[] | null = null;
let yukleme: Promise<SourceModule[]> | null = null;
const yuklenmeHatalari: { dosya: string; hata: string }[] = [];

export async function kaynaklariYukle(): Promise<SourceModule[]> {
  if (kayitli) return kayitli;
  return (yukleme ??= kaynaklariOku());
}

async function kaynaklariOku(): Promise<SourceModule[]> {
  const dizin = ayar.sourcesDir;
  let dosyalar: string[];

  try {
    dosyalar = (await fs.readdir(dizin))
      .filter((d) => d.endsWith(".ts") && !d.endsWith(".d.ts") && !d.startsWith("_"))
      .sort();
  } catch (hata) {
    // Kaynak klasoru bulunamadi. Once sessizce bos liste donmek, aramanin
    // neden bos kaldigini gormeyi imkansiz kiliyordu; hatayi kaydet ve
    // arama katmanina bildir.
    yuklenmeHatalari.push({
      dosya: dizin,
      hata: `Kaynak klasörü okunamadı: ${(hata as Error).message}`,
    });
    kayitli = [];
    return kayitli;
  }

  const yuklenen: SourceModule[] = [];

  for (const dosya of dosyalar) {
    const tamYol = path.join(dizin, dosya);
    try {
      // Windows'ta import() mutlak yol degil file:// URL kabul eder.
      const modUrl = pathToFileURL(tamYol).href;
      const mod = (await import(modUrl)) as { default?: SourceModule };
      const k = mod.default;
      if (!k || typeof k.ara !== "function") {
        throw new Error("varsayılan export SourceModule değil");
      }
      if (
        typeof k.id !== "string" ||
        !k.id ||
        typeof k.ad !== "string" ||
        !k.ad ||
        !Array.isArray(k.tur)
      ) {
        throw new Error("id, ad veya tur eksik");
      }
      if (
        !/^[a-z0-9][a-z0-9-]*$/i.test(k.id) ||
        !k.tur.length ||
        k.tur.some((tur) => !["kitap", "makale", "slayt"].includes(tur))
      ) {
        throw new Error("Kaynak kimliği veya türleri geçersiz");
      }
      if (yuklenen.some((onceki) => onceki.id === k.id))
        throw new Error(`Kaynak kimliği tekrar ediyor: ${k.id}`);
      yuklenen.push(k);
    } catch (hata) {
      yuklenmeHatalari.push({ dosya, hata: (hata as Error).message });
    }
  }

  kayitli = yuklenen;
  return kayitli;
}

export function kaynakListesi(): KaynakInfo[] {
  return (kayitli ?? []).map((k) => ({
    id: k.id,
    ad: k.ad,
    tur: k.tur,
    aciklama: k.aciklama ?? "",
    ...kaynakHazirligi(k),
  }));
}

export function yuklenmeHataListesi() {
  return yuklenmeHatalari;
}

/** Testler ve yeniden yukleme icin. */
export function kayitTemizle() {
  kayitli = null;
  yukleme = null;
  yuklenmeHatalari.length = 0;
}

export async function kaynakGetir(id: string): Promise<SourceModule | undefined> {
  const kaynaklar = await kaynaklariYukle();
  return kaynaklar.find((k) => k.id === id);
}
