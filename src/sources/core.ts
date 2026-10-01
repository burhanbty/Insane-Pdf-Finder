import { get } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * CORE: dünya genelinde acik erisimli makale ve arastirma verisi indeksi.
 * Bircoğu tam metin PDF verir. Anahtarsiz calisir ama kotasi dardir.
 */

interface CoreSonuc {
  id?: string | number;
  title?: string;
  abstract?: string;
  authors?: { name?: string }[];
  contributors?: string[];
  yearPublished?: number;
  publishedDate?: string;
  downloadUrl?: string;
  fullText?: string;
  doi?: string;
  publisher?: string;
  subjects?: string[];
  language?: string;
  citationCount?: number;
  sourceFulltextUrls?: string[];
}

function tamMetinUrl(k: CoreSonuc): string | undefined {
  return (
    (k.sourceFulltextUrls ?? []).find((u) => /\.pdf($|\?)/i.test(u)) ??
    (k.downloadUrl?.includes(".pdf") ? k.downloadUrl : undefined)
  );
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const u = new URL("https://api.core.ac.uk/v3/search/works");
  // CORE anahtarsiz erisimde kotayi dar tutuyor; az istek atiyoruz.
  u.searchParams.set("q", sorgu.yazar ? `${sorgu.baslik} ${sorgu.yazar}` : sorgu.baslik);
  u.searchParams.set("limit", String(Math.min(20, sorgu.limit)));

  const cevap = await get(u.toString(), {
    timeoutMs: 25_000,
    boslukMs: 2000,
    header: { accept: "application/json" },
  });
  const veri = JSON.parse(await cevap.text()) as { results?: CoreSonuc[] };

  const sonuc: Work[] = [];
  for (const k of veri.results ?? []) {
    if (!k.title) continue;

    const pdf = tamMetinUrl(k);
    const yil = k.yearPublished ?? (Number(k.publishedDate?.slice(0, 4)) || undefined);

    sonuc.push({
      kaynak: "core",
      kaynakAd: "CORE",
      tur: "makale",
      baslik: k.title,
      yazarlar: (k.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
      yil: Number.isFinite(yil) ? yil : undefined,
      ozet: k.abstract,
      konular: k.subjects?.slice(0, 12),
      yayinci: k.publisher,
      dil: k.language,
      doi: k.doi,
      atif: k.citationCount,
      link: `https://core.ac.uk/outputs/${k.id ?? ""}`,
      pdf,
      erisim: pdf ? "acik" : "sinirli",
      ham: k,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "core",
  ad: "CORE",
  tur: ["makale"],
  aciklama: "Dünya geneli açık erişim makale indeksi, çoğunda tam metin PDF",
  ara,
};

export default kaynak;