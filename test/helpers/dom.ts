/*
 * Arayuz testleri icin ortak jsdom kurulumu.
 *
 * Once iki test dosyasi (arayuz-dyn.test.ts, arayuz-kaynak.test.ts) ayni
 * kurulum kodunu kopyalamisti. Burada tek yere toplandi.
 *
 * Kullanim:
 *
 *   import { domKur, aramaYap, gorunurKartlar } from "./helpers/dom.js";
 *
 *   beforeEach(async () => {
 *     await domKur();
 *   });
 *
 * Not: app.js dosyasi gercek kodundan okunup calistirilir; test icin
 * yeniden yazilmaz. Boylece testler, tarayicida calisan kodun aynisini
 * denetler. Dosyanin sonunda top-level await oldugu icin calistirma
 * geri dondurulen Promise beklenir — aksi halde testler birbirine
 * karisir ve eski DOM'daki ogeleri okurlar.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

/** Etkin JSDOM nesnesi. domKur() cagrildiktan sonra kullanilabilir. */
export let dom: JSDOM;

/** fetch sahte cevaplari icin: (yol, govde) => cevap. */
export type FetchSahte = (yol: string, govde: unknown) => unknown;

/** Etkin sahte. Testlerde atanir. */
export let fetchSahte: FetchSahte = () => ({});

/** Bir aramanin bos cevabi. */
export const BOS_CEVPAP = {
  gruplar: [],
  kaynakDurumlari: [],
  toplamSonuc: 0,
  gruplamaNotu: "",
};

/** app.js'in çağırdığı rotaların listesi (kayıt amaçlı). */
export const ROTALAR = [
  "/api/search",
  "/api/web-search",
  "/api/sources",
  "/api/saglik",
  "/api/downloads",
  "/api/download",
  "/api/summary",
  "/api/sayfa-sayisi",
  "/api/kapak",
  "/api/custom-sources",
  "/api/cache/clear",
] as const;

/**
 * index.html + app.js'i yeni bir DOM'da yükler.
 * Her beforeEach'te cagrilmalidir.
 */
export async function domKur(): Promise<void> {
  const kok = process.cwd();
  const html = await fs.readFile(path.join(kok, "public/index.html"), "utf8");
  const js = await fs.readFile(path.join(kok, "public/app.js"), "utf8");

  dom = new JSDOM(html, {
    url: "http://127.0.0.1:3000/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });

  const { window } = dom;

  // Varsayilan sahte: /api/downloads bos liste, digerleri bos cevap.
  fetchSahte = (yol: string) => (yol === "/api/downloads" ? { dosyalar: [] } : BOS_CEVPAP);

  window.fetch = (async (yol: string, secenek?: { body?: string }) => {
    const govde = secenek?.body ? JSON.parse(secenek.body) : undefined;
    const veri = fetchSahte(yol, govde) as Record<string, unknown>;
    const kod = veri.hata ? 400 : 200;
    return { ok: kod < 400, status: kod, json: async () => veri };
  }) as unknown as typeof window.fetch;

  // app.js globalThis.fetch uzerinden istek atiyor.
  globalThis.fetch = window.fetch as unknown as typeof globalThis.fetch;

  try {
    window.eval(`globalThis.__calisma = (async () => {\n${js}\n})();`);
    await (window as unknown as { __calisma: Promise<void> }).__calisma;
  } catch (hata) {
    throw new Error(`app.js yüklenemedi: ${(hata as Error).message}`, { cause: hata });
  }
}

/** Etkin DOM'un dokümanı. */
export function belge(): Document {
  return dom.window.document;
}

/**
 * Arama formunu doldurur ve gönderir.
 * `bekle` ms sonra döner (arama zamanlanmış bir iş zinciri).
 */
export async function aramaYap(
  degerler: { baslik?: string; yazar?: string; yil?: string } = {},
  bekle = 90,
): Promise<Document> {
  const d = belge();

  if (degerler.baslik !== undefined) {
    d.querySelector<HTMLInputElement>("#baslik")!.value = degerler.baslik;
  }
  if (degerler.yazar !== undefined) {
    d.querySelector<HTMLInputElement>("#yazar")!.value = degerler.yazar;
  }
  if (degerler.yil !== undefined) {
    d.querySelector<HTMLInputElement>("#yil")!.value = degerler.yil;
  }

  d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );

  await bekleMs(bekle);
  return d;
}

/** Belirtilen süre bekler. */
export function bekleMs(ms: number): Promise<void> {
  return new Promise((r) => dom.window.setTimeout(r, ms));
}

/** Filtrelenmemiş (gizli olmayan) kart listesi. */
export function gorunurKartlar(d: Document = belge()): HTMLElement[] {
  return [...d.querySelectorAll<HTMLElement>(".kart")].filter(
    (k) => !k.classList.contains("gizli"),
  );
}

/** Tüm kart listesi (gizli olanlar dahil). */
export function tumKartlar(d: Document = belge()): HTMLElement[] {
  return [...d.querySelectorAll<HTMLElement>(".kart")];
}

/** Bir <select> veya <input>'a değer atar ve change olayını tetikler. */
export function degistir(secici: string, deger: string | boolean): void {
  const d = belge();
  const el = d.querySelector<HTMLSelectElement | HTMLInputElement>(secici)!;
  if (el instanceof dom.window.HTMLInputElement && el.type === "checkbox") {
    el.checked = Boolean(deger);
  } else {
    el.value = String(deger);
  }
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

/** Bir öğeye tıklar. */
export function tikla(secici: string | Element): void {
  const el = typeof secici === "string" ? belge().querySelector(secici)! : secici;
  el.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
}
