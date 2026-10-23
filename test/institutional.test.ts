import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  bilkentYanitiniCoz,
  kurumAramaKayitlari,
  kurumSayfasindanEser,
} from "../src/institutional.js";
import {
  arsiveKaydet,
  arsivIndeksYolu,
  yerelArsivdeAra,
  arsivIndeksSurumu,
} from "../src/institutional-index.js";
import { ayar } from "../src/config.js";
import type { Work } from "../src/types.js";

describe("üniversite arşiv künyeleri", () => {
  it("ODTÜ künye alanlarından tez/PDF çıkarır, yılı sorgudan uydurmaz", () => {
    const r = kurumSayfasindanEser(
      "openmetu",
      '<meta name="DC.title" content="Örnek Tez"><meta name="DC.creator" content="Yılmaz, Ali"><meta name="DC.type" content="Master Thesis"><meta name="citation_date" content="2024-05-01"><meta name="citation_pdf_url" content="https://open.metu.edu.tr/file.pdf">',
      "https://open.metu.edu.tr/handle/11511/123",
    );
    expect(r).toMatchObject({
      tur: "makale",
      belgeTuru: "tez",
      yil: 2024,
      yazarlar: ["Yılmaz, Ali"],
      pdf: "https://open.metu.edu.tr/file.pdf",
    });
    expect(
      kurumSayfasindanEser(
        "openmetu",
        "<html>Bot challenge</html>",
        "https://open.metu.edu.tr/handle/11511/123",
      ),
    ).toBeUndefined();
  });
  it("Sabancı DC başlık/yazar/DOI alanlarını çözer; dosyasız kayıt PDF değildir", () => {
    const r = kurumSayfasindanEser(
      "sabanci",
      '<meta name="DC.title" content="Neural models"><meta name="DC.creator" content="Jane Smith"><meta name="DC.relation" content="https://dx.doi.org/10.1234/test"><meta name="DC.type" content="Article">',
      "https://research.sabanciuniv.edu/id/eprint/12/",
    );
    expect(r).toMatchObject({ baslik: "Neural models", doi: "10.1234/test", erisim: "yonlendir" });
    expect(r?.pdf).toBeUndefined();
    expect(r?.yil).toBeUndefined();
  });
  it("ambargolu dosyayı açık erişim adayı olarak sunmaz", () => {
    const r = kurumSayfasindanEser(
      "openmetu",
      '<meta name="DC.title" content="Some Book"><meta name="DC.type" content="Book"><meta name="DC.rights" content="embargoedAccess"><meta name="citation_pdf_url" content="https://open.metu.edu.tr/hidden.pdf">',
      "https://open.metu.edu.tr/handle/11511/123",
    );
    expect(r).toMatchObject({ tur: "kitap", erisim: "sinirli", pdfAdaylari: [] });
    expect(r?.pdf).toBeUndefined();
  });
  it("arama sayfasından yalnızca kurumun kayıt bağlantılarını alır", () => {
    const html =
      '<a href="/handle/11511/123">Title &amp; Test</a><a href="https://evil.test/handle/11511/12">bad</a><a href="/handle/">home</a><!-- <a href="/handle/11511/66">fake</a> -->';
    expect(kurumAramaKayitlari("openmetu", html)).toEqual([
      { baslik: "Title & Test", link: "https://open.metu.edu.tr/handle/11511/123" },
    ]);
  });
  it("Bilkent DSpace kayıt türünü/DOI'yi korur; UUID ve silinen kayıtları denetler", () => {
    const object = (uuid: string, withdrawn = false) => ({
      _embedded: {
        indexableObject: {
          uuid,
          withdrawn,
          metadata: {
            "dc.title": [{ value: "Thesis on graphs" }],
            "dc.type": [{ value: "Thesis" }],
            "dc.identifier.doi": [{ value: "10.1234/graph" }],
          },
        },
      },
    });
    const sonuc = bilkentYanitiniCoz({
      _embedded: {
        searchResult: {
          _embedded: {
            objects: [
              object("1d9e98a7-c82c-426b-9149-a3ea274da54d"),
              object("../bad"),
              object("1d9e98a7-c82c-426b-9149-a3ea274da54f", true),
            ],
          },
        },
      },
    });
    expect(sonuc).toHaveLength(1);
    expect(sonuc[0]).toMatchObject({
      tur: "makale",
      belgeTuru: "tez",
      doi: "10.1234/graph",
      erisim: "yonlendir",
    });
    expect(() => bilkentYanitiniCoz({ error: "forbidden" })).toThrow();
    expect(
      bilkentYanitiniCoz({ _embedded: { searchResult: { page: { totalElements: 0 } } } }),
    ).toEqual([]);
  });
});

describe("yerel üniversite kelime indeksi", () => {
  const eski = ayar.dataDir;
  let dir: string;
  const w = (n: string, baslik: string, ozet = ""): Work => ({
    kaynak: "openmetu",
    kaynakAd: "OpenMETU",
    tur: "makale",
    baslik,
    yazarlar: ["Jane Smith"],
    link: `https://open.metu.edu.tr/handle/11511/${n}`,
    ozet,
  });
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "archives-test-"));
    ayar.dataDir = dir;
  });
  afterEach(async () => {
    ayar.dataDir = eski;
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("archives-test-")
    )
      throw Error("Geçersiz test dizini");
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("önce boş döner; gözlenen künye özetinden farklı konu sorgusuyla bulunur", async () => {
    const s = { baslik: "graph algorithms", tur: "makale" as const, limit: 10 };
    expect(arsivIndeksSurumu()).toBe("v1:yok");
    expect(await yerelArsivdeAra(s)).toEqual([]);
    await arsiveKaydet([
      w("1", "Routing in Complex Networks", "We study graph algorithms and routing"),
    ]);
    const r = await yerelArsivdeAra(s);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kaynak: "yerel-arsiv", arsivGorulmeZamani: expect.any(String) });
    expect(await yerelArsivdeAra({ ...s, tur: "kitap" })).toEqual([]);
    expect(r[0]?.pdf).toBeUndefined();
  });
  it("eşzamanlı eklemelerde kayıt kaybetmez; aynı URL'yi günceller, DOI çelişkili farklı URL'yi korur", async () => {
    await Promise.all([
      arsiveKaydet([w("1", "Graph algorithms")]),
      arsiveKaydet([w("2", "Graph algorithms")]),
    ]);
    await arsiveKaydet([{ ...w("1", "Graph algorithms updated"), doi: "10.1234/one" }]);
    const r = await yerelArsivdeAra({ baslik: "graph algorithms", tur: "makale", limit: 20 });
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.link.endsWith("/1"))?.baslik).toBe("Graph algorithms updated");
    expect(
      (await fs.readdir(path.dirname(arsivIndeksYolu()))).some((x) => x.endsWith(".part")),
    ).toBe(false);
  });
  it("bozuk yerel indeksi sessizce sıfırlamaz ve canlı sonuçları kaybettirmez", async () => {
    await fs.mkdir(path.dirname(arsivIndeksYolu()), { recursive: true });
    await fs.writeFile(arsivIndeksYolu(), "broken");
    await expect(yerelArsivdeAra({ baslik: "graph", tur: "makale", limit: 10 })).rejects.toThrow();
    await arsiveKaydet([w("2", "Graph methods")]);
    expect(await fs.readFile(arsivIndeksYolu(), "utf8")).toBe("broken");
  });
});
