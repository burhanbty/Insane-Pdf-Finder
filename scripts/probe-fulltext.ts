import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getJson } from "../src/http.js";
import { tamMetniZenginlestir } from "../src/fulltext.js";
import { ayar } from "../src/config.js";
import { doiAnahtari } from "../src/doi.js";
import type { Work } from "../src/types.js";
import { ara } from "../src/search.js";

if (!ayar.unpaywallEmail)
  throw Error("Önce gerçek CONTACT_EMAIL_UNPAYWALL iletişim adresini yapılandırın");
ayar.cacheDir = path.join(ayar.projeKok, ".cache", `fulltext-validation-${randomUUID()}`);
const sonuclar = [];
for (const doi of [
  "10.1038/s41597-023-02208-w",
  "10.1371/journal.pone.0000308",
  "10.1038/s41586-021-03819-2",
]) {
  try {
    const { message: m } = await getJson<{
      message: {
        DOI: string;
        title: string[];
        author?: { given?: string; family?: string }[];
        issued?: { "date-parts"?: number[][] };
      };
    }>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      timeoutMs: 15000,
      tekrar: 0,
    });
    if (doiAnahtari(m.DOI) !== doi) throw Error("Crossref DOI uyuşmazlığı");
    const eser: Work = {
      kaynak: "crossref",
      kaynakAd: "Crossref",
      tur: "makale",
      baslik: m.title[0] ?? "",
      yazarlar: (m.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(" ")),
      yil: m.issued?.["date-parts"]?.[0]?.[0],
      doi: m.DOI,
      link: `https://doi.org/${doi}`,
    };
    const durum = await tamMetniZenginlestir([eser]);
    sonuclar.push({ doi, durum, eser });
    if (durum.hatalar.length || !eser.pdfAdaylari?.length) process.exitCode = 1;
  } catch (e) {
    sonuclar.push({ doi, hata: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  }
}
const rapor = {
  tarih: new Date().toISOString(),
  yapilandirildi: Boolean(ayar.unpaywallEmail),
  adresRaporaYazilmadi: true,
  onbellek: "Doğrulama başında yeni ve yalıtılmış önbellek",
  sinir:
    "Canlı Crossref künyesi üzerinden Unpaywall adayları; bu rapor dosya indirme/kimlik doğrulaması değildir.",
  sonuclar,
};
try {
  const arama = await ara({
    baslik: "CORE: A Global Aggregation Service for Open Access Papers",
    yazar: "Knoth",
    yil: 2023,
    tur: "makale",
    limit: 3,
  });
  await fs.writeFile(
    "reports/pdf-configured-search-live-2026-10-22.json",
    JSON.stringify(arama, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ arama: "CORE", grup: arama.gruplar.length, tamMetin: arama.tamMetinDurumu }),
  );
  if (
    !arama.gruplar.some((g) =>
      g.kaynaklar.some(
        (k) => doiAnahtari(k.doi) === "10.1038/s41597-023-02208-w" && k.pdfAdaylari?.length,
      ),
    )
  )
    process.exitCode = 1;
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
await fs.mkdir("reports", { recursive: true });
await fs.writeFile(
  "reports/pdf-fulltext-live-2026-10-22.json",
  JSON.stringify(rapor, null, 2) + "\n",
);
console.log(JSON.stringify(rapor));
