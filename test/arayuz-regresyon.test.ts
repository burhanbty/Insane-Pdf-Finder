import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { grupla } from "../src/search.js";

const BOS = { gruplar: [], kaynakDurumlari: [], toplamSonuc: 0, gruplamaNotu: "" };
const kart = (id: string, source = "a", extra: Record<string, unknown> = {}) => ({
  anahtar: id,
  tur: "kitap",
  baslik: id,
  yazarlar: ["Writer"],
  konular: [],
  puan: 0.95,
  kaynaklar: [
    { kaynak: source, kaynakAd: source.toUpperCase(), link: `https://example.test/${id}` },
  ],
  ...extra,
});
const cevap = (gruplar: unknown[]) => ({ ...BOS, gruplar });
function ertelenmis<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}
let dom: JSDOM;
let d: Document;
const cagrilar: { url: string; body: unknown }[] = [];
async function kur(handler: (url: string, body: unknown) => unknown) {
  cagrilar.length = 0;
  dom = new JSDOM(await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"), {
    url: "http://127.0.0.1:3000",
    runScripts: "outside-only",
  });
  d = dom.window.document;
  dom.window.fetch = (async (url: string, options?: { body?: string }) => {
    const body = options?.body ? JSON.parse(options.body) : undefined;
    cagrilar.push({ url, body });
    const data =
      url === "/api/download-jobs" && !body
        ? { isler: [] }
        : url === "/api/downloads"
          ? { dosyalar: [] }
          : url === "/api/sources"
            ? { kaynaklar: [] }
            : url === "/api/sayfa-sayisi"
              ? { sonuclar: {} }
              : ((await handler(url, body)) as Record<string, unknown>);
    return { ok: !data.hata, json: async () => data };
  }) as unknown as typeof dom.window.fetch;
  dom.window.eval(
    await fs.readFile(new URL("../public/download-manager.js", import.meta.url), "utf8"),
  );
  const js = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
  dom.window.eval(`globalThis.__regresyon = (async () => {\n${js}\n})();`);
  await (dom.window as unknown as { __regresyon: Promise<void> }).__regresyon;
}
function gonder(baslik = "Test") {
  d.querySelector<HTMLInputElement>("#baslik")!.value = baslik;
  d.querySelector("#aramaForm")!.dispatchEvent(
    new dom.window.Event("submit", { cancelable: true }),
  );
}
function degistir(id: string, value: string | boolean) {
  const el = d.querySelector<HTMLInputElement | HTMLSelectElement>(id)!;
  if (typeof value === "boolean") (el as HTMLInputElement).checked = value;
  else el.value = value;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
const ids = () => [...d.querySelectorAll<HTMLElement>(".kart")].map((k) => k.dataset.anahtar);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => dom?.window.close());

it("tek kaynağın alternatif PDF'leri indirme kuyruğuna gider ve kitap bölümü etiketi görünür", async () => {
  await kur((url) =>
    url === "/api/download-jobs"
      ? { is: { id: "alternatives", durum: "sirada", baslik: "Book", alinan: 0 } }
      : cevap([
          kart("Book", "doab", {
            kaynaklar: [
              {
                kaynak: "doab",
                kaynakAd: "DOAB",
                link: "https://publisher.org/book",
                pdf: "https://publisher.org/main.pdf",
                belgeTuru: "kitap-bolumu",
                pdfAdaylari: [
                  { url: "https://publisher.org/main.pdf" },
                  { url: "https://repo.org/alternative.pdf" },
                  { url: "javascript:alert(1)" },
                ],
              },
            ],
          }),
        ]),
  );
  degistir("#webDahil", false);
  gonder();
  await vi.waitFor(() => expect(ids()).toEqual(["Book"]));
  expect(d.querySelector(".kaynak-rozet")?.textContent).toContain("Kitap bölümü");
  (d.querySelector('[data-eylem="indir"]') as HTMLElement).click();
  await vi.waitFor(() =>
    expect(cagrilar.some((c) => c.url === "/api/download-jobs" && c.body)).toBe(true),
  );
  const body = cagrilar.find((c) => c.url === "/api/download-jobs" && c.body)?.body as {
    alternatifler: string[];
  };
  expect(body.alternatifler).toContain("https://repo.org/alternative.pdf");
  expect(body.alternatifler).not.toContain("https://publisher.org/main.pdf");
  expect(body.alternatifler.some((s) => s.startsWith("javascript:"))).toBe(false);
});

describe("arama araçları", () => {
  it("baskı tercihini gönderir, kıyaslamayı ve yazım önerisini güvenli biçimde gösterir", async () => {
    const s = {
      baslik: "Calcullus",
      isbn: "9780131103627",
      dil: "tr",
      tur: "kitap" as const,
      limit: 20,
    };
    const gruplar = grupla(
      [
        {
          baslik: "Calculus",
          tur: "kitap",
          yazarlar: [],
          kaynak: "catalog",
          kaynakAd: "Catalog",
          link: "https://example.com/book",
          isbn: "9780306406157",
          dil: "eng",
        },
      ],
      s,
    );
    await kur(() => cevap(gruplar));
    degistir("#webDahil", false);
    degistir("#hedefIsbn", s.isbn);
    degistir("#hedefDil", "tr");
    gonder(s.baslik);
    await vi.waitFor(() => expect(ids()).toHaveLength(1));
    expect(cagrilar.find((c) => c.url === "/api/search")?.body).toMatchObject({
      isbn: s.isbn,
      dil: "tr",
    });
    expect(d.querySelector("#aramaOnerileri button")?.textContent).toBe("Calculus");
    expect(d.querySelector(".baski-karsilastirma")?.textContent).toContain("9780306406157");
    expect(d.querySelector(".kunye-farkli")?.textContent).toBe("Farklı");
    expect(d.querySelector(".etiket.eslesme-tam")).toBeNull();
    (d.querySelector("#aramaOnerileri button") as HTMLElement).click();
    await vi.waitFor(() => expect(cagrilar.filter((c) => c.url === "/api/search")).toHaveLength(2));
    expect(
      (cagrilar.filter((c) => c.url === "/api/search")[1]!.body as { baslik: string }).baslik,
    ).toBe("Calculus");
  });
  it("tam eşleşme filtresinde yüksek puanlı farklı baskıyı göstermez", async () => {
    await kur(() =>
      cevap([
        kart("Exact", "a", { eslesme: { tur: "tam", aciklama: "Başlık eşleşiyor" } }),
        kart("Other edition", "a", { puan: 1, eslesme: { tur: "yakin", aciklama: "Farklı ISBN" } }),
      ]),
    );
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toHaveLength(2));
    (d.querySelector('[data-suzgec="uyum"]') as HTMLElement).click();
    expect(
      [...d.querySelectorAll<HTMLElement>(".kart:not(.gizli)")].map((k) => k.dataset.anahtar),
    ).toEqual(["Exact"]);
  });
  it("bütün kaynaklar başarısızsa kesin bir 'sonuç yok' mesajı vermez", async () => {
    await kur(() => ({
      ...BOS,
      kaynakDurumlari: [
        { id: "a", ad: "A", hazir: true, hataMesaji: "HTTP 429", sonucSayisi: 0, sureMs: 0 },
      ],
    }));
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() =>
      expect(d.querySelector("#bos")?.textContent).toContain("kaynaklara ulaşılamadı"),
    );
    expect(d.querySelector("#bos")?.textContent).not.toContain("Sonuç bulunamadı");
  });
  it("tek tıkla sunucu kaydını tarayıcı indirmesine aktarır ve ikinci PDF adayını gönderir", async () => {
    const g = kart("Book", "a", {
      kaynaklar: [
        {
          kaynak: "a",
          kaynakAd: "A",
          link: "https://a.test/record",
          pdf: "https://a.test/broken.pdf",
        },
        {
          kaynak: "b",
          kaynakAd: "B",
          link: "https://b.test/record",
          pdf: "https://b.test/full.pdf",
        },
      ],
    });
    await kur((url) =>
      url === "/api/download-jobs"
        ? { is: { id: "job", baslik: "Book", durum: "tamamlandi", dosya: "book.pdf", alinan: 42 } }
        : cevap([g]),
    );
    const downloads: string[] = [];
    dom.window.HTMLAnchorElement.prototype.click = function () {
      downloads.push(this.getAttribute("href")!);
    };
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(["Book"]));
    (d.querySelector('[data-eylem="indir"]') as HTMLElement).click();
    await vi.waitFor(() => expect(downloads).toContain("/api/downloads/book.pdf"));
    expect(cagrilar.find((c) => c.url === "/api/download-jobs" && c.body)?.body).toMatchObject({
      alternatifler: expect.arrayContaining(["https://b.test/full.pdf"]),
    });
    expect(d.querySelector(".indirme-icerik a")?.getAttribute("download")).toBe("book.pdf");
  });
  it("katalog kaydında pasif PDF yerine bağlantı arama eylemi sunar; hatayı görünür tutar", async () => {
    await kur((url) =>
      url === "/api/download-jobs"
        ? { hata: "Doğrudan PDF bağlantısı bulunamadı" }
        : cevap([kart("Catalog")]),
    );
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(["Catalog"]));
    const button = d.querySelector<HTMLButtonElement>('[data-eylem="indir"]')!;
    expect(button.textContent).toBe("PDF bağlantısını bul");
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() =>
      expect(d.querySelector(".indirme-icerik")?.textContent).toContain(
        "Doğrudan PDF bağlantısı bulunamadı",
      ),
    );
    expect(button.disabled).toBe(false);
  });
  it("kapalı arama seçeneklerindeki geçersiz alanı düzeltmek için görünür yapar", async () => {
    await kur(() => BOS);
    d.querySelector<HTMLInputElement>("#baslik")!.value = "Algorithms";
    d.querySelector<HTMLInputElement>("#yil")!.value = "999";
    const secenekler = d.querySelector<HTMLDetailsElement>(".arama-secenekleri")!;
    expect(secenekler.open).toBe(false);
    expect(d.querySelector<HTMLFormElement>("#aramaForm")!.reportValidity()).toBe(false);
    expect(secenekler.open).toBe(true);
    expect(cagrilar.some((c) => c.url === "/api/search")).toBe(false);
  });

  it("bilinmeyen yılları sona alır ve başlığa göre sıralar", async () => {
    await kur(() =>
      cevap([kart("Z", "a", { yil: 2000 }), kart("B"), kart("A", "a", { yil: 2024 })]),
    );
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(["Z", "B", "A"]));
    degistir("#siralama", "yeni");
    expect(ids()).toEqual(["A", "Z", "B"]);
    degistir("#siralama", "eski");
    expect(ids()).toEqual(["Z", "A", "B"]);
    degistir("#siralama", "baslik");
    expect(ids()).toEqual(["A", "B", "Z"]);
  });
  it("EPUB ve metin gerçek biçimleriyle indirilir; güvenli olmayan link tıklanamaz", async () => {
    await kur((url) =>
      url === "/api/download-jobs"
        ? { is: { id: "job", baslik: "Book", durum: "tamamlandi", dosya: "book.epub", alinan: 42 } }
        : cevap([
            kart("Book", "a", {
              kaynaklar: [
                {
                  kaynak: "a",
                  kaynakAd: "A",
                  link: "javascript:alert(1)",
                  epub: "https://example.test/book.epub",
                  tamMetin: "https://example.test/book.txt",
                },
              ],
            }),
          ]),
    );
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(["Book"]));
    expect(d.querySelector(".kaynak-rozet a")).toBeNull();
    expect(d.querySelector('[data-tur="pdf"][data-eylem="indir"]')).toBeNull();
    expect(d.querySelector('[data-tur="metin"][data-eylem="indir"]')).not.toBeNull();
    (d.querySelector('[data-tur="epub"][data-eylem="indir"]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(cagrilar.find((c) => c.url === "/api/download-jobs" && c.body)?.body).toEqual({
        url: "https://example.test/book.epub",
        tur: "epub",
        baslik: "Book",
      }),
    );
  });
  it("panoya erişilemiyorsa künye seçilebilir metin olarak gösterilir", async () => {
    await kur(() => cevap([kart("Book", "a", { yil: 2020 })]));
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(["Book"]));
    (d.querySelector('[data-eylem="kunye"]') as HTMLElement).click();
    await flush();
    expect(d.querySelector(".ozet-icerik")?.textContent).toContain(
      "Writer. (2020). Book. https://example.test/Book",
    );
  });
  it("RIS aktarımı yalnızca filtredeki sonuçları içerir ve satır enjeksiyonunu engeller", async () => {
    await kur(() =>
      cevap([kart("Visible\nER  - injected", "a", { yil: 2024 }), kart("Hidden", "b")]),
    );
    let blob: Blob | undefined;
    Object.assign(dom.window.URL, {
      createObjectURL: (b: Blob) => {
        blob = b;
        return "blob:test";
      },
      revokeObjectURL: () => {},
    });
    vi.spyOn(dom.window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toHaveLength(2));
    degistir("#kaynakSecim", "a");
    (d.querySelector("#risAktar") as HTMLElement).click();
    const reader = new dom.window.FileReader();
    const text = await new Promise<string>((resolve) => {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob!);
    });
    expect(text).toContain("TY  - BOOK");
    expect(text).toContain("PY  - 2024");
    expect(text).toContain("TI  - Visible ER  - injected");
    expect(text).not.toContain("Hidden");
    expect(text.match(/^ER {2}-\r?$/gm)).toHaveLength(1);
  });
});

describe("özet eylemi", () => {
  it("yalnızca açıklaması bulunan kayıtta boş URL'li özet düğmesi sunmaz", async () => {
    await kur(() =>
      cevap([
        kart("abstract", "a", {
          ozet: "Available abstract",
          kaynaklar: [
            {
              kaynak: "a",
              kaynakAd: "A",
              link: "https://example.test",
              ozet: "Available abstract",
            },
          ],
        }),
      ]),
    );
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(["abstract"]));
    expect(d.querySelector('[data-eylem="ozet"]')).toBeNull();
    expect(d.querySelector(".aciklama")?.textContent).toBe("Available abstract");
    expect(cagrilar.some((c) => c.url === "/api/summary")).toBe(false);
  });

  it("tam metin varsa özet API'sine o metnin gerçek URL'sini gönderir", async () => {
    await kur((url) =>
      url === "/api/summary"
        ? { ozet: "Summary", yontem: "extractive", karakterSayisi: 100 }
        : cevap([
            kart("text", "a", {
              kaynaklar: [
                { kaynak: "a", kaynakAd: "A", link: "https://example.test", ozet: "Abstract" },
                {
                  kaynak: "b",
                  kaynakAd: "B",
                  link: "https://example.test/b",
                  tamMetin: "https://example.test/body.txt",
                },
              ],
            }),
          ]),
    );
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(["text"]));
    (d.querySelector('[data-eylem="ozet"]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(d.querySelector(".ozet-icerik")?.textContent).toContain("Summary"),
    );
    expect(cagrilar.find((c) => c.url === "/api/summary")?.body).toEqual({
      url: "https://example.test/body.txt",
      tur: "metin",
      baslik: "text",
    });
  });
});

describe("karışık kaynak sırası", () => {
  const baslangic = ["a1", "b1", "a2", "b2"];
  async function sonuclariKur() {
    await kur(() => cevap(baslangic.map((id) => kart(id, id[0]))));
    degistir("#webDahil", false);
    gonder();
    await vi.waitFor(() => expect(ids()).toEqual(baslangic));
  }
  it("A/B/A/B sırasını iki kaynak başlığı altında toplar", async () => {
    await sonuclariKur();
    degistir("#grupla", true);
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(2);
    expect(ids()).toEqual(["a1", "a2", "b1", "b2"]);
    expect([...d.querySelectorAll(".grup-sayi")].map((n) => n.textContent)).toEqual([
      "2 sonuç",
      "2 sonuç",
    ]);
  });
  it("gruplama kapatılınca özgün puan sırasına döner", async () => {
    await sonuclariKur();
    degistir("#grupla", true);
    degistir("#grupla", false);
    expect(ids()).toEqual(baslangic);
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(0);
  });
  it("süzgeç kaldırılınca aynı kaynak için tekrarlanan başlık üretmez", async () => {
    await sonuclariKur();
    degistir("#grupla", true);
    degistir("#kaynakSecim", "a");
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(1);
    degistir("#kaynakSecim", "");
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(2);
    expect(ids()).toEqual(["a1", "a2", "b1", "b2"]);
  });
});

describe("bağımsız arama cevapları", () => {
  it("ana sonuçlar hazırken web'i beklemez ve sonra web sonucunu ekler", async () => {
    const web = ertelenmis<unknown>();
    await kur((url) => (url === "/api/web-search" ? web.promise : cevap([kart("main")])));
    gonder();
    try {
      await vi.waitFor(() => expect(ids()).toEqual(["main"]));
      expect(d.querySelector<HTMLButtonElement>("#araBtn")!.disabled).toBe(false);
      expect(d.querySelector("#ozetPanel")!.textContent).toContain("Web araması sürüyor");
    } finally {
      web.resolve(cevap([kart("web", "b")]));
    }
    await vi.waitFor(() => expect(ids()).toEqual(["main", "web"]));
  });

  it("web önce gelirse onu gösterir, ana sonuç geldiğinde ana sırayı korur", async () => {
    const main = ertelenmis<unknown>();
    await kur((url) => (url === "/api/search" ? main.promise : cevap([kart("web", "b")])));
    gonder();
    try {
      await vi.waitFor(() => expect(ids()).toEqual(["web"]));
      expect(d.querySelector<HTMLButtonElement>("#araBtn")!.disabled).toBe(false);
      expect(d.querySelector<HTMLButtonElement>("#aramaIptal")!.hidden).toBe(false);
    } finally {
      main.resolve(cevap([kart("main")]));
    }
    await vi.waitFor(() => expect(ids()).toEqual(["main", "web"]));
  });

  it("ana hata web başarısını gizlemez", async () => {
    const web = ertelenmis<unknown>();
    await kur((url) => (url === "/api/web-search" ? web.promise : { hata: "main failed" }));
    gonder();
    try {
      await vi.waitFor(() =>
        expect(d.querySelector("#ozetPanel")!.textContent).toContain("main failed"),
      );
    } finally {
      web.resolve(cevap([kart("web", "b")]));
    }
    await vi.waitFor(() => expect(ids()).toEqual(["web"]));
    expect(d.querySelector("#ozetPanel")!.textContent).toContain("main failed");
  });

  it("web hatası ana başarılı sonucu kaldırmaz", async () => {
    const web = ertelenmis<unknown>();
    await kur((url) => (url === "/api/web-search" ? web.promise : cevap([kart("main")])));
    gonder();
    web.reject(new Error("web failed"));
    await vi.waitFor(() => expect(ids()).toEqual(["main"]));
    expect(d.querySelector("#ozetPanel")!.textContent).toContain("web failed");
  });

  it("önceki aramanın geç gelen web yanıtı yeni aramayı ezmez", async () => {
    const oldWeb = ertelenmis<unknown>();
    await kur((url, body) => {
      const q = body as { baslik: string };
      if (url === "/api/web-search") return q.baslik === "old" ? oldWeb.promise : BOS;
      return cevap([kart(q.baslik)]);
    });
    gonder("old");
    try {
      await vi.waitFor(() => expect(ids()).toEqual(["old"]));
      gonder("new");
      await vi.waitFor(() => expect(ids()).toEqual(["new"]));
    } finally {
      oldWeb.resolve(cevap([kart("old-web", "b")]));
    }
    await flush();
    expect(ids()).toEqual(["new"]);
  });

  it("sonradan gelen web cevabı açık özeti ve kaynak süzgecini korur", async () => {
    const web = ertelenmis<unknown>();
    await kur((url) =>
      url === "/api/web-search"
        ? web.promise
        : url === "/api/summary"
          ? { ozet: "Kept summary", yontem: "extractive", karakterSayisi: 100 }
          : cevap([
              kart("main", "a", {
                kaynaklar: [
                  {
                    kaynak: "a",
                    kaynakAd: "A",
                    link: "https://example.test",
                    tamMetin: "https://example.test/body.txt",
                  },
                ],
              }),
            ]),
    );
    gonder();
    try {
      await vi.waitFor(() => expect(ids()).toEqual(["main"]));
      const before = d.querySelector(".kart");
      (d.querySelector('[data-eylem="ozet"]') as HTMLElement).click();
      await vi.waitFor(() =>
        expect(d.querySelector(".ozet-icerik")!.textContent).toContain("Kept summary"),
      );
      degistir("#kaynakSecim", "a");
      web.resolve(cevap([kart("web", "b")]));
      await vi.waitFor(() => expect(ids()).toEqual(["main", "web"]));
      expect(d.querySelector(".kart")).toBe(before);
      expect(d.querySelector(".ozet-icerik")!.textContent).toContain("Kept summary");
      expect(d.querySelector<HTMLSelectElement>("#kaynakSecim")!.value).toBe("a");
      expect(d.querySelectorAll(".kart:not(.gizli)")).toHaveLength(1);
    } finally {
      web.resolve(BOS);
    }
  });
});
