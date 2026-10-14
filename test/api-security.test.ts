import { afterAll, beforeAll, expect, it } from "vitest";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request, type Server } from "node:http";
import { uygulama } from "../src/app.js";
import { ayar } from "../src/config.js";

let server: Server;
let url: string;
let temporary: string;
const onceki = { cacheDir: ayar.cacheDir, downloadsDir: ayar.downloadsDir };
beforeAll(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-api-test-"));
  ayar.cacheDir = path.join(temporary, "cache");
  ayar.downloadsDir = path.join(temporary, "downloads");
  await fs.mkdir(ayar.cacheDir);
  await fs.mkdir(ayar.downloadsDir);
  await fs.writeFile(path.join(ayar.cacheDir, "keep"), "keep");
  await fs.writeFile(path.join(ayar.downloadsDir, "book.txt"), "owned book");
  await fs.writeFile(path.join(temporary, "outside.txt"), "secret");
  server = uygulama.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  server.close();
  await once(server, "close");
  Object.assign(ayar, onceki);
  const relative = path.relative(os.tmpdir(), temporary);
  if (
    !relative.startsWith("kaynak-bul-api-test-") ||
    relative.includes("..") ||
    path.isAbsolute(relative)
  )
    throw Error("Geçici dizin sınır dışında");
  await fs.rm(temporary, { recursive: true, force: true });
});
const post = (yol: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url + yol, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

it("yabancı Origin ve text/plain önbellek silmesini engeller, dosyayı korur", async () => {
  expect((await post("/api/cache/clear", {}, { origin: "https://evil.example" })).status).toBe(403);
  expect((await post("/api/cache/clear", {}, { "content-type": "text/plain" })).status).toBe(415);
  expect(await fs.readFile(path.join(ayar.cacheDir, "keep"), "utf8")).toBe("keep");
});
it("aynı Origin ile yerel API isteğine izin verir", async () => {
  expect((await post("/api/search", {}, { origin: url })).status).toBe(400);
});
it("DNS rebinding için yabancı Host başlığını reddeder", async () => {
  const status = await new Promise((resolve, reject) => {
    const req = request(url + "/api/downloads", { headers: { host: "attacker.example" } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
  expect(status).toBe(403);
});
it("özel ağdan dosya indirmeyi engeller", async () => {
  const r = await post("/api/download", { url: "http://127.0.0.1/internal", tur: "metin" });
  expect(r.status).toBe(502);
  expect((await r.json()).hata).toContain("engellendi");
  expect(await fs.readdir(ayar.downloadsDir)).toEqual(["book.txt"]);
});
it.each([1.5, 0, 51, "Infinity"])("geçersiz limit %s aramayı başlatmaz", async (limit) => {
  expect((await post("/api/search", { baslik: "x", limit })).status).toBe(400);
});
it("geçersiz tür ve bozuk JSON için anlaşılır JSON hatası döner", async () => {
  expect((await post("/api/search", { baslik: "x", tur: "unknown" })).status).toBe(400);
  const r = await fetch(url + "/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  expect(r.status).toBe(400);
  expect((await r.json()).hata).toContain("JSON");
});
it("indirilen dosyayı tarayıcıya sunar ve dosya yollarını korur", async () => {
  const r = await fetch(url + "/api/downloads/book.txt");
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("owned book");
  expect(r.headers.get("content-disposition")).toContain("attachment");
  expect((await fetch(url + "/api/downloads/..%2Foutside.txt")).status).toBe(400);
  expect((await fetch(url + "/api/downloads/missing.txt")).status).toBe(404);
  expect((await fetch(url + "/api/downloads/book.txt.part")).status).toBe(400);
});
it("bilinmeyen API ve güvenlik başlıklarını doğrular", async () => {
  const r = await fetch(url + "/api/unknown");
  expect(r.status).toBe(404);
  expect((await r.json()).hata).toBeTruthy();
  expect(r.headers.get("x-powered-by")).toBeNull();
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
});
