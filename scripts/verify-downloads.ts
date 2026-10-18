/** İndirme yolunu canlı genel kaynaklarla, geçici verilerle doğrular; LLM çağırmaz. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ayar } from "../src/config.js";
import { indir } from "../src/download.js";
import { ara } from "../src/search.js";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-live-download-"));
Object.assign(ayar, {
  downloadsDir: path.join(temp, "downloads"),
  cacheDir: path.join(temp, "cache"),
  contactEmail: "",
  unpaywallEmail: "",
  googleBooksKey: "",
  semanticScholarKey: "",
});
const sonuc: Record<string, unknown>[] = [];
try {
  for (const [ad, url] of [
    ["W3C doğrudan PDF", "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"],
    ["arXiv doğrudan PDF", "https://arxiv.org/pdf/1706.03762"],
    ["arXiv kayıt sayfasından PDF", "https://arxiv.org/abs/1706.03762"],
  ]) {
    const baslangic = Date.now();
    try {
      const d = await indir({ url: url!, varsayilanAd: ad! }, "pdf");
      const b = await fs.readFile(d.yol);
      const evidence = {
        ad,
        url,
        ok: true,
        bytes: b.length,
        signature: b.subarray(0, 5).toString(),
        sha256: crypto.createHash("sha256").update(b).digest("hex"),
        ms: Date.now() - baslangic,
      };
      sonuc.push(evidence);
      console.log(JSON.stringify(evidence));
    } catch (e) {
      const evidence = {
        ad,
        url,
        ok: false,
        hata: (e as Error).message,
        ms: Date.now() - baslangic,
      };
      sonuc.push(evidence);
      console.log(JSON.stringify(evidence));
    }
  }
  const sorgu = { baslik: "Deli Kadın Mektupları", tur: "kitap" as const, limit: 5 };
  const kitap = await ara(sorgu);
  const rapor = {
    date: "2026-10-18",
    node: process.version,
    keysUsed: false,
    contactEmailUsed: false,
    downloads: sonuc,
    example: {
      sorgu,
      toplam: kitap.gruplar.length,
      eserler: kitap.gruplar.map((g) => ({
        baslik: g.baslik,
        yazarlar: g.yazarlar,
        pdf: g.kaynaklar.some((k) => Boolean(k.pdf)),
        kaynaklar: g.kaynaklar.map((k) => ({ ad: k.kaynakAd, link: k.link, pdf: k.pdf })),
      })),
      kaynaklar: kitap.kaynakDurumlari.map((k) => ({
        id: k.id,
        hazir: k.hazir,
        sonucSayisi: k.sonucSayisi,
        hata: k.hataMesaji,
      })),
    },
  };
  await fs.writeFile(
    path.join(ayar.projeKok, "reports", "pdf-live-2026-10-18.json"),
    JSON.stringify(rapor, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      exampleResults: kitap.gruplar.map((g) => g.baslik),
      sources: kitap.kaynakDurumlari.length,
    }),
  );
} finally {
  await temizle();
}
async function temizle() {
  const relative = path.relative(os.tmpdir(), temp);
  if (
    !relative.startsWith("kaynak-bul-live-download-") ||
    relative.includes("..") ||
    path.isAbsolute(relative)
  )
    throw Error("Temp boundary mismatch");
  await fs.rm(temp, { recursive: true, force: true });
}
