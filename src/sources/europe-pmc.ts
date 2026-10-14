import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * Europe PMC: 44 milyondan fazla biyomedikal, tıp, fen ve yaşam bilimleri makalesi.
 * PubMed Central (PMC) açık erişimli tam metin PDF bağlantılarını doğrudan sunar.
 */

interface EPMCHit {
  id?: string;
  source?: string;
  title?: string;
  authorString?: string;
  pubYear?: string;
  journalTitle?: string;
  doi?: string;
  abstractText?: string;
  isOpenAccess?: string;
  inEpmc?: string;
  inPmc?: string;
  pageInfo?: string;
  fullTextUrlList?: {
    fullTextUrl?: {
      availability?: string;
      documentStyle?: string;
      site?: string;
      url?: string;
    }[];
  };
}

function pdfUrlBul(hit: EPMCHit): string | undefined {
  const urls = hit.fullTextUrlList?.fullTextUrl ?? [];

  // Önce doğrudan PDF belgesi olan bağlantıyı ara
  const pdfBelge = urls.find(
    (u) =>
      u.documentStyle?.toLowerCase() === "pdf" ||
      (typeof u.url === "string" && u.url.toLowerCase().includes(".pdf")),
  );
  if (pdfBelge?.url) return pdfBelge.url;

  // Europe PMC doğrudan render PDF'i
  const epmc = urls.find((u) => u.site === "Europe_PMC" && u.url?.includes("pdf"));
  if (epmc?.url) return epmc.url;

  return undefined;
}

function htmlTemizle(s?: string): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const terimler: string[] = [`"${sorgu.baslik.replace(/"/g, "")}"`];
  if (sorgu.yazar) {
    terimler.push(`AUTH:"${sorgu.yazar.replace(/"/g, "")}"`);
  }
  if (sorgu.yil) {
    terimler.push(`PUB_YEAR:${sorgu.yil}`);
  }

  const u = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  u.searchParams.set("query", terimler.join(" AND "));
  u.searchParams.set("format", "json");
  u.searchParams.set("resultType", "core");
  u.searchParams.set("pageSize", String(Math.min(30, sorgu.limit * 2)));

  const veri = await getJson<{ resultList?: { result?: EPMCHit[] } }>(u.toString(), {
    boslukMs: 400,
    timeoutMs: 20_000,
  });

  const sonuclar: Work[] = [];

  for (const hit of veri.resultList?.result ?? []) {
    const baslik = htmlTemizle(hit.title);
    if (!baslik) continue;

    const yazarlar = hit.authorString
      ? hit.authorString
          .split(/,\s*|\s*;\s*/)
          .map((a) => a.replace(/\.$/, "").trim())
          .filter(Boolean)
      : [];

    const yil = hit.pubYear ? Number(hit.pubYear) : undefined;
    const pdf = pdfUrlBul(hit);
    const acikErisim = hit.isOpenAccess === "Y" || Boolean(pdf);

    sonuclar.push({
      kaynak: "europe-pmc",
      kaynakAd: "Europe PMC",
      tur: "makale",
      baslik,
      yazarlar,
      yil: Number.isFinite(yil) ? yil : undefined,
      yayinci: hit.journalTitle,
      doi: hit.doi,
      ozet: htmlTemizle(hit.abstractText),
      sayfa: hit.pageInfo,
      link: hit.id
        ? `https://europepmc.org/article/${encodeURIComponent(hit.source ?? "MED")}/${encodeURIComponent(hit.id)}`
        : "https://europepmc.org",
      pdf,
      erisim: acikErisim ? "acik" : "sinirli",
    });
  }

  return sonuclar;
}

const kaynak: SourceModule = {
  id: "europe-pmc",
  ad: "Europe PMC",
  tur: ["makale"],
  aciklama: "44+ milyon biyomedikal ve fen bilimleri makalesi, doğrudan açık PDF bağlantısı",
  ara,
};

export default kaynak;
