import { disAdres } from "./network.js";
import { doiAnahtari } from "./doi.js";
import type { PdfAdayi, Work } from "./types.js";

export function adayAdresi(adres?: string): string | undefined {
  if (typeof adres !== "string" || adres.length > 2000) return undefined;
  try {
    const u = disAdres(adres);
    u.hash = "";
    return u.href;
  } catch {
    return undefined;
  }
}

export function pdfAdaylariniBirlestir(...listeler: (PdfAdayi[] | undefined)[]): PdfAdayi[] {
  const adaylar = new Map<string, PdfAdayi>();
  for (const aday of listeler.flatMap((l) => l ?? [])) {
    const url = adayAdresi(aday.url);
    if (!url || !aday.kaynak) continue;
    const doi = doiAnahtari(aday.doi);
    if (doi && [doiAnahtari(url), doiAnahtari(aday.kayitUrl)].some((d) => d && d !== doi)) continue;
    const onceki = adaylar.get(url);
    adaylar.set(url, {
      url,
      kaynak: onceki?.kaynak ?? aday.kaynak,
      kayitUrl: onceki?.kayitUrl ?? adayAdresi(aday.kayitUrl),
      doi: onceki?.doi ?? doi,
      lisans: onceki?.lisans ?? aday.lisans,
      surum: onceki?.surum ?? aday.surum,
      hostTuru: onceki?.hostTuru ?? aday.hostTuru,
      baglantiTuru: onceki?.baglantiTuru ?? aday.baglantiTuru ?? "pdf",
      durum: "aday",
    });
    if (adaylar.size >= 30) break;
  }
  return [...adaylar.values()].sort(
    (a, b) => Number(a.baglantiTuru === "kayit") - Number(b.baglantiTuru === "kayit"),
  );
}

export function eserinPdfAdaylari(w: Work): PdfAdayi[] {
  return pdfAdaylariniBirlestir(
    w.pdf ? [{ url: w.pdf, kaynak: w.kaynak, kayitUrl: w.link, doi: w.doi, durum: "aday" }] : [],
    w.pdfAdaylari,
  );
}
