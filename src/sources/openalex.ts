import { ayar } from "../config.js";
import { getJson } from "../http.js";
import { yazarParcalari } from "../normalize.js";
import { doiAnahtari } from "../doi.js";
import { pdfAdaylariniBirlestir } from "../pdf-candidates.js";
import type { PdfAdayi, SourceModule, Sorgu, Work } from "../types.js";

/*
 * OpenAlex kayıtları ve bütün açık erişim konumları.
 * Unpaywall bütün kaynaklara ortak fulltext.ts katmanında çalışır.
 */

/** Sorgudaki yazar, eser yazarlarindan biriyle soyad uyumlu mu. */
function yazarUstundenGecer(eserYazarlari: string[], sorguYazar: string): boolean {
  const s = yazarParcalari(sorguYazar);
  return eserYazarlari.some((ey) => {
    const e = yazarParcalari(ey);
    return s.soyad.some((x) => e.soyad.includes(x)) || s.ad.some((x) => e.ad.includes(x));
  });
}

interface OAKonum {
  landing_page_url?: string | null;
  pdf_url?: string | null;
  is_oa?: boolean;
  license?: string | null;
  version?: string | null;
  source?: { display_name?: string; type?: string } | null;
}
interface OAWork {
  id?: string;
  doi?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: OAKonum;
  best_oa_location?: OAKonum | null;
  locations?: OAKonum[];
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

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const u = new URL("https://api.openalex.org/works");
  u.searchParams.set("search", sorgu.baslik);
  u.searchParams.set("per-page", String(Math.min(50, sorgu.limit * 2)));
  if (ayar.contactEmail) u.searchParams.set("mailto", ayar.contactEmail);
  u.searchParams.set(
    "select",
    [
      "id",
      "doi",
      "display_name",
      "publication_year",
      "authorships",
      "abstract_inverted_index",
      "primary_location",
      "best_oa_location",
      "locations",
      "open_access",
      "topics",
      "cited_by_count",
      "type",
    ].join(","),
  );

  // Bu adaptörde yazar ve yıl uyumu dönen kayıtlar üzerinde uygulanır.

  const veri = await getJson<{ results?: OAWork[] }>(u.toString(), {
    boslukMs: 350,
    timeoutMs: 20_000,
    header: ayar.openalexKey ? { authorization: `Bearer ${ayar.openalexKey}` } : undefined,
  });

  const sonuc: Work[] = [];
  for (const w of veri.results ?? []) {
    if (!w.display_name) continue;

    // Yazar filtresi: sorguda yazar varsa eslesmeyen sonuclari ele.
    const yazarlar = (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean);
    if (sorgu.yazar && !yazarUstundenGecer(yazarlar, sorgu.yazar)) continue;
    if (sorgu.yil && w.publication_year && Math.abs(sorgu.yil - w.publication_year) > 1) continue;

    const doi = doiAnahtari(w.doi);
    const pdfAdaylari = pdfAdaylariniBirlestir(
      [w.best_oa_location, w.primary_location, ...(w.locations ?? [])].flatMap((k): PdfAdayi[] => {
        if (
          !k?.pdf_url ||
          k.is_oa === false ||
          (k !== w.best_oa_location && !k.is_oa && !w.open_access?.is_oa)
        )
          return [];
        return [
          {
            url: k.pdf_url,
            kaynak: "openalex",
            kayitUrl: k.landing_page_url ?? undefined,
            doi,
            lisans: k.license ?? undefined,
            surum: k.version ?? undefined,
            hostTuru: k.source?.type === "repository" ? "repository" : undefined,
            durum: "aday",
          },
        ];
      }),
    );
    const pdf = pdfAdaylari[0]?.url;
    const erisim: Work["erisim"] = pdf ? "acik" : w.open_access?.is_oa ? "sinirli" : "yonlendir";

    const ozet = tersIndekstenOzet(w.abstract_inverted_index);

    sonuc.push({
      kaynak: "openalex",
      kaynakAd: "OpenAlex",
      tur: "makale",
      baslik: w.display_name,
      yazarlar: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
      yil: w.publication_year,
      ozet,
      konular: (w.topics ?? [])
        .map((t) => t.display_name ?? "")
        .filter(Boolean)
        .slice(0, 10),
      yayinci: w.primary_location?.source?.display_name ?? undefined,
      doi,
      atif: w.cited_by_count,
      link:
        w.best_oa_location?.landing_page_url ??
        w.primary_location?.landing_page_url ??
        w.id ??
        "https://openalex.org",
      pdf,
      pdfAdaylari,
      erisim,
      ham: w,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "openalex",
  ad: "OpenAlex",
  tur: ["makale"],
  aciklama: "Bilimsel makale kayıtları ve alternatif açık erişim kopyaları",
  ara,
};

export default kaynak;
