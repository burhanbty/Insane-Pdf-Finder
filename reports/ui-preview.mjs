// Deterministic browser fixture; no external searches, downloads, keys or LLM calls.
// Run: node --import tsx reports/ui-preview.mjs
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ayar } from "../src/config.ts";
import { kaynaklariYukle } from "../src/registry.ts";
import { uygulama } from "../src/app.ts";
import express from "express";

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-ui-preview-"));
console.log(`Temporary UI fixture: ${temporary}`);
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url).startsWith("https://openlibrary.org/api/books")) {
    return Promise.resolve(
      Response.json({
        "ISBN:9780131103627": {
          title: "The C Programming Language — arayüz örneği",
          authors: [{ name: "Brian Kernighan" }],
          publish_date: "1988",
          edition_name: "Second edition (test fixture)",
        },
      }),
    );
  }
  return originalFetch(url, init);
};
Object.assign(ayar, {
  sourcesDir: path.join(temporary, "sources"),
  cacheDir: path.join(temporary, "cache"),
  downloadsDir: path.join(temporary, "downloads"),
  dataDir: path.join(temporary, "data"),
});
for (const dir of [ayar.sourcesDir, ayar.cacheDir, ayar.downloadsDir, ayar.dataDir])
  await fs.mkdir(dir);
await fs.writeFile(
  path.join(ayar.downloadsDir, "arayuz_ornegi.txt"),
  "Arayüz doğrulaması için örnek metin.",
);
const rows = [
  {
    kaynak: "ornek-a",
    kaynakAd: "Örnek katalog A",
    tur: "kitap",
    baslik: "Pride and Prejudice — arayüz örneği",
    yazarlar: ["Jane Austen"],
    yil: 1813,
    konular: ["Roman"],
    ozet: "Bu kayıt yalnızca arayüz doğrulaması için hazırlanmıştır.",
    link: "https://www.gutenberg.org/ebooks/1342",
    epub: "https://www.gutenberg.org/ebooks/1342.epub3.images",
    tamMetin: "https://www.gutenberg.org/ebooks/1342.txt.utf-8",
    erisim: "acik",
  },
  {
    kaynak: "ornek-b",
    kaynakAd: "Örnek katalog B",
    tur: "kitap",
    baslik: "Açık araştırma rehberi — arayüz örneği",
    yazarlar: ["Örnek Yazar"],
    yil: 2024,
    sayfaSayisi: 1,
    pdf: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    link: "https://www.w3.org",
    erisim: "acik",
  },
  {
    kaynak: "ornek-a",
    kaynakAd: "Örnek katalog A",
    tur: "kitap",
    baslik: "Yılı bilinmeyen katalog kaydı — arayüz örneği",
    yazarlar: [],
    link: "https://example.com",
    erisim: "yonlendir",
  },
];
for (const id of ["ornek-a", "ornek-b"]) {
  const source = { id, ad: rows.find((w) => w.kaynak === id).kaynakAd, tur: ["kitap"] };
  await fs.writeFile(
    path.join(ayar.sourcesDir, `${id}.ts`),
    `export default {...${JSON.stringify(source)}, ara: async () => ${JSON.stringify(rows.filter((w) => w.kaynak === id))}};`,
  );
}
await kaynaklariYukle();
const preview = express();
preview.get("/", async (_req, res) => {
  const html = await fs.readFile(path.join(ayar.publicDir, "index.html"), "utf8");
  res
    .type("html")
    .send(
      html.replace(
        "<body>",
        '<body><aside class="onizleme-uyari" role="note">Arayüz önizlemesi — örnek veriler gösteriliyor. Gerçek arama için <a href="http://127.0.0.1:3000">uygulamayı aç</a>.</aside>',
      ),
    );
});
preview.use(uygulama);
const server = preview.listen(3319, "127.0.0.1", () =>
  console.log("UI fixture: http://127.0.0.1:3319"),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  const relative = path.relative(os.tmpdir(), temporary);
  if (
    !relative.startsWith("kaynak-bul-ui-preview-") ||
    relative.includes("..") ||
    path.isAbsolute(relative)
  )
    throw Error("Temporary directory outside boundary");
  await fs.rm(temporary, { recursive: true, force: true });
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
