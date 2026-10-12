import { getJson } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * HAL Open Science: 4 milyondan fazla akademik araştırma yayını, doktora tezi,
 * monografi ve kitap bölümünü barındıran Avrupa açık arşiv platformu.
 * Çoğu yayının açık tam metin PDF'ini doğrudan sunar.
 */

interface HALDoc {
  docid?: string;
  title_s?: string[];
  authFullName_s?: string[];
  producedDateY_i?: number;
  doiId_s?: string;
  abstract_s?: string[];
  uri_s?: string;
  files_s?: string[];
  docType_s?: string;
}

interface HALResponse {
  response?: {
    numFound?: number;
    docs?: HALDoc[];
  };
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const terimler: string[] = [`"${sorgu.baslik.replace(/"/g, "")}"`];
  if (sorgu.yazar) {
    terimler.push(`authFullName_t:"${sorgu.yazar.replace(/"/g, "")}"`);
  }
  if (sorgu.yil) {
    terimler.push(`producedDateY_i:${sorgu.yil}`);
  }

  const u = new URL("https://api.archives-ouvertes.fr/search/");
  u.searchParams.set("q", terimler.join(" AND "));
  u.searchParams.set("wt", "json");
  u.searchParams.set(
    "fl",
    "docid,title_s,authFullName_s,producedDateY_i,doiId_s,abstract_s,uri_s,files_s,docType_s",
  );
  u.searchParams.set("rows", String(Math.min(30, sorgu.limit * 2)));

  const veri = await getJson<HALResponse>(u.toString(), {
    boslukMs: 400,
    timeoutMs: 20_000,
  });

  const sonuclar: Work[] = [];

  for (const doc of veri.response?.docs ?? []) {
    const baslik = doc.title_s?.[0];
    if (!baslik || !doc.docid) continue;

    const uri = doc.uri_s ?? `https://hal.science/hal-${doc.docid}`;
    // HAL açık PDF indirme adresi
    const dosyaPdf = doc.files_s?.find((f) => f.toLowerCase().endsWith(".pdf"));
    const pdf = dosyaPdf ?? `https://hal.science/hal-${doc.docid}/document`;

    const tur: Work["tur"] =
      doc.docType_s?.toUpperCase() === "OUV" || doc.docType_s?.toUpperCase() === "COUV"
        ? "kitap"
        : sorgu.tur;

    sonuclar.push({
      kaynak: "hal",
      kaynakAd: "HAL Science",
      tur,
      baslik,
      yazarlar: doc.authFullName_s ?? [],
      yil: doc.producedDateY_i,
      ozet: doc.abstract_s?.[0]?.slice(0, 800),
      doi: doc.doiId_s,
      link: uri,
      pdf,
      erisim: "acik",
    });
  }

  return sonuclar.slice(0, sorgu.limit);
}

const kaynak: SourceModule = {
  id: "hal",
  ad: "HAL Science",
  tur: ["makale", "kitap"],
  aciklama: "4+ milyon açık erişimli araştırma yayını, tez ve kitap arşivi (tam PDF)",
  ara,
};

export default kaynak;
