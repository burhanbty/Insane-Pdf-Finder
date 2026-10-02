/* Indirme ve ozet akisini gercek bir PDF ile dener. */

import { indir, indirilenleriListele } from "../src/download.js";
import { ozetUret } from "../src/summary.js";

const HEDEF = process.argv[2] ?? "https://arxiv.org/pdf/1706.03762";
const BASLIK = process.argv[3] ?? "Attention Is All You Need";

console.log("1) Indiriliyor:", HEDEF);
const t0 = Date.now();
const dosya = await indir({ url: HEDEF, varsayilanAd: BASLIK }, "pdf");
console.log(
  `   OK  ${dosya.dosya}  ${(dosya.boyut / 1024 / 1024).toFixed(2)} MB  (${Date.now() - t0} ms)`,
);
console.log(`   tur=${dosya.tur}`);

console.log("\n2) Ozet uretiliyor...");
const t1 = Date.now();
const ozet = await ozetUret({ url: HEDEF, tur: "pdf", baslik: BASLIK });
console.log(`   yontem: ${ozet.yontem}`);
console.log(
  `   sayfa: ${ozet.sayfaSayisi ?? "-"}  karakter: ${ozet.karakterSayisi}  (${Date.now() - t1} ms)`,
);
if (ozet.uyari) console.log(`   uyari: ${ozet.uyari}`);
console.log("\n--- OZET ---\n" + ozet.ozet.slice(0, 900));
console.log("\n--- ILK PARAGRAF ---\n" + (ozet.ilkParagraf ?? "-").slice(0, 400));

console.log("\n3) Indirilenler:");
for (const d of await indirilenleriListele()) {
  console.log(`   ${d.dosya}  ${(d.boyut / 1024).toFixed(0)} KB`);
}
