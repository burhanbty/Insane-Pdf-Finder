import { get } from "./http.js";
import { sinirliGovde } from "./body.js";
import { alanlar, htmlCoz, sayfadakiPdfler, sayfaUstverisi } from "./pdf-resolver.js";
import { adayAdresi } from "./pdf-candidates.js";
import { doiAnahtari } from "./doi.js";
import { isbnDogrula } from "./isbn.js";
import { eslestir } from "./normalize.js";
import { istekSinyali } from "./deadline.js";
import type { SourceModule, Sorgu, Work } from "./types.js";
import { arsiveKaydet } from "./institutional-index.js";

export const UNIVERSITELER = {
  openmetu: {
    ad: "ODTÜ OpenMETU",
    origin: "https://open.metu.edu.tr",
    yol: "/discover",
    parametre: "query",
    kayit: /^\/handle\/11511\/\d+$/,
  },
  sabanci: {
    ad: "Sabancı Üniversitesi",
    origin: "https://research.sabanciuniv.edu",
    yol: "/cgi/search/simple",
    parametre: "q",
    kayit: /^\/id\/eprint\/\d+\/$/,
  },
  bilkent: {
    ad: "Bilkent Üniversitesi",
    origin: "https://repository.bilkent.edu.tr",
    yol: "/server/api/discover/search/objects",
    parametre: "query",
    kayit: /^\/items\/[\da-f-]+$/,
  },
} as const;
export type Universite = keyof typeof UNIVERSITELER;

async function metinAl(url: string): Promise<string> {
  const r = await get(url, { ham: true, disAg: true, tekrar: 0, timeoutMs: 7000, boslukMs: 250 });
  return new TextDecoder().decode(await sinirliGovde(r, 4 * 1024 * 1024));
}

function belgeTuru(t: string): Work["belgeTuru"] {
  if (/thesis|tez|dissertation/i.test(t)) return "tez";
  if (/chapter|book section/i.test(t)) return "kitap-bolumu";
  if (/book|monograph/i.test(t) && !/review/i.test(t)) return "kitap";
  if (/lecture|course|ders/i.test(t)) return "ders-notu";
  if (/presentation|slide|sunum/i.test(t)) return "sunum";
  if (/report|rapor/i.test(t)) return "rapor";
  return undefined;
}
function eser(kaynak: Universite, link: string, alan: (ad: string) => string[]): Work | undefined {
  const ilk = (...adlar: string[]) => adlar.flatMap(alan).find(Boolean);
  const baslik = ilk("citation_title", "dc.title");
  if (!baslik) return undefined;
  const belge = belgeTuru(alan("dc.type").join(" "));
  const tur =
    belge === "kitap" || belge === "kitap-bolumu"
      ? "kitap"
      : belge === "ders-notu" || belge === "sunum"
        ? "slayt"
        : "makale";
  const doi = [
    ilk("citation_doi", "dc.identifier.doi"),
    ...alan("dc.identifier"),
    ...alan("dc.relation"),
  ]
    .map(doiAnahtari)
    .find(Boolean);
  const tarih = ilk("citation_publication_date", "citation_date", "dc.date.issued", "dc.date");
  const yil = Number(tarih?.match(/\b(?:1[0-9]{3}|20[0-9]{2})\b/)?.[0]) || undefined;
  const yazarlar = alan("citation_author").length
    ? alan("citation_author")
    : alan("dc.creator").length
      ? alan("dc.creator")
      : alan("dc.contributor.author");
  const kisitli = /embargo|closed|restricted/i.test(
    [...alan("dc.rights"), ...alan("dc.rights.accessrights")].join(" "),
  );
  const pdfler = kisitli
    ? []
    : alan("citation_pdf_url").flatMap((url) => (adayAdresi(url) ? [adayAdresi(url)!] : []));
  return {
    kaynak,
    kaynakAd: UNIVERSITELER[kaynak].ad,
    tur,
    baslik,
    link,
    yazarlar,
    yil,
    doi,
    belgeTuru: belge,
    isbn: isbnDogrula(ilk("citation_isbn", "dc.identifier.isbn")) ?? undefined,
    ozet: ilk("dc.description.abstract", "dc.description"),
    dil: ilk("citation_language", "dc.language.iso", "dc.language"),
    yayinci: ilk("citation_publisher", "dc.publisher"),
    konular: [
      ...alan("dc.subject"),
      ...alan("citation_keywords").flatMap((s) => s.split(";")),
    ].slice(0, 14),
    erisim: kisitli ? "sinirli" : pdfler.length ? "acik" : "yonlendir",
    pdf: pdfler[0],
    pdfAdaylari: pdfler.length
      ? pdfler.map((url) => ({
          url,
          kaynak,
          kayitUrl: link,
          doi,
          durum: "aday",
          baglantiTuru: "pdf",
        }))
      : kisitli
        ? []
        : [{ url: link, kaynak, kayitUrl: link, doi, durum: "aday", baglantiTuru: "kayit" }],
  };
}

export function kurumSayfasindanEser(
  kaynak: Universite,
  html: string,
  link: string,
): Work | undefined {
  const m = sayfaUstverisi(html);
  if (!m.has("citation_pdf_url")) m.set("citation_pdf_url", sayfadakiPdfler(html, link));
  return eser(kaynak, link, (ad) => m.get(ad) ?? []);
}

export function kurumAramaKayitlari(
  kaynak: Universite,
  html: string,
): { link: string; baslik: string }[] {
  const k = UNIVERSITELER[kaynak];
  const sonuc = new Map<string, string>();
  const temiz = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  for (const m of temiz.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const a = alanlar(m[1]!);
    if (!a.href) continue;
    try {
      const u = new URL(a.href, k.origin);
      if (u.origin !== k.origin || !k.kayit.test(u.pathname)) continue;
      const baslik = htmlCoz(m[2]!.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      if (baslik) sonuc.set(u.href, baslik);
    } catch {
      /* kaynak dışı ve bozuk bağlantılar elenir */
    }
  }
  return [...sonuc].map(([link, baslik]) => ({ link, baslik }));
}

interface DSpaceItem {
  uuid?: string;
  withdrawn?: boolean;
  metadata?: Record<string, { value?: string }[]>;
}
export function bilkentYanitiniCoz(v: unknown): Work[] {
  const veri = v as {
    _embedded?: {
      searchResult?: {
        page?: { totalElements?: number };
        _embedded?: { objects?: { _embedded?: { indexableObject?: DSpaceItem } }[] };
      };
    };
  };
  const result = veri?._embedded?.searchResult;
  if (result?.page?.totalElements === 0) return [];
  if (!result || !Array.isArray(result._embedded?.objects))
    throw Error("Bilkent arama yanıtı tanınmadı");
  return result._embedded.objects.flatMap((o) => {
    const item = o._embedded?.indexableObject;
    if (
      !item?.uuid ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(item.uuid) ||
      item.withdrawn
    )
      return [];
    const w = eser("bilkent", `${UNIVERSITELER.bilkent.origin}/items/${item.uuid}`, (ad) =>
      (item.metadata?.[ad] ?? []).flatMap((m) => (typeof m.value === "string" ? [m.value] : [])),
    );
    return w ? [w] : [];
  });
}

export function universiteKaynagi(id: Universite): SourceModule {
  const k = UNIVERSITELER[id];
  return {
    id,
    ad: k.ad,
    tur: ["kitap", "makale", "slayt"],
    onbellekSurumu: () => "v1",
    aciklama:
      "Üniversitenin açık arşivinde makale, tez, kitap ve ders materyali; dosyasız/ambargolu kayıtlar ayrıca belirtilir.",
    async ara(s: Sorgu) {
      const uyarilar: string[] = [];
      const u = new URL(k.yol, k.origin);
      u.searchParams.set(k.parametre, s.baslik);
      let works: Work[];
      if (id === "bilkent") {
        u.searchParams.set("dsoType", "item");
        u.searchParams.set("size", String(Math.min(20, s.limit * 2)));
        works = bilkentYanitiniCoz(JSON.parse(await metinAl(u.href)));
      } else {
        if (id === "sabanci") {
          u.searchParams.set("_action_search", "Search");
          u.searchParams.set("_order", "bytitle");
        }
        const html = await metinAl(u.href);
        if (!/ep_search|ui-datatable|discovery|discover/i.test(html))
          throw Error("Arşiv arama sayfası tanınmadı; erişim engeli olabilir");
        const adaylar = kurumAramaKayitlari(id, html)
          .sort(
            (a, b) =>
              eslestir({ baslik: s.baslik, yazarlar: [] }, { baslik: b.baslik, yazarlar: [] })
                .puan -
              eslestir({ baslik: s.baslik, yazarlar: [] }, { baslik: a.baslik, yazarlar: [] }).puan,
          )
          .slice(0, Math.min(s.limit, 5));
        const sonuclar = await Promise.allSettled(
          adaylar.map(async (a) => kurumSayfasindanEser(id, await metinAl(a.link), a.link)),
        );
        const eksik = sonuclar.filter((r) => r.status === "rejected" || !r.value).length;
        if (eksik)
          uyarilar.push(
            `${adaylar.length} kayıttan ${eksik} kaydın künyesi alınamadı; arşiv taraması kısmi.`,
          );
        istekSinyali.getStore()?.throwIfAborted();
        if (sonuclar.length && sonuclar.every((r) => r.status === "rejected" || !r.value))
          throw Error("Arşiv bulundu fakat kayıt künyeleri alınamadı; daha sonra yeniden deneyin");
        works = sonuclar.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
      }
      // Arşiv türleri sorgudan tahmin edilmez. Tez/raporlar makale altında ayrıca etiketlenir.
      const secilen = works.filter((w) => w.tur === s.tur).slice(0, s.limit);
      await arsiveKaydet(secilen);
      return Object.assign(secilen, uyarilar.length ? { uyarilar } : {});
    },
  };
}
