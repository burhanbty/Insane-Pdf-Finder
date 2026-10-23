import { ayar } from "./config.js";
import { getJson, KaynakHatasi } from "./http.js";
import { onbellekli } from "./cache.js";
import { istekSinyali, sureSinirli } from "./deadline.js";
import { doiAnahtari } from "./doi.js";
import { eserinPdfAdaylari, pdfAdaylariniBirlestir } from "./pdf-candidates.js";
import type { PdfAdayi, Work } from "./types.js";

interface Konum {
  url_for_pdf?: string | null;
  url_for_landing_page?: string | null;
  license?: string | null;
  version?: string | null;
  host_type?: string | null;
}
interface Unpaywall {
  doi?: string;
  best_oa_location?: Konum | null;
  oa_locations?: Konum[];
}
export interface TamMetinDurumu {
  hazir: boolean;
  planlanan: number;
  tamamlanan: number;
  eklenenAday: number;
  sureMs: number;
  hatalar: { doi?: string; mesaj: string }[];
}

// Aynı DOI için eşzamanlı üretim birleştirilir. Abort sinyalleri farklı aramalar paylaşmaz.
const devamEden = new Map<string, Promise<PdfAdayi[]>>();
const sinyalKimlikleri = new WeakMap<AbortSignal, number>();
let sinyalSirasi = 0;
export async function doiIcinPdfAdaylari(girdi: string): Promise<PdfAdayi[]> {
  const doi = doiAnahtari(girdi);
  if (!doi || !ayar.unpaywallEmail) return [];
  const anahtar = `unpaywall:v3:${ayar.unpaywallEmail}:${doi}`;
  const signal = istekSinyali.getStore();
  if (signal && !sinyalKimlikleri.has(signal)) sinyalKimlikleri.set(signal, ++sinyalSirasi);
  const ucus = `${ayar.cacheDir}:${anahtar}:${signal ? sinyalKimlikleri.get(signal) : "yok"}`;
  const mevcut = devamEden.get(ucus);
  if (mevcut) return mevcut;
  const is = onbellekli(anahtar, async () => {
    let veri: Unpaywall;
    try {
      veri = await getJson<Unpaywall>(
        `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(ayar.unpaywallEmail)}`,
        { timeoutMs: 4000, tekrar: 0, boslukMs: 350 },
      );
    } catch (e) {
      if (e instanceof KaynakHatasi && e.durum === 404) return [];
      throw e;
    }
    if (doiAnahtari(veri.doi) !== doi)
      throw Error("Unpaywall yanıtındaki DOI istenen eserle eşleşmiyor");
    return pdfAdaylariniBirlestir(
      [veri.best_oa_location, ...(veri.oa_locations ?? [])].flatMap((k): PdfAdayi[] =>
        k?.url_for_pdf || k?.url_for_landing_page
          ? [
              {
                url: (k.url_for_pdf ?? k.url_for_landing_page)!,
                kaynak: "unpaywall",
                kayitUrl: k.url_for_landing_page ?? undefined,
                doi,
                lisans: k.license ?? undefined,
                surum: k.version ?? undefined,
                hostTuru:
                  k.host_type === "publisher" || k.host_type === "repository"
                    ? k.host_type
                    : undefined,
                baglantiTuru: k.url_for_pdf ? "pdf" : "kayit",
                durum: "aday",
              },
            ]
          : [],
      ),
    );
  });
  devamEden.set(ucus, is);
  try {
    return pdfAdaylariniBirlestir(await is);
  } finally {
    if (devamEden.get(ucus) === is) devamEden.delete(ucus);
  }
}

/** Kaynak araması bitince ayrı süre/bütçeyle zenginleştirir; künye sonucu kaybolmaz. */
export async function tamMetniZenginlestir(works: Work[]): Promise<TamMetinDurumu> {
  const baslangic = Date.now();
  const durum: TamMetinDurumu = {
    hazir: Boolean(ayar.unpaywallEmail),
    planlanan: 0,
    tamamlanan: 0,
    eklenenAday: 0,
    sureMs: 0,
    hatalar: [],
  };
  const doiGruplari = new Map<string, Work[]>();
  for (const w of works) {
    w.pdfAdaylari = eserinPdfAdaylari(w);
    w.pdf = w.pdfAdaylari.find((a) => a.baglantiTuru !== "kayit")?.url;
    // Ödünç/kısıtlı kitap kaydının baskısını yalnızca DOI ile açık sayma.
    const doi = doiAnahtari(w.doi);
    if (!doi || w.erisim === "odunc") continue;
    const grup = doiGruplari.get(doi) ?? [];
    grup.push(w);
    doiGruplari.set(doi, grup);
  }
  if (!durum.hazir) {
    durum.sureMs = Date.now() - baslangic;
    return durum;
  }
  const isler = [...doiGruplari].slice(0, ayar.tamMetinDoiLimiti);
  durum.planlanan = isler.length;
  let sonraki = 0;
  try {
    await sureSinirli(async () => {
      const signal = istekSinyali.getStore()!;
      await Promise.all(
        Array.from({ length: Math.min(3, isler.length) }, async () => {
          for (;;) {
            signal.throwIfAborted();
            const is = isler[sonraki++];
            if (!is) return;
            const [doi, kayitlar] = is;
            try {
              const adaylar = await doiIcinPdfAdaylari(doi);
              signal.throwIfAborted();
              for (const w of kayitlar) {
                const onceki = w.pdfAdaylari?.length ?? 0;
                w.pdfAdaylari = pdfAdaylariniBirlestir(w.pdfAdaylari, adaylar);
                durum.eklenenAday += w.pdfAdaylari.length - onceki;
                w.pdf = w.pdfAdaylari.find((a) => a.baglantiTuru !== "kayit")?.url;
                if (w.pdf || adaylar.length) w.erisim = "acik";
              }
            } catch (e) {
              signal.throwIfAborted();
              durum.hatalar.push({ doi, mesaj: e instanceof Error ? e.message : String(e) });
            }
            durum.tamamlanan++;
          }
        }),
      );
    }, ayar.tamMetinTimeoutMs);
  } catch (e) {
    durum.hatalar.push({ mesaj: e instanceof Error ? e.message : String(e) });
  }
  durum.sureMs = Date.now() - baslangic;
  return durum;
}
