#!/usr/bin/env node
/*
 * Ortak baslatma betigi.
 *
 * Windows (.bat), macOS/Linux (.sh) ikisi de bunu cagirir; boylece
 * mantik tek yerde durur ve iki platformun davranisi ayrismaz.
 *
 * Yaptigi isler:
 *   1) Node surumunu kontrol eder
 *   2) Gerekli duzenleri hazirlar (.env, downloads, .cache)
 *   3) Tarayiciyi acar (opsiyonel, OPEN_BROWSER=0 ile kapatilir)
 *   4) Sunucuyu baslatir; hata olursa anlasilir mesaj verir
 *
 * Kullanim:
 *   node scripts/baslat.mjs            -> sunucuyu baslatir
 *   node scripts/baslat.mjs --kurulum  -> yalnizca kurulumu yapar
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const kodDizini = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(kodDizini, "..");

const c = {
  yesil: "\u001b[32m",
  sari: "\u001b[33m",
  kirmizi: "\u001b[31m",
  soluk: "\u001b[90m",
  kalin: "\u001b[1m",
  sifir: "\u001b[0m",
};

const kurulumOnly = process.argv.includes("--kurulum");
const tarayiciAc = process.env.OPEN_BROWSER !== "0";

/* --- Node surumu --------------------------------------------------------- */

const SURUM_DESTEK = 20;
const nodeAna = Number(process.versions.node.split(".")[0] ?? 0);
if (!Number.isFinite(nodeAna) || nodeAna < SURUM_DESTEK) {
  console.error(
    `${c.kirmizi}${c.kalin}Node.js ${SURUM_DESTEK}+ gerekli. Şu an: ${process.versions.node}${c.sifir}`,
  );
  console.error(`${c.soluk}  Kurulum: https://nodejs.org${c.sifir}`);
  process.exit(1);
}

/* --- Dizinler ------------------------------------------------------------ */

function hazirla() {
  for (const ad of ["downloads", ".cache"]) {
    const yol = path.join(kok, ad);
    if (fs.existsSync(yol)) continue;
    try {
      fs.mkdirSync(yol, { recursive: true });
      console.log(`  ${c.yesil}✓${c.sifir} ${ad}/ oluşturuldu`);
    } catch (hata) {
      console.error(`  ${c.kirmizi}✗${c.sifir} ${ad}/ oluşturulamadı: ${hata.message}`);
    }
  }

  const envYol = path.join(kok, ".env");
  if (!fs.existsSync(envYol)) {
    fs.writeFileSync(
      envYol,
      [
        "# Otomatik oluşturuldu.",
        "# Anahtarları doldurman şart değil — boş bırakılırsa program çalışır,",
        "# yalnızca o değerlere bağlı kaynaklar kapalı kalır.",
        "",
        "CONTACT_EMAIL=",
        "GOOGLE_BOOKS_API_KEY=",
        "SEMANTIC_SCHOLAR_API_KEY=",
        "LLM_BASE_URL=",
        "LLM_API_KEY=",
        "LLM_MODEL=gpt-4o-mini",
        "",
      ].join("\n"),
      "utf8",
    );
    console.log(`  ${c.yesil}✓${c.sifir} .env oluşturuldu (anahtarlar boş)`);
  }
}

/* --- Bagimliliklar ------------------------------------------------------- */

const nodeModuler = path.join(kok, "node_modules");
if (!fs.existsSync(nodeModuler)) {
  console.log(`  ${c.sari}…${c.sifir} paketler kuruluyor (ilk sefer, biraz sürebilir)`);

  const kurulum = spawn("npm", ["install"], {
    cwd: kok,
    stdio: "inherit",
    shell: os.platform() === "win32",
  });

  kurulum.on("error", (hata) => {
    console.error(`${c.kirmizi}npm bulunamadı.${c.sifir} Node.js'i npm ile kurun.`);
    console.error(`  ${c.soluk}${hata.message}${c.sifir}`);
    process.exit(1);
  });

  kurulum.on("exit", (kod) => {
    if (kod !== 0) {
      console.error(`${c.kirmizi}paket kurulumu başarısız (${kod}).${c.sifir}`);
      process.exit(kod ?? 1);
    }
    kurulumTamam(kurulumOnly);
  });
} else {
  kurulumTamam(kurulumOnly);
}

/* --- Sunucu -------------------------------------------------------------- */

function kurulumTamam(sadeceKurulum) {
  hazirla();

  if (sadeceKurulum) {
    console.log(`\n${c.yesil}Kurulum tamam. Başlatmak için:${c.sifir}`);
    console.log(`  ${c.soluk}npm start${c.sifir}`);
    console.log("");
    return;
  }

  const port = process.env.PORT || "3000";
  const adres = `http://127.0.0.1:${port}`;

  // Sunucu birkaç saniye sonra ayakta olacağı için gecikmeli açıyoruz.
  if (tarayiciAc) {
    const bekle = setTimeout(() => {
      const komut =
        os.platform() === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      const arguman = os.platform() === "win32" ? ["/c", "start", "", adres] : [adres];
      spawn(komut, arguman, { stdio: "ignore", detached: true, shell: os.platform() === "win32" })
        .on("error", () => {
          /* tarayıcı açılamadıysa sorun değil, adresi konsola yazdık */
        })
        .unref();
    }, 2500);
    bekle.unref();
  }

  const sunucu = spawn("npm", ["start"], {
    cwd: kok,
    stdio: "inherit",
    shell: os.platform() === "win32",
  });

  sunucu.on("exit", (kod) => process.exit(kod ?? 0));

  // Ctrl+C hem alt sürece hem bize sinyal gönderiyor.
  process.on("SIGINT", () => sunucu.kill("SIGINT"));
  process.on("SIGTERM", () => sunucu.kill("SIGTERM"));
}
