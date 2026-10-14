import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ayar } from "../src/config.js";
import { ara } from "../src/search.js";
import { onbellekli, onbellekTemizle } from "../src/cache.js";
import { kaynaklariYukle } from "../src/registry.js";

vi.mock("../src/registry.js", () => ({ kaynaklariYukle: vi.fn(), yuklenmeHataListesi: () => [] }));
const oncekiDizin = ayar.cacheDir;
let dizin: string;
beforeEach(async () => {
  dizin = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-search-cache-test-"));
  ayar.cacheDir = dizin;
});
afterEach(async () => {
  vi.resetAllMocks();
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(dizin));
  if (
    !relative.startsWith("kaynak-bul-search-cache-test-") ||
    relative.includes("..") ||
    path.isAbsolute(relative)
  )
    throw new Error("Test dizini sınır dışında");
  try {
    await onbellekTemizle();
  } finally {
    ayar.cacheDir = oncekiDizin;
  }
});

it("eski kuralla birleştirilmiş disk sonucunu atlar, düzeltilmiş sonucu önbelleğe alır", async () => {
  const sorgu = { baslik: "Data Structures", yil: 2020, tur: "kitap" as const, limit: 20 };
  await onbellekli("arama:kitap:data structures::2020:20", async () => ({
    gruplar: [{ baslik: "stale merged result" }],
  }));
  const arama = vi.fn().mockResolvedValue([
    {
      kaynak: "a",
      kaynakAd: "A",
      tur: "kitap",
      baslik: "Data Structures",
      yazarlar: ["Alice Smith"],
      yil: 2020,
      link: "https://example.test/a",
    },
    {
      kaynak: "b",
      kaynakAd: "B",
      tur: "kitap",
      baslik: "Data Structures",
      yazarlar: ["Bob Jones"],
      yil: 2020,
      link: "https://example.test/b",
    },
  ]);
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "test", ad: "Test", tur: ["kitap"], ara: arama },
  ]);
  const sonuc = await ara(sorgu);
  expect(sonuc.gruplar).toHaveLength(2);
  expect(sonuc.gruplar.every((g) => g.baslik === "Data Structures")).toBe(true);
  expect(await ara(sorgu)).toEqual(sonuc);
  expect(arama).toHaveBeenCalledTimes(1);
});
