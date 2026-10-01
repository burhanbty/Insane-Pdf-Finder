import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

function yolla(k: string, varsayilan: string): string {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : varsayilan;
}

/*
 * Proje kokunu BUGUNUN KLASORUNE gore degil, KODUN KONUMUNA gore
 * cozuyoruz. process.cwd() sunucu nereden baslatildigina bagli
 * oldugu icin yanlis klasorden calistirildiginda kaynaklar bulunamaz ve
 * arama sessizce 0 sonuc donuyordu.
 */
const kodDizini = path.dirname(fileURLToPath(import.meta.url));
const kok = path.resolve(kodDizini, "..");

export const ayar = {
  port: Number(yolla("PORT", "3000")),
  host: yolla("HOST", "127.0.0.1"),

  contactEmail: yolla("CONTACT_EMAIL", ""),
  googleBooksKey: yolla("GOOGLE_BOOKS_API_KEY", ""),
  semanticScholarKey: yolla("SEMANTIC_SCHOLAR_API_KEY", ""),
  unpaywallEmail: yolla("CONTACT_EMAIL_UNPAYWALL", "") || yolla("CONTACT_EMAIL", ""),

  llm: {
    baseUrl: yolla("LLM_BASE_URL", ""),
    apiKey: yolla("LLM_API_KEY", ""),
    model: yolla("LLM_MODEL", "gpt-4o-mini"),
  },

  /** SOURCES_DIR mutlak yol olarak verilirse onu, degilse varsayilani kullan. */
  sourcesDir: process.env.SOURCES_DIR?.trim()
    ? path.resolve(process.env.SOURCES_DIR.trim())
    : path.join(kok, "src", "sources"),

  publicDir: path.join(kok, "public"),
  downloadsDir: path.join(kok, "downloads"),
  cacheDir: path.join(kok, ".cache"),
  projeKok: kok,

  /** Kullanici tanitici. Open Library kendini arayabilsin diye sart. */
  userAgent(): string {
    const e = ayar.contactEmail || ayar.unpaywallEmail;
    return `kaynak-bul/1.0 (akademik kaynak arama;${e ? ` iletisim: ${e}` : ""})`;
  },
};