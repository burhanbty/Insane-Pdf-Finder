// Deterministic browser QA for search, editions and download jobs.
// node --import tsx reports/features-preview.mjs (port 3320; no external traffic)
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import { ayar } from "../src/config.ts";
import { kaynaklariYukle } from "../src/registry.ts";
import { uygulama } from "../src/app.ts";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-features-preview-"));
Object.assign(
  ayar,
  Object.fromEntries(
    ["sources", "cache", "downloads", "data"].map((d) => [
      d === "sources" ? "sourcesDir" : `${d}Dir`,
      path.join(temporary, d),
    ]),
  ),
);
for (const d of [ayar.sourcesDir, ayar.cacheDir, ayar.downloadsDir, ayar.dataDir])
  await fs.mkdir(d);
const rows = [
  {
    baslik: "Calculus 2",
    yil: 1988,
    dil: "eng",
    baski: "2nd edition",
    isbn: "9780131103627",
    yayinci: "Örnek Yayınevi",
    pdf: "https://feature-fixture.invalid/one.pdf",
  },
  {
    baslik: "Calculus 2",
    yil: 1993,
    dil: "tur",
    baski: "3. baskı",
    isbn: "9780306406157",
    yayinci: "Başka Yayınevi",
    pdf: "https://feature-fixture.invalid/two.pdf",
  },
  {
    baslik: "Calculus 3",
    yil: 2010,
    dil: "eng",
    baski: "1",
    pdf: "https://feature-fixture.invalid/three.pdf",
  },
].map((w) => ({
  kaynak: "ornek",
  kaynakAd: "Örnek katalog · test verisi",
  tur: "kitap",
  yazarlar: ["Jane Doe"],
  konular: ["Arayüz testi"],
  link: w.pdf,
  erisim: "acik",
  sayfaSayisi: 1,
  ...w,
}));
await fs.writeFile(
  path.join(ayar.sourcesDir, "ornek.ts"),
  `export default {id:'ornek',ad:'Örnek katalog',tur:['kitap'],ara:async()=>${JSON.stringify(rows)}};`,
);
await kaynaklariYukle();
const attempts = new Map();
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.hostname !== "feature-fixture.invalid") throw new Error("Önizlemede dış ağ kapalı");
  const n = (attempts.get(u.pathname) ?? 0) + 1;
  attempts.set(u.pathname, n);
  if (u.pathname === "/three.pdf" && n === 1)
    return new Response("Kaynak geçici olarak kapalı", { status: 503 });
  const bytes = Buffer.alloc(2 * 1024 * 1024, 32);
  bytes.write("%PDF-1.4\nUI fixture (not a production document)\n");
  if (u.pathname === "/three.pdf") bytes[100] = 65;
  let offset = 0,
    timer;
  const body = new ReadableStream({
    start(c) {
      const iptal = () => {
        clearTimeout(timer);
        c.error(init.signal.reason);
      };
      init.signal?.addEventListener("abort", iptal, { once: true });
      function send() {
        if (init.signal?.aborted) {
          iptal();
          return;
        }
        if (offset >= bytes.length) {
          init.signal?.removeEventListener("abort", iptal);
          c.close();
          return;
        }
        c.enqueue(bytes.subarray(offset, offset + 32768));
        offset += 32768;
        timer = setTimeout(send, 200);
      }
      send();
    },
    cancel() {
      clearTimeout(timer);
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/pdf", "content-length": String(bytes.length) },
  });
};
const preview = express();
preview.get("/", async (_req, res) => {
  const html = await fs.readFile(path.join(ayar.publicDir, "index.html"), "utf8");
  res
    .type("html")
    .send(
      html
        .replace(
          "<body>",
          '<body><aside class="onizleme-uyari" role="note">ÖZELLİK TESTİ — örnek katalog ve yavaş dosya akışı. Gerçek uygulama: <a href="http://127.0.0.1:3000">3000</a>.</aside>',
        )
        .replace('id="webDahil" checked', 'id="webDahil"'),
    );
});
preview.use(uygulama);
const server = preview.listen(3320, "127.0.0.1", () =>
  console.log(`Feature QA: http://127.0.0.1:3320 (isolated: ${temporary})`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(temporary));
  if (
    path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) ||
    !relative.startsWith("kaynak-bul-features-preview-") ||
    relative.includes("..")
  )
    throw new Error("Temporary fixture outside boundary");
  await fs.rm(temporary, { recursive: true, force: true });
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
