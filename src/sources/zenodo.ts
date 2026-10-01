import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/* Zenodo: arastirma verisi, calisma kagitlari, sunumlar. Tam PDF her kayitta. */

interface ZKayit {
  id?: number;
  doi?: string;
  metadata?: {
    title?: string;
    description?: string;
    creators?: { name?: string }[];
    publication_date?: string;
    keywords?: string[];
    resource_type?: { title?: string };
    license?: { id?: string };
  };
  files?: { key?: string; links?: { self?: string } }[];
  links?: { html?: string };
}

function aciklamadanOzet(html?: string): string | undefined {
  if (!html) return undefined;
  const metin = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return metin || undefined;
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const parcalar = [`metadata.title:"${sorgu.baslik.replace(/"/g, "")}"`];
  if (sorgu.yazar) parcalar.push(`metadata.creators.name:"${sorgu.yazar.replace(/"/g, "")}"`);

  const u = new URL("https://zenodo.org/api/records");
  u.searchParams.set("q", parcalar.join(" AND "));
  u.searchParams.set("size", String(Math.min(50, sorgu.limit * 2)));
  u.searchParams.set("sort", "bestmatch");

  const veri = await getJson<{ hits?: { hits?: ZKayit[] } }>(u.toString(), {
    boslukMs: 500,
    timeoutMs: 25_000,
  });

  const sonuc: Work[] = [];
  for (const k of veri.hits?.hits ?? []) {
    const md = k.metadata;
    if (!md?.title || !k.id) continue;

    const pdf = k.files?.find((f) => /\.pdf$/i.test(f.key ?? ""))?.links?.self
      ?? k.files?.[0]?.links?.self;

    const tur = /presentation|slide|poster/i.test(md.resource_type?.title ?? "") ? "slayt" : "makale";

    sonuc.push({
      kaynak: "zenodo",
      kaynakAd: "Zenodo",
      tur,
      baslik: md.title,
      yazarlar: (md.creators ?? []).map((c) => c.name ?? "").filter(Boolean),
      yil: Number(md.publication_date?.slice(0, 4)) || undefined,
      ozet: aciklamadanOzet(md.description),
      konular: md.keywords,
      yayinci: md.resource_type?.title,
      doi: k.doi,
      link: k.links?.html ?? `https://zenodo.org/records/${k.id}`,
      pdf,
      erisim: "acik",
      ham: k,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "zenodo",
  ad: "Zenodo",
  tur: ["makale", "slayt"],
  aciklama: "Arastirma verisi, calisma kagitlari ve acik sunum dosyalari (tam PDF)",
  ara,
};

export default kaynak;