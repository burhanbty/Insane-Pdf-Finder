import { describe, expect, it } from "vitest";
import { grupla } from "../src/search.js";
import type { Sorgu, Work } from "../src/types.js";

function w(kismi: Partial<Work>): Work {
  return {
    kaynak: "test",
    kaynakAd: "Test",
    tur: "kitap",
    baslik: "Bilinmeyen",
    yazarlar: [],
    link: "https://ornek.test",
    ...kismi,
  };
}

const sorgu: Sorgu = { baslik: "Sapiens", yazar: "Harari", yil: 2011, tur: "kitap", limit: 20 };

describe("grupla", () => {
  it("aynı başlık ve yıldaki farklı yazarları ayrı, benzersiz gruplarda tutar", () => {
    const g = grupla(
      [
        w({ baslik: "Data Structures", yazarlar: ["Alice Smith"], yil: 2020, kaynak: "a" }),
        w({ baslik: "Data Structures", yazarlar: ["Bob Jones"], yil: 2020, kaynak: "b" }),
        w({ baslik: "Data Structures", yazarlar: ["Smith"], yil: 2020, kaynak: "c" }),
        w({ baslik: "Data Structures", yazarlar: ["Jones"], yil: 2020, kaynak: "d" }),
      ],
      { baslik: "Data Structures", tur: "kitap", limit: 20 },
    );
    expect(g).toHaveLength(2);
    expect(new Set(g.map((x) => x.anahtar)).size).toBe(2);
    expect(g.map((x) => x.kaynaklar.map((k) => k.kaynak))).toEqual([
      ["a", "c"],
      ["b", "d"],
    ]);
  });

  it("benzer başlıklı ama farklı yazarlı eserleri de ayırır", () => {
    const g = grupla(
      [
        w({ baslik: "Data Structures", yazarlar: ["Alice Smith"], yil: 2020 }),
        w({ baslik: "Data Structures: Introduction", yazarlar: ["Bob Jones"], yil: 2020 }),
      ],
      { baslik: "Data Structures", tur: "kitap", limit: 20 },
    );
    expect(g).toHaveLength(2);
  });

  it("aynı başlık ve yazarlı fakat farklı DOI'li yayınları ayırır", () => {
    const g = grupla(
      [
        w({ baslik: "Research", yazarlar: ["Alice Smith"], doi: "10.1234/one" }),
        w({ baslik: "Research", yazarlar: ["Alice Smith"], doi: "10.1234/two" }),
      ],
      sorgu,
    );
    expect(g).toHaveLength(2);
  });

  it("aynı DOI'nin farklı gösterimlerini yazar listesi değişse de birleştirir", () => {
    const g = grupla(
      [
        w({ baslik: "Research", yazarlar: ["Alice Smith"], doi: "10.1234/ONE" }),
        w({ baslik: "Research", yazarlar: ["Bob Jones"], doi: "https://doi.org/10.1234/one" }),
      ],
      sorgu,
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.kaynaklar).toHaveLength(2);
  });

  it("yazarı eksik kayıt iki ayrı yazarlı grubu birbirine bağlamaz", () => {
    const g = grupla(
      [
        w({ baslik: "Research", yazarlar: ["Alice Smith"], kaynak: "a" }),
        w({ baslik: "Research", yazarlar: [], kaynak: "unknown" }),
        w({ baslik: "Research", yazarlar: ["Bob Jones"], kaynak: "b" }),
      ],
      sorgu,
    );
    expect(g).toHaveLength(2);
    expect(
      g.every(
        (x) =>
          !(x.kaynaklar.some((k) => k.kaynak === "a") && x.kaynaklar.some((k) => k.kaynak === "b")),
      ),
    ).toBe(true);
  });

  it("benzerlik ile birlesen kayitlarin kaynak ve PDF baglantilarini bir kez korur", () => {
    const kayitlar = [
      w({ kaynak: "a", baslik: "Sapiens", yazarlar: ["Harari"], yil: 2011 }),
      w({
        kaynak: "b",
        baslik: "Sapiens: History",
        yazarlar: ["Harari"],
        yil: 2011,
        pdf: "https://ornek.test/b.pdf",
      }),
      w({ kaynak: "c", baslik: "Sapiens: History", yazarlar: ["Harari"], yil: 2011 }),
    ];
    const g = grupla(kayitlar, sorgu);
    expect(g).toHaveLength(1);
    expect(g[0]!.kaynaklar).toEqual(kayitlar);
    expect(g[0]!.kaynaklar.find((k) => k.kaynak === "b")?.pdf).toBe("https://ornek.test/b.pdf");
  });

  it("ayni normalize baslikta tek grup eder", () => {
    const g = grupla(
      [
        w({ baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"], yil: 2011 }),
        w({ baslik: "SAPIENS", yazarlar: ["Harari"], yil: 2011 }),
      ],
      sorgu,
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.kaynaklar).toHaveLength(2);
  });

  it("farkli eserleri ayirir", () => {
    const g = grupla(
      [
        w({ baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"], yil: 2011 }),
        w({ baslik: "Animal Farm", yazarlar: ["George Orwell"], yil: 1945 }),
      ],
      sorgu,
    );
    expect(g).toHaveLength(2);
  });

  it("farkli turleri birlestirmez", () => {
    const g = grupla(
      [w({ baslik: "Sapiens", tur: "kitap" }), w({ baslik: "Sapiens", tur: "makale" })],
      sorgu,
    );
    expect(g).toHaveLength(2);
  });

  it("eksik alanlari diger kaynaktan doldurur", () => {
    const g = grupla(
      [
        w({ baslik: "Sapiens", yazarlar: ["Harari"], yil: 2011 }),
        w({
          baslik: "Sapiens",
          yazarlar: ["Harari"],
          yil: 2011,
          ozet: "Ozet metni",
          kapak: "https://kapak.test/a.jpg",
        }),
      ],
      sorgu,
    );
    expect(g[0]!.ozet).toBe("Ozet metni");
    expect(g[0]!.kapak).toBe("https://kapak.test/a.jpg");
  });

  it("sorgu yilindan uzak sonuclari cezalandirir", () => {
    const [yakin, uzak] = grupla(
      [
        w({ baslik: "Sapiens", yazarlar: ["Harari"], yil: 2011 }),
        w({ baslik: "Başka Bir Kitap", yazarlar: ["Baska Yazar"], yil: 1987 }),
      ],
      sorgu,
    );
    expect(yakin!.puan).toBeGreaterThan(uzak!.puan);
  });

  it("konulari birlestirip tekrarlari eler", () => {
    const g = grupla(
      [
        w({ baslik: "Sapiens", konular: ["tarih", "insan"] }),
        w({ baslik: "Sapiens", konular: ["tarih", "felsefe"] }),
      ],
      sorgu,
    );
    expect(g[0]!.konular).toEqual(["tarih", "insan", "felsefe"]);
  });

  it("sonuclari puana gore siralar", () => {
    const g = grupla(
      [
        w({ baslik: "Tamamen Alakasiz Bir Baslik", yazarlar: ["X"] }),
        w({ baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"], yil: 2011 }),
      ],
      sorgu,
    );
    expect(g[0]!.baslik).toBe("Sapiens");
  });

  it("farklı yıllardaki kitap baskılarını ayrı tutar", () => {
    const g = grupla(
      [
        w({ baslik: "Sapiens", yazarlar: ["Harari"], yil: 2011 }),
        w({ baslik: "Sapiens", yazarlar: ["Harari"], yil: 1999 }),
      ],
      sorgu,
    );
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.yil).sort()).toEqual([1999, 2011]);
  });
});
