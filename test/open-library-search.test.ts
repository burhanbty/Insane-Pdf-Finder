import { afterEach, expect, it, vi } from "vitest";
import source from "../src/sources/open-library.js";
import { getJson } from "../src/http.js";
import { isbnKitabi } from "../src/isbn.js";
import type { Gruplanmis } from "../src/types.js";
vi.mock("../src/http.js", () => ({ getJson: vi.fn() }));
vi.mock("../src/isbn.js", () => ({ isbnKitabi: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const s = { baslik: "Calcullus", tur: "kitap" as const, limit: 20 };
it("boş başlık aramasında yalnızca bir yakın yazım sorgusu yapar", async () => {
  vi.mocked(getJson)
    .mockResolvedValueOnce({ docs: [] })
    .mockResolvedValueOnce({ docs: [{ title: "Calculus", key: "/works/OL1W" }] });
  const r = await source.ara(s);
  expect(r[0]?.baslik).toBe("Calculus");
  expect(getJson).toHaveBeenCalledTimes(2);
  const u = new URL(vi.mocked(getJson).mock.calls[1]![0]);
  expect(u.searchParams.get("q")).toBe("title:(Calcullus~1)");
  expect(u.searchParams.get("limit")).toBe("5");
});
it("ağ hatasını boş sonuç gibi yorumlayıp başka sorguya geçmez", async () => {
  vi.mocked(getJson).mockRejectedValueOnce(new Error("HTTP 429"));
  await expect(source.ara(s)).rejects.toThrow("429");
  expect(getJson).toHaveBeenCalledTimes(1);
});
it("birden çok baskının ilk ISBN/dil/yayınevini tek baskı gibi uydurmaz", async () => {
  vi.mocked(getJson).mockResolvedValueOnce({
    docs: [
      {
        title: "Calculus",
        key: "/works/OL1W",
        isbn: ["9780131103627", "9780306406157"],
        language: ["eng", "tur"],
        publisher: ["A", "B"],
      },
    ],
  });
  const [r] = await source.ara(s);
  expect(r?.isbn).toBeUndefined();
  expect(r?.dil).toBeUndefined();
  expect(r?.yayinci).toBeUndefined();
  expect(getJson).toHaveBeenCalledTimes(1);
});
it("ISBN belirtilince doğrudan o baskının katalog kaydını getirir", async () => {
  const kayit = { baslik: "Calculus", isbn: "9780131103627", baski: "2" };
  vi.mocked(isbnKitabi).mockResolvedValue({
    isbn: "9780131103627",
    eser: { kaynaklar: [kayit] } as Gruplanmis,
  });
  expect(await source.ara({ ...s, isbn: "9780131103627" })).toEqual([kayit]);
  expect(isbnKitabi).toHaveBeenCalledWith("9780131103627");
  expect(getJson).not.toHaveBeenCalled();
});
