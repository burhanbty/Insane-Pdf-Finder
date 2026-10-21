import { describe, expect, it } from "vitest";
import { grupla } from "../src/search.js";
import { baskiKarsilastir } from "../src/matching.js";
import { eserAnahtari, eslestir } from "../src/normalize.js";
import type { Sorgu, Work } from "../src/types.js";

const sorgu: Sorgu = { baslik: "Calculus", tur: "kitap", limit: 20 };
const w = (extra: Partial<Work> = {}): Work => ({
  kaynak: "test",
  kaynakAd: "Test",
  baslik: "Calculus",
  tur: "kitap",
  yazarlar: ["Jane Doe"],
  link: "https://example.com/book",
  ...extra,
});
describe("öğrenci aramasında kimlik ve baskı doğruluğu", () => {
  it("tek haneli cilt numaralarını ve olumsuzluk kelimelerini korur", () => {
    expect(eserAnahtari("Calculus 2")).not.toBe(eserAnahtari("Calculus 3"));
    expect(eserAnahtari("No Exit")).not.toBe(eserAnahtari("Exit"));
    expect(eserAnahtari("Война и мир")).not.toBe(eserAnahtari("Преступление"));
    expect(grupla([w({ baslik: "Calculus 2" }), w({ baslik: "Calculus 3" })], sorgu)).toHaveLength(
      2,
    );
  });
  it("C, C++ ve C# başlıkları ile Roma rakamlarını birbirine dönüştürmez", () => {
    expect(
      new Set(["C Programming", "C++ Programming", "C# Programming"].map(eserAnahtari)).size,
    ).toBe(3);
    expect(eserAnahtari("Calculus I")).not.toBe(eserAnahtari("Calculus II"));
    const gruplar = grupla(
      [
        w({ baslik: "C Programming" }),
        w({ baslik: "C++ Programming" }),
        w({ baslik: "C# Programming" }),
      ],
      { ...sorgu, baslik: "C Programming" },
    );
    expect(gruplar).toHaveLength(3);
    expect(grupla([w({ baslik: "Calculus I" }), w({ baslik: "Calculus II" })], sorgu)).toHaveLength(
      2,
    );
  });
  it("yazar verilmemesi tam başlık puanını düşürmez", () => {
    expect(eslestir({ baslik: "Calculus", yazarlar: [] }, w()).puan).toBe(1);
    expect(grupla([w()], sorgu)[0]?.eslesme?.tur).toBe("tam");
  });
  it("aynı soyadlı farklı yazarları birleştirmez veya tam eşleşme sunmaz", () => {
    const g = grupla([w({ yazarlar: ["Alice Smith"] }), w({ yazarlar: ["Bob Smith"] })], {
      ...sorgu,
      yazar: "Alice Smith",
    });
    expect(g).toHaveLength(2);
    expect(g.find((g) => g.yazarlar[0] === "Bob Smith")?.eslesme?.tur).toBe("ilgili");
  });
  it("eksik yazar doğrulanmış yazar eşleşmesi değildir", () => {
    expect(
      grupla([w({ yazarlar: [] })], { ...sorgu, yazar: "Jane Doe" })[0]?.eslesme?.tur,
    ).not.toBe("tam");
  });
  it.each([
    [{ isbn: "9780131103627" }, { isbn: "9780306406157" }],
    [{ dil: "tr" }, { dil: "eng" }],
    [{ baski: "2" }, { baski: "3rd edition" }],
    [{ yil: 2011 }, { yil: 2020 }],
  ])("bilinen baskı çelişkileri ayrılır: %j / %j", (a, b) => {
    expect(grupla([w(a), w(b)], sorgu)).toHaveLength(2);
  });
  it("ISBN-10 ve aynı ISBN-13 ile dil/baskı yazım çeşitlerini birleştirir", () => {
    expect(
      grupla(
        [
          w({ isbn: "0-13-110362-8", dil: "eng", baski: "Second edition" }),
          w({ isbn: "9780131103627", dil: "en", baski: "2. baskı" }),
        ],
        sorgu,
      ),
    ).toHaveLength(1);
  });
  it("künye eksiği iki farklı baskı arasında köprü olmaz", () => {
    const g = grupla([w({ isbn: "9780131103627" }), w(), w({ isbn: "9780306406157" })], sorgu);
    expect(g).toHaveLength(2);
    expect(g.every((g) => new Set(g.kaynaklar.map((k) => k.isbn).filter(Boolean)).size <= 1)).toBe(
      true,
    );
  });
  it("karşılaştırmada eksik ISBN bilinmiyor, farklı dil farklıdır", () => {
    const c = baskiKarsilastir({ ...sorgu, isbn: "9780131103627", dil: "tr" }, w({ dil: "eng" }));
    expect(c.alanlar.find((a) => a.alan === "ISBN")?.durum).toBe("bilinmiyor");
    expect(c.alanlar.find((a) => a.alan === "Dil")?.durum).toBe("farkli");
    expect(grupla([w()], { ...sorgu, isbn: "9780131103627" })[0]?.eslesme?.tur).toBe("yakin");
  });
  it("farklı kaynakların kısmi bilgilerini tek doğrulanmış baskı gibi sunmaz", () => {
    const g = grupla([w({ isbn: "9780131103627" }), w({ dil: "en" })], {
      ...sorgu,
      isbn: "9780131103627",
      dil: "en",
    });
    expect(g[0]?.eslesme?.tur).toBe("yakin");
  });
  it("yazım önerisi yalnızca yakın gerçek başlıkta, sayı ve yazar çelişmeden sunulur", () => {
    expect(grupla([w()], { ...sorgu, baslik: "Calcullus" })[0]?.eslesme).toMatchObject({
      tur: "yakin",
      oneri: true,
    });
    expect(
      grupla([w({ baslik: "Calculus 3" })], { ...sorgu, baslik: "Calculus 2" })[0]?.eslesme?.oneri,
    ).toBe(false);
    expect(
      grupla([w()], { ...sorgu, baslik: "Calcullus", yazar: "Other Writer" })[0]?.eslesme?.oneri,
    ).toBe(false);
  });
  it("başlığı alakasız kayıt yüksek yazar puanıyla tam eşleşme olmaz", () => {
    expect(
      grupla([w({ baslik: "History of Art" })], { ...sorgu, yazar: "Jane Doe" })[0]?.eslesme?.tur,
    ).toBe("ilgili");
  });
  it("kitap aramasında aynı adlı makaleyi tam eşleşme saymaz", () => {
    expect(grupla([w({ tur: "makale" })], sorgu)[0]?.eslesme?.tur).toBe("ilgili");
  });
});
