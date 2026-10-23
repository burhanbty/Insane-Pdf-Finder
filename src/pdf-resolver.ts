import { get, KaynakHatasi } from "./http.js";
import { disAdres } from "./network.js";
import { pdfImzasi, sinirliGovde } from "./body.js";
import { istekSinyali, sureSinirli } from "./deadline.js";

const SAYFA_SINIRI = 2 * 1024 * 1024;

export function htmlCoz(s: string): string {
  return s.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (m) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&lt;": "<",
      "&gt;": ">",
    };
    const ad = named[m.toLowerCase()];
    if (ad) return ad;
    const hex = /^&#x/i.test(m);
    const n = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
  });
}
export function alanlar(tag: string) {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    out[m[1]!.toLowerCase()] = htmlCoz(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

export function sayfaUstverisi(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const temiz = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  for (const m of temiz.matchAll(/<meta\b[^>]*>/gi)) {
    const a = alanlar(m[0]);
    const ad = (a.name ?? a.property ?? "").toLowerCase();
    if (ad && a.content?.trim()) out.set(ad, [...(out.get(ad) ?? []), a.content.trim()]);
  }
  return out;
}

/** Yalnızca sayfanın kendi bildirdiği PDF; kaynakçadaki rastgele PDF'leri seçmez. */
export function sayfadakiPdfler(html: string, sayfa: string): string[] {
  const temiz = html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const bildirilen: string[] = [];
  for (const m of temiz.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
    const a = alanlar(m[0]);
    if (/^citation_pdf_url$/i.test(a.name ?? a.property ?? "") && a.content)
      bildirilen.push(a.content);
    if (
      a.href &&
      /^application\/pdf(?:;|$)/i.test(a.type ?? "") &&
      /\balternate\b/i.test(a.rel ?? "")
    )
      bildirilen.push(a.href);
  }
  // Birden fazla belirsiz bağlantı varsa yanlış kitabı indirmek yerine künye bilgisini bekle.
  if (!bildirilen.length) {
    const baglantilar = [...temiz.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)]
      .map((m) => ({ a: alanlar(m[1]!), text: htmlCoz(m[2]!.replace(/<[^>]*>/g, " ")).trim() }))
      .filter(
        ({ a, text }) =>
          a.href &&
          (/^application\/pdf$/i.test(a.type ?? "") ||
            (/\.pdf(?:[?#]|$)/i.test(a.href) &&
              /^(?:download\s*(?:the\s*)?(?:full[ -]?text\s*)?pdf|pdf(?:\s*(?:indir|download|full[ -]?text))?|tam metin(?:\s*\(pdf\))?)$/i.test(
                text,
              ))),
      );
    const tek = [...new Set(baglantilar.map(({ a }) => a.href))];
    if (tek.length === 1 && tek[0]) bildirilen.push(tek[0]);
  }
  return [
    ...new Set(
      bildirilen.flatMap((s) => {
        try {
          const u = disAdres(new URL(s, sayfa).href);
          u.hash = "";
          return [u.href];
        } catch {
          return [];
        }
      }),
    ),
  ].slice(0, 3);
}

/** İmza için okunan baytları geri ekler; büyük PDF'i belleğe toplamaz. */
async function basiniOku(r: Response): Promise<{ ilk: Uint8Array; cevap: Response }> {
  if (!r.body) throw Error("Kaynak boş yanıt döndürdü");
  const reader = r.body.getReader();
  const signal = istekSinyali.getStore();
  const iptal = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.throwIfAborted();
  signal?.addEventListener("abort", iptal, { once: true });
  const parcalar: Uint8Array[] = [];
  let n = 0;
  try {
    while (n < 5) {
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      parcalar.push(next.value);
      n += next.value.length;
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  } finally {
    signal?.removeEventListener("abort", iptal);
  }
  const ilk = Buffer.concat(parcalar);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of parcalar) c.enqueue(b);
    },
    async pull(c) {
      try {
        const next = await reader.read();
        if (next.done) c.close();
        else c.enqueue(next.value);
      } catch (e) {
        c.error(e);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { ilk, cevap: new Response(body, { headers: r.headers, status: r.status }) };
}

export async function pdfYanitiniBul(
  adresler: string[],
  secenek: {
    kabul?: (cevap: Response, adres: string) => Promise<void>;
    deneme?: (sira: number) => void;
  } = {},
): Promise<Response> {
  const kuyruk = [...new Set(adresler)];
  const gorulen = new Set<string>();
  let hata =
    "Kaynak PDF yerine bir sayfa döndürdü; doğrudan PDF bağlantısı bulunamadı. Kayıt yalnızca katalog, önizleme veya ödünç erişimi sunuyor olabilir.";
  for (let i = 0; kuyruk.length && i < 8; i++) {
    istekSinyali.getStore()?.throwIfAborted();
    const adres = kuyruk.shift()!;
    if (gorulen.has(adres)) continue;
    gorulen.add(adres);
    secenek.deneme?.(gorulen.size);
    try {
      const bulunan = await sureSinirli(
        async () => {
          disAdres(adres);
          const r = await get(adres, {
            disAg: true,
            ham: true,
            tekrar: 0,
            timeoutMs: 25_000,
            boslukMs: 200,
          });
          const { ilk, cevap } = await basiniOku(r);
          if (pdfImzasi(ilk)) {
            try {
              await secenek.kabul?.(cevap, r.url || adres);
            } catch (e) {
              await cevap.body?.cancel().catch(() => undefined);
              throw e;
            }
            return cevap;
          }
          const tip = r.headers.get("content-type") ?? "";
          if (/html/i.test(tip) || /^\s*</.test(new TextDecoder().decode(ilk.subarray(0, 200)))) {
            const html = new TextDecoder().decode(await sinirliGovde(cevap, SAYFA_SINIRI));
            const pdfler = sayfadakiPdfler(html, r.url || adres).filter((u) => !gorulen.has(u));
            kuyruk.unshift(...pdfler);
          } else {
            await cevap.body?.cancel();
            hata = "Kaynak PDF yerine farklı bir dosya döndürdü.";
          }
          return undefined;
        },
        30_000,
        true,
      );
      if (bulunan) return bulunan;
    } catch (e) {
      istekSinyali.getStore()?.throwIfAborted();
      if (e instanceof KaynakHatasi && [401, 403, 429].includes(e.durum ?? 0))
        hata = `Kaynak otomatik indirmeye izin vermedi (HTTP ${e.durum}). Kaynak sayfasını açarak erişim seçeneklerini kontrol edebilirsiniz.`;
      else hata = (e as Error).message;
    }
  }
  throw Error(hata);
}
