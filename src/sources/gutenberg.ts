import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * Project Gutenberg (Gutendex): 70.000'den fazla klasik ve kamu malı kitap.
 * Google aramalarında çoğu zaman ticari kitap satış sitelerinin arkasında kalan
 * dünya edebiyatı ve felsefe klasiklerini doğrudan ücretsiz EPUB, metin ve HTML olarak sunar.
 */

interface GutenbergAuthor {
  name?: string;
  birth_year?: number;
  death_year?: number;
}

interface GutenbergBook {
  id: number;
  title?: string;
  authors?: GutenbergAuthor[];
  subjects?: string[];
  bookshelves?: string[];
  languages?: string[];
  formats?: Record<string, string>;
  download_count?: number;
}

interface GutendexResponse {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: GutenbergBook[];
}

function tamMetinBul(formats: Record<string, string> = {}): string | undefined {
  return (
    formats["text/plain; charset=utf-8"] ??
    formats["text/plain; charset=us-ascii"] ??
    formats["text/plain"]
  );
}

function kapakBul(formats: Record<string, string> = {}): string | undefined {
  return formats["image/jpeg"];
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const terimler = sorgu.yazar ? `${sorgu.baslik} ${sorgu.yazar}`.trim() : sorgu.baslik.trim();

  if (!terimler) return [];

  const u = new URL("https://gutendex.com/books/");
  u.searchParams.set("search", terimler);

  const veri = await getJson<GutendexResponse>(u.toString(), {
    boslukMs: 300,
    timeoutMs: 15_000,
  });

  const sonuclar: Work[] = [];

  for (const book of veri.results ?? []) {
    if (!book.title) continue;

    const yazarlar = (book.authors ?? [])
      .map((a) => {
        // "Austen, Jane" biçimini "Jane Austen" haline getir
        if (!a.name) return "";
        const parcalar = a.name.split(",").map((p) => p.trim());
        return parcalar.length > 1 ? `${parcalar[1]} ${parcalar[0]}` : (parcalar[0] ?? "");
      })
      .filter(Boolean);

    const formatlar = book.formats ?? {};
    const pdf = formatlar["application/pdf"];
    const tamMetin = tamMetinBul(formatlar);
    const kapak = kapakBul(formatlar);
    const dil = book.languages?.[0];

    sonuclar.push({
      kaynak: "gutenberg",
      kaynakAd: "Project Gutenberg",
      tur: "kitap",
      baslik: book.title,
      yazarlar,
      dil,
      konular: (book.subjects ?? []).slice(0, 8),
      kapak,
      link: `https://www.gutenberg.org/ebooks/${book.id}`,
      pdf,
      epub: formatlar["application/epub+zip"],
      tamMetin,
      erisim: "acik",
    });
  }

  return sonuclar.slice(0, sorgu.limit);
}

const kaynak: SourceModule = {
  id: "gutenberg",
  ad: "Project Gutenberg",
  tur: ["kitap"],
  aciklama: "70.000+ klasik ve kamu malı tam metin kitap arşivi (EPUB, TXT, HTML)",
  ara,
};

export default kaynak;
