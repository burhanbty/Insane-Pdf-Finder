import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * Sci-Hub: 88 milyondan fazla akademik makale, bildiri ve kitap bölümünün
 * açık tam metin arşivi.
 *
 * Normalde Google'da ücretli/kapalı olan akademik yayınları DOI üzerinden
 * doğrudan tam metin olarak sunar. Altcha doğrulaması tarayıcı tarafında
 * çözüldüğü için kullanıcı doğrudan ilgili aynaya yönlendirilir.
 */

const AYNALAR = ["https://sci-hub.se", "https://sci-hub.st", "https://sci-hub.ru"] as const;

interface CrossrefItem {
  type?: string;
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] };
  publisher?: string;
  "container-title"?: string[];
}

function doiBul(metin: string): string | null {
  const m = metin.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
  return m ? (m[1] ?? null) : null;
}

async function doiVeKunyeGetir(sorgu: Sorgu): Promise<Work[]> {
  const baslikDoi = doiBul(sorgu.baslik);
  if (baslikDoi) {
    const ayna = AYNALAR[0];
    return [
      {
        kaynak: "sci-hub",
        kaynakAd: "Sci-Hub",
        tur: sorgu.tur,
        baslik: sorgu.baslik,
        yazarlar: [],
        doi: baslikDoi,
        link: `${ayna}/${encodeURIComponent(baslikDoi)}`,
        ozet: "Sci-Hub üzerinden doğrudan erişilebilen tam metin akademik yayın.",
        erisim: "yonlendir",
      },
    ];
  }

  // Başlık ve yazar bilgisiyle Crossref üzerinden DOI çöz
  const u = new URL("https://api.crossref.org/works");
  u.searchParams.set("query.bibliographic", sorgu.baslik + (sorgu.yazar ? ` ${sorgu.yazar}` : ""));
  u.searchParams.set("rows", String(Math.min(5, sorgu.limit)));
  u.searchParams.set("select", "DOI,title,author,issued,publisher,container-title,type");

  const veri = await getJson<{ message?: { items?: CrossrefItem[] } }>(u.toString(), {
    boslukMs: 350,
    timeoutMs: 15_000,
  });

  const ayna = AYNALAR[0];
  const sonuclar: Work[] = [];

  for (const item of veri.message?.items ?? []) {
    const doi = item.DOI;
    const baslik = item.title?.[0];
    if (!doi || !baslik) continue;

    const yazarlar = (item.author ?? [])
      .map((a) => [a.given, a.family].filter(Boolean).join(" ") || a.name || "")
      .filter(Boolean);

    const yil = item.issued?.["date-parts"]?.[0]?.[0];

    sonuclar.push({
      kaynak: "sci-hub",
      kaynakAd: "Sci-Hub",
      tur: item.type?.startsWith("book") || item.type === "monograph" ? "kitap" : "makale",
      baslik,
      yazarlar,
      yil: Number.isFinite(yil) ? yil : undefined,
      yayinci: item["container-title"]?.[0] ?? item.publisher,
      doi,
      link: `${ayna}/${encodeURIComponent(doi)}`,
      ozet: `Sci-Hub açık arşivi üzerinden tam metin (DOI: ${doi}).`,
      erisim: "yonlendir",
    });
  }

  return sonuclar;
}

const kaynak: SourceModule = {
  id: "sci-hub",
  ad: "Sci-Hub",
  tur: ["makale", "kitap"],
  aciklama: "88+ milyon akademik makale ve kitap bölümünün açık tam metin arşivi",
  ara: doiVeKunyeGetir,
};

export default kaynak;
