import type { SourceModule, Sorgu, Work } from "../types.js";

type LibgenKayit = {
  baslik: string;
  yazarlar: string[];
  yayinci?: string;
  yil?: number;
  dil?: string;
  sayfa?: string;
  sayfaSayisi?: number;
  boyut?: string;
  uzanti?: string;
  md5: string;
  ayna: string;
};

const AYNALAR = [
  "https://libgen.li",
  "https://libgen.vg",
  "https://libgen.la",
  "https://libgen.bz",
  "https://libgen.gl",
] as const;

const TARAYICI_UA =
  "Mozilla/5.0 (X11; Linux x86_64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

const MD5_RE = /[a-f0-9]{32}/i;
const ADS_MD5_RE = /ads\.php\?md5=([a-f0-9]{32})/i;
const FILE_ID_RE = /file\.php\?id=(\d+)/i;
const EDITION_LINK_RE = /href=["'][^"']*edition\.php\?id=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i;

function htmlCoz(metin: string): string {
  return metin
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d: string) =>
      String.fromCodePoint(Number.parseInt(d, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlMetin(html: string): string {
  return htmlCoz(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\t\r ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .trim(),
  );
}

function tekSatirMetin(html: string): string {
  return htmlMetin(html).replace(/\s+/g, " ").trim();
}

function yilCoz(metin?: string): number | undefined {
  const eslesme = metin?.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  if (!eslesme) return undefined;
  const yil = Number(eslesme[1]);
  return Number.isFinite(yil) ? yil : undefined;
}

function sayfaCoz(metin?: string): number | undefined {
  const eslesme = metin?.match(/\d+/);
  if (!eslesme) return undefined;
  const sayi = Number(eslesme[0]);
  return Number.isFinite(sayi) && sayi > 0 ? sayi : undefined;
}

function yazarlariAyir(hucreHtml: string): string[] {
  // Yazar hücresindeki ayrı bağlantıları tercih et.
  const linkler = [...hucreHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => tekSatirMetin(m[1]))
    .filter(Boolean);

  if (linkler.length > 0) return [...new Set(linkler)];

  const metin = htmlMetin(hucreHtml);
  if (!metin) return [];

  return metin
    .split(/\n|\s*;\s*|\s*\|\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function baslikCoz(hucreHtml: string): string {
  // Güncel frontend başlığı edition.php?id=... bağlantısında taşıyor.
  const edition = hucreHtml.match(EDITION_LINK_RE);
  if (edition) {
    const baslik = tekSatirMetin(edition[1]);
    if (baslik) return baslik;
  }

  // Bazı kayıtlar seri adını <b> içinde gösterebiliyor.
  const seri = hucreHtml.match(/<b\b[^>]*>([\s\S]*?)<\/b>/i);
  if (seri) {
    const baslik = tekSatirMetin(seri[1]);
    if (baslik) return baslik;
  }

  return tekSatirMetin(hucreHtml);
}

function tabloyuCoz(html: string, ayna: string): LibgenKayit[] {
  const satirlar = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const sonuc: LibgenKayit[] = [];

  for (const satir of satirlar) {
    const satirHtml = satir[1];
    const hucreler = [...satirHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (m) => m[1],
    );

    // Güncel libgen.li ailesi:
    // 0 başlık, 1 yazar, 2 yayınevi, 3 yıl,
    // 4 dil, 5 sayfa, 6 boyut, 7 uzantı, 8 aynalar.
    if (hucreler.length < 9) continue;

    // Header/layout satırlarını elemek için güncel istemcinin kullandığı kontrol.
    if (!FILE_ID_RE.test(satirHtml)) continue;

    const md5 =
      satirHtml.match(ADS_MD5_RE)?.[1] ??
      satirHtml.match(MD5_RE)?.[0];

    if (!md5) continue;

    const baslik = baslikCoz(hucreler[0]);
    if (!baslik) continue;

    const yayinci = tekSatirMetin(hucreler[2]) || undefined;
    const yilMetni = tekSatirMetin(hucreler[3]);
    const dil = tekSatirMetin(hucreler[4]) || undefined;
    const sayfa = tekSatirMetin(hucreler[5]) || undefined;
    const boyut = tekSatirMetin(hucreler[6]) || undefined;
    const uzanti = tekSatirMetin(hucreler[7]) || undefined;

    sonuc.push({
      baslik,
      yazarlar: yazarlariAyir(hucreler[1]),
      yayinci,
      yil: yilCoz(yilMetni),
      dil,
      sayfa,
      sayfaSayisi: sayfaCoz(sayfa),
      boyut,
      uzanti,
      md5: md5.toLowerCase(),
      ayna,
    });
  }

  return sonuc;
}

async function htmlGetir(url: string): Promise<string> {
  const controller = new AbortController();
  const zamanAsimi = setTimeout(() => controller.abort(), 20_000);

  try {
    const cevap = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": TARAYICI_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
        "Cache-Control": "no-cache",
      },
    });

    if (!cevap.ok) {
      throw new Error(`${new URL(url).host} HTTP ${cevap.status}`);
    }

    const html = await cevap.text();

    // Bu frontend bazı bot UA'larına 200 ile nginx placeholder döndürebiliyor.
    if (/welcome to nginx!/i.test(html) && !/<td\b/i.test(html)) {
      throw new Error(`${new URL(url).host} placeholder sayfa döndürdü`);
    }

    return html;
  } finally {
    clearTimeout(zamanAsimi);
  }
}

function sonucSayisi(limit: number): 25 | 50 | 100 {
  if (limit <= 25) return 25;
  if (limit <= 50) return 50;
  return 100;
}

async function libgenAra(terimler: string, limit: number): Promise<LibgenKayit[]> {
  let sonHata: unknown;

  for (const ayna of AYNALAR) {
    try {
      const u = new URL("/index.php", ayna);
      u.searchParams.set("req", terimler);
      u.searchParams.set("res", String(sonucSayisi(limit)));

      const html = await htmlGetir(u.toString());
      const kayitlar = tabloyuCoz(html, ayna);

      if (kayitlar.length > 0) return kayitlar;

      // Gerçek bir sonuç sayfası geldiyse ama kayıt yoksa diğer aynaya geçmek
      // çoğu zaman gereksiz; yine de mirror kaynaklı boş sayfalara karşı devam et.
    } catch (hata) {
      sonHata = hata;
    }
  }

  // Kaynak geçici olarak erişilemiyorsa diğer kaynakların aramasını bozma.
  if (sonHata) {
    console.warn("[libgen] tüm aynalar başarısız veya parse edilemedi", sonHata);
  }

  return [];
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const baslik = sorgu.baslik.trim();
  if (!baslik) return [];

  const terimler = sorgu.yazar
    ? `${baslik} ${sorgu.yazar.trim()}`.trim()
    : baslik;

  const limit = Math.max(1, Math.min(50, sorgu.limit));
  let kayitlar = await libgenAra(terimler, limit);

  if (sorgu.yil) {
    kayitlar = kayitlar.filter((k) => k.yil === sorgu.yil);
  }

  return kayitlar.slice(0, limit).map((k): Work => ({
    kaynak: "libgen",
    kaynakAd: "Library Genesis",
    tur: sorgu.tur,
    baslik: k.baslik,
    yazarlar: k.yazarlar,
    yil: k.yil,
    yayinci: k.yayinci,
    dil: k.dil,
    sayfa: k.sayfa,
    sayfaSayisi: k.sayfaSayisi,
    ozet:
      [
        k.uzanti ? `Dosya türü: ${k.uzanti}` : undefined,
        k.boyut ? `Boyut: ${k.boyut}` : undefined,
      ]
        .filter(Boolean)
        .join(" • ") || undefined,
    // Yalnızca detay/landing sayfasına yönlendiriyoruz.
    link: `${k.ayna}/ads.php?md5=${encodeURIComponent(k.md5)}`,
    erisim: "yonlendir",
  }));
}

const kaynak: SourceModule = {
  id: "libgen",
  ad: "Library Genesis",
  tur: ["kitap", "makale"],
  aciklama: "Library Genesis aynalarında kitap ve makale kayıtları arar",
  ara,
};

export default kaynak;
