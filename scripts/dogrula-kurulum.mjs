/*
 * Klon -> calisir kabul olcutunun otomatik testi.
 *
 * Bu betik CI'da calisir. Amaci: biri projeyi klonlayip
 * "npm install && npm start" dediginde GERCEKTEN calistigini kanitlamak.
 *
 * Kontrol edilenler:
 *   1) Gerekli dosyalar depoda var mi
 *   2) Sunucu ayaga kalkiyor mu
 *   3) /api/saglik "ok" diyor mu
 *   4) Kaynaklar yuklendi mi
 *   5) Arayuz sayfasi sunuluyor mu
 *   6) Temel API rotalari yanit veriyor mu
 *
 * Cevrimdisi calisir: gercek kaynaklara istek atmaz.
 *
 * Kullanim:
 *   node scripts/dogrula-kurulum.mjs
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kodDizini = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(kodDizini, "..");
const PORT = process.env.DOGRULAMA_PORT || "3399";

const c = {
  yesil: "\u001b[32m",
  kirmizi: "\u001b[31m",
  soluk: "\u001b[90m",
  kalin: "\u001b[1m",
  sifir: "\u001b[0m",
};

let basarisiz = 0;
const adimlar = [];

function ad(name, gecti, not = "") {
  adimlar.push({ name, gecti, not });
  if (!gecti) basarisiz++;
  const isaret = gecti ? `${c.yesil}✓${c.sifir}` : `${c.kirmizi}✗${c.sifir}`;
  const ek = not ? ` ${c.soluk}${not}${c.sifir}` : "";
  console.log(`  ${isaret} ${name}${ek}`);
}

/* --- 1) Depoda olmasi gereken dosyalar ------------------------------------ */

console.log(`\n${c.kalin}Dosyalar${c.sifir}`);

const GEREKLILER = [
  "package.json",
  "tsconfig.json",
  "src/server.ts",
  "src/config.ts",
  "src/registry.ts",
  "src/types.ts",
  "public/index.html",
  "public/app.js",
  "public/style.css",
  ".env.example",
  "README.md",
  "baslat.bat",
  "baslat.sh",
];

for (const d of GEREKLILER) {
  ad(`${d} var`, fs.existsSync(path.join(kok, d)));
}

// Kaynak klasörü dolu mu?
const kaynakDizini = path.join(kok, "src", "sources");
let kaynakDosyalari = [];
try {
  kaynakDosyalari = fs.readdirSync(kaynakDizini).filter((f) => f.endsWith(".ts"));
} catch {
  /* ad yukarida zaten kontrol edildi */
}
ad(`src/sources/ dolu (${kaynakDosyalari.length} dosya)`, kaynakDosyalari.length > 0);

/* --- 2) Sunucuyu baslat ---------------------------------------------------- */

console.log(`\n${c.kalin}Sunucu${c.sifir}`);

if (basarisiz > 0) {
  console.log(`\n${c.kirmizi}Dosya eksik, sunucu denenmedi.${c.sifir}\n`);
  process.exit(1);
}

/*
 * Sunucuyu dogrudan tsx ile baslatiyoruz (npx/c npm uzerinden dolasmak
 * yerine). Windows'ta npm script'leri .cmd dosyalardir ve shell:false
 * ile cagrilamaz; bu yuzden dogru yolu isletiyoruz.
 */
function sunucuKomutu() {
  const tsxJs = path.join(kok, "node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxJs)) return null;
  return { dosya: process.execPath, argumanlar: [tsxJs, "src/server.ts"] };
}

const komut = sunucuKomutu();
if (!komut) {
  console.log(`  ${c.kirmizi}✗${c.sifir} node_modules/tsx bulunamadı — "npm install" çalıştırın`);
  process.exit(1);
}

const cocuk = spawn(komut.dosya, komut.argumanlar, {
  cwd: kok,
  env: { ...process.env, PORT, CONTACT_EMAIL: "ci@example.org" },
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});

let sunucuCikti = "";
cocuk.stdout.on("data", (d) => {
  sunucuCikti += String(d);
});
cocuk.stderr.on("data", (d) => {
  sunucuCikti += String(d);
});

function temizle() {
  try {
    cocuk.kill();
  } catch {
    /* zaten kapanmis */
  }
}

/** Sunucu ayaga kalkana kadar bekler. */
async function bekle() {
  for (let i = 0; i < 60; i++) {
    if (cocuk.exitCode !== null) return false;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/saglik`);
      if (r.ok) return true;
    } catch {
      /* henuz dinlemiyor */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ayakta = await bekle();

if (!ayakta) {
  console.log(`  ${c.kirmizi}✗${c.sifir} sunucu ayaga kalkamadı`);
  console.log(`\n${c.soluk}Sunucu çıktısı:\n${sunucuCikti}${c.sifir}\n`);
  temizle();
  await once(cocuk, "exit").catch(() => {});
  process.exit(1);
}

ad("sunucu ayaga kalkti", true);

/* --- 3) Uctan uca kontrol ------------------------------------------------ */

const kokAdres = `http://127.0.0.1:${PORT}`;

async function json(yol) {
  try {
    const r = await fetch(kokAdres + yol);
    return { kod: r.status, veri: await r.json().catch(() => ({})) };
  } catch (e) {
    return { kod: 0, veri: {}, hata: e instanceof Error ? e.message : String(e) };
  }
}

const saglik = await json("/api/saglik");
ad("GET /api/saglik → 200", saglik.kod === 200, `kod: ${saglik.kod}`);
ad("durum: ok", saglik.veri.durum === "ok", `durum: ${saglik.veri.durum}`);
ad("sürüm bildiriliyor", Boolean(saglik.veri.surum), `sürüm: ${saglik.veri.surum}`);
ad(
  "hazır kaynak var",
  (saglik.veri.kaynak?.hazir ?? 0) > 0,
  `${saglik.veri.kaynak?.hazir ?? 0} hazır`,
);
ad(
  "yükleme hatası yok",
  (saglik.veri.kaynak?.yuklenmeHatalari?.length ?? 0) === 0,
  JSON.stringify(saglik.veri.kaynak?.yuklenmeHatalari ?? []).slice(0, 120),
);

const kaynaklar = await json("/api/sources");
ad("GET /api/sources → 200", kaynaklar.kod === 200);
ad(
  "kaynak listesi dolu",
  (kaynaklar.veri.kaynaklar?.length ?? 0) > 0,
  `${kaynaklar.veri.kaynaklar?.length ?? 0} kaynak`,
);

// Arayüz sunuluyor mu?
try {
  const r = await fetch(kokAdres + "/");
  const html = await r.text();
  ad("GET / → 200", r.ok, `kod: ${r.status}`);
  // Doctype kucuk harfli olabilir (prettier'da "<!doctype html>")
  const doctypeVar = /^\s*<!doctype html>/i.test(html);
  ad("GET / → HTML", doctypeVar, `${html.length} bayt`);
  ad("arayüz uygulamayı yüklüyor", html.includes("app.js"));
  // Bozuk id' olmamali (2026'da bu bir hataya yol açti)
  ad("id'ler geçerli", !/\bid="[^"]*\s[^"]*"/.test(html));
} catch {
  ad("GET / → 200", false);
}

try {
  const r = await fetch(kokAdres + "/app.js");
  const js = await r.text();
  ad("GET /app.js → JS", r.ok && js.length > 1000, `${js.length} bayt`);
} catch {
  ad("GET /app.js → JS", false);
}

// Girdi doğrulaması çalışıyor mu?
const bosArama = await fetch(kokAdres + "/api/search", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ yazar: "x" }),
});
ad("POST /api/search (başlık yok) → 400", bosArama.status === 400, `kod: ${bosArama.status}`);

const kotuUrl = await fetch(kokAdres + "/api/download", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: "javascript:alert(1)" }),
});
ad("POST /api/download (javascript:) → 400", kotuUrl.status === 400, `kod: ${kotuUrl.status}`);

const kotuKapak = await fetch(
  kokAdres + "/api/kapak?url=" + encodeURIComponent("https://kotu.example/a.jpg"),
);
ad("GET /api/kapak (izin dışı) → 403", kotuKapak.status === 403, `kod: ${kotuKapak.status}`);

/* --- 4) Zarif kapanis ---------------------------------------------------- */

console.log(`\n${c.kalin}Kapanış${c.sifir}`);

cocuk.kill("SIGTERM");
const kapandi = await Promise.race([
  once(cocuk, "exit").then(() => true),
  new Promise((r) => setTimeout(() => r(false), 6000)),
]);
ad("SIGTERM ile düzgün kapandı", kapandi);

if (!kapandi) temizle();

/* --- Sonuc ---------------------------------------------------------------- */

console.log("");
if (basarisiz === 0) {
  console.log(
    `${c.yesil}${c.kalin}Kurulum doğrulandı — ${adimlar.length}/${adimlar.length} kontrol geçti.${c.sifir}`,
  );
  console.log(`${c.soluk}  "npm install && npm start" yolu çalışıyor.${c.sifir}\n`);
  process.exit(0);
} else {
  console.log(`${c.kirmizi}${c.kalin}${basarisiz} kontrol başarısız:${c.sifir}`);
  for (const a of adimlar.filter((x) => !x.gecti)) {
    console.log(`  ${c.kirmizi}✗${c.sifir} ${a.name}${a.not ? ` (${a.not})` : ""}`);
  }
  if (sunucuCikti.trim()) {
    console.log(`\n${c.soluk}Sunucu çıktısı:\n${sunucuCikti}${c.sifir}`);
  }
  console.log("");
  process.exit(1);
}
