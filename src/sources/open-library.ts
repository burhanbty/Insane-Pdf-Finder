import { ayar } from "../config.js";
import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";
import { isbnKitabi } from "../isbn.js";

interface OLDoc {
  key?: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  publish_year?: number[];
  publisher?: string[];
  subject?: string[];
  language?: string[];
  isbn?: string[];
  number_of_pages_median?: number;
  cover_i?: number;
  edition_key?: string[];
  /** Internet Archive kimlikleri. */
  ia?: string[];
}

/** Solr sorgu dizisinde ozel anlam tasiyan karakterleri kacirir. */
function solrKacis(s: string): string {
  return s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, "\\$1");
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  if (sorgu.isbn) return (await isbnKitabi(sorgu.isbn)).eser.kaynaklar;
  const u = new URL("https://openlibrary.org/search.json");

  // Onemli: Open Library `title=` parametresi TAM baslik eslesmesi istiyor.
  // "Sapiens A Brief History of Humankind" gibi uzun basliklarda (kayit
  // sadece "Sapiens" tutuyor) sifir sonuc donuyor. `q=` ile Solr sorgusu
  // yaziyoruz: kismi eslesme verir, filtreler ayni sekilde calisir.
  const parcalar = [`title:"${solrKacis(sorgu.baslik)}"`];
  if (sorgu.yazar) parcalar.push(`author:"${solrKacis(sorgu.yazar)}"`);
  u.searchParams.set("q", parcalar.join(" AND "));

  u.searchParams.set("limit", String(Math.min(50, sorgu.limit * 2)));
  u.searchParams.set(
    "fields",
    [
      "key",
      "title",
      "subtitle",
      "author_name",
      "first_publish_year",
      "publish_year",
      "publisher",
      "subject",
      "language",
      "isbn",
      "number_of_pages_median",
      "cover_i",
      "edition_key",
      "ia",
    ].join(","),
  );

  let veri = await getJson<{ docs?: OLDoc[]; numFound?: number }>(u.toString(), {
    // Open Library kendi kuralina gore istekleri yavaslat.
    boslukMs: ayar.contactEmail ? 350 : 1100,
    timeoutMs: 20_000,
  });
  // Boş kesin aramada tek, sınırlandırılmış yazım önerisi sorgusu. Ağ hatası boş sonuç sayılmaz.
  const kelimeler = sorgu.baslik.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    !veri.docs?.length &&
    kelimeler.length &&
    kelimeler.length <= 12 &&
    kelimeler.some((k) => k.length >= 5)
  ) {
    const yakin = [
      `title:(${kelimeler.map((k) => `${solrKacis(k)}${k.length >= 5 && !/^\d+$/.test(k) ? "~1" : ""}`).join(" AND ")})`,
    ];
    if (sorgu.yazar) yakin.push(`author:"${solrKacis(sorgu.yazar)}"`);
    u.searchParams.set("q", yakin.join(" AND "));
    u.searchParams.set("limit", "5");
    veri = await getJson<{ docs?: OLDoc[] }>(u.toString(), {
      boslukMs: ayar.contactEmail ? 350 : 1100,
      timeoutMs: 8000,
      tekrar: 0,
    });
  }

  const sonuc: Work[] = [];
  for (const d of veri.docs ?? []) {
    if (!d.title) continue;

    const kapak = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : undefined;

    const olishler = (d.ia ?? []).map((id) => `https://archive.org/details/${id}`);

    sonuc.push({
      kaynak: "open-library",
      kaynakAd: "Open Library",
      tur: "kitap",
      baslik: d.title,
      kunyeTuru: "eser",
      altBaslik: d.subtitle,
      yazarlar: d.author_name ?? [],
      yil: d.first_publish_year,
      konular: (d.subject ?? []).slice(0, 12),
      // Work araması farklı baskıların ISBN/dil/yayınevlerini bir arada döndürür.
      // Dizilerin ilk elemanlarını aynı baskının künyesiymiş gibi kullanma.
      sayfa: d.number_of_pages_median ? `${d.number_of_pages_median} sayfa` : undefined,
      sayfaSayisi: d.number_of_pages_median || undefined,
      kapak,
      link: `https://openlibrary.org${d.key ?? ""}`,
      erisim: olishler.length ? "odunc" : "yonlendir",
      ham: { ia: d.ia, edition_key: d.edition_key },
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "open-library",
  ad: "Open Library",
  tur: ["kitap"],
  aciklama: "Acik katalog; eser kaydi ve Internet Archive baglantilari",
  ara,
};

export default kaynak;
