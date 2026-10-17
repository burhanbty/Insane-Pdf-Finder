/*
 * Sunucuyu gecici olarak ayaga kaldirip tum rotalari gercek HTTP ile dener,
 * sonra kapatir. Kalici sunucu icin: npm start
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 3311;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-smoke-"));
let basarisiz = 0;
const boot = `const {ayar}=await import('./src/config.ts'); ayar.downloadsDir=${JSON.stringify(path.join(temporary, "downloads"))}; ayar.cacheDir=${JSON.stringify(path.join(temporary, "cache"))}; ayar.dataDir=${JSON.stringify(path.join(temporary, "data"))}; await import('./src/server.ts');`;

console.log("Sunucu baslatiliyor...");
const cocuk = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", boot], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", LLM_API_KEY: "", LLM_BASE_URL: "" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let sunucuCikti = "";
cocuk.stdout.on("data", (d) => {
  sunucuCikti += String(d);
});
cocuk.stderr.on("data", (d) => {
  sunucuCikti += String(d);
});

async function bekleVeKacOlmam() {
  for (let i = 0; i < 40; i++) {
    if (cocuk.exitCode !== null) throw new Error(`Sunucu erken kapandi:\n${sunucuCikti}`);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/sources`);
      if (r.ok) return;
    } catch {
      /* henuz dinlemiyor */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Sunucu acilmadi:\n${sunucuCikti}`);
}

async function test(ad: string, yol: string, govde?: unknown, beklenen: number[] = [200]) {
  const t0 = Date.now();
  try {
    const cevap = await fetch(`http://127.0.0.1:${PORT}${yol}`, {
      method: govde ? "POST" : "GET",
      headers: govde ? { "content-type": "application/json" } : undefined,
      body: govde ? JSON.stringify(govde) : undefined,
    });
    const veri = (await cevap.json()) as Record<string, unknown>;
    const ms = Date.now() - t0;

    if (!beklenen.includes(cevap.status)) {
      basarisiz++;
      console.log(
        `FAIL ${ad.padEnd(30)} ${cevap.status} beklenen ${beklenen.join("/")}  ${String(veri.hata ?? "")}`,
      );
      return null;
    }
    console.log(
      `OK   ${ad.padEnd(30)} ${cevap.status}  ${ms} ms  ${JSON.stringify(veri).slice(0, 90)}`,
    );
    return veri;
  } catch (hata) {
    basarisiz++;
    console.log(`FAIL ${ad.padEnd(30)} ${(hata as Error).message}`);
    return null;
  }
}

try {
  await bekleVeKacOlmam();
  console.log("Sunucu ayakta.\n");

  await test("GET /api/sources", "/api/sources");
  await test("GET /api/downloads", "/api/downloads");
  await test("GET /api/workspace", "/api/workspace");
  await test("ISBN (kontrol basamağı yanlış)", "/api/isbn", { isbn: "9780131103628" }, [400]);

  // Statik dosyalar JSON donmez; ayri dogruluyoruz.
  try {
    const s = await fetch(`http://127.0.0.1:${PORT}/`);
    const html = await s.text();
    if (!s.ok) basarisiz++;
    console.log(
      `${s.ok ? "OK  " : "FAIL"} ${"GET / (statik)".padEnd(30)} ${s.status}  ${html.length} bayt HTML`,
    );
    const c = await fetch(`http://127.0.0.1:${PORT}/app.js`);
    const js = await c.text();
    if (!c.ok) basarisiz++;
    console.log(
      `${c.ok ? "OK  " : "FAIL"} ${"GET /app.js".padEnd(30)} ${c.status}  ${js.length} bayt JS`,
    );
  } catch (hata) {
    basarisiz++;
    console.log(`FAIL statik dosyalar — ${(hata as Error).message}`);
  }

  const arama = process.argv.includes("--live")
    ? await test("POST /api/search (makale)", "/api/search", {
        baslik: "Attention Is All You Need",
        yazar: "Vaswani",
        yil: 2017,
        tur: "makale",
        limit: 5,
      })
    : null;

  if (arama) {
    const gruplar = arama.gruplar as { baslik: string; puan: number; kaynaklar: unknown[] }[];
    console.log(
      `     -> ${gruplar.length} grup, en iyi: ${gruplar[0]?.baslik} (${gruplar[0]?.puan.toFixed(2)})`,
    );
    const durumlar = arama.kaynakDurumlari as { ad: string; sonucSayisi: number }[];
    console.log(`     -> kaynaklar: ${durumlar.map((d) => `${d.ad}=${d.sonucSayisi}`).join(", ")}`);
  }

  // Girdi dogrulama: bu rotalar 4xx donmeli, sunucu cokmemeli.
  await test("search (baslik yok)", "/api/search", { yazar: "x" }, [400]);
  await test("search (bozuk yil)", "/api/search", { baslik: "x", yil: 9999 }, [400]);
  await test("search (kesirli limit)", "/api/search", { baslik: "x", limit: 1.5 }, [400]);
  await test("download (javascript:)", "/api/download", { url: "javascript:alert(1)" }, [400]);
  await test(
    "download (olmayan host)",
    "/api/download",
    { url: "https://example.invalid/x.pdf" },
    [502],
  );
  await test(
    "kapak (izin disi alan)",
    `/api/kapak?url=${encodeURIComponent("https://kotu.example.com/a.jpg")}`,
    undefined,
    [403],
  );
  await test("GET /api/custom-sources", "/api/custom-sources");
  await test("POST /api/cache/clear", "/api/cache/clear", {});
  process.exitCode = basarisiz ? 1 : 0;

  console.log("\n--- sunucu cikisi ---");
  console.log(sunucuCikti.trim().split("\n").slice(0, 5).join("\n"));
} finally {
  if (cocuk.exitCode === null) {
    cocuk.kill();
    await once(cocuk, "exit").catch(() => {});
  }
  await geciciyiTemizle();
  console.log("\nSunucu kapatildi.");
}
async function geciciyiTemizle() {
  const relative = path.relative(os.tmpdir(), temporary);
  if (
    !relative.startsWith("kaynak-bul-smoke-") ||
    relative.includes("..") ||
    path.isAbsolute(relative)
  )
    throw Error("Geçici dizin sınır dışında");
  await fs.rm(temporary, { recursive: true, force: true });
}
