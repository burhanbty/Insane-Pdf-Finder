import { getJson, KaynakHatasi } from "./http.js";
import { onbellekli } from "./cache.js";
import { sureSinirli } from "./deadline.js";
import type { Gruplanmis } from "./types.js";

/** ISBN-10/13 kontrol basamağı. ISBN-10 doğrulandıktan sonra 13'e çevrilir. */
export function isbnDogrula(girdi: unknown): string | null {
  if (typeof girdi !== "string" || girdi.length > 40) return null;
  const s = girdi.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    const toplam = [...s].reduce((n, c, i) => n + (c === "X" ? 10 : Number(c)) * (10 - i), 0);
    if (toplam % 11) return null;
    const temel = `978${s.slice(0, 9)}`;
    const check =
      (10 - ([...temel].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    return temel + check;
  }
  if (!/^97[89]\d{10}$/.test(s)) return null;
  return [...s].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0 ? s : null;
}
interface Kitap {
  title?: string;
  subtitle?: string;
  publish_date?: string;
  edition_name?: string;
  authors?: { name?: string }[];
  publishers?: { name?: string }[];
  number_of_pages?: number;
  url?: string;
}
export async function isbnKitabi(
  isbn: string,
): Promise<{ eser: Gruplanmis; isbn: string; baski?: string }> {
  return onbellekli(`isbn:v1:${isbn}`, () =>
    sureSinirli(async () => {
      const u = new URL("https://openlibrary.org/api/books");
      u.searchParams.set("bibkeys", `ISBN:${isbn}`);
      u.searchParams.set("jscmd", "data");
      u.searchParams.set("format", "json");
      const data = await getJson<Record<string, Kitap>>(u.href, {
        timeoutMs: 10_000,
        boslukMs: 1100,
        tekrar: 0,
        disAg: true,
      });
      const k = data[`ISBN:${isbn}`];
      if (!k || typeof k.title !== "string" || !k.title.trim())
        throw new KaynakHatasi("http", "Bu ISBN için katalog kaydı bulunamadı", 404);
      const ad = k.title.trim().slice(0, 1000);
      const yil =
        Number(String(k.publish_date ?? "").match(/\b(1\d{3}|20\d{2}|2100)\b/)?.[1]) || undefined;
      const yazarlar = (Array.isArray(k.authors) ? k.authors : [])
        .map((a) => a?.name)
        .filter((a): a is string => typeof a === "string" && Boolean(a.trim()))
        .slice(0, 30)
        .map((a) => a.slice(0, 300));
      const link = `https://openlibrary.org/isbn/${isbn}`;
      const eser: Gruplanmis = {
        anahtar: `isbn:${isbn}`,
        tur: "kitap",
        baslik: ad,
        altBaslik: typeof k.subtitle === "string" ? k.subtitle.slice(0, 500) : undefined,
        yazarlar,
        yil,
        konular: [],
        puan: 1,
        sayfaSayisi:
          Number.isInteger(k.number_of_pages) && Number(k.number_of_pages) > 0
            ? k.number_of_pages
            : undefined,
        kaynaklar: [
          {
            kaynak: "open-library",
            kaynakAd: "Open Library · ISBN kaydı",
            tur: "kitap",
            baslik: ad,
            yazarlar,
            yil,
            isbn,
            link,
            yayinci:
              typeof k.publishers?.[0]?.name === "string"
                ? k.publishers[0].name.slice(0, 500)
                : undefined,
            erisim: "yonlendir",
          },
        ],
      };
      return {
        eser,
        isbn,
        baski: typeof k.edition_name === "string" ? k.edition_name.slice(0, 100) : undefined,
      };
    }, 12_000),
  );
}
