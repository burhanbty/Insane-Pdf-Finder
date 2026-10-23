import { beforeEach, afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { ara, type AramaCevabi } from "../src/search.js";
import { kaynaklariYukle } from "../src/registry.js";
import { ayar } from "../src/config.js";
import { istekSinyali } from "../src/deadline.js";
import type { Work } from "../src/types.js";

vi.mock("../src/registry.js", () => ({ kaynaklariYukle: vi.fn(), yuklenmeHataListesi: () => [] }));
let dir: string;
const eski = { cacheDir: ayar.cacheDir, unpaywallEmail: ayar.unpaywallEmail };
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-test-"));
  ayar.cacheDir = dir;
  ayar.unpaywallEmail = "";
});
afterEach(async () => {
  Object.assign(ayar, eski);
  vi.resetAllMocks();
  if (
    path.dirname(dir) !== path.resolve(os.tmpdir()) ||
    !path.basename(dir).startsWith("stream-test-")
  )
    throw Error("Geçersiz test dizini");
  await fs.rm(dir, { recursive: true, force: true });
});
const eser = (id: string, baslik: string): Work => ({
  kaynak: id,
  kaynakAd: id,
  baslik,
  tur: "makale",
  yazarlar: ["Jane Smith"],
  link: `https://stream.test/${id}`,
});

it("hızlı kaynağı yavaşı beklemeden gösterir, bütün kaynaklar bitince nihai yanıt gönderir", async () => {
  const s = { baslik: randomUUID(), tur: "makale" as const, limit: 10 };
  let bitir!: (w: Work[]) => void;
  const yavas = new Promise<Work[]>((r) => {
    bitir = r;
  });
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "slow", ad: "Slow", tur: ["makale"], ara: () => yavas },
    { id: "fast", ad: "Fast", tur: ["makale"], ara: async () => [eser("fast", s.baslik)] },
  ]);
  const akis: AramaCevabi[] = [];
  const p = ara(s, { guncelle: (r) => akis.push(structuredClone(r)) });
  await vi.waitFor(() => expect(akis.some((r) => r.gruplar.length === 1)).toBe(true));
  expect(akis.at(-1)).toMatchObject({
    tamamlandi: false,
    kaynakDurumlari: expect.arrayContaining([
      expect.objectContaining({ id: "slow", bekliyor: true }),
    ]),
  });
  bitir([eser("slow", s.baslik)]);
  const son = await p;
  expect(son.tamamlandi).toBe(true);
  expect(son.gruplar[0]?.kaynaklar.map((w) => w.kaynak)).toEqual(["slow", "fast"]);
  expect(akis.at(-1)?.tamamlandi).toBe(true);
  const tekrar: AramaCevabi[] = [];
  await ara(s, { guncelle: (r) => tekrar.push(r) });
  expect(tekrar).toHaveLength(1);
  expect(tekrar[0]?.tamamlandi).toBe(true);
});

it("istemci iptalini kaynak HTTP işlerine yayar; eksik aramayı başarı diye saklamaz", async () => {
  const s = { baslik: randomUUID(), tur: "makale" as const, limit: 10 };
  let signal: AbortSignal | undefined;
  const kaynak = vi.fn(
    () =>
      new Promise<Work[]>((_r, reject) => {
        signal = istekSinyali.getStore();
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      }),
  );
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "cancel", ad: "Cancel", tur: ["makale"], ara: kaynak },
  ]);
  const c = new AbortController();
  const p = ara(s, { signal: c.signal });
  const red = expect(p).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(signal).toBeDefined());
  c.abort(new Error("cancelled"));
  await red;
  expect(signal?.aborted).toBe(true);
  kaynak.mockResolvedValueOnce([]);
  expect((await ara(s)).tamamlandi).toBe(true);
  expect(kaynak).toHaveBeenCalledTimes(2);
});

it("tek kaynak hatası erken sonuçları silmez ve son durumda eksik kaynağı bildirir", async () => {
  const s = { baslik: randomUUID(), tur: "makale" as const, limit: 10 };
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "good", ad: "Good", tur: ["makale"], ara: async () => [eser("good", s.baslik)] },
    {
      id: "bad",
      ad: "Bad",
      tur: ["makale"],
      ara: async () => {
        throw Error("429 quota");
      },
    },
  ]);
  const r = await ara(s);
  expect(r.gruplar).toHaveLength(1);
  expect(r.kaynakDurumlari.find((d) => d.id === "bad")?.hataMesaji).toBe("429 quota");
});

it("kısmi kaynak künyelerini korur, uyarılı kaynağı tekrar sorgular", async () => {
  const s = { baslik: randomUUID(), tur: "makale" as const, limit: 10 };
  const kaynak = vi
    .fn()
    .mockResolvedValue(
      Object.assign([eser("partial", s.baslik)], { uyarilar: ["Bir kayıt okunamadı"] }),
    );
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    { id: "partial", ad: "Partial", tur: ["makale"], ara: kaynak },
  ]);
  const r = await ara(s);
  expect(r.gruplar).toHaveLength(1);
  expect(r.kaynakDurumlari[0]?.hataMesaji).toContain("okunamadı");
  await ara(s);
  expect(kaynak).toHaveBeenCalledTimes(2);
});
