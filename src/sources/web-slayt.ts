import { get } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/*
 * Genel web aramasi (slayt ve serbest PDF bulma).
 *
 * GERCEK KISIT: Bing, sorgudaki tirnak icinde tam eslesme ve `site:` /
 * `filetype:` filtrelerini uygulamiyor. Bu yuzden sunucu tarafindan
 * sonuclari alan adi ve baslik uyumu ile eliyoruz. Filtre motoru tarafinda
 * uygulanmadigi icin bazi ilgisiz sonuclar gelebilir.
 *
 * Bilinen alternatifler denendi ve bu ortamdan calismadi:
 *   - DuckDuckGo (html ve lite): IP engellendi, 202 + CAPTCHA
 *   - Brave Search: 429
 *   - Mojeek: 403
 *   - Startpage / SearX: Anubis bot korumasi
 *
 * Program burada yalnizca arama motoruna sorgu gonderir ve baglantilari
 * listeler. Icerigi cekmez, indirmez, otomasyon yapmaz.
 */

const HEDEFLER = [
  { alan: "slideshare.com", ad: "SlideShare" },
  { alan: "speakerdeck.com", ad: "Speaker Deck" },
  { alan: "slideplayer.com", ad: "SlidePlayer" },
  { alan: "docs.google.com", ad: "Google Slides/Docs" },
  { alan: "researchgate.net", ad: "ResearchGate" },
  { alan: "academia.edu", ad: "Academia.edu" },
  { alan: "issuu.com", ad: "Issuu" },
] as const;

function kacisCoz(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function metinTemizle(html: string): string {
  return kacisCoz(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Bing sonuclarini `/ck/a?...&u=a1<base64url>` yonlendirmesi uzerinden cozer.
 * Cozulemezse ham adresi dondurur.
 */
function yonlendirmeyiCoz(href: string): string {
  const m = href.match(/[?&]u=a1([^&]+)/);
  if (!m?.[1]) return href;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const yast = Buffer.from(b64, "base64").toString("utf8");
    return yast.startsWith("http") ? yast : href;
  } catch {
    return href;
  }
}

interface BingSonuc {
  url: string;
  baslik: string;
  alan: string;
}

async function bingAra(terimler: string[], adet = 20): Promise<BingSonuc[]> {
  const u = new URL("https://www.bing.com/search");
  u.searchParams.set("q", terimler.join(" "));
  u.searchParams.set("count", String(Math.min(30, adet)));

  const cevap = await get(u.toString(), {
    ham: true,
    boslukMs: 900,
    timeoutMs: 20_000,
  });
  const html = await cevap.text();

  // <li class="b_algo"> bloklarini bul (regex yerine kesin blok arasiyla,
  // cunku ic ice <li> etiketleri var ve regex yanlis eslesir).
  const bloklar: string[] = [];
  let i = 0;
  while (true) {
    const bas = html.indexOf('<li class="b_algo"', i);
    if (bas === -1) break;
    const son = html.indexOf("</li>", bas);
    if (son === -1) break;
    bloklar.push(html.slice(bas, son));
    i = son + 5;
  }

  const sonuclar: BingSonuc[] = [];
  for (const blok of bloklar) {
    const h2 = blok.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "";
    const hamHref = h2.match(/href="([^"]+)"/)?.[1];
    if (!hamHref) continue;

    const url = yonlendirmeyiCoz(kacisCoz(hamHref));
    if (!url.startsWith("http")) continue;

    let alan: string;
    try {
      alan = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }

    const baslik = metinTemizle(h2);
    if (!baslik) continue;
    sonuclar.push({ url, baslik, alan });
  }

  return sonuclar;
}

/** Baslik, sorgu basligiyla ne kadar kesisiyor. */
function baslikUyumu(sonucBaslik: string, sorguBaslik: string): number {
  const normalize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(" ")
        .filter((t) => t.length > 2),
    );
  const a = normalize(sonucBaslik);
  const b = normalize(sorguBaslik);
  if (!a.size || !b.size) return 0;
  let kesisim = 0;
  for (const t of b) if (a.has(t)) kesisim++;
  return kesisim / b.size;
}

/** Slayt/sunum sitelerinde baslik arar. Yalnizca baglantilar toplanir. */
async function ara(sorgu: Sorgu): Promise<Work[]> {
  const terimler = [`"${sorgu.baslik}"`];
  if (sorgu.yazar) terimler.push(`"${sorgu.yazar}"`);

  const hepsi: BingSonuc[] = [];
  const hatalar: string[] = [];

  for (const h of HEDEFLER) {
    try {
      hepsi.push(...(await bingAra([...terimler, `site:${h.alan}`])));
    } catch (hata) {
      hatalar.push(`${h.ad}: ${(hata as Error).message}`);
    }
  }

  if (!hepsi.length && hatalar.length === HEDEFLER.length) {
    throw new Error(`Web araması başarısız (${hatalar[0]})`);
  }

  // Bing site: filtresini uygulamadigi icin iki katmanli eleme yapiyoruz:
  // once alan adi, sonra baslik uyumu.
  const istenenAlanlar = HEDEFLER.map((h) => h.alan);
  const sonuc: Work[] = [];
  const gorulen = new Set<string>();

  for (const s of hepsi) {
    const hedef = istenenAlanlar.find((a) => s.alan === a || s.alan.endsWith(`.${a}`));
    if (!hedef || gorulen.has(s.url)) continue;
    if (baslikUyumu(s.baslik, sorgu.baslik) < 0.34) continue;
    gorulen.add(s.url);

    const meta = HEDEFLER.find((h) => h.alan === hedef)!;

    sonuc.push({
      kaynak: `web-${meta.alan.split(".")[0]}`,
      kaynakAd: `${meta.ad} (web araması)`,
      tur: "slayt",
      baslik: s.baslik,
      yazarlar: sorgu.yazar ? [sorgu.yazar] : [],
      yil: sorgu.yil,
      link: s.url,
      erisim: "yonlendir",
    });
  }

  return sonuc;
}

/**
 * Genel PDF/sunum aramasi: tum web'de PDF sonucu.
 *
 * UYARI: `filetype:pdf` filtresi Bing tarafindan uygulanmiyor, bu yuzden
 * PDF olmayan sayfalar da gelebilir; baslik uyumu ile bir kirpma yapilir.
 * Gercek PDF adresi tespit edilenler indirilebilir isaretlenir.
 */
export async function genelArama(sorgu: Sorgu): Promise<Work[]> {
  const terimler = [`"${sorgu.baslik}"`];
  if (sorgu.yazar) terimler.push(`"${sorgu.yazar}"`);
  if (sorgu.yil) terimler.push(sorgu.yil.toString());
  terimler.push("filetype:pdf");

  const sonuclar = await bingAra(terimler, 30);

  const sonuc: Work[] = [];
  const gorulen = new Set<string>();

  for (const s of sonuclar) {
    if (gorulen.has(s.url)) continue;
    if (/(bing|microsoft|msn)\.com$/.test(s.alan)) continue;
    if (baslikUyumu(s.baslik, sorgu.baslik) < 0.34) continue;
    gorulen.add(s.url);

    const pdfGorunuyor = /\.pdf($|\?)/i.test(s.url) || /\bpdf\b/i.test(s.baslik);

    sonuc.push({
      kaynak: "web-genel",
      kaynakAd: "Genel Web Araması",
      tur: sorgu.tur,
      baslik: s.baslik,
      yazarlar: sorgu.yazar ? [sorgu.yazar] : [],
      yil: sorgu.yil,
      link: s.url,
      pdf: pdfGorunuyor ? s.url : undefined,
      erisim: "yonlendir",
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "web-slayt",
  ad: "Web Araması (Slayt)",
  tur: ["slayt"],
  aciklama:
    "SlideShare, Speaker Deck, Google Slides vb. sitelerde başlık araması — yalnızca bağlantı listeler. " +
    "Bing'in site: filtresi güvenilir çalışmadığı için sonuçlar sınırlıdır.",
  ara,
};

export default kaynak;
