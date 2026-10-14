import { get } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * OpenAIRE: Avrupa acik erisim altyapisinin toplu indeksi.
 * DOAB, OAPEN, Zenodo, kurumsal arsivler gibi yuzlerce kaynagi kapsar ve
 * hepsinin acik erisim kopyasini verir.
 *
 * Not: DOAB'in kendi REST API'si Cloudflare onunde 403 donuyor; OpenAIRE
 * ayni DOAB kayitlarini indeksledigi icin bu yol tercih edildi.
 */

interface OAAlan {
  $?: string;
  "@classid"?: string;
  "@name"?: string;
  "@classname"?: string;
}

interface OAInstance {
  accessright?: OAAlan;
  webresource?: { url?: OAAlan | OAAlan[] } | { url?: OAAlan | OAAlan[] }[];
  url?: OAAlan | OAAlan[];
  hostedby?: { "@name"?: string };
  instancetype?: { "@classname"?: string };
  pid?: OAAlan;
}

interface OAZarf {
  metadata?: { "oaf:entity"?: { "oaf:result"?: OAKayit } };
}

function dizi<T>(alan?: T | T[]): T[] {
  return alan == null ? [] : Array.isArray(alan) ? alan : [alan];
}

interface OAKayit {
  title?: OAAlan | OAAlan[];
  creator?: OAAlan | OAAlan[];
  dateofacceptance?: OAAlan;
  publisher?: OAAlan;
  subject?: OAAlan | OAAlan[];
  description?: OAAlan;
  language?: OAAlan;
  bestaccessright?: { "@classid"?: string; "@classname"?: string };
  pid?: OAAlan | OAAlan[];
  originalId?: { $?: string }[];
  children?: { instance?: OAInstance | OAInstance[] };
  sourcecollectedfrom?: { "@name"?: string } & OAAlan;
}

function deger(alan?: OAAlan | OAAlan[]): string | undefined {
  if (!alan) return undefined;
  if (Array.isArray(alan)) return deger(alan[0]);
  return typeof alan.$ === "string" ? alan.$.trim() || undefined : undefined;
}

function degerler(alan?: OAAlan | OAAlan[]): string[] {
  if (!alan) return [];
  return dizi(alan)
    .map((a) => deger(a) ?? "")
    .filter(Boolean);
}

function httpUrl(aday: string): string | undefined {
  try {
    const u = new URL(aday);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function erisimTuru(kayit: OAKayit, instance?: OAInstance): Work["erisim"] {
  const sinif = (
    instance?.accessright?.["@classid"] ??
    kayit.bestaccessright?.["@classid"] ??
    ""
  ).toUpperCase();
  if (sinif.includes("OPEN")) return "acik";
  if (sinif.includes("EMBARGO") || sinif.includes("RESTRICTED")) return "sinirli";
  if (sinif.includes("CLOSED")) return "yonlendir";
  return "yonlendir";
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const u = new URL("https://api.openaire.eu/search/publications");
  u.searchParams.set("title", sorgu.baslik);
  if (sorgu.yazar) u.searchParams.set("author", sorgu.yazar);
  if (sorgu.yil) u.searchParams.set("fromDateAccepted", `${sorgu.yil}-01-01`);
  if (sorgu.yil) u.searchParams.set("toDateAccepted", `${sorgu.yil}-12-31`);
  u.searchParams.set("size", String(Math.min(50, sorgu.limit * 2)));
  u.searchParams.set("format", "json");

  const cevap = await get(u.toString(), {
    timeoutMs: 30_000,
    boslukMs: 600,
    ham: true,
  });
  const veri = JSON.parse(await cevap.text()) as {
    response?: { results?: { result?: OAZarf | OAZarf[] } };
  };
  if (!veri?.response) throw new Error("OpenAIRE yanıt biçimi tanınmadı");

  const sonuc: Work[] = [];
  for (const zarf of dizi(veri.response.results?.result)) {
    const kayit = zarf?.metadata?.["oaf:entity"]?.["oaf:result"];
    if (!kayit || typeof kayit !== "object") {
      throw new Error("OpenAIRE kayıt metaverisi bulunamadı");
    }
    const baslik = deger(kayit.title);
    if (!baslik) continue;

    const ornekler = kayit.children?.instance
      ? Array.isArray(kayit.children.instance)
        ? kayit.children.instance
        : [kayit.children.instance]
      : [];

    // Acik erisimli ornegi olan kaydi tercih et.
    const acikOrnek = ornekler.find((o) => erisimTuru(kayit, o) === "acik") ?? ornekler[0];
    const erisim = erisimTuru(kayit, acikOrnek);

    const adresler = [
      ...dizi(acikOrnek?.webresource).flatMap((r) => degerler(r.url)),
      ...degerler(acikOrnek?.url),
      ...degerler(kayit.pid),
    ]
      .map(httpUrl)
      .filter((u): u is string => Boolean(u));
    const webUrl = adresler[0];
    // Acik erisimli kayit sayfasi tek basina dogrudan PDF demek degildir.
    const pdf =
      erisim === "acik" ? adresler.find((u) => /\.pdf$/i.test(new URL(u).pathname)) : undefined;

    const doi = (Array.isArray(kayit.pid) ? kayit.pid : kayit.pid ? [kayit.pid] : [])
      .filter((p): p is OAAlan => p?.["@classid"] === "doi")
      .map((p) => p.$)
      .find((d): d is string => Boolean(d));

    const yil = Number(kayit.dateofacceptance?.$?.slice(0, 4)) || undefined;

    sonuc.push({
      kaynak: "openaire",
      kaynakAd: `OpenAIRE${acikOrnek?.hostedby?.["@name"] ? ` (${acikOrnek.hostedby["@name"]})` : ""}`,
      tur: /book|monograph|chapter/i.test(acikOrnek?.instancetype?.["@classname"] ?? "")
        ? "kitap"
        : "makale",
      baslik,
      yazarlar: (Array.isArray(kayit.creator) ? kayit.creator : [kayit.creator])
        .filter((c): c is OAAlan => Boolean(c?.$))
        .map((c) => c.$!),
      yil: Number.isFinite(yil) ? yil : undefined,
      ozet: deger(kayit.description),
      konular: degerler(kayit.subject)
        .flatMap((s) => s.split(";"))
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 12),
      yayinci: deger(kayit.publisher),
      dil: kayit.language?.["@classid"],
      doi,
      link: webUrl ?? (doi ? `https://doi.org/${doi}` : "https://explore.openaire.eu"),
      pdf,
      erisim,
      ham: kayit,
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "openaire",
  ad: "OpenAIRE (Açık Erişim)",
  tur: ["kitap", "makale"],
  aciklama:
    "Avrupa açık erişim indeksi — DOAB, OAPEN, kurumsal arşivler dahil, açık kopyaları verir",
  ara,
};

export default kaynak;
