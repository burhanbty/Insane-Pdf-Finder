import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import kaynak from "../src/sources/openaire.js";
import { get } from "../src/http.js";

vi.mock("../src/http.js", () => ({ get: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const sorgu = { baslik: "Attention Is All You Need", tur: "makale" as const, limit: 5 };
const zarf = (ek: Record<string, unknown> = {}) => ({
  metadata: {
    "oaf:entity": {
      "oaf:result": {
        title: { $: "Test paper" },
        creator: { $: "Author" },
        bestaccessright: { "@classid": "OPEN" },
        ...ek,
      },
    },
  },
});
function cevap(veri: unknown) {
  vi.mocked(get).mockResolvedValue(Response.json(veri));
}
function kayitCevabi(ek: Record<string, unknown> = {}) {
  cevap({ response: { results: { result: [zarf(ek)] } } });
}

describe("OpenAIRE gerçek yanıt şeması ve URL seçimi", () => {
  it("canlı API'den kaydedilen iç içe zarfı çözümler", async () => {
    cevap(
      JSON.parse(
        await fs.readFile(new URL("./fixtures/openaire-live.json", import.meta.url), "utf8"),
      ),
    );
    const sonuclar = await kaynak.ara(sorgu);
    expect(sonuclar.map((s) => s.baslik)).toEqual([
      "Attention Is All You Need",
      "Not All Attention Is All You Need",
    ]);
    expect(sonuclar[0]!.yazarlar).toContain("Ashish Vaswani");
    expect(sonuclar.every((s) => /^https?:\/\//.test(s.link))).toBe(true);
  });

  it("tek kayıt nesnesini ve tek yaratıcıyı destekler", async () => {
    cevap({ response: { results: { result: zarf() } } });
    expect((await kaynak.ara(sorgu))[0]!.yazarlar).toEqual(["Author"]);
  });

  it("gerçek boş yanıtı boş liste olarak döndürür", async () => {
    cevap({ response: { results: { result: [] } } });
    expect(await kaynak.ara(sorgu)).toEqual([]);
    cevap({ response: { header: { total: { $: 0 } } } });
    expect(await kaynak.ara(sorgu)).toEqual([]);
  });

  it("dolu ama tanınmayan kaydı sessizce boş sonuç yapmaz", async () => {
    cevap({ response: { results: { result: [{ unexpected: true }] } } });
    await expect(kaynak.ara(sorgu)).rejects.toThrow("OpenAIRE");
  });

  it("instance URL'sini DOI yerine seçer", async () => {
    kayitCevabi({
      pid: { "@classid": "doi", $: "10.1234/example" },
      children: {
        instance: {
          accessright: { "@classid": "OPEN" },
          webresource: { url: { $: "https://repo.test/paper.pdf" } },
        },
      },
    });
    const [s] = await kaynak.ara(sorgu);
    expect(s!.link).toBe("https://repo.test/paper.pdf");
    expect(s!.pdf).toBe("https://repo.test/paper.pdf");
    expect(s!.doi).toBe("10.1234/example");
  });

  it("PID olmadan instance URL'sini korur ve URL dizilerini destekler", async () => {
    kayitCevabi({
      children: {
        instance: {
          accessright: { "@classid": "OPEN" },
          webresource: [
            { url: { $: "javascript:alert(1)" } },
            {
              url: [
                { $: "https://repo.test/record" },
                { $: "https://repo.test/file.PDF?download=1" },
              ],
            },
          ],
        },
      },
    });
    const [s] = await kaynak.ara(sorgu);
    expect(s!.link).toBe("https://repo.test/record");
    expect(s!.pdf).toBe("https://repo.test/file.PDF?download=1");
  });

  it("yalnızca HTTP PID'yi yedek link yapar, landing page'i PDF saymaz", async () => {
    kayitCevabi({
      pid: [{ "@classid": "arXiv", $: 1706.03762 }, { $: "https://repo.test/record" }],
    });
    const [s] = await kaynak.ara(sorgu);
    expect(s!.link).toBe("https://repo.test/record");
    expect(s!.pdf).toBeUndefined();
  });

  it("kapalı erişim instance'ını indirilebilir PDF yapmaz", async () => {
    kayitCevabi({
      children: {
        instance: {
          accessright: { "@classid": "CLOSED" },
          url: { $: "https://repo.test/file.pdf" },
        },
      },
    });
    const [s] = await kaynak.ara(sorgu);
    expect(s!.link).toBe("https://repo.test/file.pdf");
    expect(s!.pdf).toBeUndefined();
  });
});
