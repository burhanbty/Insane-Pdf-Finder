import { ayar } from "./config.js";
import { AdresHatasi, disFetch } from "./network.js";
import { istekSinyali } from "./deadline.js";
import { setTimeout as bekle } from "node:timers/promises";

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
  disAg?: boolean;
  izinliHost?: (host: string) => boolean;
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
  const ustSinyal = istekSinyali.getStore();

  return sirayaAl(host, boslukMs, async () => {
    let sonHata: unknown;

    for (let deneme = 0; deneme <= sonDeneme; deneme++) {
      ustSinyal?.throwIfAborted();
      // Native fetch bu sinyali yanit govdesi tuketilirken de izler.
      // Basliklar geldikten sonra zamanlayiciyi temizlemek, yavas/sonsuz
      // text(), arrayBuffer() ve indirme akislarini sinirsiz birakiyordu.
      const sinyal = ustSinyal
        ? AbortSignal.any([ustSinyal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);
      try {
        const init: RequestInit = {
          signal: sinyal,
          redirect: secenek.yonlendir ? "follow" : "follow",
          headers: {
            "user-agent": ayar.userAgent(),
            accept: secenek.ham
              ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
              : "application/json, text/plain, */*",
            "accept-language": "tr,en;q=0.8",
            ...header,
          },
        };
        const cevap = secenek.disAg
          ? await disFetch(url, init, secenek.izinliHost)
          : await fetch(url, init);

        if (cevap.status === 429 || cevap.status >= 500) {
          await cevap.body?.cancel().catch(() => undefined);
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
          if (deneme < sonDeneme)
            await bekleme(Math.min(bekle || 800 * (deneme + 1), 5000), ustSinyal);
          continue;
        }
        if (!cevap.ok) {
          await cevap.body?.cancel().catch(() => undefined);
          throw new KaynakHatasi("http", `${host} ${cevap.status}`, cevap.status);
        }
        return cevap;
      } catch (h) {
        if (h instanceof AdresHatasi) throw h;
        ustSinyal?.throwIfAborted();
        if (h instanceof KaynakHatasi && h.sinif === "http") throw h;
        sonHata = sinyal.aborted
          ? new KaynakHatasi("zaman-asimi", `${host} zaman aşımı (${timeoutMs}ms)`)
          : new KaynakHatasi("ag", `${host} ${(h as Error)?.message ?? h}`);
        if (deneme < sonDeneme) await bekleme(500 * (deneme + 1), ustSinyal);
      }
    }

    throw sonHata instanceof Error ? sonHata : new KaynakHatasi("ag", `${host} bilinmeyen hata`);
  });
}

async function bekleme(ms: number, signal?: AbortSignal) {
  await bekle(ms, undefined, { signal });
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
