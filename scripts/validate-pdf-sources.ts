import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { katalogdaAra, type KitapKaynagi } from "../src/book-catalog.js";
import { pdfYanitiniBul } from "../src/pdf-resolver.js";
import { sinirliGovde } from "../src/body.js";
import { sureSinirli } from "../src/deadline.js";
import { ayar } from "../src/config.js";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const durumlar: Record<string, unknown>[] = [];
await fs.mkdir(".data/pdf-validation", { recursive: true });
for (const [kaynak, baslik] of [
  ["oapen", "Multilevel Social Citizenship"],
  ["doab", "A World of Nourishment"],
] as const) {
  const bas = Date.now();
  try {
    const bulunan = await katalogdaAra(kaynak as KitapKaynagi, { baslik, tur: "kitap", limit: 5 });
    const eser = bulunan.find((w) => w.baslik === baslik);
    if (!eser) throw Error("Beklenen tam başlık indekste bulunamadı");
    const adresler = [
      ...new Set(
        [eser.pdf, ...(eser.pdfAdaylari ?? []).map((a) => a.url), eser.link].filter(
          (u): u is string => Boolean(u),
        ),
      ),
    ];
    const bayt = await sureSinirli(
      async () => sinirliGovde(await pdfYanitiniBul(adresler), 50 * 1024 * 1024),
      90000,
    );
    const sha256 = createHash("sha256").update(bayt).digest("hex");
    const baytSayisi = bayt.length; // pdf.js ArrayBuffer'ı worker'a aktarabilir.
    await fs.writeFile(`.data/pdf-validation/${kaynak}.pdf`, bayt);
    const is = pdfjs.getDocument({
      data: bayt,
      useSystemFonts: false,
      disableFontFace: true,
      verbosity: 0,
    });
    try {
      const pdf = await is.promise;
      const sayfaMetinleri = [];
      for (let i = 1; i <= Math.min(8, pdf.numPages); i++) {
        const text = await (await pdf.getPage(i)).getTextContent();
        sayfaMetinleri.push(text.items.map((v) => ("str" in v ? v.str : "")).join(" "));
      }
      const metin = sayfaMetinleri.join(" ").normalize("NFKD").replace(/\s+/g, " ").toLowerCase();
      const baslikGoruldu = metin.includes(baslik.toLowerCase());
      durumlar.push({
        kaynak,
        baslik,
        eser,
        durum: "COMPLETED",
        bayt: baytSayisi,
        sha256,
        sayfa: pdf.numPages,
        ilkSayfalardaBaslikGoruldu: baslikGoruldu,
        sureMs: Date.now() - bas,
        sinir:
          "Bu örnekte dosya açıldı ve ilk sayfalarda başlık arandı. Genel otomatik dosya-kimlik doğrulaması henüz ürün özelliği değildir.",
      });
    } finally {
      await is.destroy();
    }
  } catch (e) {
    durumlar.push({
      kaynak,
      baslik,
      durum: /HTTP (403|429)/.test(e instanceof Error ? e.message : String(e))
        ? "EXTERNAL_LIMIT"
        : "FAILED",
      hata: e instanceof Error ? e.message : String(e),
      sureMs: Date.now() - bas,
    });
    process.exitCode = 1;
  }
}
const rapor = {
  tarih: new Date().toISOString(),
  yapilandirma: {
    unpaywallEpostaVar: Boolean(ayar.unpaywallEmail),
    openalexAnahtarVar: Boolean(ayar.openalexKey),
  },
  durumlar,
};
await fs.writeFile(
  "reports/pdf-new-sources-live-2026-10-22.json",
  JSON.stringify(rapor, null, 2) + "\n",
);
console.log(JSON.stringify(rapor));
