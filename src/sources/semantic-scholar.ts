import { ayar } from "../config.js";
import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * Semantic Scholar: zengin ozet + DOI + acik erisim PDF baglantisi
 * (openAccessPdf). Anahtarsiz da calisir ama yavas; anahtar varsa hizli.
 */

interface SS {
  paperId?: string;
  title?: string;
  abstract?: string;
  year?: number;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; ArXiv?: string; CorpusId?: number };
  openAccessPdf?: { url?: string; status?: string } | null;
  fieldsOfStudy?: string[];
  venue?: string;
  url?: string;
  citationCount?: number;
  isOpenAccess?: boolean;
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const parcalar = [`title:${sorgu.baslik}`];
  if (sorgu.yazar) parcalar.push(`author:${sorgu.yazar}`);
  if (sorgu.yil) parcalar.push(`year:${sorgu.yil}`);

  const u = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  u.searchParams.set("query", parcalar.join(" "));
  u.searchParams.set("limit", String(Math.min(50, sorgu.limit * 2)));
  u.searchParams.set("fields", [
    "title", "abstract", "year", "authors", "externalIds",
    "openAccessPdf", "fieldsOfStudy", "venue", "url", "citationCount", "isOpenAccess",
  ].join(","));
  if (ayar.semanticScholarKey) u.searchParams.set("x-api-key", ayar.semanticScholarKey);

  const veri = await getJson<{ data?: SS[]; total?: number }>(u.toString(), {
    boslukMs: ayar.semanticScholarKey ? 300 : 1500,
    timeoutMs: 20_000,
  });

  const sonuc: Work[] = [];
  for (const p of veri.data ?? []) {
    if (!p.title) continue;

    const oaPdf = p.openAccessPdf?.url;
    sonuc.push({
      kaynak: "semantic-scholar",
      kaynakAd: "Semantic Scholar",
      tur: "makale",
      baslik: p.title,
      yazarlar: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
      yil: p.year,
      ozet: p.abstract,
      konular: p.fieldsOfStudy,
      yayinci: p.venue ?? undefined,
      doi: p.externalIds?.DOI,
      atif: p.citationCount,
      link: p.url ?? (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : "https://www.semanticscholar.org"),
      pdf: oaPdf ?? undefined,
      erisim: oaPdf ? "acik" : p.isOpenAccess ? "sinirli" : "yonlendir",
      ham: p,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "semantic-scholar",
  ad: "Semantic Scholar",
  tur: ["makale"],
  aciklama: "Makale ozeti, atif sayisi ve acik erisim PDF linki",
  ara,
};

export default kaynak;