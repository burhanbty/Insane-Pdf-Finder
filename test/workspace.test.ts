import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CalismaAlani } from "../src/workspace.js";

let dizin: string;
let dosya: string;
let alan: CalismaAlani;
const eser = (ad = "Research", doi?: string) => ({
  anahtar: ad,
  baslik: ad,
  tur: "kitap",
  yazarlar: ["Jane Doe"],
  yil: 2024,
  konular: ["Science"],
  kaynaklar: [
    {
      kaynak: "test",
      kaynakAd: "Test",
      link: "https://example.org/book",
      doi,
      ham: { apiKey: "must-not-persist" },
    },
  ],
});
const arama = (baslik = "Research") => ({
  ad: baslik,
  sorgu: { baslik, tur: "kitap", limit: 20 },
  webDahil: false,
});
beforeEach(async () => {
  dizin = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-workspace-test-"));
  dosya = path.join(dizin, "workspace.json");
  alan = new CalismaAlani(() => dosya);
});
afterEach(async () => {
  vi.restoreAllMocks();
  const rel = path.relative(os.tmpdir(), dizin);
  if (!rel.startsWith("kaynak-bul-workspace-test-") || rel.includes("..") || path.isAbsolute(rel))
    throw Error("Dizin sınır dışında");
  await fs.rm(dizin, { recursive: true, force: true });
});

describe("kalıcı kitaplık", () => {
  it("baskı bilgisi ve kayıtlı arama tercihleri yeniden okumada korunur", async () => {
    const g = eser();
    Object.assign(g.kaynaklar[0]!, {
      baski: "Second edition",
      dil: "eng",
      isbn: "9780131103627",
      yil: 1988,
    });
    await alan.ekle(g);
    const a = arama();
    Object.assign(a.sorgu, {
      isbn: "0-13-110362-8",
      baski: "2",
      dil: "en",
      yayinci: "Prentice Hall",
    });
    await alan.aramaKaydet(a);
    const yeni = await new CalismaAlani(() => dosya).listele();
    expect(yeni.kitaplik[0]?.eser.kaynaklar[0]).toMatchObject({
      baski: "Second edition",
      dil: "eng",
      isbn: "9780131103627",
      yil: 1988,
    });
    expect(yeni.aramalar[0]?.sorgu).toMatchObject({
      isbn: "9780131103627",
      baski: "2",
      dil: "en",
      yayinci: "Prentice Hall",
    });
  });
  it("ilk okumada boş alan döner; kendiliğinden dosya oluşturmaz", async () => {
    expect(await alan.listele()).toEqual({ surum: 1, kitaplik: [], aramalar: [] });
    expect(await fs.readdir(dizin)).toEqual([]);
  });
  it("kayıt/notlar yeni store örneğinde kalır; ham kaynak verisi kaydedilmez", async () => {
    const { kayit } = await alan.ekle(eser());
    await alan.guncelle(kayit.id, {
      notlar: "Important finding",
      koleksiyon: "Thesis",
      durum: "okunuyor",
    });
    const yeni = new CalismaAlani(() => dosya);
    expect((await yeni.listele()).kitaplik[0]).toMatchObject({
      notlar: "Important finding",
      koleksiyon: "Thesis",
      durum: "okunuyor",
    });
    expect(await fs.readFile(dosya, "utf8")).not.toContain("must-not-persist");
  });
  it("aynı DOI'nin farklı başlığı ikinci kayıt oluşturmaz veya notları sıfırlamaz", async () => {
    const { kayit } = await alan.ekle(eser("First title", "10.1000/ABC"));
    await alan.guncelle(kayit.id, { notlar: "Keep this" });
    const ikinci = await alan.ekle(eser("Other title", "https://doi.org/10.1000/abc"));
    expect(ikinci.eklendi).toBe(false);
    expect(ikinci.kayit.notlar).toBe("Keep this");
    expect((await alan.listele()).kitaplik).toHaveLength(1);
  });
  it("eşzamanlı yirmi kayıt kayıp veya bozuk JSON oluşturmaz", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => alan.ekle(eser(`Book ${i}`))));
    expect((await alan.listele()).kitaplik).toHaveLength(20);
    expect((await fs.readdir(dizin)).filter((d) => d.endsWith(".tmp"))).toEqual([]);
  });
  it("arşivleme geri alınabilir ve notları korur", async () => {
    const { kayit } = await alan.ekle(eser());
    await alan.guncelle(kayit.id, { notlar: "Personal", arsiv: true });
    expect((await alan.listele()).kitaplik[0]?.arsiv).toBe(true);
    await alan.guncelle(kayit.id, { arsiv: false });
    expect((await alan.listele()).kitaplik[0]).toMatchObject({ arsiv: false, notlar: "Personal" });
  });
  it("geçersiz değişiklik öncekileri diske kısmen yazmaz", async () => {
    const { kayit } = await alan.ekle(eser());
    await expect(
      alan.guncelle(kayit.id, { notlar: "wrong partial update", durum: "bogus" }),
    ).rejects.toThrow("durumu");
    expect((await alan.listele()).kitaplik[0]?.notlar).toBe("");
  });
  it("yazma başarısızsa önceki dosya durur ve geçici dosya kalmaz", async () => {
    await alan.ekle(eser());
    const onceki = await fs.readFile(dosya, "utf8");
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk error"));
    await expect(alan.ekle(eser("Another book"))).rejects.toThrow("disk error");
    rename.mockRestore();
    expect(await fs.readFile(dosya, "utf8")).toBe(onceki);
    expect(await fs.readdir(dizin)).toEqual(["workspace.json"]);
  });
  it("bozuk yerel veriyi sıfırlamaz ve üzerine yazmaz", async () => {
    await fs.writeFile(dosya, "{broken");
    await expect(alan.ekle(eser())).rejects.toThrow("dosya korundu");
    expect(await fs.readFile(dosya, "utf8")).toBe("{broken");
  });
  it.each([
    { baslik: "" },
    { yazarlar: "wrong" },
    { yil: 9999 },
    { kaynaklar: [{ kaynak: "x", kaynakAd: "X", link: "javascript:alert(1)" }] },
  ])("geçersiz eser alanlarını reddeder: %j", async (degisiklik) => {
    await expect(alan.ekle({ ...eser(), ...degisiklik })).rejects.toThrow();
    expect(await fs.readdir(dizin)).toEqual([]);
  });
});

describe("kayıtlı aramalar ve yedek", () => {
  it("ders listesi önizlenir, atomik kaydedilir; yinelenen sorgular korunur", async () => {
    const g = {
      ders: "CENG 201",
      metin:
        "1. The C Programming Language | Brian Kernighan | 1988\nIntroduction to Algorithms | Thomas Cormen\nThe C Programming Language | Brian Kernighan | 1988",
    };
    const onizleme = await alan.dersListesi(g, true);
    expect(onizleme).toMatchObject({ yeniArama: 2, mevcut: 1 });
    expect(await fs.readdir(dizin)).toEqual([]);
    await alan.dersListesi(g, false);
    const sonuc = await alan.listele();
    expect(sonuc.aramalar).toHaveLength(2);
    expect(sonuc.aramalar[0]).toMatchObject({
      ad: "CENG 201 · The C Programming Language",
      sorgu: { yil: 1988, tur: "kitap" },
    });
    expect((await alan.dersListesi(g, false)).yeniArama).toBe(0);
  });
  it("bir hatalı ders satırı kısmi yazma yapmaz", async () => {
    await expect(
      alan.dersListesi(
        { ders: "Physics", metin: "Good book | Writer | 2020\nBad book | Writer | nineteen" },
        false,
      ),
    ).rejects.toThrow();
    expect(await fs.readdir(dizin)).toEqual([]);
    await expect(
      alan.dersListesi({ ders: "Physics", metin: Array(21).fill("Book").join("\n") }, false),
    ).rejects.toThrow("1-20");
  });
  it("aynı başlıklı farklı ISBN baskılarını ayrı tutar", async () => {
    const bir = eser();
    bir.kaynaklar[0] = { ...bir.kaynaklar[0]!, isbn: "9780131103627" } as (typeof bir.kaynaklar)[0];
    const iki = eser();
    iki.kaynaklar[0] = { ...iki.kaynaklar[0]!, isbn: "9780306406157" } as (typeof iki.kaynaklar)[0];
    await alan.ekle(bir);
    await alan.ekle(iki);
    expect((await alan.listele()).kitaplik).toHaveLength(2);
  });
  it("aynı sorguyu tek kez kaydeder, adını günceller ve tekrar kaldırabilir", async () => {
    const ilk = await alan.aramaKaydet(arama());
    await alan.aramaKaydet({ ...arama(), ad: "New name" });
    const sonuc = await alan.listele();
    expect(sonuc.aramalar).toHaveLength(1);
    expect(sonuc.aramalar[0]?.ad).toBe("New name");
    await alan.aramaKaldir(ilk.id);
    expect((await alan.listele()).aramalar).toEqual([]);
  });
  it("önizleme dosya yazmaz; birleştirme mevcut notları korur ve tekrarlanabilir", async () => {
    const { kayit } = await alan.ekle(eser());
    await alan.guncelle(kayit.id, { notlar: "Original" });
    const yedek = await alan.listele();
    yedek.kitaplik[0]!.notlar = "Imported overwrite";
    const yeniDosya = path.join(dizin, "new.json");
    const diger = new CalismaAlani(() => yeniDosya);
    await diger.ekle(eser("New book"));
    await diger.aramaKaydet(arama());
    const ek = await diger.listele();
    yedek.kitaplik.push(...ek.kitaplik);
    yedek.aramalar.push(...ek.aramalar);
    const before = await fs.readFile(dosya, "utf8");
    expect(await alan.birlestir(yedek, true)).toEqual({ yeniKitap: 1, yeniArama: 1, korunan: 1 });
    expect(await fs.readFile(dosya, "utf8")).toBe(before);
    await alan.birlestir(yedek, false);
    expect((await alan.listele()).kitaplik.find((k) => k.id === kayit.id)?.notlar).toBe("Original");
    expect(await alan.birlestir(yedek, false)).toEqual({ yeniKitap: 0, yeniArama: 0, korunan: 3 });
  });
  it("geçersiz sürüm ve yinelenen yedek kayıtları hiçbir veriyi değiştirmez", async () => {
    await alan.ekle(eser());
    const before = await fs.readFile(dosya, "utf8");
    const yedek = await alan.listele();
    await expect(alan.birlestir({ ...yedek, surum: 99 }, false)).rejects.toThrow("sürümü");
    await expect(
      alan.birlestir({ ...yedek, kitaplik: [...yedek.kitaplik, ...yedek.kitaplik] }, false),
    ).rejects.toThrow("yinelenen");
    expect(await fs.readFile(dosya, "utf8")).toBe(before);
  });
  it("not, arama ve kitaplık sınırlarını uygular", async () => {
    const { kayit } = await alan.ekle(eser());
    await expect(alan.guncelle(kayit.id, { notlar: "x".repeat(5001) })).rejects.toThrow("5000");
    await expect(
      alan.aramaKaydet({ ...arama(), sorgu: { ...arama().sorgu, limit: 1.5 } }),
    ).rejects.toThrow("seçenekleri");
    await expect(
      alan.birlestir({ surum: 1, kitaplik: Array(1001).fill({}), aramalar: [] }, false),
    ).rejects.toThrow("sınırı");
  });
});
