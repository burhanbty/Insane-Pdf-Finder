// Public metadata only. No API keys, user contact details, downloads or LLM calls.
// Run: node --import tsx reports/audit-live.mjs
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ayar } from "../src/config.ts";
import { kaynaklariYukle } from "../src/registry.ts";

Object.assign(ayar, {
  contactEmail: "",
  unpaywallEmail: "",
  googleBooksKey: "",
  semanticScholarKey: "",
  sourcesDir: fileURLToPath(new URL("../src/sources", import.meta.url)),
});
// A fixed deadline bounds the audit; individual requests retain their own signals.
const deadline = AbortSignal.timeout(25_000);
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = (url, options = {}) => {
  requests++;
  return originalFetch(url, {
    ...options,
    signal: AbortSignal.any([
      deadline,
      AbortSignal.timeout(8_000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
};
const selected = (await kaynaklariYukle()).filter(
  (s) => !["benim-sitem", "google-books"].includes(s.id),
);
const results = await Promise.all(
  selected.map(async (source) => {
    const query = source.tur.includes("makale")
      ? { baslik: "Attention Is All You Need", tur: "makale", limit: 1 }
      : source.tur.includes("kitap")
        ? { baslik: "Pride and Prejudice", tur: "kitap", limit: 1 }
        : { baslik: "Attention Is All You Need", tur: "slayt", limit: 1 };
    const t = Date.now();
    try {
      const works = await source.ara(query);
      const result = {
        id: source.id,
        status: "response",
        ms: Date.now() - t,
        count: works.length,
        sample: works
          .slice(0, 2)
          .map((w) => ({ baslik: w.baslik, tur: w.tur, link: w.link, pdf: w.pdf })),
      };
      console.log(JSON.stringify(result));
      return result;
    } catch (e) {
      const result = { id: source.id, status: "error", ms: Date.now() - t, error: e.message };
      console.log(JSON.stringify(result));
      return result;
    }
  }),
);
globalThis.fetch = originalFetch;
await fs.writeFile(
  new URL(
    process.argv.includes("--after-improvements")
      ? "./audit-live-after-improvements.json"
      : "./audit-live-evidence.json",
    import.meta.url,
  ),
  JSON.stringify(
    {
      node: process.version,
      requestCount: requests,
      deadlineMs: 25000,
      requestTimeoutMs: 8000,
      results,
    },
    null,
    2,
  ) + "\n",
);
