/*
 * Kaynak bazli ozellikler: süzgec, gruplama, istatistik.
 *
 * jsdom ile gercek DOM kurulur, form gonderilir, fetch sahte cevaplarla
 * degistirilir. Kartlarin kaynak kimlikleri ve gruplama davranisi denetlenir.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";

let dom: JSDOM;
let fetchCevabi: (yol: string, govde: unknown) => unknown;

const BOS = { gruplar: [], kaynakDurumlari: [], toplamSonuc: 0, gruplamaNotu: "" };

/** Ayni eser iki kaynakta bulunuyor, digerleri tek kaynakta. */
const CEVAP = {
  gruplar: [
    {
      anahtar: "coklu",
      tur: "makale",
      baslik: "Attention Is All You Need",
      yazarlar: ["Vaswani"],
      yil: 2017,
      konular: [],
      puan: 0.93,
      sayfaSayisi: 15,
      kaynaklar: [
        { kaynak: "arxiv", kaynakAd: "arXiv", link: "https://arxiv.org/x", erisim: "acik", pdf: "https://arxiv.org/x.pdf" },
        { kaynak: "crossref", kaynakAd: "Crossref", link: "https://cr.org/x", erisim: "yonlendir" },
      ],
    },
    {
      anahtar: "tek-arxiv",
      tur: "makale",
      baslik: "Deep Learning",
      yazarlar: ["Bengio"],
      yil: 2015,
      konular: [],
      puan: 0.8,
      kaynaklar: [
        { kaynak: "arxiv", kaynakAd: "arXiv", link: "https://arxiv.org/y", erisim: "acik" },
      ],
    },
    {
      anahtar: "tek-zenodo",
      tur: "makale",
      baslik: "Bir Veri Seti",
      yazarlar: ["Smith"],
      yil: 2020,
      konular: [],
      // Dusuk puan: "Tam eslesme" filtresinden elenir. Boylece kaynak
      // süzgeci ile ust sekmelerin birlikte calistigini dogrulayabiliyoruz.
      puan: 0.45,
      kaynaklar: [
        { kaynak: "zenodo", kaynakAd: "Zenodo", link: "https://zenodo.org/x", erisim: "acik" },
      ],
    },
  ],
  kaynakDurumlari: [],
  toplamSonuc: 3,
  gruplamaNotu: "",
};

async function arayuzuYukle(): Promise<void> {
  const html = await fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8");
  const js = await fs.readFile(path.join(process.cwd(), "public/app.js"), "utf8");

  dom = new JSDOM(html, {
    url: "http://127.0.0.1:3000/",
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;

  fetchCevabi = (yol) => (yol === "/api/downloads" ? { dosyalar: [] } : BOS);

  window.fetch = (async (yol: string, secenek?: { body?: string }) => {
    const govde = secenek?.body ? JSON.parse(secenek.body) : undefined;
    const veri = fetchCevabi(yol, govde) as Record<string, unknown>;
    const kod = veri.hata ? 400 : 200;
    return { ok: kod < 400, status: kod, json: async () => veri };
  }) as unknown as typeof window.fetch;

  globalThis.fetch = window.fetch as unknown as typeof globalThis.fetch;

  try {
    window.eval(`globalThis.__calisma = (async () => {\n${js}\n})();`);
    await (window as unknown as { __calisma: Promise<void> }).__calisma;
  } catch (hata) {
    throw new Error(`app.js yüklenemedi: ${(hata as Error).message}`);
  }
}

beforeEach(async () => {
  await arayuzuYukle();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function araVeBekle(): Promise<Document> {
  fetchCevabi = (yol) => {
    if (yol === "/api/downloads") return { dosyalar: [] };
    if (yol === "/api/sayfa-sayisi") return { sonuclar: {} };
    if (yol === "/api/web-search") return BOS;
    return CEVAP;
  };

  const d = dom.window.document;
  d.querySelector<HTMLInputElement>("#baslik")!.value = "Attention";
  d.querySelector<HTMLFormElement>("#aramaForm")!.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await new Promise((r) => dom.window.setTimeout(r, 90));
  return d;
}

function gorunurler(d: Document): HTMLElement[] {
  return [...d.querySelectorAll<HTMLElement>(".kart")].filter(
    (k) => !k.classList.contains("gizli"),
  );
}

describe("kaynak süzgeci", () => {
  it("kaynak seçim kutusunu sonuçlardaki kaynaklarla doldurur", async () => {
    const d = await araVeBekle();
    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;
    const degerler = [...secim.options].map((o) => o.value);

    expect(degerler[0], "ilk seçenek tüm kaynaklar olmalı").toBe("");
    expect(degerler).toContain("arxiv");
    expect(degerler).toContain("crossref");
    expect(degerler).toContain("zenodo");
  });

  it("seçenek etiketinde kaynak adı ve sonuç sayısı yazar", async () => {
    const d = await araVeBekle();
    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;

    const arxiv = [...secim.options].find((o) => o.value === "arxiv")!;
    expect(arxiv.textContent).toContain("arXiv");
    expect(arxiv.textContent).toContain("2"); // iki kart arXiv'de

    const zenodo = [...secim.options].find((o) => o.value === "zenodo")!;
    expect(zenodo.textContent).toContain("1");
  });

  it("seçilen kaynağın sonuçlarını gösterir", async () => {
    const d = await araVeBekle();

    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;
    secim.value = "zenodo";
    secim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(gorunurler(d)).toHaveLength(1);
    expect(gorunurler(d)[0]!.dataset.anahtar).toBe("tek-zenodo");
  });

  it("çoklu kaynakta bulunan eser her iki kaynakta da görünür", async () => {
    const d = await araVeBekle();
    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;

    secim.value = "crossref";
    secim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    // Crossref yalnızca "coklu" kartında bulunuyor.
    expect(gorunurler(d)).toHaveLength(1);
    expect(gorunurler(d)[0]!.dataset.anahtar).toBe("coklu");
  });

  it("tüm kaynaklar seçilince tüm sonuçlar görünür", async () => {
    const d = await araVeBekle();
    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;

    secim.value = "zenodo";
    secim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(gorunurler(d)).toHaveLength(1);

    secim.value = "";
    secim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(gorunurler(d)).toHaveLength(3);
  });

  it("süzgeçte sonuç kalmayınca bilgi gösterir", async () => {
    const d = await araVeBekle();
    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;

    secim.value = "zenodo";
    // "Tam eşleşme" sekmesi + zenodo: puan 0.7 olduğu için elenir
    const sekme = [...d.querySelectorAll<HTMLElement>(".sekme")].find(
      (s) => s.dataset.suzgec === "uyum",
    )!;
    sekme.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

    expect(gorunurler(d)).toHaveLength(0);
    expect(d.querySelector("#bos")!.classList.contains("gizli")).toBe(false);
  });
});

describe("kart üzerindeki kaynak bilgisi", () => {
  it("kartın veri özniteliklerine kaynak kimlikleri yazılır", async () => {
    const d = await araVeBekle();
    const coklu = d.querySelector<HTMLElement>('[data-anahtar="coklu"]')!;

    expect(coklu.dataset.kaynaklar).toBe("arxiv,crossref");
    expect(coklu.dataset.kaynakSayisi).toBe("2");
    expect(coklu.dataset.anaKaynak).toBe("arxiv");
  });

  it("çok kaynakta bulunan eserde uyarı notu görünür", async () => {
    const d = await araVeBekle();
    const not = d
      .querySelector('[data-anahtar="coklu"]')!
      .querySelector(".kaynak-notu");

    expect(not?.textContent).toContain("2 kaynakta");
  });

  it("tek kaynakta bulunan eserde not çizilmez", async () => {
    const d = await araVeBekle();
    const tek = d.querySelector('[data-anahtar="tek-zenodo"]')!;
    expect(tek.querySelector(".kaynak-notu")).toBeNull();
  });

  it("her kaynak rozetinin kimliği taşınır", async () => {
    const d = await araVeBekle();
    const rozetler = [
      ...d.querySelectorAll('[data-anahtar="coklu"] .kaynak-rozet'),
    ] as HTMLElement[];

    expect(rozetler.map((r) => r.dataset.kaynak)).toEqual(["arxiv", "crossref"]);
  });
});

describe("gruplama", () => {
  async function gruplaAc(d: Document): Promise<void> {
    const kutu = d.querySelector<HTMLInputElement>("#grupla")!;
    kutu.checked = true;
    kutu.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  }

  it("kapalıyken başlık çizilmez", async () => {
    const d = await araVeBekle();
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(0);
  });

  it("açıkken her kaynak için başlık ekler", async () => {
    const d = await araVeBekle();
    await gruplaAc(d);

    // arXiv (2 kart) ve Zenodo (1 kart) -> 2 başlık
    const basliklar = [...d.querySelectorAll(".grup-basligi")];
    expect(basliklar).toHaveLength(2);
    expect(basliklar[0]!.querySelector(".grup-ad")?.textContent).toContain("arXiv");
    expect(basliklar[0]!.querySelector(".grup-sayi")?.textContent).toContain("2 sonuç");
    expect(basliklar[1]!.querySelector(".grup-ad")?.textContent).toContain("Zenodo");
  });

  it("başlık sayısı kart sayısına eşit değildir", async () => {
    // Regresyon: her kart için ayrı başlık ekleniyordu.
    const d = await araVeBekle();
    await gruplaAc(d);

    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(2);
    expect(d.querySelectorAll(".kart")).toHaveLength(3);
  });

  it("aynı kaynağın kartları başlık altında toplanır", async () => {
    const d = await araVeBekle();
    await gruplaAc(d);

    const cocuklar = [...d.querySelector("#kartlar")!.children];
    const ilkBaslik = cocuklar.findIndex((c) => c.classList.contains("grup-basligi"))!;
    const digerBaslik = cocuklar.findIndex(
      (c, i) => i > ilkBaslik && c.classList.contains("grup-basligi"),
    );

    // İlk başlıktan sonraki ikinci başlığa kadar tüm kartlar arXiv olmalı.
    for (let i = ilkBaslik + 1; i < digerBaslik; i++) {
      expect(
        cocuklar[i]!.getAttribute("data-ana-kaynak"),
        "gruplama sırası bozuk",
      ).toBe("arxiv");
    }
  });

  it("kapatılınca başlıklar temizlenir", async () => {
    const d = await araVeBekle();
    await gruplaAc(d);
    expect(d.querySelectorAll(".grup-basligi").length).toBeGreaterThan(0);

    const kutu = d.querySelector<HTMLInputElement>("#grupla")!;
    kutu.checked = false;
    kutu.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(0);
  });

  it("başlığa tıklamak o kaynağa göre süzer", async () => {
    const d = await araVeBekle();
    await gruplaAc(d);

    const zenodoBasligi = [...d.querySelectorAll(".grup-basligi")].find((b) =>
      b.querySelector(".grup-ad")?.textContent?.includes("Zenodo"),
    )!;
    zenodoBasligi.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

    expect(d.querySelector<HTMLSelectElement>("#kaynakSecim")!.value).toBe("zenodo");
    expect(gorunurler(d)).toHaveLength(1);
  });

  it("aynı başlığa ikinci kez tıklamak süzgeci kaldırır", async () => {
    const d = await araVeBekle();
    await gruplaAc(d);

    const arxivBasligi = [...d.querySelectorAll(".grup-basligi")].find((b) =>
      b.querySelector(".grup-ad")?.textContent?.includes("arXiv"),
    )!;

    arxivBasligi.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    expect(gorunurler(d)).toHaveLength(2);

    // Başlık yeniden çizildiği için yeniden bulmamız gerekiyor.
    const yeniBaslik = [...d.querySelectorAll(".grup-basligi")].find((b) =>
      b.querySelector(".grup-ad")?.textContent?.includes("arXiv"),
    )!;
    yeniBaslik.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

    expect(d.querySelector<HTMLSelectElement>("#kaynakSecim")!.value).toBe("");
    expect(gorunurler(d)).toHaveLength(3);
  });

  it("süzgeç gruplamayı doğru sayıda başlıkla yeniden çizer", async () => {
    const d = await araVeBekle();
    await gruplaAc(d);
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(2);

    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;
    secim.value = "zenodo";
    secim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    // Yalnızca Zenodo göründüğü için tek başlık kalmalı.
    expect(d.querySelectorAll(".grup-basligi")).toHaveLength(1);
    expect(d.querySelector(".grup-ad")?.textContent).toContain("Zenodo");
  });
});

describe("yalnızca tek kaynakta bulunanlar", () => {
  it("çoklu eşleşmeleri eler", async () => {
    const d = await araVeBekle();

    const kutu = d.querySelector<HTMLInputElement>("#sadeceTekKaynak")!;
    kutu.checked = true;
    kutu.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    const anahtarlar = gorunurler(d).map((k) => k.dataset.anahtar);
    expect(anahtarlar).not.toContain("coklu");
    expect(anahtarlar).toHaveLength(2);
  });
});

describe("istatistik sayacı", () => {
  it("kaynak ve çoklu eşleşme sayısını yazar", async () => {
    const d = await araVeBekle();
    const sayac = d.querySelector("#kaynakSayaci")!.textContent ?? "";

    expect(sayac).toContain("3 kaynak");
    expect(sayac).toContain("1 çoklu eşleşme");
  });

  it("süzgeç seçiliyken süzgecin adını yazar", async () => {
    const d = await araVeBekle();

    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;
    secim.value = "zenodo";
    secim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(d.querySelector("#kaynakSayaci")!.textContent).toContain("Zenodo");
  });

  it("sonuç kalmayınca sayaç boşalır", async () => {
    const d = await araVeBekle();

    const sekme = [...d.querySelectorAll<HTMLElement>(".sekme")].find(
      (s) => s.dataset.suzgec === "uyum",
    )!;
    const secim = d.querySelector<HTMLSelectElement>("#kaynakSecim")!;
    secim.value = "zenodo";

    sekme.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    secim.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    expect(gorunurler(d)).toHaveLength(0);
    expect(d.querySelector("#kaynakSayaci")!.textContent).toBe("");
  });
});