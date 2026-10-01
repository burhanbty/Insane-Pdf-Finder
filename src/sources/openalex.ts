import { ayar } from "../config.js";
import { getJson } from "../http.js";
import { yazarParcalari } from "../normalize.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * OpenAlex + Unpaywall zinciri.
 *  OpenAlex: genis makale/bilimsel kayit indeksi, konu etiketleri verir.
 *  Unpaywall: DOI verildiginde yasal acik erisim PDF kopyasini bulur
 *             (Green OA: arXiv/preprint, kurumsal depo, vs.).
 */

/** Sorgudaki yazar, eser yazarlarindan biriyle soyad uyumlu mu. */
function yazarUstundenGecer(eserYazarlari: string[], sorguYazar: string): boolean {
  const s = yazarParcalari(sorguYazar);
  return eserYazarlari.some((ey) => {
    const e = yazarParcalari(ey);
    return s.soyad.some((x) => e.soyad.includes(x)) || s.ad.some((x) => e.ad.includes(x));
  });
}

interface OAWork {
  id?: string;
  doi?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    source?: { display_name?: string } | null;
  };
  best_oa_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    license?: string | null;
  } | null;
  open_access?: { is_oa?: boolean; oa_status?: string };
  topics?: { display_name?: string }[];
  cited_by_count?: number;
  type?: string;
}

/** OpenAlex ozeti ters indeks olarak verir; metne ceviriyoruz. */
function tersIndekstenOzet(harita?: Record<string, number[]>): string | undefined {
  if (!harita) return undefined;
  const konumlar: [number, string][] = [];
  for (const [kelime, indeksler] of Object.entries(harita)) {
    for (const i of indeksler) konumlar.push([i, kelime]);
  }
  if (!konumlar.length) return undefined;
  konumlar.sort((a, b) => a[0] - b[0]);
  return konumlar.map(([, k]) => k).join(" ");
}

interface UPWall {
  best_oa_location?: {
    url_for_pdf?: string | null;
    url_for_landing_page?: string | null;
    license?: string | null;
    host_type?: string | null;
  } | null;
  oa_locations?: {
    url_for_pdf?: string | null;
    url_for_landing_page?: string | null;
    host_type?: string | null;
    license?: string | null;
  }[];
}

async function unpaywall(doi: string): Promise<UPWall | null> {
  if (!ayar.unpaywallEmail) return null;
  try {
    return await getJson<UPWall>(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(ayar.unpaywallEmail)}`,
      { boslukMs: 350, timeoutMs: 12_000 },
    );
  } catch {
    return null;
  }
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const u = new URL("https://api.openalex.org/works");
  u.searchParams.set("search", sorgu.baslik);
  u.searchParams.set("per-page", String(Math.min(50, sorgu.limit * 2)));
  if (ayar.unpaywallEmail) u.searchParams.set("mailto", ayar.unpaywallEmail);
  u.searchParams.set("select", [
    "id", "doi", "display_name", "publication_year", "authorships",
    "abstract_inverted_index", "primary_location", "best_oa_location",
    "open_access", "topics", "cited_by_count", "type",
  ].join(","));

  // Not: OpenAlex `filter` parametresini 400 ile reddediyor; yazar ve yil
  // filtresi sonuc listesinde uygulanir (asagida).

  const veri = await getJson<{ results?: OAWork[] }>(u.toString(), {
    boslukMs: 350,
    timeoutMs: 20_000,
  });

  const sonuc: Work[] = [];
  for (const w of veri.results ?? []) {
    if (!w.display_name) continue;

    // Yazar filtresi: sorguda yazar varsa eslesmeyen sonuclari ele.
    const yazarlar = (w.authorships ?? [])
      .map((a) => a.author?.display_name ?? "")
      .filter(Boolean);
    if (sorgu.yazar && !yazarUstundenGecer(yazarlar, sorgu.yazar)) continue;
    if (sorgu.yil && w.publication_year && Math.abs(sorgu.yil - w.publication_year) > 1) continue;

    const doi = w.doi?.replace(/^https?:\/\/doi\.org\//, "");
    let pdf = w.best_oa_location?.pdf_url ?? w.primary_location?.pdf_url ?? undefined;
    let erisim: Work["erisim"] = pdf ? "acik" : w.open_access?.is_oa ? "sinirli" : "yonlendir";
    let tamMetin: string | undefined;

    // DOI varsa yasal OA kopyasini arayin.
    if (!pdf && doi) {
      const up = await unpaywall(doi);
      const enIyi = up?.best_oa_location ?? up?.oa_locations?.[0];
      if (enIyi?.url_for_pdf) {
        pdf = enIyi.url_for_pdf;
        erisim = "acik";
      } else if (enIyi?.url_for_landing_page && erisim === "yonlendir") {
        erisim = "sinirli";
      }
    }

    const ozet = tersIndekstenOzet(w.abstract_inverted_index);

    sonuc.push({
      kaynak: "openalex",
      kaynakAd: "OpenAlex",
      tur: "makale",
      baslik: w.display_name,
      yazarlar: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
      yil: w.publication_year,
      ozet,
      konular: (w.topics ?? []).map((t) => t.display_name ?? "").filter(Boolean).slice(0, 10),
      yayinci: w.primary_location?.source?.display_name ?? undefined,
      doi,
      atif: w.cited_by_count,
      link: w.best_oa_location?.landing_page_url ?? w.primary_location?.landing_page_url ?? w.id ?? "https://openalex.org",
      pdf,
      tamMetin,
      erisim,
      ham: w,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "openalex",
  ad: "OpenAlex + Unpaywall",
  tur: ["makale"],
  aciklama: "Makale kaydi ve DOI uzerinden yasal acik erisim PDF kopyasi",
  ara,
};

export default kaynak;