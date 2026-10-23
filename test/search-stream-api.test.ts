import { afterAll, beforeAll, it, expect, vi } from "vitest";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { uygulama } from "../src/app.js";
import { kaynaklariYukle } from "../src/registry.js";
import { ayar } from "../src/config.js";
import { istekSinyali } from "../src/deadline.js";
import type { Work } from "../src/types.js";

vi.mock("../src/registry.js", () => ({
  kaynaklariYukle: vi.fn(),
  kaynakListesi: () => [],
  yuklenmeHataListesi: () => [],
}));
let server: Server, url: string, dir: string;
const eski = { cacheDir: ayar.cacheDir, unpaywallEmail: ayar.unpaywallEmail };
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-api-test-"));
  ayar.cacheDir = dir;
  ayar.unpaywallEmail = "";
  server = uygulama.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  Object.assign(ayar, eski);
  if (
    path.dirname(dir) !== path.resolve(os.tmpdir()) ||
    !path.basename(dir).startsWith("stream-api-test-")
  )
    throw Error("Geçersiz test dizini");
  await fs.rm(dir, { recursive: true, force: true });
});

it("gerçek HTTP akışında hızlı kaynağın kartı yavaş kaynak bitmeden gelir", async () => {
  let bitir!: (w: Work[]) => void;
  const bekleyen = new Promise<Work[]>((r) => {
    bitir = r;
  });
  const baslik = randomUUID();
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    {
      id: "fast",
      ad: "Fast",
      tur: ["makale"],
      ara: async () => [
        {
          kaynak: "fast",
          kaynakAd: "Fast",
          tur: "makale",
          baslik,
          yazarlar: [],
          link: "https://stream.test/fast",
        },
      ],
    },
    { id: "slow", ad: "Slow", tur: ["makale"], ara: () => bekleyen },
  ]);
  const r = await fetch(url + "/api/search", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({ baslik, tur: "makale" }),
  });
  expect(r.headers.get("content-type")).toContain("application/x-ndjson");
  const reader = r.body!.getReader(),
    decoder = new TextDecoder();
  let veri = "";
  try {
    await vi.waitFor(async () => {
      const next = await reader.read();
      veri += decoder.decode(next.value);
      expect(veri).toContain('"kaynak":"fast"');
    });
    expect(veri).toContain('"tamamlandi":false');
    expect(veri).not.toContain('"tamamlandi":true');
  } finally {
    bitir([]);
  }
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    veri += decoder.decode(next.value);
  }
  expect(veri).toContain('"tamamlandi":true');
});

it("HTTP bağlantısı kapanınca kaynağın iptal sinyali tetiklenir", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(kaynaklariYukle).mockResolvedValue([
    {
      id: "cancel-http",
      ad: "Cancel",
      tur: ["makale"],
      ara: () =>
        new Promise<Work[]>((_r, reject) => {
          signal = istekSinyali.getStore();
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        }),
    },
  ]);
  const c = new AbortController();
  const r = await fetch(url + "/api/search", {
    method: "POST",
    signal: c.signal,
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({ baslik: randomUUID(), tur: "makale" }),
  });
  await vi.waitFor(() => expect(signal).toBeDefined());
  c.abort();
  await r.body?.cancel().catch(() => undefined);
  await vi.waitFor(() => expect(signal?.aborted).toBe(true));
});
