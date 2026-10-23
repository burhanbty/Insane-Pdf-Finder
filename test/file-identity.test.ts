import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { kimligiKarsilastir, kimlikGirdisi } from "../src/file-identity.js";
import { indir } from "../src/download.js";
import { ayar } from "../src/config.js";
import { testPdf } from "./helpers/pdf.js";

const kimlik = {
  baslik: "Understanding Neural Network Models",
  yazarlar: ["Jane Smith"],
  doi: "10.1234/neural",
};
describe("dosya kimliği kanıtları", () => {
  it("başlık ve yazar kanıtıyla doğrular; imza ve tek kelimelik başlık yetmez", () => {
    expect(kimligiKarsilastir(kimlik, kimlik.baslik, `${kimlik.baslik} Jane Smith`).durum).toBe(
      "dogrulandi",
    );
    expect(kimligiKarsilastir(kimlik, "", "").durum).toBe("belirsiz");
    expect(kimligiKarsilastir({ baslik: "Physics" }, "Physics", "Physics").durum).toBe("belirsiz");
  });
  it("kaynakçadaki DOI/yazar, yanlış PDF başlığını doğrulamaz", () => {
    expect(
      kimligiKarsilastir(
        kimlik,
        "A Different Research Paper",
        `References ${kimlik.baslik} Jane Smith DOI: 10.1234/neural`,
      ).durum,
    ).toBe("uyusmuyor");
    expect(
      kimligiKarsilastir(
        kimlik,
        kimlik.baslik,
        `${kimlik.baslik} References Jane Smith DOI: 10.1234/neural`,
      ).durum,
    ).toBe("belirsiz");
  });
  it("ISBN ve baskı çelişkisini reddeder, eksik baskı kanıtını belirsiz tutar", () => {
    const k = { ...kimlik, isbn: "9780131103627", baski: "2" };
    expect(
      kimligiKarsilastir(k, kimlik.baslik, `${kimlik.baslik} Jane Smith ISBN: 9780262033848`).durum,
    ).toBe("uyusmuyor");
    expect(
      kimligiKarsilastir(k, kimlik.baslik, `${kimlik.baslik} Jane Smith 3rd edition`).durum,
    ).toBe("uyusmuyor");
    expect(kimligiKarsilastir(k, kimlik.baslik, `${kimlik.baslik} Jane Smith`).durum).toBe(
      "belirsiz",
    );
    expect(
      kimligiKarsilastir(
        k,
        kimlik.baslik,
        `${kimlik.baslik} Jane Smith ISBN: 9780131103627 2nd edition`,
      ).durum,
    ).toBe("dogrulandi");
  });
  it("önizleme veya kitap eleştirisini tam eser gibi doğrulamaz", () => {
    expect(
      kimligiKarsilastir(kimlik, kimlik.baslik, `Book review ${kimlik.baslik} Jane Smith`).durum,
    ).toBe("belirsiz");
  });
  it("dağınık konu kelimeleri ile yazarı bir başlık eşleşmesi saymaz", () => {
    const metin =
      kimlik.baslik.split(" ").join(" many unrelated words fill the page before ") + " Smith";
    expect(kimligiKarsilastir(kimlik, "", metin).durum).toBe("belirsiz");
  });
  it("API kimliğinde tip, uzunluk ve ISBN denetimini uygular", () => {
    expect(kimlikGirdisi(undefined)).toBeUndefined();
    expect(() => kimlikGirdisi({ baslik: "x", yazarlar: [123] })).toThrow();
    expect(() => kimlikGirdisi({ baslik: "x", isbn: "fake" })).toThrow();
    expect(() => kimlikGirdisi({ baslik: "x", doi: "bad" })).toThrow();
  });
  it("ön künyede açık DOI çelişkisini reddeder", () => {
    expect(
      kimligiKarsilastir(kimlik, kimlik.baslik, `${kimlik.baslik} Jane Smith DOI: 10.1234/wrong`)
        .durum,
    ).toBe("uyusmuyor");
  });
});

describe("gerçek PDF parser ile alternatif indirme", () => {
  let dir: string;
  const eski = ayar.downloadsDir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "identity-test-"));
    ayar.downloadsDir = dir;
  });
  afterEach(async () => {
    ayar.downloadsDir = eski;
    vi.unstubAllGlobals();
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("identity-test-")
    )
      throw Error("Geçersiz test dizini");
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("ilk PDF yanlış eserse ikinci kopyayı indirir; reddedilen dosya/part kalmaz", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (u: URL) =>
          new Response(
            String(u).includes("wrong")
              ? testPdf("A Different Research Paper", "Unrelated author")
              : testPdf(kimlik.baslik, `${kimlik.baslik} Jane Smith`),
          ),
      ),
    );
    const r = await indir(
      {
        url: "https://identity.test/wrong.pdf",
        varsayilanAd: "paper",
        kimlik,
        alternatifler: ["https://identity.test/right.pdf"],
      },
      "pdf",
    );
    expect(r.dogrulama).toMatchObject({ durum: "dogrulandi", sayfaSayisi: 1, incelenenSayfa: 1 });
    expect(r.kopyaDenemesi).toBe(2);
    expect(await fs.readdir(dir)).toEqual([r.dosya]);
  });
  it("bozuk PDF imzasında durmaz; sonraki açılabilir dosyayı dener", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (u: URL) =>
          new Response(
            String(u).includes("broken")
              ? "%PDF-not a valid file"
              : testPdf(kimlik.baslik, `${kimlik.baslik} Jane Smith`),
          ),
      ),
    );
    const r = await indir(
      {
        url: "https://identity.test/broken.pdf",
        varsayilanAd: "paper",
        kimlik,
        alternatifler: ["https://identity.test/ok.pdf"],
      },
      "pdf",
    );
    expect(r.kopyaDenemesi).toBe(2);
    expect(r.dogrulama?.durum).toBe("dogrulandi");
  });
  it("açılabilir ama metinsiz dosyayı belirsiz diye gösterir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(testPdf("", ""))),
    );
    const r = await indir(
      { url: "https://identity.test/scanned.pdf", varsayilanAd: "paper", kimlik },
      "pdf",
    );
    expect(r.dogrulama?.durum).toBe("belirsiz");
    expect(await fs.readdir(dir)).toEqual([r.dosya]);
  });
  it("bütün kopyalar yanlışsa dosya yayımlamaz", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(testPdf("Another Completely Different Work", "Nobody"))),
    );
    await expect(
      indir({ url: "https://identity.test/allbad.pdf", varsayilanAd: "paper", kimlik }, "pdf"),
    ).rejects.toThrow("uyuşmuyor");
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
