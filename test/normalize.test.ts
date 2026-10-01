import { describe, expect, it } from "vitest";
import {
  eserAnahtari,
  eslestir,
  metindenYil,
  normalizeMetin,
  tokenlar,
  yazarParcalari,
  yilUyumlu,
} from "../src/normalize.js";

describe("normalizeMetin", () => {
  it("turkce harfleri ASCII'ye indirger", () => {
    expect(normalizeMetin("Çağdaş Türkçe")).toBe("cagdas turkce");
    expect(normalizeMetin("İlk Şubat")).toBe("ilk subat");
    expect(normalizeMetin("Işık Işığı")).toBe("isik isigi");
  });

  it("aksanlari ve noktalama isaretlerini atar", () => {
    expect(normalizeMetin("Café—déjà vu!")).toBe("cafe deja vu");
    expect(normalizeMetin("  bir   çift   boşluk  ")).toBe("bir cift bosluk");
  });

  it("bos girdide bos doner", () => {
    expect(normalizeMetin("")).toBe("");
  });
});

describe("tokenlar", () => {
  it("edatleri atar", () => {
    expect(tokenlar("The Lord of the Rings")).toEqual(["lord", "rings"]);
  });

  it("tek kelimede edat varsa onu korur", () => {
    expect(tokenlar("Of")).toEqual(["of"]);
  });

  it("tekrar eden tokenlari eler", () => {
    expect(tokenlar("Sapiens sapiens sapiens")).toEqual(["sapiens"]);
  });
});

describe("eserAnahtari", () => {
  it("siralamadan bagimsiz ayni anahtari uretir", () => {
    expect(eserAnahtari("History of Humankind")).toBe(eserAnahtari("Humankind of History"));
  });
});

describe("yazarParcalari", () => {
  it("soyadi cikarir", () => {
    const p = yazarParcalari("Yuval Noah Harari");
    expect(p.soyad).toEqual(["harari"]);
    expect(p.ad).toContain("yuval");
  });

  it("soyad edatini (de/van) ad kismina karistirmaz", () => {
    const p = yazarParcalari("Ludwig van Beethoven");
    expect(p.soyad).toEqual(["beethoven"]);
    expect(p.ad).toEqual(["ludwig"]);
  });

  it("ara parcalar soyad veya ad olarak yazilir", () => {
    const p = yazarParcalari("Miguel de Cervantes Saavedra");
    expect(p.soyad).toEqual(["saavedra"]);
    expect(p.ad).toContain("cervantes");
  });

  it("tek kelimelik isimlerde tamamini soyad sayar", () => {
    expect(yazarParcalari("Plato").soyad).toEqual(["plato"]);
  });
});

describe("eslestir", () => {
  const sorgu = { baslik: "Sapiens: A Brief History of Humankind", yazarlar: ["Yuval Noah Harari"], yil: 2011 };

  it("birebir ayni eseri yuksek puanlar", () => {
    const e = eslestir(sorgu, {
      baslik: "Sapiens: A Brief History of Humankind",
      yazarlar: ["Yuval Noah Harari"],
      yil: 2011,
    });
    expect(e.puan).toBeGreaterThan(0.95);
    expect(e.yil).toBe(1);
  });

  it("cok farkli bir eseri dusuk puanlar", () => {
    const e = eslestir(sorgu, {
      baslik: "Animal Farm",
      yazarlar: ["George Orwell"],
      yil: 1945,
    });
    expect(e.puan).toBeLessThan(0.2);
  });

  it("kisa baslik sorgusu uzun baslikla eslesir", () => {
    const e = eslestir(
      { baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"], yil: 2011 },
      { baslik: "Sapiens: A Brief History of Humankind", yazarlar: ["Yuval Noah Harari"], yil: 2011 },
    );
    expect(e.baslik).toBeGreaterThan(0.35);
    expect(e.puan).toBeGreaterThan(0.6);
  });

  it("dogru baslik yanlis yazarla orta puan verir", () => {
    const e = eslestir({ baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"], yil: 2011 }, { baslik: "Sapiens", yazarlar: ["George Orwell"], yil: 2011 });
    expect(e.puan).toBeGreaterThan(0.3);
    expect(e.puan).toBeLessThan(0.7);
    expect(e.yazar).toBe(0);
  });

  it("yil yoksa puanlamaya katilmaz", () => {
    const e = eslestir({ baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"] }, { baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"] });
    expect(e.yil).toBeNull();
    expect(e.puan).toBeGreaterThan(0.9);
  });

  it("yil saptasi puani dusurur", () => {
    const dogru = eslestir(sorgu, { baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"], yil: 2011 });
    const yanlis = eslestir(sorgu, { baslik: "Sapiens", yazarlar: ["Yuval Noah Harari"], yil: 1987 });
    expect(dogru.puan).toBeGreaterThan(yanlis.puan);
  });

  it("farkli yazimda ayni eseri tanir", () => {
    const e = eslestir(
      { baslik: "Brave New World", yazarlar: ["Aldous Huxley"] },
      { baslik: "Cesur Yeni Dunya", yazarlar: ["Aldous Leonard Huxley"] },
    );
    expect(e.yazar).toBeGreaterThan(0.7);
  });
});

describe("metindenYil", () => {
  it("basliktaki yili cikarir", () => {
    expect(metindenYil("Sapiens 2011")).toBe(2011);
  });

  it("yil yoksa undefined doner", () => {
    expect(metindenYil("Animal Farm")).toBeUndefined();
  });

  it("anlamsiz sayilari yil saymaz", () => {
    expect(metindenYil("Fahrenheit 451")).toBeUndefined();
  });
});

describe("yilUyumlu", () => {
  it("bir yil fark kabul eder", () => {
    expect(yilUyumlu(2011, 2012)).toBe(true);
  });

  it("buyuk farki eler", () => {
    expect(yilUyumlu(2011, 1990)).toBe(false);
  });

  it("eksik bilgide serbest birakir", () => {
    expect(yilUyumlu(undefined, 1990)).toBe(true);
    expect(yilUyumlu(2011, undefined)).toBe(true);
  });
});