/*
 * Türkçe Wikipedia — eklenen kendi kaynağınız için örnek.
 *
 * Bu dosya, "kendi kaynağımı nasıl eklerim" sorusunun çalışan bir
 * cevabıdır. Wikipedia'nın API'si anahtar gerektirmez, herkese açıktır.
 * Kopyalayıp kendi sitenize uyarlayabilirsiniz.
 */

import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * `list=search` cevabı şu şekilde gelir:
 *
 *   { query: { search: [ { title, pageid, snippet, … } ] } }
 *
 * Dikkat: `query.pages` DEĞİL `query.search`. Özet (extract) ve kapak
 * (thumbnail) için ayrı bir istek gerekir: action=query&prop=extracts.
 * Aşağıda tek istekte almak için arama sonrası sayfaları topluyoruz.
 */

interface AramaSonucu {
  query?: {
    search?: { title: string; pageid: number; snippet?: string }[];
  };
}

interface SayfaDetay {
  query?: {
    pages?: Record<
      string,
      { title?: string; extract?: string; thumbnail?: string; pageid?: number }
    >;
  };
}

function kacisCoz(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")          // arama sonucundaki <span> etiketleri
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  /* --- 1. adım: başlık/yazar terimini ara --- */
  const terimler = sorgu.yazar ? `${sorgu.baslik} ${sorgu.yazar}` : sorgu.baslik;

  const aramaU = new URL("https://tr.wikipedia.org/w/api.php");
  aramaU.searchParams.set("action", "query");
  aramaU.searchParams.set("list", "search");
  aramaU.searchParams.set("srsearch", terimler);
  aramaU.searchParams.set("srlimit", String(Math.min(20, sorgu.limit)));
  aramaU.searchParams.set("format", "json");

  const arama = await getJson<AramaSonucu>(aramaU.toString(), {
    boslukMs: 350,
    timeoutMs: 15_000,
  });

  const sayfalar = arama.query?.search ?? [];
  if (!sayfalar.length) return [];

  /* --- 2. adım: özet ve kapak için sayfaları tek seferde al --- */
  const detayU = new URL("https://tr.wikipedia.org/w/api.php");
  detayU.searchParams.set("action", "query");
  detayU.searchParams.set("pageids", sayfalar.map((s) => s.pageid).join("|"));
  detayU.searchParams.set("prop", "extracts|pageimages");
  detayU.searchParams.set("exintro", "1");        // sadece giriş bölümü
  detayU.searchParams.set("explaintext", "1");   // HTML değil, düz metin
  detayU.searchParams.set("piprop", "thumbnail");
  detayU.searchParams.set("pithumbsize", "300");
  detayU.searchParams.set("format", "json");

  const detay = await getJson<SayfaDetay>(detayU.toString(), {
    boslukMs: 350,
    timeoutMs: 15_000,
  });

  const detaylar = new Map<number, { extract?: string; thumbnail?: string; title?: string }>();
  for (const p of Object.values(detay.query?.pages ?? {})) {
    if (p.pageid) detaylar.set(p.pageid, p);
  }

  /* --- 3. adım: Work[] biçimine çevir --- */
  const sonuc: Work[] = [];

  for (const s of sayfalar) {
    const d = detaylar.get(s.pageid);
    const baslik = d?.title ?? s.title;
    if (!baslik) continue;

    sonuc.push({
      kaynak: "wikipedia-tr",
      kaynakAd: "Türkçe Wikipedia",
      tur: sorgu.tur,
      baslik,
      yazarlar: sorgu.yazar ? [sorgu.yazar] : [],
      yil: sorgu.yil,
      ozet: d?.extract ?? (s.snippet ? kacisCoz(s.snippet) : undefined),
      kapak: d?.thumbnail,
      link: `https://tr.wikipedia.org/wiki/${encodeURIComponent(baslik.replace(/ /g, "_"))}`,
      erisim: "acik",
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "wikipedia-tr",
  ad: "Türkçe Wikipedia",
  tur: ["kitap", "makale", "slayt"],
  aciklama: "Anahtarsız açık API — kendi kaynağınızı eklemek için örnek",
  ara,
};

export default kaynak;