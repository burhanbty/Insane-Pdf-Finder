import { uygulama } from "./app.js";
import { ayar } from "./config.js";
import { acilisRaporu, ilkCalistirmaHazirligi } from "./hazirlik.js";
import { kaynaklariYukle, yuklenmeHataListesi } from "./registry.js";
import { nodeDestekleniyor, NODE_GEREKSINIMI } from "../scripts/runtime.mjs";

/* --------------------------------- calistir ------------------------------ */

/*
 * Acilis sirasi:
 *   1) Node surumu uygun mu?
 *   2) .env / dizinler hazir mi?
 *   3) Kaynaklar yukleniyor
 *   4) Sunucu dinlemeye basliyor (port hatasi insanlikca anlatiliyor)
 *
 * Bu siranin her adimi acikca yaziyoruz: kullanici "neden calismiyor"
 * sorusunu terminal ciktisindan cevaplayabilmeli.
 */

const c = {
  yesil: "\u001b[32m",
  sari: "\u001b[33m",
  kirmizi: "\u001b[31m",
  soluk: "\u001b[90m",
  kalin: "\u001b[1m",
  sifir: "\u001b[0m",
};

/* --- 1) Node surumu ------------------------------------------------------ */

if (!nodeDestekleniyor(process.versions.node)) {
  console.error("");
  console.error(`${c.kirmizi}${c.kalin}${NODE_GEREKSINIMI} gerekli.${c.sifir}`);
  console.error(`${c.kirmizi}Şu an Node ${process.versions.node} çalışıyor.${c.sifir}`);
  console.error(`${c.soluk}Kurulum: https://nodejs.org${c.sifir}`);
  console.error("");
  process.exit(1);
}

/* --- 2) Ilk calistirma hazirligi ------------------------------------------ */

const hazirlik = ilkCalistirmaHazirligi();

/* --- 3) Kaynaklar --------------------------------------------------------- */

const yuklenen = await kaynaklariYukle();
const yuklenmeHatalari = yuklenmeHataListesi();

acilisRaporu(hazirlik, yuklenen.length, yuklenmeHatalari);

/* --- 4) Sunucu ------------------------------------------------------------ */

const dinleyici = uygulama.listen(ayar.port, ayar.host);

dinleyici.on("error", (hata: NodeJS.ErrnoException) => {
  if (hata.code === "EADDRINUSE") {
    console.error(`${c.kirmizi}${c.kalin}Port ${ayar.port} zaten kullanımda.${c.sifir}`);
    console.error("");
    console.error("  Başka bir program o portu tutuyor. Üç seçeneğin var:");
    console.error("");
    console.error(`    1) Farklı port ile başlat:      PORT=3001 npm start`);
    console.error(`       Windows'ta:  set PORT=3001 && npm start`);
    console.error(`    2) Portu kullanan programı kapat`);
    console.error(`    3) .env dosyasına PORT=3001 yaz`);
    console.error("");
    process.exit(1);
  }

  if (hata.code === "EACCES") {
    console.error(`${c.kirmizi}${c.kalin}Port ${ayar.port} için izin yok.${c.sifir}`);
    console.error(
      `${c.soluk}1024 altı portlar bazı sistemlerde rezervedir. Farklı port deneyin.${c.sifir}`,
    );
    process.exit(1);
  }

  if ((hata as NodeJS.ErrnoException).code === "EADDRNOTAVAIL") {
    console.error(`${c.kirmizi}${c.kalin}Adres bulunamadı: ${ayar.host}${c.sifir}`);
    console.error(`${c.soluk}HOST değerini kontrol edin (örn. HOST=127.0.0.1).${c.sifir}`);
    process.exit(1);
  }

  console.error(`${c.kirmizi}${c.kalin}Sunucu başlatılamadı: ${hata.message}${c.sifir}`);
  process.exit(1);
});

dinleyici.on("listening", () => {
  const adres = `http://${ayar.host}:${ayar.port}`;
  console.log(`  ${c.yesil}→${c.sifir} ${c.kalin}${adres}${c.sifir}`);
  console.log("");
  console.log(`${c.soluk}  Durdurmak için Ctrl+C${c.sifir}`);
  console.log("");
});

/* --- Zarif kapanis ------------------------------------------------------- */

let kapaniyor = false;
function kapat(sinyal: string) {
  if (kapaniyor) return;
  kapaniyor = true;
  console.log(`\n${c.soluk}${sinyal} alındı, kapatılıyor…${c.sifir}`);

  dinleyici.close(() => process.exit(0));

  // Açık istekler varsa 5 saniye bekleyip zorla çıkıyoruz.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => kapat("SIGINT"));
process.on("SIGTERM", () => kapat("SIGTERM"));
