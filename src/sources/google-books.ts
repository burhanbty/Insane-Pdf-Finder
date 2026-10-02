import { ayar } from "../config.js";
import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

interface GBDoc {
  id?: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publishedDate?: string;
    publisher?: string;
    description?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    pageCount?: number;
    categories?: string[];
    language?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    infoLink?: string;
  };
  accessInfo?: {
    viewability?: string;
    webReaderLink?: string;
    pdf?: { downloadLink?: string; isAvailable?: boolean };
  };
}

function yilCikart(tarih?: string): number | undefined {
  if (!tarih) return undefined;
  const m = tarih.match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const parcalar = [`intitle:${sorgu.baslik}`];
  if (sorgu.yazar) parcalar.push(`inauthor:${sorgu.yazar}`);
  if (sorgu.yil) parcalar.push(sorgu.yil.toString());

  const u = new URL("https://www.googleapis.com/books/v1/volumes");
  u.searchParams.set("q", parcalar.join(" "));
  u.searchParams.set("maxResults", String(Math.min(40, sorgu.limit * 2)));
  u.searchParams.set("printType", "books");
  u.searchParams.set("orderBy", "relevance");
  if (ayar.googleBooksKey) u.searchParams.set("key", ayar.googleBooksKey);

  const veri = await getJson<{ items?: GBDoc[] }>(u.toString(), { timeoutMs: 12_000 });
  const sonuc: Work[] = [];

  for (const item of veri.items ?? []) {
    const v = item.volumeInfo;
    if (!v?.title) continue;

    const gorunurluk = item.accessInfo?.viewability;
    const erisim: Work["erisim"] =
      gorunurluk === "FULL_PUBLIC_DOMAIN"
        ? "acik"
        : gorunurluk === "ALL_PAGES" || gorunurluk === "PARTIAL_PUBLIC_DOMAIN"
          ? "sinirli"
          : "yonlendir";

    const isbn = v.industryIdentifiers?.find(
      (i) => i.type === "ISBN_13" || i.type === "ISBN_10",
    )?.identifier;

    const kapakHam = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail;
    // Google kapak linkleri http donuyor, https'e ceviriyoruz.
    const kapak = kapakHam?.replace(/^http:/, "https:").replace(/&zoom=1$/, "");

    const pdfBaglanti =
      item.accessInfo?.pdf?.isAvailable && item.accessInfo.pdf.downloadLink
        ? item.accessInfo.pdf.downloadLink
        : undefined;

    sonuc.push({
      kaynak: "google-books",
      kaynakAd: "Google Books",
      tur: "kitap",
      baslik: v.title,
      altBaslik: v.subtitle,
      yazarlar: v.authors ?? [],
      yil: yilCikart(v.publishedDate),
      ozet: v.description?.replace(/<[^>]+>/g, " "),
      konular: v.categories,
      yayinci: v.publisher,
      dil: v.language,
      isbn,
      sayfa: v.pageCount ? `${v.pageCount} sayfa` : undefined,
      sayfaSayisi: v.pageCount || undefined,
      kapak,
      link: v.infoLink ?? `https://books.google.com/books?id=${item.id ?? ""}`,
      pdf: pdfBaglanti,
      erisim,
      ham: item,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "google-books",
  ad: "Google Books",
  tur: ["kitap"],
  aciklama: "Katalog kaydi, kapak, bazi durumlarda tam gorunumlu PDF",
  hazirMi: () => Boolean(ayar.googleBooksKey),
  ara,
};

export default kaynak;
