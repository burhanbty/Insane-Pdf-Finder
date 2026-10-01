/*
 * Gercek DOM ile arayuz testleri (jsdom).
 *
 * Buradaki test, "Cannot read properties of null (reading 'checked')"
 * hatasinin kaynagini gercekten yakalayabilecek sekilde kuruluyor:
 * index.html yuklenir, app.js calistirilir, form doldurulup gonderilir ve
 * fetch sahte (stub) cevaplarla degistirilir.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

interface Cevap {
  gruplar: unknown[];
  kaynakDurumlari: unknown[];
  toplamSonuc: number;
  gruplamaNotu: string;
  elleAramaAdresi?: string;
  dosyalar?: unknown[];
  kaynaklar?: unknown[];
  yuklenmeHatalari?: unknown[];
}

const BOS_CEVPAP: Cevap = { gruplar: [], kaynakDurumlari: [], toplamSonuc: 0, gruplamaNotu: "" };

let dom: JSDOM;
let cagrilanlar: { yol: string; govde: unknown }[] = [];
let fetchCevabi: (yol: string, govde: unknown) => unknown;

/** app.js'i bu DOM'da calistirir. */
async function arayuzuYukle(): Promise<void> {
  const html = await fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8");

  dom = new JSDOM(html, { url: "http://127.0.0.1:3000/", pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;

  cagrilanlar = [];
  fetchCevabi = (yol) => (yol === "/api/downloads" ? { dosyalar: [] } : BOS_CEVPAP);

  window.fetch = (async (yol: string, secenek?: { body?: string }) => {
    const govde = secenek?.body ? JSON.parse(secenek.body) : undefined;
    cagrilanlar.push({ yol, govde });

    const veri = fetchCevabi(yol, govde) as Record<string, unknown>;
    const kod = veri.hata ? 400 : 200;

    return { ok: kod < 400, status: kod, json: async () => veri };
  }) as unknown as typeof window.fetch;

  // jsdom'da globalThis.fetch ayri bir nesnedir; ikisini de bagliyoruz ki
  // app.js hangisini kullanirsa kullansin sahte cevabi gorsun.
  globalThis.fetch = window.fetch as unknown as typeof globalThis.fetch;

  // app.js dosyasini gercek kodundan calistiriyoruz (yeniden yazmiyoruz).
  // Dosyanin sonunda top-level await var; bu yuzden calistirma geri
  // dondurulen Promise'i bekliyoruz. Aksi halde testler birbirine
  // karisiyor ve eski DOM'daki kartlari okuyorlar.
  const js = await fs.readFile(path.join(process.cwd(), "public/app.js"), "utf8");

  try {
    dom.window.eval(`globalThis.__calisma = (async () => {\n${js}\n})();`);
    await (dom.window as unknown as { __calisma: Promise<void> }).__calisma;
  } catch (hata) {
    throw new Error(`app.js yüklenemedi: ${(hata as Error).message}`);
  }

  // Modul, globalThis.fetch uzerinden istek atiyor; jsdom'da fetch
  // global'e degil window'a baglanir.
  globalThis.fetch = window.fetch as unknown as typeof globalThis.fetch;
}

beforeEach(async () => {
  await arayuzuYukle();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("arayuz ilk yukleme", () => {
  it("tum kontrol elemanlarini bulur", () => {
    const d = dom.window.document;
    expect(d.querySelector("#baslik")).toBeTruthy();
    expect(d.querySelector("#yazar")).toBeTruthy();
    expect(d.querySelector("#yil")).toBeTruthy();
    expect(d.querySelector("#limit")).toBeTruthy();
    expect(d.querySelector("#araBtn")).toBeTruthy();
    expect(d.querySelector("#kartlar")).toBeTruthy();
    expect(d.querySelector("#kaynakDialog")).toBeTruthy();
  });

  it("genel web aramasi onay kutusuna erisebilir", () => {
    // Asil hatanin kaynagi: bu oge null donuyordu.
    const kutu = dom.window.document.querySelector<HTMLInputElement>("#webDahil");
    expect(kutu, "webDahil kutusu bulunamadı").toBeTruthy();
    expect(() => kutu!.checked).not.toThrow();
    expect(kutu!.checked).toBe(true);
  });

  it("indirilenler listesini bos gosterir", () => {
    const liste = dom.window.document.querySelector("#indirmeListesi");
    expect(liste?.textContent ?? "").toContain("Henüz");
  });
});

describe("arama gonderimi", () => {
  it("baslik girilince hata vermeden kaynaklari sorgular", async () => {
    const d = dom.window.document;
    fetchCevabi = (yol) =>
      yol === "/api/downloads"
        ? { dosyalar: [] }
        : {
            gruplar: [
              {
                anahtar: "a",
                tur: "kitap",
                baslik: "Sapiens",
                yazarlar: ["Yuval Noah Harari"],
                yil: 2011,
                konular: [],
                puan: 0.93,
                kaynaklar: [
                  {
                    kaynakAd: "Internet Archive",
                    link: "https://archive.org/details/x",
                    erisim: "acik",
                    pdf: "https://archive.org/x.pdf",
                  },
                ],
              },
            ],
            kaynakDurumlari: [
              { id: "ia", ad: "Internet Archive", tur: ["kitap"], sonucSayisi: 1, sureMs: 500, hazir: true },
            ],
            toplamSonuc: 1,
            gruplamaNotu: "not",
          };

    d.querySelector<HTMLInputElement>("#baslik")!.value = "Sapiens";
    d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );

    // Formun submit olayinin islenmesi icin macera ver.
    await new Promise((r) => dom.window.setTimeout(r, 60));

    const aramaCagrisi = cagrilanlar.find((c) => c.yol === "/api/search");
    expect(aramaCagrisi, "POST /api/search çağrılmadı").toBeTruthy();
    expect((aramaCagrisi!.govde as { baslik: string }).baslik).toBe("Sapiens");

    const hataMetni = dom.window.document.querySelector("#ozetPanel")?.textContent ?? "";
    expect(hataMetni).not.toContain("Cannot read properties of null");
    expect(hataMetni).not.toContain("Arama başarısız");
  });

  it("web aramasi acikken iki istek yollar", async () => {
    const d = dom.window.document;
    d.querySelector<HTMLInputElement>("#baslik")!.value = "Sapiens";
    d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => dom.window.setTimeout(r, 60));

    expect(cagrilanlar.some((c) => c.yol === "/api/search")).toBe(true);
    expect(cagrilanlar.some((c) => c.yol === "/api/web-search")).toBe(true);
  });

  it("web aramasi kapaliyken sadece kayitli kaynaklari sorgular", async () => {
    const d = dom.window.document;
    const kutu = d.querySelector<HTMLInputElement>("#webDahil")!;
    kutu.checked = false;

    d.querySelector<HTMLInputElement>("#baslik")!.value = "Sapiens";
    d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => dom.window.setTimeout(r, 60));

    expect(cagrilanlar.some((c) => c.yol === "/api/search")).toBe(true);
    expect(cagrilanlar.some((c) => c.yol === "/api/web-search")).toBe(false);
  });

  it("sonuclari kart olarak cizer", async () => {
    const d = dom.window.document;
    fetchCevabi = (yol) =>
      yol === "/api/downloads"
        ? { dosyalar: [] }
        : {
            gruplar: [
              {
                anahtar: "a",
                tur: "kitap",
                baslik: "Sapiens: A Brief History of Humankind",
                yazarlar: ["Yuval Noah Harari"],
                yil: 2011,
                konular: ["tarih"],
                puan: 0.93,
                kaynaklar: [
                  {
                    kaynakAd: "Open Library",
                    link: "https://openlibrary.org/x",
                    erisim: "acik",
                    pdf: "https://example.test/x.pdf",
                  },
                ],
              },
            ],
            kaynakDurumlari: [],
            toplamSonuc: 1,
            gruplamaNotu: "",
          };

    d.querySelector<HTMLInputElement>("#baslik")!.value = "Sapiens";
    d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => dom.window.setTimeout(r, 60));

    const kart = d.querySelector(".kart");
    expect(kart, "sonuç kartı çizilmedi").toBeTruthy();
    expect(kart!.textContent).toContain("Sapiens");
    expect(kart!.querySelector('[data-eylem="indir"]')).toBeTruthy();
  });
});

describe("sayfa sayisi", () => {
  const PDF = "https://example.test/sayfa-testi.pdf";
  const KAYNAK_PDF = { kaynakAd: "IA", link: "https://ia.test/x", erisim: "acik", pdf: PDF };
  const KAYNAK_PLAIN = { kaynakAd: "Crossref", link: "https://cr.test/x", erisim: "yonlendir" };

  /** Arama cevabini hazirlar. `kaynaklar` grubun ICINDEKI kaynaklardir. */
  function cevap(grupEk: Record<string, unknown> = {}, kaynaklar: unknown[] = [KAYNAK_PDF]) {
    return {
      gruplar: [
        {
          anahtar: "a",
          tur: "kitap",
          baslik: "Sapiens",
          yazarlar: ["Yuval Noah Harari"],
          yil: 2011,
          konular: [],
          puan: 0.93,
          kaynaklar,
          ...grupEk,
        },
      ],
      kaynakDurumlari: [],
      toplamSonuc: 1,
      gruplamaNotu: "",
    };
  }

  function stub(aramaCevabi: Record<string, unknown>, sayfaCevabi: Record<string, unknown> = {}) {
    fetchCevabi = (yol) => {
      if (yol === "/api/downloads") return { dosyalar: [] };
      if (yol === "/api/sayfa-sayisi") return { sonuclar: sayfaCevabi };
      if (yol === "/api/web-search") {
        // Genel web aramasini bos dondur; yoksa ayni kartlar iki kez eklenir.
        return { gruplar: [], kaynakDurumlari: [], toplamSonuc: 0, gruplamaNotu: "" };
      }
      return aramaCevabi;
    };
  }

  async function araVeBekle(): Promise<Element> {
    const d = dom.window.document;
    d.querySelector<HTMLInputElement>("#baslik")!.value = "Sapiens";
    d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => dom.window.setTimeout(r, 80));
    return d.querySelector(".kart")!;
  }

  it("kaynaktan gelen sayfa sayisini gosterir", async () => {
    stub(cevap({ sayfaSayisi: 412 }));
    const kart = await araVeBekle();

    const sayfa = kart.querySelector(".sayfa");
    expect(sayfa?.textContent, "sayfa etiketi cizilmedi").toContain("412");
    // Buton degil, salt etiket olmali (bilgi geldi, istek gerekmiyor).
    expect(sayfa?.tagName, "bilinen sayfada buton olmamali").toBe("SPAN");
  });

  it("kaynaktan metin olarak gelen sayfa bilgisini gosterir", async () => {
    stub(cevap({}, [{ ...KAYNAK_PLAIN, sayfa: "12: 30-58" }]));
    const kart = await araVeBekle();
    expect(kart.querySelector(".sayfa")?.textContent).toContain("12: 30-58");
  });

  it("sayfa bilinmiyorsa 'Sayfa: ?' dugmesi gosterir", async () => {
    stub(cevap());
    const kart = await araVeBekle();

    const dugme = kart.querySelector('button[data-eylem="sayfa"]');
    expect(dugme, "sayfa düğmesi yok").toBeTruthy();
    expect(dugme!.textContent).toContain("Sayfa: ?");
    expect(dugme!.getAttribute("data-url")).toBe(PDF);
  });

  it("PDF yoksa sayfa kismi cizilmez", async () => {
    stub(cevap({}, [KAYNAK_PLAIN]));
    const kart = await araVeBekle();
    expect(kart.querySelector(".sayfa"), "PDF yokken sayfa cizilmemeli").toBeNull();
  });

  it("sayfa bilgisi olan kart sunucuya istek atmaz", async () => {
    stub(cevap({ sayfaSayisi: 300 }));
    await araVeBekle();
    await new Promise((r) => dom.window.setTimeout(r, 40));

    expect(cagrilanlar.some((c) => c.yol === "/api/sayfa-sayisi")).toBe(false);
  });

  it("ilk kartlarin sayfasi arka planda otomatik gelir", async () => {
    stub(cevap(), { [PDF]: { sayfaSayisi: 15 } });
    await araVeBekle();
    // Arka plan istegi bitmeli.
    await new Promise((r) => dom.window.setTimeout(r, 60));

    const etiket = dom.window.document.querySelector(".kart .sayfa");
    expect(etiket?.textContent, "otomatik sayfa gelmedi").toContain("15");
    expect(cagrilanlar.some((c) => c.yol === "/api/sayfa-sayisi")).toBe(true);
  });

  /*
   * Otomatik yukleme yalnizca ilk 3 kart icin calisir. Burada kart
   * 4. sira oldugu icin dugme duruyor ve kullanici tiklayinca ogreniliyor.
   */
  describe("elle sayfa sayisi isteme", () => {
    /*
     * Otomatik yukleme yalnizca ilk 3 kart icin calisir. Burada 5 kart
     * var ve hicbiri icin sayfa bilinmiyor; kullanici 4. kartin dugmesine
     * tikladiginda sunucu yanit verir.
     */
    async function cokluKartKur(): Promise<NodeListOf<Element>> {
      const gruplar = Array.from({ length: 5 }, (_, i) => ({
        anahtar: `k${i}`,
        tur: "makale",
        baslik: `Belge ${i}`,
        yazarlar: ["Yazar"],
        yil: 2020,
        konular: [],
        puan: 0.9,
        kaynaklar: [
          { kaynakAd: "IA", link: `https://ia.test/${i}`, erisim: "acik", pdf: `${PDF}?n=${i}` },
        ],
      }));

      // Once hicbir kartin sayfasi bilinmiyor.
      fetchCevabi = (yol) => {
        if (yol === "/api/downloads") return { dosyalar: [] };
        if (yol === "/api/sayfa-sayisi") return { sonuclar: {} };
        if (yol === "/api/web-search") {
          return { gruplar: [], kaynakDurumlari: [], toplamSonuc: 0, gruplamaNotu: "" };
        }
        return { gruplar, kaynakDurumlari: [], toplamSonuc: 5, gruplamaNotu: "" };
      };

      const d = dom.window.document;
      d.querySelector<HTMLInputElement>("#baslik")!.value = "Sapiens";
      d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      );
      await new Promise((r) => dom.window.setTimeout(r, 80));
      return d.querySelectorAll(".kart");
    }

    /** Tiklamadan sonra sunucu cevap vermeye baslar. */
    function sayfaCevabiVer(sonuc: Record<string, unknown>): void {
      const onceki = fetchCevabi;
      fetchCevabi = (yol, govde) => {
        if (yol === "/api/sayfa-sayisi") return { sonuclar: sonuc };
        return onceki(yol, govde);
      };
    }

    it("dortuncu kartin dugmesi durur ve tiklayinca sayfa yazar", async () => {
      const kartlar = await cokluKartKur();
      expect(kartlar.length, "5 kart çizilmeli").toBe(5);

      const dugme = kartlar[3]!.querySelector<HTMLButtonElement>('button[data-eylem="sayfa"]');
      expect(dugme, "4. kartta sayfa düğmesi olmalı").toBeTruthy();
      expect(dugme!.textContent).toContain("Sayfa: ?");

      sayfaCevabiVer({ [`${PDF}?n=3`]: { sayfaSayisi: 42 } });
      dugme!.click();
      await new Promise((r) => dom.window.setTimeout(r, 60));

      const etiket = dom.window.document.querySelectorAll(".kart")[3]!.querySelector(".sayfa");
      expect(etiket?.textContent, "sayfa yazılmadı").toContain("42");
      expect(etiket?.tagName).toBe("SPAN");
    });

    it("sayfa alinamazsa 'Sayfa: ?' olarak kalir ve hata vermez", async () => {
      const kartlar = await cokluKartKur();
      const dugme = kartlar[3]!.querySelector<HTMLButtonElement>('button[data-eylem="sayfa"]');
      expect(dugme).toBeTruthy();

      sayfaCevabiVer({ [`${PDF}?n=3`]: { not: "PDF değil" } });
      dugme!.click();
      await new Promise((r) => dom.window.setTimeout(r, 60));

      const etiket = dom.window.document.querySelectorAll(".kart")[3]!.querySelector(".sayfa");
      expect(etiket?.textContent).toContain("Sayfa: ?");
      expect(etiket?.textContent).not.toContain("undefined");
      expect(etiket?.getAttribute("title")).toContain("PDF değil");
    });
  });
});