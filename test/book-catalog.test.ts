import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ayar } from "../src/config.js";
import { yayinlariOku, jsonSatirlariniOku } from "../src/catalog-stream.js";
import {
  katalogGuncelle,
  katalogdaAra,
  katalogSurumu,
  katalogYolu,
  yayindanEser,
} from "../src/book-catalog.js";
import { get } from "../src/http.js";
import { grupla } from "../src/search.js";
import doab from "../src/sources/doab.js";
import { kaynakHazirligi } from "../src/source-state.js";
vi.mock("../src/http.js", async (original) => ({
  ...(await original<typeof import("../src/http.js")>()),
  get: vi.fn(),
}));
const onceki = ayar.dataDir;
let temp: string;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-catalog-"));
  ayar.dataDir = temp;
  vi.mocked(get).mockReset();
});
afterEach(async () => {
  ayar.dataDir = onceki;
  const rel = path.relative(os.tmpdir(), temp);
  if (!rel.startsWith("kaynak-bul-catalog-") || rel.includes(".."))
    throw Error("Dizin sınır dışında");
  await fs.rm(temp, { recursive: true, force: true });
});
const yayin = (ad = "A World of Nourishment", type = "book") => ({
  metadata: {
    title: ad,
    author: ["Cinzia Pieruccini"],
    published: 2016,
    identifier: "https://directory.doabooks.org/handle/20.500.12854/62823",
    docType: type,
    isbn: ["9780131103627"],
    licence: "cc-by",
    doi: "10.1234/book",
  },
  links: { href: ["https://publisher.org/book.pdf"], type: "application/pdf" },
});
async function* baytlar(text: string, boyut = 1) {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += boyut) yield bytes.slice(i, i + boyut);
}
async function topla(text: string) {
  const out = [];
  for await (const v of yayinlariOku(baytlar(text))) out.push(v);
  return out;
}
it("parçalanmış UTF-8, kaçış, iç içe diziler ve parantezli metin doğru okunur", async () => {
  const item = { metadata: { title: 'Türkçe \\" ve } ] metin', array: [{ x: "ı" }] } };
  expect(await topla(JSON.stringify({ metadata: [], publications: [item, item] }))).toEqual([
    item,
    item,
  ]);
});
it("DOAB kayıtlarındaki Unicode satır ayıracı JSONL kaydını bölmez", async () => {
  const satir = { baslik: "French book", ozet: "Texte\u2028En réunissant\u2029fin\u0085suite" };
  const out = [];
  for await (const v of jsonSatirlariniOku(
    baytlar(JSON.stringify(satir) + "\n" + JSON.stringify(satir) + "\n"),
  ))
    out.push(v);
  expect(out).toEqual([satir, satir]);
});
it.each([
  '{"publications":[{}',
  '{"publications":[{},]}',
  '{"publications":[{}{}]}',
  '{"publications":[4]}',
  '{"metadata":[]}',
])("eksik/bozuk JSON yayımlanmaz: %s", async (text) => {
  await expect(topla(text)).rejects.toThrow();
});
it("kitap künye, lisans ve dosya adayları doğru eşlenir; editör yazar yapılmaz", () => {
  const p = yayin();
  Object.assign(p.metadata, { author: null, editor: ["Editor Name"] });
  const w = yayindanEser("doab", p)!;
  expect(w).toMatchObject({
    kaynak: "doab",
    baslik: "A World of Nourishment",
    yazarlar: [],
    yil: 2016,
    isbn: "9780131103627",
    belgeTuru: "kitap",
    pdf: "https://publisher.org/book.pdf",
  });
  expect(w.pdfAdaylari?.[0]).toMatchObject({ lisans: "cc-by", durum: "aday", baglantiTuru: "pdf" });
});
it("DOI/yayınevi sayfası doğrudan PDF olarak sunulmaz", () => {
  const p = yayin();
  p.links.href = ["10.1234/book", "https://publisher.org/book"];
  const w = yayindanEser("doab", p)!;
  expect(w.pdf).toBeUndefined();
  expect(w.pdfAdaylari).toHaveLength(2);
  expect(w.pdfAdaylari?.[0]).toMatchObject({
    url: "https://doi.org/10.1234/book",
    baglantiTuru: "kayit",
  });
});
it("birden fazla ISBN varsa PDF'nin baskısı için ilkini tahmin etmez", () => {
  const p = yayin();
  p.metadata.isbn = ["9780131103627", "9780262033848"];
  expect(yayindanEser("doab", p)?.isbn).toBeUndefined();
});
it("kitap bölümüne üst kitabın ISBN ve sayfa sayısını atamaz", () => {
  const p = yayin("Chapter on Nourishment", "chapter");
  Object.assign(p.metadata, { numberOfPages: "768" });
  const w = yayindanEser("doab", p)!;
  expect(w.belgeTuru).toBe("kitap-bolumu");
  expect(w.isbn).toBeUndefined();
  expect(w.sayfaSayisi).toBeUndefined();
});
it("kaynak dışı, özel ağ, yanlış tür ve tehlikeli dosya URL'sini reddeder", () => {
  const p = yayin();
  p.metadata.identifier = "https://evil.org/book";
  expect(yayindanEser("doab", p)).toBeUndefined();
  p.metadata.identifier = "https://directory.doabooks.org/handle/x";
  p.metadata.docType = "dataset";
  expect(yayindanEser("doab", p)).toBeUndefined();
  p.metadata.docType = "book";
  p.links.href = ["http://127.0.0.1/private.pdf"];
  expect(yayindanEser("doab", p)?.pdfAdaylari).toEqual([]);
});
it("tam akış indekslenir; yeni süreçte aranır ve başarısız güncelleme önceki indeksi korur", async () => {
  const feed = JSON.stringify({ metadata: [{ numberOfItems: 1 }], publications: [yayin()] });
  vi.mocked(get).mockResolvedValueOnce(new Response(feed));
  const baslik = await katalogGuncelle("doab");
  const oncekiSurum = katalogSurumu("doab");
  expect(baslik).toMatchObject({ kayitSayisi: 1, okunan: 1, tam: true });
  const s = { baslik: "A World of Nourishment", tur: "kitap" as const, limit: 5 };
  const r = await katalogdaAra("doab", s);
  expect(r[0]?.pdf).toBe("https://publisher.org/book.pdf");
  r[0]!.baslik = "mutated";
  expect((await katalogdaAra("doab", s))[0]?.baslik).toBe(s.baslik);
  vi.mocked(get).mockResolvedValueOnce(new Response(feed.slice(0, -5)));
  await expect(katalogGuncelle("doab")).rejects.toThrow();
  expect(katalogSurumu("doab")).toBe(oncekiSurum);
  expect((await katalogdaAra("doab", s))[0]?.baslik).toBe(s.baslik);
  expect(
    (await fs.readdir(path.dirname(katalogYolu("doab")))).some((f) => f.endsWith(".part")),
  ).toBe(false);
});
it("üstveri toplamına uymayan kısmi akış tam indeks diye yayımlanmaz", async () => {
  vi.mocked(get).mockResolvedValueOnce(
    new Response(JSON.stringify({ metadata: [{ numberOfItems: 2 }], publications: [yayin()] })),
  );
  await expect(katalogGuncelle("doab")).rejects.toThrow("eksik");
  await expect(fs.stat(katalogYolu("doab"))).rejects.toThrow();
});
it("başarılı yeni indeks eski bellek sonucunu ve kaynak önbellek sürümünü değiştirir", async () => {
  const feed = (ad: string) =>
    JSON.stringify({ metadata: [{ numberOfItems: 1 }], publications: [yayin(ad)] });
  vi.mocked(get).mockResolvedValueOnce(new Response(feed("First Original Title")));
  await katalogGuncelle("doab");
  const surum = katalogSurumu("doab");
  expect(
    (await katalogdaAra("doab", { baslik: "First Original Title", tur: "kitap", limit: 5 }))[0]
      ?.baslik,
  ).toBe("First Original Title");
  vi.mocked(get).mockResolvedValueOnce(new Response(feed("Replacement Completely Different")));
  await katalogGuncelle("doab");
  expect(katalogSurumu("doab")).not.toBe(surum);
  expect(
    (
      await katalogdaAra("doab", {
        baslik: "Replacement Completely Different",
        tur: "kitap",
        limit: 5,
      })
    )[0]?.baslik,
  ).toBe("Replacement Completely Different");
});
it("indeks eksikse açıklayıcı kurulum komutu döner", async () => {
  expect(kaynakHazirligi(doab)).toMatchObject({
    hazir: false,
    hata: expect.stringContaining("sources:sync -- doab"),
  });
  await expect(katalogdaAra("oapen", { baslik: "Book", tur: "kitap", limit: 5 })).rejects.toThrow(
    "sources:sync -- oapen",
  );
});
it("aynı DOI bildirilse bile kitap ve kitap bölümü tek eser diye birleştirilmez", () => {
  const kitap = yayindanEser("doab", yayin())!,
    bolum = yayindanEser("doab", yayin("A World of Nourishment", "chapter"))!;
  expect(grupla([kitap, bolum], { baslik: kitap.baslik, tur: "kitap", limit: 5 })).toHaveLength(2);
});
