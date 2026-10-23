import { katalogGuncelle, type KitapKaynagi } from "../src/book-catalog.js";

const secilen = process.argv.slice(2);
if (secilen.some((s) => !["oapen", "doab"].includes(s)))
  throw Error("Kullanım: npm run sources:sync -- [oapen] [doab]");
for (const kaynak of (secilen.length ? secilen : ["oapen", "doab"]) as KitapKaynagi[]) {
  console.log(`${kaynak}: resmî tam üstveri akışı indiriliyor`);
  try {
    const baslik = await katalogGuncelle(kaynak, (adet) =>
      console.log(`${kaynak}: ${adet} kayıt okundu`),
    );
    console.log(JSON.stringify(baslik));
  } catch (e) {
    console.error(
      `${kaynak}: güncellenemedi, önceki indeks korundu: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exitCode = 1;
  }
}
