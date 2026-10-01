import { onbellekli } from "./cache.js";
import { get } from "./http.js";

/*
 * Bir PDF'in kac sayfa oldugunu ogrenmek.
 *
 * Kaynaklar cogunlukla sayfa sayisini vermiyor (arXiv, Zenodo, OpenAIRE).
 * Sayfa sayisi PDF'in icindeki sayfa agacinda (/Type /Pages /Count N)
 * bulunuyor; dosyayi tam indirmeden guvenilir sekilde okunabiliyor ama
 * pratikte guvenilir bir yontem degil: ayni dosyada birden fazla /Count
 * degeri cikabiliyor (alt agaclar, ekler).
 *
 * Bu yuzden dosyayi indirip pdfjs ile aciyoruz. Sonuc onbellege alindigi
 * icin ayni PDF icin ikinci kez indirilmiyor.
 */

/** Onbellek anahtari. */
function anahtar(url: string): string {
  return `sayfa:${url}`;
}

export interface SayfaSonucu {
  sayfaSayisi?: number;
  /** Neden bulunamadi (kullaniciya gostermek icin). */
  not?: string;
}

const EN_FAZLA_BAYT = 120 * 1024 * 1024;

/**
 * URL'deki PDF'in sayfa sayisini dondurur.
 *
 * Sayfa bilgisi kaynaktan geliyorsa hic istek atmaz; onbellekte varsa
 * diskten okur.
 */
export async function sayfaSayisiOgren(
  url: string,
  secenek: { zorlaGuncelle?: boolean } = {},
): Promise<SayfaSonucu> {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { not: "Geçersiz adres" };
  }

  return onbellekli(
    anahtar(url),
    async (): Promise<SayfaSonucu> => {
      const cevap = await get(url, {
        yonlendir: true,
        timeoutMs: 45_000,
        boslukMs: 250,
        ham: true,
      });

      const tur = String(cevap.headers.get("content-type") ?? "").toLowerCase();
      const beyanEdilen = Number(cevap.headers.get("content-length") ?? 0);

      if (beyanEdilen > EN_FAZLA_BAYT) {
        return { not: "Dosya çok büyük, sayfa sayısı okunmadı" };
      }

      const bayt = new Uint8Array(await cevap.arrayBuffer());
      if (bayt.length > EN_FAZLA_BAYT) {
        return { not: "Dosya çok büyük, sayfa sayısı okunmadı" };
      }

      // PDF degilse (html hata sayfasi, metin) sayfa sayisi yoktur.
      const pdfMi =
        bayt[0] === 0x25 && bayt[1] === 0x50 && bayt[2] === 0x44 && bayt[3] === 0x46;
      if (!pdfMi) {
        if (tur.includes("text/plain") || url.endsWith(".txt")) {
          // Duz metinde "sayfa" kavrami yok; karakter/kelime bilgisi verelim.
          const metin = new TextDecoder("utf-8", { fatal: false }).decode(bayt);
          return { not: `Metin dosyası (${metin.split(/\s+/).filter(Boolean).length} kelime)` };
        }
        return { not: "PDF değil" };
      }

      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const belge = await pdfjs.getDocument({
          data: bayt,
          useSystemFonts: false,
          disableFontFace: true,
          verbosity: 0,
        }).promise;

        const adet = belge.numPages;
        await belge.cleanup();
        return adet > 0 ? { sayfaSayisi: adet } : { not: "Sayfa sayısı okunamadı" };
      } catch (hata) {
        return { not: `PDF açılamadı: ${(hata as Error).message}` };
      }
    },
    // Yenileme istendiyse disk onbellegini atlayip yeniden dener.
    secenek.zorlaGuncelle ? { disk: false } : {},
  );
}

/** Ayni anda kac PDF indirilebilecegi. Daha fazlasi kaynaklari yorar. */
const ESZAMANLI = 3;

/**
 * Birden cok adres icin sayfa sayisi.
 *
 * Arka arkaya (sirali) istek atmak yavas kaynaklarda bekletiyordu:
 * uc PDF'den biri 60 saniye surerse ucu de bekliyordu. Burada en fazla
 * ESZAMANLI adres ayni anda islenir; biri beklerken digerleri ilerler.
 */
export async function topluSayfaSayisi(
  adresler: string[],
): Promise<Record<string, SayfaSonucu>> {
  const sonuc: Record<string, SayfaSonucu> = {};
  const benzersiz = [...new Set(adresler)].slice(0, 30);
  if (!benzersiz.length) return sonuc;

  let sira = 0;

  async function isleyici(): Promise<void> {
    while (sira < benzersiz.length) {
      const adres = benzersiz[sira]!;
      sira++;
      sonuc[adres] = await sayfaSayisiOgren(adres).catch((hata) => ({
        not: (hata as Error).message,
      }));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ESZAMANLI, benzersiz.length) }, isleyici),
  );

  return sonuc;
}