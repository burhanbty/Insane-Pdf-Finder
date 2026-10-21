import { describe, expect, it, vi } from "vitest";
import { IndirmeYoneticisi } from "../src/download-jobs.js";
import type { indir, IndirmeSecenekleri, IndirmeSonucu } from "../src/download.js";
const sonuc: IndirmeSonucu = { dosya: "book.pdf", yol: "unused", boyut: 42, tur: "pdf" };
const hedef = (ad: string) => ({ url: `https://example.com/${ad}.pdf`, varsayilanAd: ad });
function kontrollu() {
  const calisan: {
    ad: string;
    secenek: IndirmeSecenekleri;
    bitir: (r: IndirmeSonucu) => void;
    reddet: (e: Error) => void;
  }[] = [];
  const fn: typeof indir = (h, _tur, s = {}) =>
    new Promise((resolve, reject) => {
      calisan.push({ ad: h.varsayilanAd, secenek: s, bitir: resolve, reddet: reject });
      s.signal?.addEventListener("abort", () => reject(s.signal!.reason), { once: true });
    });
  return { calisan, fn };
}
describe("indirme kuyruğunun yaşam döngüsü", () => {
  it("en fazla iki işi paralel çalıştırır; üçüncüyü ilk boşalan yere alır", async () => {
    const { calisan, fn } = kontrollu();
    const y = new IndirmeYoneticisi(fn);
    y.ekle(hedef("a"), "pdf");
    y.ekle(hedef("b"), "pdf");
    const c = y.ekle(hedef("c"), "pdf");
    await vi.waitFor(() => expect(calisan.map((i) => i.ad)).toEqual(["a", "b"]));
    expect(y.listele().find((i) => i.id === c.id)?.durum).toBe("sirada");
    calisan[0]!.bitir(sonuc);
    await vi.waitFor(() => expect(calisan.map((i) => i.ad)).toEqual(["a", "b", "c"]));
    calisan[1]!.bitir(sonuc);
    calisan[2]!.bitir(sonuc);
    await vi.waitFor(() => expect(y.listele().every((i) => i.durum === "tamamlandi")).toBe(true));
  });
  it("sıradaki işi iptal edince hiç ağ isteği yapmaz; çalışan işi sinyalle durdurur", async () => {
    const { calisan, fn } = kontrollu();
    const y = new IndirmeYoneticisi(fn, 1);
    const a = y.ekle(hedef("a"), "pdf"),
      b = y.ekle(hedef("b"), "pdf");
    await vi.waitFor(() => expect(calisan).toHaveLength(1));
    y.iptal(b.id);
    y.iptal(a.id);
    await vi.waitFor(() => expect(y.listele().every((i) => i.durum === "iptal")).toBe(true));
    expect(calisan).toHaveLength(1);
    expect(calisan[0]!.secenek.signal?.aborted).toBe(true);
  });
  it("aynı etkin URL'yi tekrar kuyruğa almaz", async () => {
    const { calisan, fn } = kontrollu();
    const y = new IndirmeYoneticisi(fn);
    const a = y.ekle(hedef("a"), "pdf");
    expect(y.ekle(hedef("a"), "pdf").id).toBe(a.id);
    await vi.waitFor(() => expect(calisan).toHaveLength(1));
    calisan[0]!.bitir(sonuc);
  });
  it("ilerlemeyi aktarır, hata sonrası yeniden dener, iç URL/yol bilgisini dışarı sızdırmaz", async () => {
    const { calisan, fn } = kontrollu();
    const y = new IndirmeYoneticisi(fn);
    const a = y.ekle(hedef("a"), "pdf");
    await vi.waitFor(() => expect(calisan).toHaveLength(1));
    calisan[0]!.secenek.ilerleme?.({ alinan: 12, toplam: 42, asama: "indiriliyor" });
    expect(y.listele()[0]).toMatchObject({ alinan: 12, toplam: 42, durum: "indiriliyor" });
    calisan[0]!.reddet(new Error("Kaynak yanıt vermedi"));
    await vi.waitFor(() => expect(y.listele()[0]?.durum).toBe("basarisiz"));
    expect(y.tekrar(a.id)).toMatchObject({ deneme: 2, alinan: 0, durum: "sirada" });
    await vi.waitFor(() => expect(calisan).toHaveLength(2));
    calisan[1]!.bitir({ ...sonuc, mevcut: true });
    await vi.waitFor(() => expect(y.listele()[0]?.durum).toBe("tamamlandi"));
    expect(y.listele()[0]).toMatchObject({ dosya: "book.pdf", mevcut: true });
    expect(y.listele()[0]).not.toHaveProperty("hedef");
    expect(y.listele()[0]).not.toHaveProperty("yol");
    expect(() => y.tekrar(a.id)).toThrow();
  });
  it("sınırsız iş kabul etmez; dolu kuyrukta tekrar deneme de sınırı aşmaz", async () => {
    const { calisan, fn } = kontrollu();
    const y = new IndirmeYoneticisi(fn, 1);
    const ilk = y.ekle(hedef("a"), "pdf");
    y.iptal(ilk.id);
    for (let n = 0; n < 20; n++) y.ekle(hedef(String(n)), "pdf");
    expect(() => y.ekle(hedef("overflow"), "pdf")).toThrow("Kuyruk dolu");
    expect(() => y.tekrar(ilk.id)).toThrow("Kuyruk dolu");
    for (const i of y.listele()) y.iptal(i.id);
    await Promise.resolve();
    expect(calisan).toHaveLength(0);
  });
});
