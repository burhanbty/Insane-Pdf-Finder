import { beforeAll, afterAll, expect, it } from "vitest";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request, type Server } from "node:http";
import { uygulama } from "../src/app.js";
import { ayar } from "../src/config.js";

let server: Server;
let base: string;
let temp: string;
const eski = ayar.dataDir;
beforeAll(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-workspace-api-"));
  ayar.dataDir = temp;
  server = uygulama.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.close();
  await once(server, "close");
  ayar.dataDir = eski;
  const rel = path.relative(os.tmpdir(), temp);
  if (!rel.startsWith("kaynak-bul-workspace-api-") || rel.includes("..") || path.isAbsolute(rel))
    throw Error("Dizin sınır dışında");
  await fs.rm(temp, { recursive: true, force: true });
});
const post = (yol: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + "/api/workspace" + yol, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
it("eser kaydetme, düzenleme, yedek ve tekrar listeleme gerçek HTTP ile çalışır", async () => {
  const r = await post("/items", {
    eser: {
      anahtar: "api",
      baslik: "API Book",
      tur: "kitap",
      yazarlar: [],
      konular: [],
      kaynaklar: [{ kaynak: "x", kaynakAd: "X", link: "https://example.com" }],
    },
  });
  expect(r.status).toBe(201);
  const { kayit } = await r.json();
  expect(
    (await post(`/items/${kayit.id}`, { notlar: "Private note", durum: "okundu" })).status,
  ).toBe(200);
  const liste = await (await fetch(base + "/api/workspace")).json();
  expect(liste.kitaplik[0].notlar).toBe("Private note");
  const yedek = await fetch(base + "/api/workspace/backup");
  expect(yedek.headers.get("content-disposition")).toContain("attachment");
  expect(yedek.headers.get("cache-control")).toBe("no-store");
  expect((await post("/import", { yedek: await yedek.json(), onizleme: true })).status).toBe(200);
});
it("yabancı Origin/Host, JSON olmayan yazma ve özel verinin statik yoldan okunması engellenir", async () => {
  expect((await post("/items", {}, { origin: "https://evil.example" })).status).toBe(403);
  expect((await post("/items", {}, { "content-type": "text/plain" })).status).toBe(415);
  const status = await new Promise((resolve, reject) => {
    const req = request(base + "/api/workspace", { headers: { host: "evil.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
  expect(status).toBe(403);
  const response = await fetch(base + "/.data/workspace.json");
  expect(await response.text()).not.toContain("Private note");
});
it("geçersiz kimlik, eser ve önizlemesiz aktarım açıklayıcı hata döner", async () => {
  expect((await post("/items/unknown", { notlar: "x" })).status).toBe(404);
  expect((await post("/items", { eser: {} })).status).toBe(400);
  expect((await post("/import", { yedek: {} })).status).toBe(400);
  const isbn = await fetch(base + "/api/isbn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isbn: "invalid" }),
  });
  expect(isbn.status).toBe(400);
  expect(
    (await post("/course-list", { ders: "CENG", metin: "C programming", onizleme: true })).status,
  ).toBe(200);
});
