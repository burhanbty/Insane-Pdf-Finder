import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/* Crossref: DOI kaydi ve referans listesi. Tam metin vermez ama
 * kesin kunyeyi (yazar, yil, sayfa, yayinci) dogrudan verir. */

interface CR {
  DOI?: string;
  title?: string[];
  subtitle?: string[];
  author?: { given?: string; family?: string; name?: string; ORCID?: string }[];
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  containerTitle?: string[];
  publisher?: string;
  abstract?: string;
  subject?: string[];
  page?: string;
  volume?: string;
  issue?: string;
  type?: string;
  URL?: string;
  language?: string;
  ISBN?: string[];
}

function adDiz(g?: string, f?: string, n?: string): string | undefined {
  if (n) return n;
  const b = [g, f].filter(Boolean).join(" ");
  return b || undefined;
}

/**
 * Crossref "page" alani makalenin o kismini verir ("411-423"), toplam
 * sayfa sayisi degildir. Tek sayfa ya da aralik varsa buradan cikaririz;
 * sonuc genel bir makale icin (orn. bir bolum) yaniltici olabilecegi icin
 * yalnizca sayi olarak saklanir.
 */
function araliktanToplam(page?: string): number | undefined {
  if (!page) return undefined;
  const sayilar = [...page.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!sayilar.length) return undefined;
  if (sayilar.length === 1) return sayilar[0];
  const enBuyuk = Math.max(...sayilar);
  // "e1000234" gibi artefaktlari ele.
  return enBuyuk < 100000 ? enBuyuk : undefined;
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const u = new URL("https://api.crossref.org/works");
  u.searchParams.set("query.bibliographic", sorgu.baslik + (sorgu.yazar ? ` ${sorgu.yazar}` : ""));
  if (sorgu.yil) u.searchParams.set("filter", `from-pub-date:${sorgu.yil - 1}-01-01,until-pub-date:${sorgu.yil + 1}-12-31`);
  u.searchParams.set("rows", String(Math.min(50, sorgu.limit * 2)));
  // Not: `language` Crossref select listesinde gecerli bir alan degil, 400 donuyor.
  u.searchParams.set("select", "DOI,title,subtitle,author,issued,container-title,publisher,abstract,subject,page,volume,issue,type,URL");
  u.searchParams.set("mailto", "ornek@example.org");

  const veri = await getJson<{ message?: { items?: CR[] } }>(u.toString(), {
    boslukMs: 400,
    timeoutMs: 20_000,
  });

  const sonuc: Work[] = [];
  for (const it of veri.message?.items ?? []) {
    const baslik = it.title?.[0];
    if (!baslik) continue;

    const yil = it.published?.["date-parts"]?.[0]?.[0] ?? it.issued?.["date-parts"]?.[0]?.[0];

    sonuc.push({
      kaynak: "crossref",
      kaynakAd: "Crossref",
      tur: "makale",
      baslik,
      altBaslik: it.subtitle?.[0],
      yazarlar: (it.author ?? []).map((a) => adDiz(a.given, a.family, a.name)).filter((x): x is string => Boolean(x)),
      yil: yil ?? undefined,
      ozet: it.abstract?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      konular: it.subject,
      yayinci: it.containerTitle?.[0] ?? it.publisher,
      doi: it.DOI,
      sayfa: it.page ? `${it.volume ?? ""}${it.issue ? `(${it.issue})` : ""}: ${it.page}`.replace(/^: /, "") : undefined,
      // Crossref "page" alani sayfa araligi verir ("411-423"), toplam
      // sayfa sayisi degildir. Araligi hesaplayip sayi olarak saklariz.
      sayfaSayisi: araliktanToplam(it.page),
      link: it.URL ?? (it.DOI ? `https://doi.org/${it.DOI}` : "https://search.crossref.org"),
      erisim: "yonlendir",
      ham: it,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "crossref",
  ad: "Crossref",
  tur: ["makale", "kitap"],
  aciklama: "Kesin kunye bilgisi (DOI, yazar, yil, sayfa)",
  ara,
};

export default kaynak;