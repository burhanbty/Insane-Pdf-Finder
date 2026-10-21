import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
let dom: JSDOM;
let d: Document;
const calls: { yol: string; body?: unknown }[] = [];
const downloads: string[] = [];
interface Is {
  id: string;
  baslik: string;
  durum: string;
  alinan: number;
  toplam?: number;
  dosya?: string;
  hata?: string;
}
async function kur(ilk: Is[] = []) {
  calls.length = 0;
  downloads.length = 0;
  dom = new JSDOM(await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"), {
    url: "http://127.0.0.1:3000",
    runScripts: "outside-only",
  });
  d = dom.window.document;
  let isler = ilk;
  let eklemeler = 0;
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.getAttribute("href")!);
  };
  dom.window.fetch = (async (yol: string, opts?: { body?: string }) => {
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    calls.push({ yol, body });
    if (!body) return { ok: true, json: async () => ({ isler }) };
    if (yol.endsWith("/iptal")) isler = isler.map((i) => ({ ...i, durum: "iptal" }));
    else if (yol.endsWith("/tekrar"))
      isler = isler.map((i) => ({ ...i, durum: "sirada", hata: undefined }));
    else
      isler = [
        {
          id: ++eklemeler === 1 ? "new" : `new-${eklemeler}`,
          baslik: body.baslik,
          durum: "sirada",
          alinan: 0,
        },
      ];
    return { ok: true, json: async () => ({ is: isler[0] }) };
  }) as unknown as typeof dom.window.fetch;
  dom.window.eval(
    await fs.readFile(new URL("../public/download-manager.js", import.meta.url), "utf8"),
  );
  await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
  const api = (
    dom.window as unknown as {
      indirmeYoneticisi: { ekle: (g: unknown, kutu?: Element) => Promise<unknown> };
    }
  ).indirmeYoneticisi;
  return {
    api,
    set: (v: Is[]) => {
      isler = v;
    },
    yenile: async () => {
      dom.window.dispatchEvent(new dom.window.Event("focus"));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}
afterEach(() => dom?.window.close());
it("sayfa açılırken önceki tamamlanmış işleri tekrar indirmez", async () => {
  await kur([{ id: "old", baslik: "Old", durum: "tamamlandi", alinan: 42, dosya: "old.pdf" }]);
  await vi.waitFor(() =>
    expect(d.querySelector(".indirme-isi a")?.getAttribute("href")).toBe("/api/downloads/old.pdf"),
  );
  expect(downloads).toEqual([]);
});
it("bilinmeyen toplamı yüzde uydurmadan gösterir, bitince bir kez tarayıcı indirmesi başlatır", async () => {
  const { api, set, yenile } = await kur();
  const kutu = d.createElement("p");
  d.body.append(kutu);
  await api.ekle({ url: "https://example.com/book.pdf", baslik: "Book", tur: "pdf" }, kutu);
  set([{ id: "new", baslik: "Book", durum: "indiriliyor", alinan: 100 }]);
  await yenile();
  expect(d.querySelector("progress")?.hasAttribute("value")).toBe(false);
  expect(kutu.textContent).toContain("toplam boyut bilinmiyor");
  set([{ id: "new", baslik: "Book", durum: "indiriliyor", alinan: 100, toplam: 1000 }]);
  await yenile();
  expect((d.querySelector("progress") as HTMLProgressElement).position).toBe(0.1);
  set([{ id: "new", baslik: "Book", durum: "tamamlandi", alinan: 1000, dosya: "book.pdf" }]);
  await yenile();
  await yenile();
  expect(downloads).toEqual(["/api/downloads/book.pdf"]);
  expect(kutu.querySelector("a")?.getAttribute("download")).toBe("book.pdf");
});
it("kuyrukta iptal ve tekrar deneme doğru işi kullanır", async () => {
  await kur([{ id: "cancel", baslik: "Book", durum: "sirada", alinan: 0 }]);
  await vi.waitFor(() =>
    expect(d.querySelector(".indirme-isi button")?.textContent).toBe("İptal et"),
  );
  (d.querySelector(".indirme-isi button") as HTMLElement).click();
  await vi.waitFor(() =>
    expect(d.querySelector(".indirme-isi button")?.textContent).toBe("Tekrar dene"),
  );
  (d.querySelector(".indirme-isi button") as HTMLElement).click();
  await vi.waitFor(() =>
    expect(calls.some((c) => c.yol === "/api/download-jobs/cancel/tekrar")).toBe(true),
  );
  expect(calls.some((c) => c.yol === "/api/download-jobs/cancel/iptal")).toBe(true);
});
it("farklı iş aynı dosyaya dönüşürse bu sayfada ikinci otomatik indirme başlatmaz", async () => {
  const { api, set, yenile } = await kur();
  await api.ekle({ url: "https://example.com/a.pdf", baslik: "A" });
  set([{ id: "new", baslik: "A", durum: "tamamlandi", alinan: 100, dosya: "same.pdf" }]);
  await yenile();
  await api.ekle({ url: "https://example.com/b.pdf", baslik: "B" });
  set([{ id: "new-2", baslik: "B", durum: "tamamlandi", alinan: 100, dosya: "same.pdf" }]);
  await yenile();
  expect(downloads).toEqual(["/api/downloads/same.pdf"]);
  expect(d.querySelector(".indirme-isi a")?.getAttribute("href")).toBe("/api/downloads/same.pdf");
});
it("sunucu yeniden başlatılınca izlenen kartta kaybolan işi açıklayıp durdurur", async () => {
  const { api, set, yenile } = await kur();
  const kutu = d.createElement("p");
  d.body.append(kutu);
  await api.ekle({ url: "https://example.com/book.pdf", baslik: "Book" }, kutu);
  set([]);
  await yenile();
  expect(kutu.textContent).toContain("sunucu yeniden başlatılmış olabilir");
  expect(downloads).toEqual([]);
});
it("başlık ve kaynak hatasını HTML olarak çalıştırmaz", async () => {
  await kur([
    {
      id: "bad",
      baslik: '<img src=x onerror="alert(1)">',
      durum: "basarisiz",
      alinan: 0,
      hata: "<script>alert(1)</script>",
    },
  ]);
  await vi.waitFor(() =>
    expect(d.querySelector(".indirme-isi")?.textContent).toContain("<script>"),
  );
  expect(d.querySelector(".indirme-isi img, .indirme-isi script")).toBeNull();
});
