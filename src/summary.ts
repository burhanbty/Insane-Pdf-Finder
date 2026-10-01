import { ayar } from "./config.js";
import { get } from "./http.js";
import { indir } from "./download.js";

/*
 * Ozet iki katmali:
 *  1) Metin cikarimi — PDF ise pdfjs-dist, duz metin ise dogrudan.
 *  2) Ozetleme — LLM anahtari varsa modele, yoksa extractive
 *     (TF kullanimina gore cumle secimi).
 *
 * LLM anahtari verilmeden de program calisir; sadece ozet kalitesi degisir.
 */

const METIN_LIMIT = 60_000;

export type OzetYontemi = "llm" | "extractive";

export interface OzetSonucu {
  yontem: OzetYontemi;
  ozet: string;
  ilkParagraf?: string;
  karakterSayisi: number;
  sayfaSayisi?: number;
  uyari?: string;
}

/* ------------------------------------------------------------------ */
/* Metin cikarimi                                                      */
/* ------------------------------------------------------------------ */

function duzMetniTemizle(girdi: string): string {
  return girdi
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** PDF'ten metin cikarir. Sayfa sayisini da dondurur. */
async function pdfMetni(veri: Uint8Array): Promise<{ metin: string; sayfa: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Node ortaminda worker yok; sayfayi ana surece icinde calistir.
  const yuklenecek = pdfjs.getDocument({
    data: veri,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const belge = await yuklenecek.promise;

  const parcalar: string[] = [];
  const sayfaSayisi = belge.numPages;
  const alinacak = Math.min(sayfaSayisi, 60);

  for (let s = 1; s <= alinacak; s++) {
    const sayfa = await belge.getPage(s);
    const icerik = await sayfa.getTextContent();
    parcalar.push(icerik.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }

  await belge.cleanup();
  return { metin: duzMetniTemizle(parcalar.join("\n\n")), sayfa: sayfaSayisi };
}

/** PDF veya metin adresinden icerik alir. */
async function metinGetir(
  url: string,
  tur: "pdf" | "metin",
): Promise<{ metin: string; sayfa?: number; uyari?: string }> {
  const cevap = await get(url, {
    yonlendir: true,
    timeoutMs: 30_000,
    boslukMs: 300,
    ham: tur === "metin",
  });

  const icerikTipi = String(cevap.headers.get("content-type") ?? "").toLowerCase();
  const bayt = new Uint8Array(await cevap.arrayBuffer());

  if (icerikTipi.includes("pdf") || bayt[0] === 0x25) {
    // %PDF imzasi
    try {
      const { metin, sayfa } = await pdfMetni(bayt);
      return { metin, sayfa };
    } catch (hata) {
      return {
        metin: "",
        uyari: `PDF metin çıkarılamadı (muhtemelen taranmış görsel): ${(hata as Error).message}`,
      };
    }
  }

  return { metin: duzMetniTemizle(new TextDecoder("utf-8", { fatal: false }).decode(bayt)) };
}

/* ------------------------------------------------------------------ */
/* Extractive ozet                                                     */
/* ------------------------------------------------------------------ */

const DURAKLAR = new Set([
  "ve", "ile", "için", "bu", "da", "de", "bir", "olarak", "daha", "çok",
  "the", "of", "and", "to", "in", "is", "are", "for", "that", "with",
  "this", "was", "were", "has", "have", "its", "as", "on", "by", "from",
]);

function cumleleriAyir(metin: string): string[] {
  return metin
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 40 && c.length < 600);
}

function kelimeSayimi(metin: string): Map<string, number> {
  const sayim = new Map<string, number>();
  const kelimeler = metin.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  for (const k of kelimeler) {
    if (DURAKLAR.has(k)) continue;
    sayim.set(k, (sayim.get(k) ?? 0) + 1);
  }
  return sayim;
}

/** TF tabanli cumle puanlama: baslik/ozet bolumune yakin cumleleri one alir. */
function extractiveOzet(metin: string, cumleSayisi = 5): string {
  const cumleler = cumleleriAyir(metin);
  if (!cumleler.length) return metin.slice(0, 400);

  const toplamKelime = metin.split(/\s+/).length || 1;
  const frekans = kelimeSayimi(metin);
  const enSik = [...frekans.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([k]) => k);
  const sikSet = new Set(enSik);

  const puanlanmis = cumleler.map((c, i) => {
    const kelimeler = (c.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
      (k) => !DURAKLAR.has(k),
    );
    if (!kelimeler.length) return { i, c, puan: 0 };

    const sig = kelimeler.filter((k) => sikSet.has(k)).length / kelimeler.length;

    // Konum agirligi: metnin basindaki cumleler ozet tasidigi icin degerli.
    const konum = 1 - i / (cumleler.length + 1);
    // Cok uzun veya cok kisa cumleler cezalidir.
    const uzunluk = Math.min(kelimeler.length, 60) / 60;

    return { i, c, puan: sig * 0.55 + konum * 0.35 + uzunluk * 0.1 };
  });

  const secilen = puanlanmis
    .sort((a, b) => b.puan - a.puan)
    .slice(0, cumleSayisi)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.c);

  return `${secilen.join(" ")}\n\n(Metin ${toplamKelime} kelime, ${cumleler.length} cümleden özetlendi.)`;
}

/* ------------------------------------------------------------------ */
/* LLM ozet                                                            */
/* ------------------------------------------------------------------ */

async function llmOzet(metin: string, baslik: string): Promise<string | undefined> {
  const { baseUrl, apiKey, model } = ayar.llm;
  if (!baseUrl || !apiKey) return undefined;

  const govde = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Bir kaynak için kısa ve bilgilendirici Türkçe özet yaz. 4-6 cümle. " +
          "Yazar, yıl, konu ve temel bulguları belirt. Yorum ekleme.",
      },
      { role: "user", content: `Başlık: ${baslik}\n\nİçerik:\n${metin.slice(0, METIN_LIMIT)}` },
    ],
    temperature: 0.3,
    max_tokens: 500,
  };

  const cevap = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": ayar.userAgent(),
    },
    body: JSON.stringify(govde),
    signal: AbortSignal.timeout(60_000),
  });

  if (!cevap.ok) return undefined;
  const veri = (await cevap.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return veri.choices?.[0]?.message?.content?.trim() || undefined;
}

/* ------------------------------------------------------------------ */
/* Genel giris noktasi                                                 */
/* ------------------------------------------------------------------ */

export interface OzetGirdi {
  url: string;
  tur: "pdf" | "metin";
  baslik: string;
  /** Once indirip diskten okumak isteyenler icin. */
  oncedenIndir?: boolean;
}

export async function ozetUret(girdi: OzetGirdi): Promise<OzetSonucu> {
  let kaynak = girdi.url;
  let uyari: string | undefined;

  if (girdi.oncedenIndir) {
    try {
      const sonuc = await indir(
        { url: girdi.url, varsayilanAd: girdi.baslik },
        girdi.tur,
      );
      kaynak = sonuc.yol;
      // Yerel dosyayi fetch ile okuyamayiz; fs uzerinden tekrar isleyecegiz.
      return yerelDosyadanOzet(sonuc.yol, girdi.baslik);
    } catch (hata) {
      uyari = `İndirme başarısız, doğrudan okunuyor: ${(hata as Error).message}`;
    }
  }

  const { metin, sayfa, uyari: cikarimUyari } = await metinGetir(kaynak, girdi.tur);
  uyari = uyari ?? cikarimUyari;

  if (!metin.trim()) {
    return {
      yontem: "extractive",
      ozet: "",
      karakterSayisi: 0,
      sayfaSayisi: sayfa,
      uyari:
        uyari ??
        "İçerik çıkarılamadı. Kaynak taranmış görsel PDF olabilir veya erişim kısıtlı olabilir.",
    };
  }

  const kesik = metin.length > METIN_LIMIT ? metin.slice(0, METIN_LIMIT) : metin;
  const ilkParagraf = kesik.split(/\n{2,}/).find((p) => p.trim().length > 60)?.trim();

  const llm = await llmOzet(kesik, girdi.baslik).catch(() => undefined);
  const ozet = llm ?? extractiveOzet(kesik);

  return {
    yontem: llm ? "llm" : "extractive",
    ozet,
    ilkParagraf,
    karakterSayisi: metin.length,
    sayfaSayisi: sayfa,
    uyari,
  };
}

async function yerelDosyadanOzet(dosyaYolu: string, baslik: string): Promise<OzetSonucu> {
  const fs = await import("node:fs/promises");
  const veri = await fs.readFile(dosyaYolu);
  const bayt = new Uint8Array(veri);

  let metin = "";
  let sayfa: number | undefined;
  let uyari: string | undefined;

  if (dosyaYolu.endsWith(".pdf")) {
    try {
      const r = await pdfMetni(bayt);
      metin = r.metin;
      sayfa = r.sayfa;
    } catch (hata) {
      uyari = `PDF metin çıkarılamadı (taranmış görsel olabilir): ${(hata as Error).message}`;
    }
  } else {
    metin = duzMetniTemizle(veri.toString("utf8"));
  }

  if (!metin.trim()) {
    return {
      yontem: "extractive",
      ozet: "",
      karakterSayisi: 0,
      sayfaSayisi: sayfa,
      uyari: uyari ?? "Dosya çıkarılamadı.",
    };
  }

  const kesik = metin.slice(0, METIN_LIMIT);
  const ilkParagraf = kesik.split(/\n{2,}/).find((p) => p.trim().length > 60)?.trim();
  const llm = await llmOzet(kesik, baslik).catch(() => undefined);

  return {
    yontem: llm ? "llm" : "extractive",
    ozet: llm ?? extractiveOzet(kesik),
    ilkParagraf,
    karakterSayisi: metin.length,
    sayfaSayisi: sayfa,
    uyari,
  };
}