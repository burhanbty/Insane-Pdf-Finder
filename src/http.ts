import { ayar } from "./config.js";

type HataSinifi = "zaman-asimi" | "http" | "ag" | "parse";

export class KaynakHatasi extends Error {
  readonly sinif: HataSinifi;
  readonly durum?: number;
  constructor(sinif: HataSinifi, mesaj: string, durum?: number) {
    super(mesaj);
    this.name = "KaynakHatasi";
    this.sinif = sinif;
    this.durum = durum;
  }
}

/* ---------------------------------------------------------------- */
/* Host basina kuyruk: Open Library 1-3 istek/sn sinirinda calismak   */
/* zorunda, digerleri de ayni discipline uygulasin.                  */
/* ---------------------------------------------------------------- */

const kuyruklar = new Map<string, Promise<unknown>>();
const sonZaman = new Map<string, number>();

/** Ayni hosta istekleri siraya koyar, aralarinda en az `bosluk` ms bekler. */
function sirayaAl<T>(host: string, boslukMs: number, is: () => Promise<T>): Promise<T> {
  const onceki = kuyruklar.get(host) ?? Promise.resolve();
  const sonraki = onceki.then(async () => {
    const kalan = boslukMs - (Date.now() - (sonZaman.get(host) ?? 0));
    if (kalan > 0) await new Promise((r) => setTimeout(r, kalan));
    sonZaman.set(host, Date.now());
    return is();
  });
  // Zincirin kopmamasi icin hatayi yutuyoruz.
  kuyruklar.set(
    host,
    sonraki.then(
      () => undefined,
      () => undefined,
    ),
  );
  return sonraki;
}

export interface GetOptions {
  /** Header ekle. */
  header?: Record<string, string>;
  timeoutMs?: number;
  /** Yeniden deneme sayisi (ağ hataları ve 5xx için). */
  tekrar?: number;
  /** Bu host icin istekler arasi minimum bekleme. Varsayilan 250ms. */
  boslukMs?: number;
  /** 429'da denemeden vazgeç. Varsayilan 1 (yani bir kez tekrar dener). */
  tekrarKotasiz?: number;
  /** Dondurulmus HTML/metin dondur. */
  ham?: boolean;
  /** Tam yonlendirme izleme (indirme icin). */
  yonlendir?: boolean;
}

/**
 * Tek HTTP GET. Zaman asimi, yeniden deneme ve host kuyrugu icerir.
 * Hatalar KaynakHatasi olarak yukseltilir; cagiran kaynak bunu yakalayip
 * kullaniciya "bu kaynak calismadi" diye gösterebilir.
 */
export async function get(url: string, secenek: GetOptions = {}): Promise<Response> {
  const {
    header = {},
    timeoutMs = 15_000,
    tekrar = 2,
    boslukMs = 250,
    tekrarKotasiz = 1,
  } = secenek;

  const u = new URL(url);
  const host = u.host;
  const sonDeneme = tekrar;

  return sirayaAl(host, boslukMs, async () => {
    let sonHata: unknown;

    for (let deneme = 0; deneme <= sonDeneme; deneme++) {
      const kontrolcu = new AbortController();
      const zamanlayici = setTimeout(() => kontrolcu.abort(), timeoutMs);
      try {
        const cevap = await fetch(url, {
          signal: kontrolcu.signal,
          redirect: secenek.yonlendir ? "follow" : "follow",
          headers: {
            "user-agent": ayar.userAgent(),
            accept: secenek.ham
              ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              : "application/json, text/plain, */*",
            "accept-language": "tr,en;q=0.8",
            ...header,
          },
        });

        if (cevap.status === 429 || cevap.status >= 500) {
          // 429 genelde kotadir. Uzun bekleyip tekrar denemek cogu zaman
          // ise yaramaz ve butun aramayi yavaslatir; hatayi bildirip cik.
          if (cevap.status === 429 && deneme >= tekrarKotasiz) {
            throw new KaynakHatasi(
              "http",
              `${host} 429 — kota dolu, biraz sonra tekrar deneyin`,
              429,
            );
          }
          sonHata = new KaynakHatasi("http", `${host} ${cevap.status}`, cevap.status);
          const bekle = Number(cevap.headers.get("retry-after") ?? 0) * 1000;
          await new Promise((r) => setTimeout(r, bekle || 800 * (deneme + 1)));
          continue;
        }
        if (!cevap.ok) {
          throw new KaynakHatasi("http", `${host} ${cevap.status}`, cevap.status);
        }
        return cevap;
      } catch (h) {
        if (h instanceof KaynakHatasi && h.sinif === "http") throw h;
        sonHata =
          h instanceof Error && h.name === "AbortError"
            ? new KaynakHatasi("zaman-asimi", `${host} zaman aşımı (${timeoutMs}ms)`)
            : new KaynakHatasi("ag", `${host} ${(h as Error)?.message ?? h}`);
        await new Promise((r) => setTimeout(r, 500 * (deneme + 1)));
      } finally {
        clearTimeout(zamanlayici);
      }
    }

    throw sonHata instanceof Error ? sonHata : new KaynakHatasi("ag", `${host} bilinmeyen hata`);
  });
}

/** JSON GET. Hatali JSON gelirse KaynakHatasi firlatir. */
export async function getJson<T = unknown>(url: string, secenek: GetOptions = {}): Promise<T> {
  const cevap = await get(url, secenek);
  const govde = await cevap.text();
  try {
    return JSON.parse(govde) as T;
  } catch {
    throw new KaynakHatasi("parse", `${new URL(url).host} JSON ayrıştırılamadı`);
  }
}
