import fs from "node:fs";
import path from "node:path";
import { ayar, SURUM } from "./config.js";

/*
 * Ilk calistirma hazirligi.
 *
 * Amac: birisi projeyi klonladiginda ek bir sey yapmadan calissin.
 * Su an .env yoksa program sessizce varsayilanlarla calisiyor ve
 * kullanici neden bazi kaynaklarin kapali oldugunu anlamiyor.
 */

export interface Hazirlik {
  envYaratildi: boolean;
  eksikDizinler: string[];
  uyarilar: string[];
}

/**
 * .env dosyasi yoksa .env.example'dan uretir.
 *
 * Anahtarlar bos birakilir; kullanici doldurmak zorunda degildir, sadece
 * doldurursa o kaynaklar acilir.
 */
function envKontrol(yol: string): { yaratildi: boolean; uyari: string | null } {
  if (fs.existsSync(yol)) return { yaratildi: false, uyari: null };

  try {
    fs.writeFileSync(
      yol,
      [
        "# Otomatik olusturuldu: " + new Date().toISOString(),
        "# Buradaki degerleri doldurmaniz SART DEGIL. Bos birakilirsa",
        "# program calisir; yalnizca o degerlere bagli kaynaklar kapali kalir.",
        "",
        "# E-posta: Open Library ve Unpaywall bunu ister. Kota 3 katina cikar.",
        "CONTACT_EMAIL=",
        "",
        "# Google Books API anahtari (https://www.googleapis.com/books/v1/volumes?q=test)",
        "GOOGLE_BOOKS_API_KEY=",
        "",
        "# Semantic Scholar API anahtari (https://www.semanticscholar.org/product/api)",
        "SEMANTIC_SCHOLAR_API_KEY=",
        "",
        "# Opsiyonel: ozet icin LLM. Bos ise anahtar kelime yontemi kullanilir.",
        "LLM_BASE_URL=",
        "LLM_API_KEY=",
        "LLM_MODEL=gpt-4o-mini",
        "",
      ].join("\n"),
      "utf8",
    );
    return { yaratildi: true, uyari: null };
  } catch {
    // Yazma iznimiz yoksa (salt okunur dizin gibi) sessizce geçiyoruz.
    return {
      yaratildi: false,
      uyari: `.env oluşturulamadı (yazma izni yok). Ayarlar varsayılanlarla kullanılıyor.`,
    };
  }
}

/**
 * Calisma icin gereken dizinleri olusturur.
 * Kaynak dizini ve public/ olmazsa program neden calismadigini
 * anlatamaz; burada erken uyari veriyoruz.
 */
function dizinKontrol(): { eksik: string[]; uyarilar: string[] } {
  const eksik: string[] = [];
  const uyarilar: string[] = [];

  for (const [ad, yol] of [
    ["downloads", ayar.downloadsDir],
    [".cache", ayar.cacheDir],
  ] as const) {
    if (fs.existsSync(yol)) continue;
    try {
      fs.mkdirSync(yol, { recursive: true });
    } catch {
      eksik.push(ad);
      uyarilar.push(`"${ad}" klasörü oluşturulamadı (${yol}) — indirme ve önbellek çalışmayabilir`);
    }
  }

  // Kaynak dizini kayit defterinin okunmasi icin sart.
  if (!fs.existsSync(ayar.sourcesDir)) {
    uyarilar.push(`Kaynak klasörü bulunamadı: ${ayar.sourcesDir} — arama çalışmayacak`);
  }

  if (!fs.existsSync(ayar.publicDir)) {
    uyarilar.push(`Arayüz klasörü bulunamadı: ${ayar.publicDir} — sayfa açılmayacak`);
  }

  return { eksik, uyarilar };
}

/** Anahtar gerektiren ama anahtari olmayan kaynaklari listeler. */
function eksikAnahtarUyarisi(): string[] {
  const uyarilar: string[] = [];

  if (!ayar.contactEmail) {
    uyarilar.push(
      "CONTACT_EMAIL boş: Open Library ve Unpaywall yavaş çalışır " +
        "(1 istek/sn, ücretsiz e-posta ile 3 istek/sn olur)",
    );
  }
  if (!ayar.googleBooksKey) {
    uyarilar.push("GOOGLE_BOOKS_API_KEY boş: Google Books kaynağı kapalı");
  }
  if (!ayar.semanticScholarKey) {
    uyarilar.push("SEMANTIC_SCHOLAR_API_KEY boş: Semantic Scholar çok yavaş çalışır");
  }

  return uyarilar;
}

/** Sunucu acilirken cagrilir. */
export function ilkCalistirmaHazirligi(): Hazirlik {
  const env = envKontrol(path.join(ayar.projeKok, ".env"));
  const dizinler = dizinKontrol();

  const uyarilar = [...dizinler.uyarilar];
  if (env.uyari) uyarilar.push(env.uyari);
  uyarilar.push(...eksikAnahtarUyarisi());

  return {
    envYaratildi: env.yaratildi,
    eksikDizinler: dizinler.eksik,
    uyarilar,
  };
}

/** Konsola basilan acilis raporu. */
export function acilisRaporu(sonuc: Hazirlik, kaynakSayisi: number, yuklenmeHatalari: unknown[]) {
  const c = {
    yesil: "\u001b[32m",
    sari: "\u001b[33m",
    kirmizi: "\u001b[31m",
    soluk: "\u001b[90m",
    sifir: "\u001b[0m",
  };

  console.log("");
  console.log(`${c.soluk}  Kaynak Bul v${SURUM}${c.sifir}`);
  console.log(`${c.soluk}  proje: ${ayar.projeKok}${c.sifir}`);
  console.log(`${c.soluk}  kaynak: ${ayar.sourcesDir}${c.sifir}`);
  console.log("");

  if (sonuc.envYaratildi) {
    console.log(
      `  ${c.yesil}✓${c.sifir} .env oluşturuldu (anahtarlar boş, doldurmanız şart değil)`,
    );
  }

  if (kaynakSayisi > 0) {
    console.log(`  ${c.yesil}✓${c.sifir} ${kaynakSayisi} kaynak yüklendi`);
  } else {
    console.log(`  ${c.kirmizi}✗${c.sifir} hiç kaynak yüklenemedi — arama çalışmayacak`);
  }

  for (const h of yuklenmeHatalari as { dosya: string; hata: string }[]) {
    console.log(`  ${c.sari}!${c.sifir} ${h.dosya}: ${h.hata}`);
  }

  if (sonuc.uyarilar.length) {
    console.log("");
    console.log(`  ${c.sari}Uyarılar:${c.sifir}`);
    for (const u of sonuc.uyarilar) console.log(`    ${c.soluk}·${c.sifir} ${u}`);
  }

  console.log("");
}
