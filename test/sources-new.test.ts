import { describe, expect, it, vi } from "vitest";
import sciHub from "../src/sources/sci-hub.js";
import europePmc from "../src/sources/europe-pmc.js";
import gutenberg from "../src/sources/gutenberg.js";
import hal from "../src/sources/hal.js";

describe("sci-hub kaynak modülü", () => {
  it("modül tanımı geçerlidir", () => {
    expect(sciHub.id).toBe("sci-hub");
    expect(sciHub.ad).toBe("Sci-Hub");
    expect(sciHub.tur).toEqual(["makale", "kitap"]);
    expect(typeof sciHub.ara).toBe("function");
  });

  it("doğrudan DOI içeren başlıkta Crossref çağırmadan sonuç üretir", async () => {
    const sonuclar = await sciHub.ara({
      baslik: "10.1038/nature12373",
      tur: "makale",
      limit: 10,
    });

    expect(sonuclar).toHaveLength(1);
    expect(sonuclar[0]!.doi).toBe("10.1038/nature12373");
    expect(sonuclar[0]!.link).toContain("sci-hub.se/10.1038%2Fnature12373");
    expect(sonuclar[0]!.pdf).toBeUndefined();
    expect(sonuclar[0]!.erisim).toBe("yonlendir");
  });

  it("başlık aramasında Crossref üzerinden DOI çözümler", async () => {
    const mockCrossref = {
      message: {
        items: [
          {
            DOI: "10.1145/3375633",
            title: ["Deep Learning Systems: Principles and Practices"],
            author: [{ given: "Yuan", family: "Wang" }],
            issued: { "date-parts": [[2020]] },
            publisher: "ACM",
          },
        ],
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockCrossref,
      text: async () => JSON.stringify(mockCrossref),
    } as unknown as Response);

    try {
      const sonuclar = await sciHub.ara({
        baslik: "Deep Learning Systems",
        yazar: "Wang",
        tur: "makale",
        limit: 10,
      });

      expect(sonuclar).toHaveLength(1);
      expect(sonuclar[0]!.baslik).toBe("Deep Learning Systems: Principles and Practices");
      expect(sonuclar[0]!.doi).toBe("10.1145/3375633");
      expect(sonuclar[0]!.link).toContain("sci-hub.se/10.1145%2F3375633");
      expect(sonuclar[0]!.yazarlar).toEqual(["Yuan Wang"]);
      expect(sonuclar[0]!.yil).toBe(2020);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("europe-pmc kaynak modülü", () => {
  it("modül tanımı geçerlidir", () => {
    expect(europePmc.id).toBe("europe-pmc");
    expect(europePmc.ad).toBe("Europe PMC");
    expect(europePmc.tur).toEqual(["makale"]);
    expect(typeof europePmc.ara).toBe("function");
  });

  it("Europe PMC yanıtını ve açık PDF bağlantılarını çözümler", async () => {
    const mockData = {
      resultList: {
        result: [
          {
            id: "PMC13650200",
            title: "The neuroscience of transformers",
            authorString: "König P., Negrello M.",
            pubYear: "2026",
            journalTitle: "Nature Neuroscience",
            doi: "10.1038/s41593-026-0001",
            abstractText: "Transformers represent a major breakthrough in AI.",
            isOpenAccess: "Y",
            fullTextUrlList: {
              fullTextUrl: [
                {
                  documentStyle: "pdf",
                  site: "Europe_PMC",
                  url: "https://europepmc.org/articles/PMC13650200?pdf=render",
                },
              ],
            },
          },
        ],
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
      text: async () => JSON.stringify(mockData),
    } as unknown as Response);

    try {
      const sonuclar = await europePmc.ara({
        baslik: "The neuroscience of transformers",
        tur: "makale",
        limit: 10,
      });

      expect(sonuclar).toHaveLength(1);
      const k = sonuclar[0]!;
      expect(k.kaynak).toBe("europe-pmc");
      expect(k.baslik).toBe("The neuroscience of transformers");
      expect(k.yazarlar).toEqual(["König P", "Negrello M"]);
      expect(k.yil).toBe(2026);
      expect(k.pdf).toBe("https://europepmc.org/articles/PMC13650200?pdf=render");
      expect(k.erisim).toBe("acik");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("gutenberg kaynak modülü", () => {
  it("modül tanımı geçerlidir", () => {
    expect(gutenberg.id).toBe("gutenberg");
    expect(gutenberg.ad).toBe("Project Gutenberg");
    expect(gutenberg.tur).toEqual(["kitap"]);
    expect(typeof gutenberg.ara).toBe("function");
  });

  it("Gutendex yanıtını doğru dönüştürür", async () => {
    const mockData = {
      count: 1,
      results: [
        {
          id: 84,
          title: "Frankenstein; or, the modern prometheus",
          authors: [{ name: "Shelley, Mary Wollstonecraft" }],
          languages: ["en"],
          subjects: ["Frankenstein monster (Fictitious character) -- Fiction"],
          formats: {
            "image/jpeg": "https://www.gutenberg.org/cache/epub/84/pg84.cover.medium.jpg",
            "application/epub+zip": "https://www.gutenberg.org/ebooks/84.epub3.images",
            "text/plain; charset=utf-8": "https://www.gutenberg.org/ebooks/84.txt.utf-8",
          },
        },
      ],
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
      text: async () => JSON.stringify(mockData),
    } as unknown as Response);

    try {
      const sonuclar = await gutenberg.ara({
        baslik: "Frankenstein",
        tur: "kitap",
        limit: 10,
      });

      expect(sonuclar).toHaveLength(1);
      const k = sonuclar[0]!;
      expect(k.kaynak).toBe("gutenberg");
      expect(k.baslik).toBe("Frankenstein; or, the modern prometheus");
      expect(k.yazarlar).toEqual(["Mary Wollstonecraft Shelley"]);
      expect(k.pdf).toBeUndefined();
      expect(k.epub).toBe("https://www.gutenberg.org/ebooks/84.epub3.images");
      expect(k.tamMetin).toBe("https://www.gutenberg.org/ebooks/84.txt.utf-8");
      expect(k.kapak).toContain("pg84.cover.medium.jpg");
      expect(k.erisim).toBe("acik");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("hal kaynak modülü", () => {
  it("modül tanımı geçerlidir", () => {
    expect(hal.id).toBe("hal");
    expect(hal.ad).toBe("HAL Science");
    expect(hal.tur).toEqual(["makale", "kitap"]);
    expect(typeof hal.ara).toBe("function");
  });

  it("HAL Solr yanıtını çözümler", async () => {
    const mockData = {
      response: {
        numFound: 1,
        docs: [
          {
            docid: "4393702",
            title_s: ["Multimodal hybrid deep learning for computer vision"],
            authFullName_s: ["Khaled Bayoudh"],
            producedDateY_i: 2024,
            doiId_s: "10.1016/j.inffus.2023.102217",
            abstract_s: ["A comprehensive survey of multimodal deep learning."],
            uri_s: "https://hal.science/hal-04393702",
            files_s: ["https://hal.science/hal-04393702/file/manuscript.pdf"],
            docType_s: "ART",
          },
        ],
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
      text: async () => JSON.stringify(mockData),
    } as unknown as Response);

    try {
      const sonuclar = await hal.ara({
        baslik: "Multimodal hybrid deep learning",
        tur: "makale",
        limit: 10,
      });

      expect(sonuclar).toHaveLength(1);
      const k = sonuclar[0]!;
      expect(k.kaynak).toBe("hal");
      expect(k.baslik).toBe("Multimodal hybrid deep learning for computer vision");
      expect(k.yazarlar).toEqual(["Khaled Bayoudh"]);
      expect(k.yil).toBe(2024);
      expect(k.pdf).toBe("https://hal.science/hal-04393702/file/manuscript.pdf");
      expect(k.erisim).toBe("acik");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
