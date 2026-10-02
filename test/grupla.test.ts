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

  it("yil uyumsuz ayni baslikli kayitlari birlestirir ama cezalandirir", () => {
    const g = grupla(
      [
        w({ baslik: "Sapiens", yazarlar: ["Harari"], yil: 2011 }),
        w({ baslik: "Sapiens", yazarlar: ["Harari"], yil: 1999 }),
      ],
      sorgu,
    );
    // Ayni normalize baslik -> kesin anahtar ayni, tek grup olur.
    expect(g).toHaveLength(1);
  });
});
