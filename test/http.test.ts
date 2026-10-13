import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { Readable } from "node:stream";
import { get, getJson } from "../src/http.js";

let adres: string;
const sunucu = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  if (req.url === "/fast") {
    res.end('{"ok":true}');
    return;
  }
  res.write('{"ok":');
  const timer = setTimeout(() => res.end("true}"), 400);
  res.on("close", () => clearTimeout(timer));
});
beforeAll(async () => {
  await new Promise<void>((resolve) => sunucu.listen(0, "127.0.0.1", resolve));
  adres = `http://127.0.0.1:${(sunucu.address() as import("node:net").AddressInfo).port}`;
});
afterAll(async () => {
  sunucu.closeAllConnections();
  await new Promise<void>((resolve, reject) => sunucu.close((e) => (e ? reject(e) : resolve())));
});
const secenek = { timeoutMs: 150, tekrar: 0, boslukMs: 0 };

describe("HTTP yanıt gövdesi zaman aşımı", () => {
  it("başlıklar gelse de yavaş JSON gövdesini iptal eder", async () => {
    await expect(getJson(`${adres}/slow-json`, secenek)).rejects.toThrow();
  });
  it("ham text gövdesinde süreyi uygular", async () => {
    const r = await get(`${adres}/slow-text`, secenek);
    expect(r.status).toBe(200);
    await expect(r.text()).rejects.toThrow();
  });
  it("arrayBuffer gövdesinde süreyi uygular", async () => {
    const r = await get(`${adres}/slow-buffer`, secenek);
    await expect(r.arrayBuffer()).rejects.toThrow();
  });
  it("indirme akışında süreyi uygular", async () => {
    const r = await get(`${adres}/slow-stream`, secenek);
    const oku = async () => {
      for await (const parca of Readable.fromWeb(
        r.body as Parameters<typeof Readable.fromWeb>[0],
      )) {
        void parca;
      }
    };
    await expect(oku()).rejects.toThrow();
  });
  it("süre içinde biten geçerli gövdeyi bozmaz", async () => {
    expect(await getJson(`${adres}/fast`, { ...secenek, timeoutMs: 1000 })).toEqual({ ok: true });
  });
});
