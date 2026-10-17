import { beforeEach, afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isbnDogrula, isbnKitabi } from "../src/isbn.js";
import { getJson } from "../src/http.js";
import { ayar } from "../src/config.js";
import { onbellekTemizle } from "../src/cache.js";

vi.mock("../src/http.js", async (original) => ({
  ...(await original<typeof import("../src/http.js")>()),
  getJson: vi.fn(),
}));
let temp: string;
const eski = ayar.cacheDir;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-isbn-test-"));
  ayar.cacheDir = temp;
});
afterEach(async () => {
  vi.clearAllMocks();
  const rel = path.relative(os.tmpdir(), temp);
  if (!rel.startsWith("kaynak-bul-isbn-test-") || rel.includes("..") || path.isAbsolute(rel))
    throw Error("Dizin sınır dışında");
  await onbellekTemizle();
  ayar.cacheDir = eski;
});
it.each([
  ["9780131103627", "9780131103627"],
  ["0-13-110362-8", "9780131103627"],
  [" 978-0-306-40615-7 ", "9780306406157"],
  ["0-8044-2957-X", "9780804429573"],
])("geçerli %s numarası 13 haneye dönüşür", (a, b) => expect(isbnDogrula(a)).toBe(b));
it.each([
  "9780131103628",
  "0131103629",
  "123",
  "../../internal",
  "http://127.0.0.1",
  "0000000000000",
  null,
  9780131103627,
])("geçersiz ISBN %s reddedilir", (a) => expect(isbnDogrula(a)).toBeNull());
it("katalog verisini tek istekle alır, yılı kayıttan okur ve tekrar kullanır", async () => {
  vi.mocked(getJson).mockResolvedValue({
    "ISBN:9780131103627": {
      title: "The C Programming Language",
      authors: [{ name: "Brian Kernighan" }],
      publish_date: "April 1988",
      edition_name: "Second edition",
      number_of_pages: 274,
      publishers: [{ name: "Prentice Hall" }],
    },
  });
  const r = await isbnKitabi("9780131103627");
  expect(r.eser).toMatchObject({
    baslik: "The C Programming Language",
    yil: 1988,
    yazarlar: ["Brian Kernighan"],
    sayfaSayisi: 274,
  });
  expect(r.eser.kaynaklar[0]).toMatchObject({
    isbn: "9780131103627",
    yayinci: "Prentice Hall",
    erisim: "yonlendir",
  });
  expect(r.eser.kaynaklar[0]?.pdf).toBeUndefined();
  await isbnKitabi("9780131103627");
  expect(getJson).toHaveBeenCalledTimes(1);
  const u = new URL(vi.mocked(getJson).mock.calls[0]![0]);
  expect(u.hostname).toBe("openlibrary.org");
  expect(u.searchParams.get("bibkeys")).toBe("ISBN:9780131103627");
});
it("bulunamayan ISBN'i başarılı kayıt veya PDF gibi sunmaz", async () => {
  vi.mocked(getJson).mockResolvedValue({});
  await expect(isbnKitabi("9780131103627")).rejects.toMatchObject({ durum: 404 });
});
it("eksik yazar veya yılı uydurmaz", async () => {
  vi.mocked(getJson).mockResolvedValue({ "ISBN:9780131103627": { title: "Known title" } });
  const r = await isbnKitabi("9780131103627");
  expect(r.eser.yil).toBeUndefined();
  expect(r.eser.yazarlar).toEqual([]);
});
