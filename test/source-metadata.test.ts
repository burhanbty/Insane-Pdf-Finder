import { afterEach, expect, it, vi } from "vitest";
import crossref from "../src/sources/crossref.js";
import zenodo from "../src/sources/zenodo.js";
import hal from "../src/sources/hal.js";
import europe from "../src/sources/europe-pmc.js";
import gutenberg from "../src/sources/gutenberg.js";
import wiki from "../src/sources/wikipedia-tr.js";
import openaire from "../src/sources/openaire.js";
import sciHub from "../src/sources/sci-hub.js";
import { iaDosyalari } from "../src/sources/internet-archive.js";

const s = { baslik: "Test", yazar: "Query Author", yil: 2099, tur: "kitap" as const, limit: 10 };
const yanit = (data: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(data)),
  );
afterEach(() => vi.unstubAllGlobals());

it.each(["Text PDF", "Image PDF", "PDF"])(
  "Internet Archive %s dosyasını kaybetmez",
  async (format) => {
    yanit({ metadata: {}, files: [{ name: "Book scan.pdf", format }] });
    expect(await iaDosyalari("public-book")).toMatchObject({
      pdf: "https://archive.org/download/public-book/Book%20scan.pdf",
      erisim: "acik",
    });
  },
);
it("Internet Archive özel dosyaları ve ödünç koleksiyonunun metnini indirme olarak sunmaz", async () => {
  yanit({ metadata: {}, files: [{ name: "private.pdf", format: "Text PDF", private: true }] });
  expect((await iaDosyalari("private")).pdf).toBeUndefined();
  yanit({
    metadata: { collection: ["books", "printdisabled"] },
    files: [
      { name: "book.pdf", format: "Text PDF" },
      { name: "book.txt", format: "DjVuTXT" },
    ],
  });
  expect(await iaDosyalari("borrow")).toMatchObject({
    pdf: undefined,
    metin: undefined,
    erisim: "odunc",
  });
});
it("Internet Archive bool erişim kısıtını ve kapalı kaydı korur", async () => {
  for (const extra of [{ metadata: { access_restricted_item: true } }, { is_dark: true }]) {
    yanit({ ...extra, files: [{ name: "book.pdf", format: "Text PDF" }] });
    expect((await iaDosyalari("restricted")).pdf).toBeUndefined();
  }
});

it("Sci-Hub Crossref kitap türünü makale sorgusuyla değiştirmez", async () => {
  yanit({ message: { items: [{ DOI: "10.1000/book", title: ["Test"], type: "book-chapter" }] } });
  const [w] = await sciHub.ara({ ...s, tur: "makale" });
  expect(w?.tur).toBe("kitap");
  expect(w?.pdf).toBeUndefined();
});

it.each(["e1000234", "411", "423-411", "S10-S15", "1-9000"])(
  "Crossref %s alanını toplam sayfa sayısı olarak yorumlamaz",
  async (page) => {
    yanit({
      message: {
        items: [{ title: ["Test"], type: "book-chapter", page, "container-title": ["Real Book"] }],
      },
    });
    const [w] = await crossref.ara(s);
    expect(w?.sayfaSayisi).toBeUndefined();
    expect(w?.tur).toBe("kitap");
    expect(w?.yayinci).toBe("Real Book");
  },
);
it("Crossref gerçek sayfa aralığını hesaplar", async () => {
  yanit({ message: { items: [{ title: ["Test"], type: "journal-article", page: "411–423" }] } });
  const [w] = await crossref.ara(s);
  expect(w?.sayfaSayisi).toBe(13);
  expect(w?.tur).toBe("makale");
});
it("Zenodo CSV dosyasını PDF gibi sunmaz", async () => {
  yanit({
    hits: {
      hits: [
        {
          id: 1,
          metadata: { title: "Test" },
          files: [{ key: "data.csv", links: { self: "https://zenodo.org/file" } }],
        },
      ],
    },
  });
  expect((await zenodo.ara(s))[0]?.pdf).toBeUndefined();
});
it("HAL eksik dosyadan PDF adresi üretmez ve makaleyi kitap gibi sunmaz", async () => {
  yanit({
    response: {
      docs: [
        {
          docid: "123",
          uri_s: "https://hal.science/hal-04749086",
          title_s: ["Test"],
          docType_s: "ART",
        },
      ],
    },
  });
  const [w] = await hal.ara(s);
  expect(w?.pdf).toBeUndefined();
  expect(w?.tur).toBe("makale");
  expect(w?.erisim).toBe("yonlendir");
});
it("Europe PMC ücretsiz HTML sayfasını PDF saymaz; MED bağlantısını doğru oluşturur", async () => {
  yanit({
    resultList: {
      result: [
        {
          id: "42059664",
          source: "MED",
          title: "Test",
          fullTextUrlList: {
            fullTextUrl: [
              {
                availability: "Free",
                site: "PubMedCentral",
                documentStyle: "html",
                url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/",
              },
            ],
          },
        },
      ],
    },
  });
  const [w] = await europe.ara(s);
  expect(w?.pdf).toBeUndefined();
  expect(w?.link).toBe("https://europepmc.org/article/MED/42059664");
});
it("Gutenberg EPUB'u ayrı tutar ve sorgudan yayın yılı uydurmaz", async () => {
  yanit({
    results: [
      {
        id: 1,
        title: "Test",
        formats: { "application/epub+zip": "https://gutenberg.org/book.epub" },
      },
    ],
  });
  const [w] = await gutenberg.ara(s);
  expect(w?.pdf).toBeUndefined();
  expect(w?.epub).toContain("epub");
  expect(w?.yil).toBeUndefined();
});
it("Wikipedia sorgu yazarını/yılını eserin künyesine yazmaz", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      Response.json(
        String(url).includes("list=search")
          ? { query: { search: [{ title: "Test", pageid: 1 }] } }
          : { query: { pages: { 1: { title: "Test", pageid: 1, extract: "Actual text" } } } },
      ),
    ),
  );
  const [w] = await wiki.ara(s);
  expect(w?.yazarlar).toEqual([]);
  expect(w?.yil).toBeUndefined();
});
it.each([
  ["Article", "makale"],
  ["Book", "kitap"],
])("OpenAIRE %s türünü kayıttan okur", async (apiTur, tur) => {
  yanit({
    response: {
      results: {
        result: {
          metadata: {
            "oaf:entity": {
              "oaf:result": {
                title: { $: "Test" },
                children: { instance: { instancetype: { "@classname": apiTur } } },
              },
            },
          },
        },
      },
    },
  });
  expect((await openaire.ara(s))[0]?.tur).toBe(tur);
});
