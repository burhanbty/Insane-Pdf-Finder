import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sureSinirli } from "../src/deadline.js";
import { get } from "../src/http.js";
import { ara, grupla } from "../src/search.js";
import { kaynaklariYukle } from "../src/registry.js";
import { ayar } from "../src/config.js";
import { nodeDestekleniyor } from "../scripts/runtime.mjs";

vi.mock("../src/registry.js", () => ({ kaynaklariYukle: vi.fn(), yuklenmeHataListesi: () => [] }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("kaynak süre sınırı devam eden HTTP isteğini iptal eder", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal = init.signal!;
          signal.addEventListener("abort", () => reject(signal!.reason), { once: true });
        }),
    ),
  );
  await expect(
    sureSinirli(() => get("https://deadline.test/", { tekrar: 0, boslukMs: 0 }), 30),
  ).rejects.toThrow("yanıt vermedi");
  expect(signal?.aborted).toBe(true);
});
it("bozuk hazırlık ve yanıt vermeyen kaynak sağlam sonucu engellemez; eksik yanıt önbelleğe alınmaz", async () => {
  const onceki = { cacheDir: ayar.cacheDir, kaynakTimeoutMs: ayar.kaynakTimeoutMs };
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-reliability-test-"));
  ayar.cacheDir = temp;
  ayar.kaynakTimeoutMs = 30;
  const iyi = vi.fn().mockResolvedValue([
    {
      kaynak: "iyi",
      kaynakAd: "İyi",
      tur: "kitap",
      baslik: "Reliability",
      yazarlar: [],
      link: "https://example.com",
    },
  ]);
  const yavas = vi.fn(() => new Promise<never>(() => {}));
  const hazirMi = () => {
    throw Error("bad key config");
  };
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "iyi", ad: "İyi", tur: ["kitap"], ara: iyi },
    { id: "bozuk", ad: "Bozuk", tur: ["kitap"], hazirMi, ara: vi.fn() },
    { id: "yavas", ad: "Yavaş", tur: ["kitap"], ara: yavas },
    {
      id: "gecersiz",
      ad: "Geçersiz",
      tur: ["kitap"],
      ara: vi.fn().mockResolvedValue({ records: [] }),
    },
  ]);
  try {
    const s = { baslik: "Reliability", tur: "kitap" as const, limit: 20 };
    const r = await ara(s);
    expect(r.gruplar).toHaveLength(1);
    expect(r.kaynakDurumlari.find((k) => k.id === "bozuk")?.hataMesaji).toContain("bad key");
    expect(r.kaynakDurumlari.find((k) => k.id === "yavas")?.hataMesaji).toContain("yanıt vermedi");
    expect(r.kaynakDurumlari.find((k) => k.id === "gecersiz")?.hataMesaji).toContain(
      "geçerli eser",
    );
    await ara(s);
    expect(iyi).toHaveBeenCalledTimes(1);
    expect(yavas).toHaveBeenCalledTimes(2);
  } finally {
    Object.assign(ayar, onceki);
    await temizle(temp);
  }
});
async function temizle(temp: string) {
  const relative = path.relative(os.tmpdir(), temp);
  if (
    !relative.startsWith("kaynak-bul-reliability-test-") ||
    relative.includes("..") ||
    path.isAbsolute(relative)
  )
    throw Error("Dizin sınır dışında");
  await fs.rm(temp, { recursive: true, force: true });
}
it("iki farklı yazara uyan yazarsız kayıt tahminle ilk kitaba bağlanmaz", () => {
  const temel = {
    kaynak: "a",
    kaynakAd: "A",
    tur: "kitap" as const,
    baslik: "Data Structures",
    yil: 2020,
    link: "https://example.com",
  };
  const r = grupla(
    [
      { ...temel, yazarlar: ["Alice Smith"] },
      { ...temel, yazarlar: ["Bob Jones"] },
      { ...temel, yazarlar: [] },
    ],
    { baslik: temel.baslik, tur: "kitap", limit: 20 },
  );
  expect(r).toHaveLength(3);
});
it.each(["20.19.0", "22.22.1", "24.14.9", "23.0.0", "25.0.0", "broken"])(
  "desteklenmeyen Node %s reddedilir",
  (v) => expect(nodeDestekleniyor(v)).toBe(false),
);
it.each(["22.22.2", "22.23.0", "24.15.0", "24.18.1", "26.0.0"])(
  "desteklenen Node %s kabul edilir",
  (v) => expect(nodeDestekleniyor(v)).toBe(true),
);
