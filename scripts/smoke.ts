/*
 * Duman testi: gercek kaynaklara istek atar, sunucu acmadan calisir.
 * Kullanim:  npx tsx scripts/smoke.ts "baslik" "yazar" 2011 [kitap|makale|slayt]
 */

import { ara } from "../src/search.js";
import { kaynaklariYukle, kaynakListesi } from "../src/registry.js";

const [, , baslikArg = "Sapiens: A Brief History of Humankind", yazarArg = "Yuval Noah Harari", yilArg = "2011", turArg = "kitap"] = process.argv;

const baslik = baslikArg;
const yazar = yazarArg.trim() ? yazarArg : undefined;
const yil = yilArg && yilArg !== "0" ? Number(yilArg) : undefined;
const tur = (turArg || "kitap") as "kitap" | "makale" | "slayt";

await kaynaklariYukle();
console.log("Kaynaklar:", kaynakListesi().map((k) => `${k.id}${k.hazir ? "" : "(kapali)"}`).join(", "));
console.log(`\nArama: "${baslik}" / ${yazar ?? "-"} / ${yil ?? "-"} / ${tur}\n`);

const cevap = await ara({ baslik, yazar, yil, tur, limit: 8 });

console.log(`Sure: ${cevap.sureMs} ms | ham kayit: ${cevap.toplamSonuc} | grup: ${cevap.gruplar.length}\n`);

console.log("Kaynak durumlari:");
for (const d of cevap.kaynakDurumlari) {
  const durum = d.hataMesaji ? `HATA: ${d.hataMesaji}` : `${d.sonucSayisi} sonuc`;
  console.log(`  ${d.ad.padEnd(26)} ${durum}`);
}

console.log("\nGruplar:");
for (const g of cevap.gruplar.slice(0, 5)) {
  console.log(`\n  [${g.puan.toFixed(2)}] ${g.baslik}`);
  console.log(`      yazar: ${g.yazarlar.slice(0, 3).join(", ") || "-"} | yil: ${g.yil ?? "-"}`);
  console.log(`      kaynaklar: ${g.kaynaklar.map((k) => `${k.kaynakAd}${k.pdf ? " [PDF]" : ""}`).join(", ")}`);
  if (g.kapak) console.log(`      kapak: ${g.kapak}`);
  const pdf = g.kaynaklar.find((k) => k.pdf);
  if (pdf) console.log(`      pdf: ${pdf.pdf}`);
}