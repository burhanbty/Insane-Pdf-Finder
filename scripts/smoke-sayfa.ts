/*
 * Sayfa sayisi ucunu gercek PDF'lerle dener.
 * Kullanim: npx tsx scripts/smoke-sayfa.ts [url ...]
 */

import { spawn } from "node:child_process";
import { once } from "node:events";

const PORT = 3315;
const VARSAYILAN = [
  "https://arxiv.org/pdf/1706.03762",     // 15 sayfa
  "https://arxiv.org/pdf/1502.05698",     // 12 sayfa
  "https://openlibrary.org/search.json",  // PDF degil
];

const ADRESLER = process.argv.length > 2 ? process.argv.slice(2) : VARSAYILAN;

const cocuk = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "src/server.ts"],
  { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] },
);

let cikti = "";
cocuk.stdout.on("data", (d) => { cikti += String(d); });
cocuk.stderr.on("data", (d) => { cikti += String(d); });

for (let i = 0; i < 40; i++) {
  if (cocuk.exitCode !== null) { console.log("SUNUCU KAPANDI:\n" + cikti); process.exit(1); }
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/sources`)).ok) break; } catch { /* bekliyor */ }
  await new Promise((r) => setTimeout(r, 500));
}

console.log("=== POST /api/sayfa-sayisi ===");
const t0 = Date.now();
const r = await fetch(`http://127.0.0.1:${PORT}/api/sayfa-sayisi`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ adresler: ADRESLER }),
});
const v = await r.json();
console.log(`status: ${r.status}  (${Date.now() - t0} ms)`);

for (const [adres, sonuc] of Object.entries((v as Record<string, { sonuclar: Record<string, unknown> }>).sonuclar ?? {})) {
  const s = sonuc as { sayfaSayisi?: number; not?: string };
  const kisa = adres.length > 58 ? adres.slice(0, 58) + "..." : adres;
  console.log(`  ${s.sayfaSayisi ? `${s.sayfaSayisi} sayfa` : `(bilinmedi: ${s.not})`}  <- ${kisa}`);
}

console.log("\n=== Onbellek: ikinci cagri (hizli olmali) ===");
const t1 = Date.now();
await fetch(`http://127.0.0.1:${PORT}/api/sayfa-sayisi`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ adresler: ADRESLER }),
});
console.log(`  ikinci cagri: ${Date.now() - t1} ms`);

console.log("\n=== Arama cevabinda sayfaSayisi var mi? ===");
const ar = await fetch(`http://127.0.0.1:${PORT}/api/search`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ baslik: "Attention Is All You Need", tur: "makale", limit: 3 }),
});
const aj = (await ar.json()) as { gruplar: { baslik: string; sayfaSayisi?: number; sayfa?: string }[] };
for (const g of aj.gruplar) {
  console.log(`  [${g.sayfaSayisi ?? "-"} sayfa / ${g.sayfa ?? "-"}]  ${g.baslik.slice(0, 50)}`);
}

cocuk.kill();
await once(cocuk, "exit").catch(() => {});