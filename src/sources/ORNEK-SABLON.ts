/*
 * ŞABLON — kendi kaynağını eklemek için kopyala
 * ============================================
 *
 * 1. Bu dosyayı src/sources/ içinde yeni bir adla kopyala:
 *        src/sources/benim-sitem.ts
 *
 * 2. Aşağıdaki yorum satırlarının yerine kendi kodunu yaz.
 *
 * 3. Sunucuyu yeniden başlat (baslat.bat). Kayıt defteri dosyayı
 *    otomatik bulur, hiçbir yeri düzenlemen gerekmez.
 *
 * ---------------------------------------------------------------------------
 * EN KISA HALİ
 * ---------------------------------------------------------------------------
 *
 *   import type { SourceModule } from "../types.js";
 *
 *   const kaynak: SourceModule = {
 *     id: "benim-sitem",
 *     ad: "Benim Sitem",
 *     tur: ["kitap", "makale"],
 *     aciklama: "Ne yaptığını bir cümleyle yaz",
 *     ara: async (sorgu) => {
 *       const veri = await benimApi(sorgu.baslik);
 *       return veri.map((k) => ({
 *         kaynak: "benim-sitem",
 *         kaynakAd: "Benim Sitem",
 *         tur: sorgu.tur,
 *         baslik: k.ad,
 *         yazarlar: k.yazarlar ?? [],
 *         yil: k.yil,
 *         link: k.url,          // ZORUNLU
 *       }));
 *     },
 *   };
 *
 *   export default kaynak;
 *
 * ---------------------------------------------------------------------------
 * API ÇAĞIRMASI
 * ---------------------------------------------------------------------------
 *
 *   import { getJson, get } from "../http.js";
 *
 *   getJson(url)  → JSON döndüren API'ler için. Hata otomatik fırlatılır.
 *   get(url, {…}) → HTML/XML veya özel başlık gerekiyorsa:
 *                     get(url, { ham: true, boslukMs: 1000 })
 *
 *   İkisi de şunları otomatik yapar: zaman aşımı (15 sn), 429/5xx'te tekrar,
 *   host başına istek aralığı (rate limit), User-Agent başlığı.
 *
 * ---------------------------------------------------------------------------
 * Work ALANLARI (hepsi isteğe bağlı, sadece link zorunlu)
 * ---------------------------------------------------------------------------
 *
 *   kaynak    "benim-sitem"          (kendi id'n, otomatik doldurulabilir)
 *   kaynakAd  "Benim Sitem"          (kartta görünen isim)
 *   tur       sorgu.tur              ("kitap" | "makale" | "slayt")
 *   baslik    "Sapiens"              ZORUNLU — boşsa kayıt atlanır
 *   link      "https://..."          ZORUNLU — her zaman var olmalı
 *   yazarlar  ["Yuval Noah Harari"]
 *   yil       2011
 *   ozet      "Kısa açıklama…"       (kartta görünür)
 *   konular   ["tarih", "felsefe"]
 *   yayinci   "Yayınevi"
 *   dil       "tr"
 *   isbn      "978..."
 *   doi       "10.xxxx/yyyy"
 *   sayfa     "412 sayfa"            (metin olarak)
 *   sayfaSayisi 412                  (sayı olarak — otomatik ölçülür)
 *   atif      142
 *   kapak     "https://.../kapak.jpg"  (proxy üzerinden gösterilir)
 *   pdf       "https://.../x.pdf"    → "PDF indir" düğmesi çıkar
 *   tamMetin  "https://.../x.txt"    → özet metinden okunabilir
 *   erisim    "acik" | "sinirli" | "odunc" | "yonlendir"
 *
 * ---------------------------------------------------------------------------
 * API ANAHTARI GEREKİYORSA
 * ---------------------------------------------------------------------------
 *
 *   import { ayar } from "../config.js";
 *
 *   hazirMi: () => Boolean(ayar.googleBooksKey),
 *
 *   Anahtar yoksa kaynak atlanır ve arayüzde "anahtar gerekli" görünür.
 *   (google-books.ts ve semantic-scholar.ts buna örnektir.)
 *
 *   Kendi anahtarını almak için .env'ye yaz, config.ts'e ayarla:
 *     .env  →  BENIM_API_KEY=abc123
 *     config.ts →  benimApiKey: yolla("BENIM_API_KEY", ""),
 *
 * ---------------------------------------------------------------------------
 * HATA YAPARSAN
 * ---------------------------------------------------------------------------
 *
 * Dosya yüklenemezse sunucu çökmez; konsola yazar ve arayüzdeki
 * "Kaynaklar" penceresinde gösterir. Sadece o kaynak devre dışı kalır.
 *
 *   ./src/sources/  klasöründe adı "_" ile başlayan dosyalar atlanır
 *                   (yardımcı dosya yapmak istersen: _yardimci.ts)
 */

/* ------------------------------------------------------------------ */
/* Aşağıdaki kodu kendi sitenle değiştir.                             */
/* ------------------------------------------------------------------ */

import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * Örnek: bir JSON API'den arama yapan kaynak.
 *
 * Bu dosya, "kendi kaynağımı nasıl eklerim" sorusunun çalışan örneğidir.
 * Gerçek bir uygulama için src/sources/wikipedia-tr.ts dosyasına bak —
 * ikisi de aynı biçimde yazıldı.
 */

// Örnek yanıt şekli: { sonuclar: [{ ad, yazarlar, yil, url, pdfUrl, ozet }] }
interface BenimSonuc {
  ad?: string;
  yazarlar?: string[];
  yil?: number;
  url?: string;
  pdfUrl?: string;
  ozet?: string;
  kapak?: string;
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  // Sorgu terimlerini birleştir: başlık + yazar
  const terimler = sorgu.yazar ? `${sorgu.baslik} ${sorgu.yazar}` : sorgu.baslik;

  /*
   * Kendi sitenizi eklerken şu bloğu açın:
   *
   *   import { getJson } from "../http.js";
   *
   *   const u = new URL("https://api.siteniz.com/v1/ara");
   *   u.searchParams.set("q", terimler);
   *   u.searchParams.set("limit", String(Math.min(50, sorgu.limit * 2)));
   *
   *   const veri = await getJson<{ sonuclar?: BenimSonuc[] }>(u.toString(), {
   *     boslukMs: 500,      // sitenizin hız limiti varsa artırın
   *     timeoutMs: 20_000,
   *   });
   *
   * getJson zaman aşımı, 429/5xx'te tekrar denemeyi ve User-Agent
   * başlığını kendisi hallediyor; siz sadece adresi yazarsınız.
   */
  void terimler;

  // Site henüz var olmadığı için istek atmadan örnek veri döndürüyoruz.
  const veri: { sonuclar?: BenimSonuc[] } = {
    sonuclar: [
      {
        ad: `${sorgu.baslik} (örnek kayıt)`,
        yazarlar: sorgu.yazar ? [sorgu.yazar] : ["Örnek Yazar"],
        yil: sorgu.yil ?? 2020,
        ozet:
          "Bu kayıt şablondan geliyor. src/sources/ORNEK-SABLON.ts dosyasını " +
          "kendi siten için düzenle; yukarıdaki yorumlu bloğu açman yeterli.",
        url: "https://example.com/kayit",
      },
    ],
  };

  const cikti: Work[] = [];

  for (const s of veri.sonuclar ?? []) {
    if (!s.ad || !s.url) continue; // başlık ve link olmadan kayıt tutmaz

    cikti.push({
      kaynak: "benim-sitem",
      kaynakAd: "Benim Sitem",
      tur: sorgu.tur,
      baslik: s.ad,
      yazarlar: s.yazarlar ?? [],
      yil: s.yil,
      ozet: s.ozet,
      kapak: s.kapak,
      link: s.url,
      pdf: s.pdfUrl,
      erisim: s.pdfUrl ? "acik" : "yonlendir",
    });
  }

  return cikti;
}

const kaynak: SourceModule = {
  id: "benim-sitem",
  ad: "Benim Sitem (örnek)",
  tur: ["kitap", "makale"],
  aciklama: "Kendi kaynağını buradan eklersin — bu bir şablondur",

  /*
   * API anahtarı gerekiyorsa bu satırı yaz:
   *
   *   hazirMi: () => Boolean(process.env.BENIM_API_KEY),
   *
   * Anahtar yoksa kaynak atlanır ve arayüzde "anahtar gerekli" yazar.
   * Şu an koşullu yok yazıyoruz: örneğin sitede "ornek" kelimesi geçen
   * bir arama yapılırsa çalışır, normal aramalarda boşuna istek atmaz.
   */
  hazirMi: () => process.argv.some((a) => a.includes("ornek")),

  ara,
};

export default kaynak;