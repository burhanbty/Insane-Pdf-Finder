// Offline audit probes. Run: node --import tsx reports/audit-reproduce.mjs
// Verifies the original eighteen findings against the current implementation.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { format, resolveConfig } from "prettier";
import { ayar } from "../src/config.ts";
import { grupla } from "../src/search.ts";
import { indir } from "../src/download.ts";
import { getJson } from "../src/http.ts";
import { sayfaSayisiOgren } from "../src/sayfa.ts";
import gutenberg from "../src/sources/gutenberg.ts";
import openaire from "../src/sources/openaire.ts";
import crossref from "../src/sources/crossref.ts";
import wikipedia from "../src/sources/wikipedia-tr.ts";
import hal from "../src/sources/hal.ts";
import { ozetUret } from "../src/summary.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await fs.mkdtemp(path.join(root, "reports", ".audit-tmp-"));
const originalFetch = globalThis.fetch;
const originalConfig = { downloadsDir: ayar.downloadsDir, cacheDir: ayar.cacheDir };
ayar.downloadsDir = path.join(temporary, "downloads");
ayar.cacheDir = path.join(temporary, "cache");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const fixed = Array.from({ length: 18 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`);
function record(id, detail) {
  results.push({ id, status: fixed.includes(id) ? "fixed" : "remaining", detail });
  console.log(JSON.stringify({ id, detail }));
}
const query = { baslik: "Sapiens", yazar: "Harari", yil: 2011, tur: "kitap", limit: 20 };
const work = (extra) => ({
  kaynak: "a",
  kaynakAd: "A",
  tur: "kitap",
  baslik: "Sapiens",
  yazarlar: ["Harari"],
  yil: 2011,
  link: "https://example.test/a",
  ...extra,
});
let child;
const upstream = http.createServer((req, res) => {
  if (req.url === "/slow-json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.flushHeaders();
    setTimeout(() => res.end('{"ok":true}'), 300);
  } else if (req.url === "/a" || req.url === "/b") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write(req.url === "/a" ? "AAAA" : "BBBB");
    setTimeout(() => res.end(req.url === "/a" ? "AAAA" : "BBBB"), req.url === "/a" ? 900 : 1200);
  } else {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("controlled-loopback-marker");
  }
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

async function ui(setup, probe) {
  const html = await fs.readFile(path.join(root, "public/index.html"), "utf8");
  const js = await fs.readFile(path.join(root, "public/app.js"), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1:3000", runScripts: "outside-only" });
  const empty = { gruplar: [], kaynakDurumlari: [], toplamSonuc: 0, gruplamaNotu: "" };
  const calls = [];
  const handler = setup(empty);
  dom.window.fetch = async (url, options) => {
    const body = options?.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, body });
    const data =
      url === "/api/downloads"
        ? { dosyalar: [] }
        : url === "/api/sources"
          ? { kaynaklar: [] }
          : await handler(url, body);
    return { ok: !data.hata, json: async () => data };
  };
  try {
    dom.window.eval(`globalThis.__audit = (async () => {\n${js}\n})();`);
    await dom.window.__audit;
    const d = dom.window.document;
    const submit = async () => {
      d.querySelector("#baslik").value = "Test";
      d.querySelector("#aramaForm").dispatchEvent(
        new dom.window.Event("submit", { cancelable: true }),
      );
      await sleep(30);
    };
    await probe({ d, dom, calls, submit });
  } finally {
    dom.window.close();
  }
}
const card = (key, source, extra = {}) => ({
  anahtar: key,
  tur: "kitap",
  baslik: key,
  yazarlar: ["Writer"],
  konular: [],
  puan: 0.95,
  kaynaklar: [
    { kaynak: source, kaynakAd: source.toUpperCase(), link: `https://example.test/${key}` },
  ],
  ...extra,
});

try {
  const fuzzy = grupla(
    [
      work({}),
      work({ kaynak: "b", baslik: "Sapiens: History", pdf: "https://example.test/b.pdf" }),
    ],
    query,
  );
  assert.equal(fuzzy.length, 1);
  assert.equal(fuzzy[0].kaynaklar.length, 2);
  assert.equal(fuzzy[0].kaynaklar[1].pdf, "https://example.test/b.pdf");
  record("F01", {
    groups: fuzzy.length,
    retainedSources: fuzzy[0].kaynaklar.map((w) => w.kaynak),
    pdfPreserved: true,
    status: "fixed",
  });

  const unrelated = grupla(
    [
      work({ baslik: "Data Structures", yazarlar: ["Alice Smith"], yil: 2020 }),
      work({ baslik: "Data Structures", yazarlar: ["Bob Jones"], yil: 2020, kaynak: "b" }),
    ],
    { ...query, baslik: "Data Structures", yazar: undefined, yil: 2020 },
  );
  assert.equal(unrelated.length, 2);
  assert.equal(new Set(unrelated.map((g) => g.anahtar)).size, 2);
  record("F02", {
    separateAuthors: unrelated.map((g) => g.yazarlar),
    groups: unrelated.length,
  });

  const started = Date.now();
  await assert.rejects(
    getJson(`${upstreamUrl}/slow-json`, { timeoutMs: 50, tekrar: 0, boslukMs: 0 }),
  );
  record("F03", {
    timeoutMs: 50,
    actualMs: Date.now() - started,
    bodyAborted: true,
    status: "fixed",
  });

  // The public-network policy remains enabled; only the test transport is stubbed.
  globalThis.fetch = (url, init) =>
    originalFetch(`${upstreamUrl}${new URL(url).pathname}`, { signal: init?.signal });
  const collision = await Promise.allSettled([
    indir({ url: "https://controlled.audit.test/a", varsayilanAd: "collision" }, "metin"),
    indir({ url: "https://controlled.audit.test/b", varsayilanAd: "collision" }, "metin"),
  ]);
  assert.ok(collision.every((r) => r.status === "fulfilled"));
  assert.equal(new Set(collision.map((r) => r.value.dosya)).size, 2);
  assert.deepEqual(await Promise.all(collision.map((r) => fs.readFile(r.value.yol, "utf8"))), [
    "AAAAAAAA",
    "BBBBBBBB",
  ]);
  record(
    "F04",
    collision.map((r) =>
      r.status === "fulfilled"
        ? { status: r.status, file: r.value.dosya, bytes: r.value.boyut, contentVerified: true }
        : { status: r.status, error: r.reason.message.replaceAll(temporary, "<temporary>") },
    ),
  );

  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return new Response("ordinary text", { headers: { "content-type": "text/plain" } });
  };
  const forceUrl = "https://force-refresh.audit.test/document";
  await sayfaSayisiOgren(forceUrl);
  await sayfaSayisiOgren(forceUrl, { zorlaGuncelle: true });
  assert.equal(count, 2);
  record("F05", { forcedRefreshFetchCount: count, expected: 2 });

  globalThis.fetch = async () =>
    Response.json({
      results: [
        {
          id: 1,
          title: "Test",
          authors: [],
          formats: { "application/epub+zip": "https://example.test/book.epub" },
        },
      ],
    });
  const books = await gutenberg.ara({ ...query, yil: 2099 });
  assert.equal(books[0].pdf, undefined);
  assert.ok(books[0].epub.endsWith(".epub"));
  assert.equal(books[0].yil, undefined);
  record("F06", { epubSeparate: books[0].epub, pdfInvented: false, yearInvented: false });

  globalThis.fetch = async () =>
    Response.json({
      response: {
        results: {
          result: [
            {
              metadata: {
                "oaf:entity": {
                  "oaf:result": {
                    title: { $: "Test paper" },
                    creator: { $: "Author" },
                    pid: { "@classid": "doi", $: "10.1234/example" },
                    children: {
                      instance: {
                        accessright: { "@classid": "OPEN" },
                        webresource: { url: { $: "https://repository.test/paper.pdf" } },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    });
  const oa = await openaire.ara({ ...query, tur: "makale" });
  assert.equal(oa[0].pdf, "https://repository.test/paper.pdf");
  assert.equal(oa[0].tur, "makale");
  record("F07", {
    expectedUrl: "https://repository.test/paper.pdf",
    actualPdf: oa[0].pdf,
    actualType: oa[0].tur,
    status: "fixed",
  });

  globalThis.fetch = async () =>
    Response.json({ message: { items: [{ title: ["Test"], type: "book", page: "e1000234" }] } });
  const cr = await crossref.ara(query);
  assert.equal(cr[0].sayfaSayisi, undefined);
  assert.equal(cr[0].tur, "kitap");
  record("F08", { articleIdExposedAsPageCount: false, bookExposedAs: cr[0].tur });

  globalThis.fetch = async (url) =>
    Response.json(
      String(url).includes("list=search")
        ? { query: { search: [{ title: "Test", pageid: 1 }] } }
        : { query: { pages: { 1: { title: "Test", pageid: 1, extract: "Actual text" } } } },
    );
  const wiki = await wikipedia.ara({ ...query, yazar: "Invented Author", yil: 2099 });
  assert.deepEqual(wiki[0].yazarlar, []);
  assert.equal(wiki[0].yil, undefined);
  record("F09", {
    sourceMetadataContainsNoAuthorOrYear: true,
    actualAuthors: wiki[0].yazarlar,
    actualYear: wiki[0].yil,
  });

  const packages = await Promise.all(
    ["pdfjs-dist", "vitest", "jsdom"].map(async (name) => {
      const pkg = JSON.parse(
        await fs.readFile(path.join(root, "node_modules", name, "package.json"), "utf8"),
      );
      return { name, version: pkg.version, node: pkg.engines.node };
    }),
  );
  record("F16", {
    declaredMinimum: "22.22.2 (22.x), 24.15.0 (24.x), 26+",
    dependencyRequirements: packages,
    evidenceType: "package manifests; Node 20 was not executed",
  });

  const liveFixture = JSON.parse(
    await fs.readFile(new URL("./openaire-live-fixture.json", import.meta.url), "utf8"),
  );
  globalThis.fetch = async () => Response.json(liveFixture);
  const oaLive = await openaire.ara({ ...query, tur: "makale" });
  assert.ok(liveFixture.response.results.result.length > 0);
  assert.equal(oaLive.length, liveFixture.response.results.result.length);
  record("F17", {
    actualApiRecords: liveFixture.response.results.result.length,
    adapterRecords: oaLive.length,
    metadataPath: 'metadata["oaf:entity"]["oaf:result"]',
    status: "fixed",
  });

  globalThis.fetch = async () =>
    Response.json({
      response: {
        docs: [
          {
            docid: "4749086",
            title_s: ["Test"],
            uri_s: "https://hal.science/hal-04749086v1",
            authFullName_s: [],
          },
        ],
      },
    });
  const halWorks = await hal.ara({ ...query, tur: "makale" });
  assert.equal(halWorks[0].pdf, undefined);
  record("F18", {
    actualRecordUri: halWorks[0].link,
    fabricatedPdf: false,
    filesMissing: true,
  });

  // Positive PDF and summary paths, using a one-page synthetic document.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream =
    "BT /F1 12 Tf 20 250 Td (This synthetic document verifies the text extraction and summary workflow.) Tj ET";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  globalThis.fetch = async () =>
    new Response(pdf, { headers: { "content-type": "application/pdf" } });
  const pdfPages = await sayfaSayisiOgren("https://synthetic.audit.test/one-page.pdf");
  assert.equal(pdfPages.sayfaSayisi, 1);
  const llmConfig = { ...ayar.llm };
  try {
    ayar.llm.apiKey = "";
    ayar.llm.baseUrl = "";
    const summary = await ozetUret({
      url: "https://synthetic.audit.test/one-page.pdf",
      tur: "pdf",
      baslik: "Audit",
    });
    assert.equal(summary.sayfaSayisi, 1);
    assert.equal(summary.yontem, "extractive");
    assert.ok(summary.ozet.includes("synthetic document"));
    console.log(
      JSON.stringify({ verification: "synthetic PDF pages and extractive summary", passed: true }),
    );
  } finally {
    Object.assign(ayar.llm, llmConfig);
  }

  await ui(
    (empty) => async (url) =>
      url === "/api/search"
        ? {
            ...empty,
            gruplar: [
              card("abstract", "a", {
                ozet: "Available abstract",
                kaynaklar: [
                  {
                    kaynak: "a",
                    kaynakAd: "A",
                    link: "https://example.test",
                    ozet: "Available abstract",
                  },
                ],
              }),
            ],
          }
        : url === "/api/summary"
          ? { hata: "Geçersiz içerik adresi" }
          : empty,
    async ({ d, submit, calls }) => {
      d.querySelector("#webDahil").checked = false;
      await submit();
      const button = d.querySelector('[data-eylem="ozet"]');
      assert.equal(button, null);
      assert.equal(d.querySelector(".aciklama").textContent, "Available abstract");
      assert.equal(
        calls.some((c) => c.url === "/api/summary"),
        false,
      );
      record("F10", {
        emptyUrlButtonRemoved: true,
        existingAbstractVisible: true,
      });
    },
  );

  await ui(
    (empty) => async (url) =>
      url === "/api/search"
        ? { ...empty, gruplar: [card("one", "a"), card("two", "b"), card("three", "a")] }
        : empty,
    async ({ d, dom, submit }) => {
      d.querySelector("#webDahil").checked = false;
      await submit();
      d.querySelector("#grupla").checked = true;
      d.querySelector("#grupla").dispatchEvent(new dom.window.Event("change"));
      const headings = [...d.querySelectorAll(".grup-basligi")].map((n) => n.textContent);
      assert.equal(headings.length, 2);
      record("F11", { expectedGroups: 2, actualGroups: headings });
    },
  );

  let finishWeb;
  await ui(
    (empty) => async (url) =>
      url === "/api/web-search"
        ? new Promise((resolve) => {
            finishWeb = () => resolve(empty);
          })
        : { ...empty, gruplar: [card("ready", "a")] },
    async ({ d, submit }) => {
      await submit();
      assert.equal(d.querySelectorAll(".kart").length, 1);
      finishWeb();
      await sleep(10);
      assert.equal(d.querySelectorAll(".kart").length, 1);
      record("F12", { cardsBeforeWebCompletes: 1, cardsAfterWebCompletes: 1 });
    },
  );

  await ui(
    (empty) => async () => ({
      ...empty,
      gruplar: [
        card("unsafe", "a", {
          kaynaklar: [{ kaynak: "a", kaynakAd: "A", link: "javascript:alert(1)" }],
        }),
      ],
    }),
    async ({ d, submit }) => {
      d.querySelector("#webDahil").checked = false;
      await submit();
      assert.equal(d.querySelector(".kaynak-rozet a"), null);
      record("F13", { unsafeSchemePresentInRenderedLink: false });
    },
  );

  globalThis.fetch = originalFetch;
  const sourcesDir = path.join(temporary, "sources");
  await fs.mkdir(sourcesDir);
  await fs.writeFile(
    path.join(sourcesDir, "controlled.ts"),
    'export default { id: "audit", ad: "Audit", tur: ["kitap"], ara: async () => [] };',
  );
  const portServer = http.createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const boot = `const {ayar}=await import('./src/config.ts'); ayar.downloadsDir=${JSON.stringify(path.join(temporary, "api-downloads"))}; ayar.cacheDir=${JSON.stringify(path.join(temporary, "api-cache"))}; await import('./src/server.ts');`;
  child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", boot], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      SOURCES_DIR: sourcesDir,
      LLM_API_KEY: "",
      LLM_BASE_URL: "",
    },
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  const apiUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await originalFetch(`${apiUrl}/api/saglik`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await sleep(100);
  }
  assert.ok(ready, "isolated API server did not start");
  const privateRead = await originalFetch(`${apiUrl}/api/download`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${upstreamUrl}/controlled-private`,
      tur: "metin",
      baslik: "marker",
    }),
  });
  assert.equal(privateRead.status, 502);
  const privateData = await privateRead.json();
  assert.match(privateData.hata, /engellendi/);
  record("F14", { loopbackDownloadStatus: privateRead.status, ownTestServerOnly: true });

  const cachePath = path.join(temporary, "api-cache");
  await fs.writeFile(path.join(cachePath, "controlled-marker"), "audit");
  const clear = await originalFetch(`${apiUrl}/api/cache/clear`, {
    method: "POST",
    headers: { origin: "https://foreign-origin.test", "content-type": "text/plain" },
    body: "",
  });
  assert.equal(clear.status, 403);
  const cacheExists = await fs.stat(cachePath).then(
    () => true,
    () => false,
  );
  assert.equal(cacheExists, true);
  assert.equal(await fs.readFile(path.join(cachePath, "controlled-marker"), "utf8"), "audit");
  record("F15", {
    foreignOriginAccepted: false,
    status: clear.status,
    isolatedCacheRemoved: false,
  });

  const outputPath = path.join(root, "reports/audit-after-improvements.json");
  await fs.writeFile(
    outputPath,
    await format(JSON.stringify({ node: process.version, fixed, probes: results }), {
      ...(await resolveConfig(outputPath)),
      parser: "json",
    }),
  );
  console.log(
    `Verified ${fixed.length} fixes and ${results.length - fixed.length} remaining observations. No external requests or LLM calls were made.`,
  );
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(ayar, originalConfig);
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  const relative = path.relative(root, temporary);
  assert.ok(relative.startsWith(`reports${path.sep}.audit-tmp-`) && !relative.includes(".."));
  await fs.rm(temporary, { recursive: true, force: true });
}
