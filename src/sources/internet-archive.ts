import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * Internet Archive: iki islev.
 *  1) Open Library'den gelen `ia` kimliklerini dogrudan PDF'ye cevirir
 *     (kayit ici cozulur, ayri istek gerektirmez).
 *  2) Bagimsiz arama: mediatype filtresi ile acik metin/PDF kayitlarini arar.
 */

interface IAMeta {
  is_dark?: boolean;
  metadata?: Record<string, string | string[] | boolean>;
  files?: {
    name?: string;
    format?: string;
    size?: string;
    source?: string;
    private?: string | boolean;
  }[];
}

function ilkDeger(v: string | string[] | boolean | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v === undefined ? undefined : String(v);
}

/** Bir IA kaydinin indirilebilir PDF/metin dosyalarini bulur. */
export async function iaDosyalari(
  kimlik: string,
): Promise<{ pdf?: string; metin?: string; erisim: Work["erisim"] }> {
  try {
    const veri = await getJson<IAMeta>(
      `https://archive.org/metadata/${encodeURIComponent(kimlik)}`,
      { boslukMs: 700, timeoutMs: 20_000 },
    );

    const md = veri.metadata ?? {};
    const erisimKisiti = ilkDeger(md.access_restricted_item);
    const koleksiyonlar = Array.isArray(md.collection)
      ? md.collection
      : String(md.collection ?? "").split("|");
    const oduncMu = koleksiyonlar.some((v) => ["printdisabled", "inlibrary"].includes(v));

    let pdf: string | undefined;
    let metin: string | undefined;

    for (const f of veri.files ?? []) {
      const ad = f.name ?? "";
      const format = (f.format ?? "").toLowerCase();
      if (f.private === true || f.private === "true") continue;
      if (
        !pdf &&
        /^(?:text |image )?pdf$/.test(format) &&
        /\.pdf$/i.test(ad) &&
        !/bw\.pdf$/i.test(ad)
      ) {
        pdf = `https://archive.org/download/${encodeURIComponent(kimlik)}/${encodeURIComponent(ad)}`;
      }
      if (!metin && /\.txt$/i.test(ad) && format.includes("text")) {
        metin = `https://archive.org/download/${encodeURIComponent(kimlik)}/${encodeURIComponent(ad)}`;
      }
    }

    const sinirli = veri.is_dark === true || erisimKisiti === "true" || oduncMu;
    return {
      pdf: sinirli ? undefined : pdf,
      metin: sinirli ? undefined : metin,
      erisim: sinirli ? "odunc" : pdf || metin ? "acik" : "yonlendir",
    };
  } catch {
    return { erisim: "yonlendir" };
  }
}

interface IADoc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
  year?: string;
  date?: string;
  description?: string;
  subject?: string | string[];
  language?: string;
  mediatype?: string;
  publicdate?: string;
}

function dizi(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : v.split(/;\s*|\n/).filter(Boolean);
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const terimler = [`title:("${sorgu.baslik}")`];
  if (sorgu.yazar) terimler.push(`creator:("${sorgu.yazar}")`);
  terimler.push("mediatype:(texts)");

  const u = new URL("https://archive.org/advancedsearch.php");
  u.searchParams.set("q", terimler.join(" AND "));
  u.searchParams.set(
    "fl[]",
    ["identifier", "title", "creator", "year", "date", "description", "subject", "language"].join(
      ",",
    ),
  );
  u.searchParams.set("rows", String(Math.min(50, sorgu.limit * 2)));
  u.searchParams.set("sort", "downloads desc");
  u.searchParams.set("output", "json");

  const veri = await getJson<{ response?: { docs?: IADoc[] } }>(u.toString(), {
    boslukMs: 700,
    timeoutMs: 20_000,
  });

  const sonuc: Work[] = [];
  for (const d of veri.response?.docs ?? []) {
    if (!d.identifier || !d.title) continue;

    const yil = Number(d.year ?? (d.date ?? "").slice(0, 4)) || undefined;
    const dosyalar = await iaDosyalari(d.identifier);

    sonuc.push({
      kaynak: "internet-archive",
      kaynakAd: "Internet Archive",
      tur: "kitap",
      baslik: d.title,
      yazarlar: dizi(d.creator),
      yil: Number.isFinite(yil) ? yil : undefined,
      ozet: dizi(d.description).join(" ").slice(0, 1200) || undefined,
      konular: dizi(d.subject).slice(0, 12),
      dil: d.language,
      link: `https://archive.org/details/${d.identifier}`,
      pdf: dosyalar.pdf,
      tamMetin: dosyalar.metin,
      erisim: dosyalar.erisim,
      ham: { identifier: d.identifier },
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "internet-archive",
  ad: "Internet Archive",
  tur: ["kitap"],
  aciklama: "Acik metin ve PDF; tam metin okunabilen kayitlar",
  ara,
};

export default kaynak;
