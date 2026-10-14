import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { ayar } from "../src/config.js";
import { onbellekli, onbellekTemizle } from "../src/cache.js";
import { sayfaSayisiOgren } from "../src/sayfa.js";
import { get } from "../src/http.js";

vi.mock("../src/http.js", () => ({ get: vi.fn() }));
const oncekiDizin = ayar.cacheDir;
let dizin: string;
beforeEach(async () => {
  dizin = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-cache-test-"));
  ayar.cacheDir = dizin;
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(dizin));
  if (
    !relative.startsWith("kaynak-bul-cache-test-") ||
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

describe("zorla önbellek yenileme", () => {
  it("normal çağrıda belleği kullanır, zorlamada yeni değeri üretip belleğe yazar", async () => {
    const key = randomUUID();
    const uret = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("fresh");
    expect(await onbellekli(key, uret, { disk: false })).toBe("old");
    expect(await onbellekli(key, uret, { disk: false })).toBe("old");
    expect(await onbellekli(key, uret, { disk: false, zorlaGuncelle: true })).toBe("fresh");
    expect(await onbellekli(key, uret, { disk: false })).toBe("fresh");
    expect(uret).toHaveBeenCalledTimes(2);
  });

  it("yenilenen değer diskten de okunur", async () => {
    const key = randomUUID();
    const uret = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("fresh");
    await onbellekli(key, uret);
    expect(await onbellekli(key, uret, { zorlaGuncelle: true })).toBe("fresh");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60 * 1000);
    expect(await onbellekli(key, uret)).toBe("fresh");
    expect(uret).toHaveBeenCalledTimes(2);
  });

  it("zorla yenileme hatasını bildirir ve önceki iyi değeri korur", async () => {
    const key = randomUUID();
    const uret = vi.fn().mockResolvedValueOnce("old").mockRejectedValueOnce(new Error("offline"));
    await onbellekli(key, uret);
    await expect(onbellekli(key, uret, { zorlaGuncelle: true })).rejects.toThrow("offline");
    expect(await onbellekli(key, uret)).toBe("old");
  });

  it("sayfa modülünün zorla yenilemesi ikinci ağ çağrısını yapar", async () => {
    vi.mocked(get)
      .mockResolvedValueOnce(new Response("one", { headers: { "content-type": "text/plain" } }))
      .mockResolvedValueOnce(
        new Response("one two three", { headers: { "content-type": "text/plain" } }),
      );
    const url = `https://refresh.test/${randomUUID()}.txt`;
    expect((await sayfaSayisiOgren(url)).not).toContain("1 kelime");
    expect((await sayfaSayisiOgren(url, { zorlaGuncelle: true })).not).toContain("3 kelime");
    expect((await sayfaSayisiOgren(url)).not).toContain("3 kelime");
    expect(get).toHaveBeenCalledTimes(2);
  });
});
