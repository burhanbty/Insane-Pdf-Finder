import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ayar } from "../src/config.js";
import { onbellekTemizle } from "../src/cache.js";
import { doiAnahtari } from "../src/doi.js";
import { pdfAdaylariniBirlestir } from "../src/pdf-candidates.js";
import { doiIcinPdfAdaylari, tamMetniZenginlestir } from "../src/fulltext.js";
import { getJson, KaynakHatasi } from "../src/http.js";
import { ara } from "../src/search.js";
import { kaynaklariYukle } from "../src/registry.js";
import openalex from "../src/sources/openalex.js";
import type { Work } from "../src/types.js";

vi.mock("../src/http.js", async (original) => ({
  ...(await original<typeof import("../src/http.js")>()),
  getJson: vi.fn(),
}));
vi.mock("../src/registry.js", () => ({ kaynaklariYukle: vi.fn(), yuklenmeHataListesi: () => [] }));
const onceki = {
  contactEmail: ayar.contactEmail,
  cacheDir: ayar.cacheDir,
  unpaywallEmail: ayar.unpaywallEmail,
  openalexKey: ayar.openalexKey,
  tamMetinTimeoutMs: ayar.tamMetinTimeoutMs,
  tamMetinDoiLimiti: ayar.tamMetinDoiLimiti,
};
let temp: string;
const eser = (doi = "10.1234/shared", kaynak = "crossref"): Work => ({
  kaynak,
  kaynakAd: kaynak,
  tur: "makale",
  baslik: "Shared Research",
  yazarlar: ["Jane Doe"],
  yil: 2024,
  doi,
  link: `https://example.org/${kaynak}`,
});
const yanit = (doi = "10.1234/shared") => ({
  doi,
  best_oa_location: {
    url_for_pdf: "https://publisher.org/paper.pdf",
    license: "cc-by",
    version: "publishedVersion",
  },
  oa_locations: [
    { url_for_pdf: "https://publisher.org/paper.pdf" },
    {
      url_for_pdf: "https://repository.org/accepted.pdf",
      license: "cc-by-nc",
      version: "acceptedVersion",
      host_type: "repository",
    },
    { url_for_pdf: "http://127.0.0.1/private.pdf" },
    { url_for_pdf: "javascript:alert(1)" },
  ],
});
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-fulltext-"));
  ayar.cacheDir = temp;
  ayar.unpaywallEmail = "contact@example.org";
  ayar.contactEmail = "";
  ayar.openalexKey = "";
  ayar.tamMetinTimeoutMs = 2000;
  ayar.tamMetinDoiLimiti = 8;
  vi.mocked(getJson).mockReset();
  vi.mocked(kaynaklariYukle).mockReset();
});
afterEach(async () => {
  await onbellekTemizle();
  Object.assign(ayar, onceki);
  vi.restoreAllMocks();
});

describe("DOI kimliği", () => {
  it.each([
    "10.1234/ABC",
    "doi: 10.1234/ABC",
    "https://doi.org/10.1234%2FABC",
    "https://dx.doi.org/10.1234/ABC",
  ])("%s normalize edilir", (s) => expect(doiAnahtari(s)).toBe("10.1234/abc"));
  it.each([
    "",
    "not a doi",
    "https://evil.org/10.1234/x",
    "10.1/x",
    "10.1234/a b",
    "https://doi.org/10.1234/a?redirect=evil",
  ])("geçersiz %s reddedilir", (s) => expect(doiAnahtari(s)).toBeUndefined());
});
it("bütün alternatifleri tutar; aynı URL tek kalır ve lisans/sürüm kanıtı korunur", async () => {
  vi.mocked(getJson).mockResolvedValue(yanit());
  const [a, b] = await Promise.all([
    doiIcinPdfAdaylari("10.1234/shared"),
    doiIcinPdfAdaylari("https://doi.org/10.1234/shared"),
  ]);
  expect(getJson).toHaveBeenCalledTimes(1);
  expect(a).toEqual(b);
  expect(a).toHaveLength(2);
  expect(a[1]).toMatchObject({
    url: "https://repository.org/accepted.pdf",
    lisans: "cc-by-nc",
    surum: "acceptedVersion",
    hostTuru: "repository",
    durum: "aday",
  });
  await doiIcinPdfAdaylari("10.1234/shared");
  expect(getJson).toHaveBeenCalledTimes(1);
});
it("e-posta yokken uzak çağrı yapmaz; mevcut PDF alternatifleri kalır", async () => {
  ayar.unpaywallEmail = "";
  const w = { ...eser(), pdf: "https://publisher.org/original.pdf" };
  const d = await tamMetniZenginlestir([w]);
  expect(d.hazir).toBe(false);
  expect(w.pdf).toBe("https://publisher.org/original.pdf");
  expect(getJson).not.toHaveBeenCalled();
});
it("Unpaywall'a özel e-posta diğer kaynakların User-Agent ve OpenAlex sorgusuna taşınmaz", async () => {
  expect(ayar.userAgent()).not.toContain("contact@example.org");
  vi.mocked(getJson).mockResolvedValue({ results: [] });
  await openalex.ara({ baslik: "Research", tur: "makale", limit: 5 });
  expect(String(vi.mocked(getJson).mock.calls[0]?.[0])).not.toContain("mailto");
});
it("başka DOI'nin PDF'sini esere bağlamaz; hata sonucu yeniden denenir", async () => {
  vi.mocked(getJson).mockResolvedValueOnce(yanit("10.1234/wrong")).mockResolvedValueOnce(yanit());
  await expect(doiIcinPdfAdaylari("10.1234/shared")).rejects.toThrow("eşleşmiyor");
  expect(await doiIcinPdfAdaylari("10.1234/shared")).toHaveLength(2);
  expect(getJson).toHaveBeenCalledTimes(2);
});
it("Unpaywall yalnızca OA kayıt sayfası bildirirse adayı korur ve doğrudan PDF diye etiketlemez", async () => {
  vi.mocked(getJson).mockResolvedValue({
    doi: "10.1234/shared",
    oa_locations: [{ url_for_landing_page: "https://publisher.org/article", license: "cc-by" }],
  });
  const w = eser();
  const d = await tamMetniZenginlestir([w]);
  expect(d.hatalar).toEqual([]);
  expect(w.pdf).toBeUndefined();
  expect(w.erisim).toBe("acik");
  expect(w.pdfAdaylari).toEqual([
    expect.objectContaining({
      url: "https://publisher.org/article",
      baglantiTuru: "kayit",
      durum: "aday",
    }),
  ]);
});
it("404 olumsuz sonucu önbelleklenir, kota/ağ hatası başarı diye saklanmaz", async () => {
  vi.mocked(getJson).mockRejectedValueOnce(new KaynakHatasi("http", "404", 404));
  expect(await doiIcinPdfAdaylari("10.1234/missing")).toEqual([]);
  expect(await doiIcinPdfAdaylari("10.1234/missing")).toEqual([]);
  expect(getJson).toHaveBeenCalledTimes(1);
  vi.mocked(getJson)
    .mockRejectedValueOnce(new KaynakHatasi("http", "429", 429))
    .mockResolvedValueOnce(yanit());
  await expect(doiIcinPdfAdaylari("10.1234/shared")).rejects.toThrow("429");
  expect(await doiIcinPdfAdaylari("10.1234/shared")).toHaveLength(2);
});
it("farklı kaynakların ortak DOI'sini tek çözer; eski PDF'yi ve bütün künyeleri korur", async () => {
  vi.mocked(getJson).mockResolvedValue(yanit());
  const a = { ...eser(), pdf: "https://existing.org/a.pdf" },
    b = eser("10.1234/shared", "semantic-scholar");
  const d = await tamMetniZenginlestir([a, b]);
  expect(getJson).toHaveBeenCalledTimes(1);
  expect(d).toMatchObject({ planlanan: 1, tamamlanan: 1, hatalar: [] });
  expect(a.pdf).toBe("https://existing.org/a.pdf");
  expect(a.pdfAdaylari).toHaveLength(3);
  expect(b.pdfAdaylari).toHaveLength(2);
  expect(a.baslik).toBe("Shared Research");
});
it("tam metin süresi dolunca künye ve mevcut PDF kaybolmaz", async () => {
  ayar.tamMetinTimeoutMs = 25;
  vi.mocked(getJson).mockImplementation(() => new Promise(() => undefined));
  const w = { ...eser(), pdf: "https://existing.org/a.pdf" };
  const d = await tamMetniZenginlestir([w]);
  expect(d.hatalar[0]?.mesaj).toContain("yanıt vermedi");
  expect(w.pdf).toBe("https://existing.org/a.pdf");
  expect(w.baslik).toBe("Shared Research");
});
it("DOI bütçesini aşmaz; ödünç eseri açık kopya diye yeniden etiketlemez", async () => {
  ayar.tamMetinDoiLimiti = 1;
  vi.mocked(getJson).mockResolvedValue(yanit());
  const odunc = { ...eser(), erisim: "odunc" as const };
  await tamMetniZenginlestir([odunc, eser(), eser("10.1234/second")]);
  expect(getJson).toHaveBeenCalledTimes(1);
  expect(odunc.erisim).toBe("odunc");
  expect(odunc.pdf).toBeUndefined();
});
it("arama katmanı OpenAlex olmadan DOI çözer ve kaynak önbelleğine mutasyon yazmaz", async () => {
  vi.mocked(getJson).mockResolvedValue(yanit());
  const w = eser();
  const kaynak = vi.fn().mockResolvedValue([w]);
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "crossref", ad: "Crossref", tur: ["makale"], ara: kaynak },
  ]);
  const r = await ara({ baslik: w.baslik, tur: "makale", limit: 5 });
  expect(r.gruplar[0]?.kaynaklar[0]?.pdfAdaylari).toHaveLength(2);
  expect(w.pdfAdaylari).toBeUndefined();
  expect(kaynak).toHaveBeenCalledTimes(1);
  expect(getJson).toHaveBeenCalledTimes(1);
});
it("e-posta etkinleştirilince eski arama önbelleği çözümlemeyi engellemez", async () => {
  const w = eser();
  vi.mocked(getJson).mockResolvedValue(yanit());
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "x", ad: "X", tur: ["makale"], ara: async () => [w] },
  ]);
  const s = { baslik: w.baslik, tur: "makale" as const, limit: 5 };
  ayar.unpaywallEmail = "";
  expect((await ara(s)).gruplar[0]?.kaynaklar[0]?.pdf).toBeUndefined();
  ayar.unpaywallEmail = "contact@example.org";
  expect((await ara(s)).gruplar[0]?.kaynaklar[0]?.pdf).toBe("https://publisher.org/paper.pdf");
});
it("başarısız DOI zenginleştirmesi arama önbelleğini zehirlemez; sağlam kaynak tekrar çağrılmaz", async () => {
  const w = eser();
  const kaynak = vi.fn().mockResolvedValue([w]);
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "crossref", ad: "Crossref", tur: ["makale"], ara: kaynak },
  ]);
  vi.mocked(getJson)
    .mockRejectedValueOnce(new KaynakHatasi("http", "429", 429))
    .mockResolvedValueOnce(yanit());
  const s = { baslik: w.baslik, tur: "makale" as const, limit: 5 };
  const ilk = await ara(s);
  expect(ilk.gruplar).toHaveLength(1);
  expect(ilk.tamMetinDurumu?.hatalar).toHaveLength(1);
  const ikinci = await ara(s);
  expect(ikinci.gruplar[0]?.kaynaklar[0]?.pdf).toBe("https://publisher.org/paper.pdf");
  expect(kaynak).toHaveBeenCalledTimes(1);
  expect(getJson).toHaveBeenCalledTimes(2);
});
it("OpenAlex bütün açık konumları okur; anahtarı yalnızca HTTP başlığına koyar", async () => {
  ayar.openalexKey = "private-key";
  vi.mocked(getJson).mockResolvedValue({
    results: [
      {
        display_name: "Shared Research",
        doi: "https://doi.org/10.1234/shared",
        open_access: { is_oa: true },
        best_oa_location: { pdf_url: "https://publisher.org/paper.pdf", license: "cc-by" },
        locations: [
          { pdf_url: "https://repo.org/a.pdf", is_oa: true, version: "acceptedVersion" },
          { pdf_url: "https://closed.org/paid.pdf", is_oa: false },
        ],
      },
    ],
  });
  const r = await openalex.ara({ baslik: "Shared Research", tur: "makale", limit: 5 });
  expect(r[0]?.pdfAdaylari).toHaveLength(2);
  expect(vi.mocked(getJson).mock.calls[0]?.[1]?.header).toEqual({
    authorization: "Bearer private-key",
  });
  expect(vi.mocked(getJson).mock.calls[0]?.[0]).not.toContain("private-key");
  expect(JSON.stringify(r)).not.toContain("private-key");
  expect(getJson).toHaveBeenCalledTimes(1);
});
it("aday adresi parçaları tekilleştirilir, tehlikeli URL'ler elenir", () => {
  expect(
    pdfAdaylariniBirlestir([
      { url: "https://repo.org/a.pdf#page=2", kaynak: "x", durum: "aday" },
      { url: "https://repo.org/a.pdf", kaynak: "y", lisans: "cc-by", durum: "aday" },
      { url: "https://user:pass@repo.org/a.pdf", kaynak: "y", durum: "aday" },
    ]),
  ).toEqual([
    expect.objectContaining({ url: "https://repo.org/a.pdf", kaynak: "x", lisans: "cc-by" }),
  ]);
});
it("eserin DOI'siyle açıkça çelişen kayıt adresini ve ikincil DOI'yi aday olarak bağlamaz", () => {
  expect(
    pdfAdaylariniBirlestir([
      {
        url: "https://doi.org/10.25504/fairsharing.246086",
        doi: "10.1038/s41586-021-03819-2",
        kaynak: "unpaywall",
        baglantiTuru: "kayit",
        durum: "aday",
      },
      {
        url: "https://repo.org/a.pdf",
        kayitUrl: "https://doi.org/10.1234/wrong",
        doi: "10.1234/expected",
        kaynak: "unpaywall",
        durum: "aday",
      },
      {
        url: "https://repo.org/good.pdf",
        doi: "10.1234/expected",
        kaynak: "unpaywall",
        durum: "aday",
      },
    ]),
  ).toEqual([expect.objectContaining({ url: "https://repo.org/good.pdf" })]);
});
