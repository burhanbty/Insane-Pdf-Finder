import express, { type Request, type Response, type NextFunction } from "express";
import { ayar, SURUM } from "./config.js";
import { ara, grupla } from "./search.js";
import { kaynakListesi, kaynaklariYukle, yuklenmeHataListesi } from "./registry.js";
import { indir, indirilenleriListele } from "./download.js";
import { topluSayfaSayisi } from "./sayfa.js";
import { ozetUret } from "./summary.js";
import { genelArama } from "./sources/web-slayt.js";
import { get } from "./http.js";
import { sinirliGovde } from "./body.js";
import { kaynakHazirligi } from "./source-state.js";
import { sureSinirli } from "./deadline.js";
import type { Sorgu, Tur } from "./types.js";
import fs from "node:fs/promises";
import path from "node:path";

export const uygulama = express();
uygulama.disable("x-powered-by");
uygulama.use((_req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  next();
});
/** Yerel API'ye yabancı sitelerden veri yazılmasını ve DNS rebinding'i engeller. */
uygulama.use("/api", (req, res, next) => {
  const host = req.headers.host ?? "";
  let alan: string;
  try {
    alan = new URL(`http://${host}`).hostname;
  } catch {
    return hataCevap(res, 403, "Geçersiz sunucu adresi");
  }
  if (![ayar.host, "localhost", "127.0.0.1", "[::1]"].includes(alan)) {
    return hataCevap(res, 403, "Bu sunucu adresine izin verilmiyor");
  }
  const origin = req.headers.origin;
  if (
    req.headers["sec-fetch-site"] === "cross-site" ||
    (origin && origin !== `${req.protocol}://${host}`)
  ) {
    return hataCevap(res, 403, "Yabancı sitelerden API erişimine izin verilmiyor");
  }
  if (req.method === "POST" && !req.is("application/json")) {
    return hataCevap(res, 415, "İstek application/json olmalı");
  }
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cache-control", "no-store");
  next();
});
uygulama.use(express.json({ limit: "1mb" }));

/* ------------------------------ ara yardimcilar --------------------------- */

function guvenliUrl(aday: unknown): string | null {
  if (typeof aday !== "string" || aday.length > 2000) return null;
  try {
    const u = new URL(aday);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function hataCevap(cevap: Response, durum: number, mesaj: string) {
  cevap.status(durum).json({ hata: mesaj });
}

const TURLER: Tur[] = ["kitap", "makale", "slayt"];

function sorguAyikla(v: unknown): Sorgu | string {
  const g = (v ?? {}) as Record<string, unknown>;
  const baslik = typeof g.baslik === "string" ? g.baslik.trim() : "";
  if (!baslik) return "Başlık gerekli";
  if (baslik.length > 300) return "Başlık çok uzun";

  if (g.tur !== undefined && !TURLER.includes(g.tur as Tur)) return "Geçersiz içerik türü";
  const tur = (g.tur as Tur) ?? "kitap";

  let yil: number | undefined;
  if (g.yil !== undefined && g.yil !== null && g.yil !== "") {
    const n = Number(g.yil);
    if (!Number.isInteger(n) || n < 1000 || n > 2100) return "Yıl 1000-2100 arası olmalı";
    yil = n;
  }

  const limit = g.limit === undefined ? 20 : Number(g.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    return "Sonuç sayısı 1-50 arası tam sayı olmalı";

  return {
    baslik,
    yazar: typeof g.yazar === "string" && g.yazar.trim() ? g.yazar.trim().slice(0, 200) : undefined,
    yil,
    tur,
    limit,
  };
}

/* ------------------------------- rotalar -------------------------------- */

/** Birincil arama: kayitli tum kaynaklar. */
uygulama.post("/api/search", async (req: Request, res: Response) => {
  const s = sorguAyikla(req.body);
  if (typeof s === "string") return hataCevap(res, 400, s);

  try {
    res.json(await ara(s));
  } catch (hata) {
    hataCevap(res, 500, `Arama başarısız: ${(hata as Error).message}`);
  }
});

/** Genel web aramasi: PDF/sunum bulmanin yolu.
 *  Program sadece arama motoruna sorgu gonderir, gelen baglantilari listeler.
 *
 *  NOT: Sunucudan HTML cozmek kotu bir fikir ve arama motorlari bunu engelliyor.
 *  Guvenilir calistigi dogrulanmayan motorlarda bos sonuc doner; boyle bir
 *  durumda kullaniciya hazir bir arama adresi gosteriyoruz. */
uygulama.post("/api/web-search", async (req: Request, res: Response) => {
  const s = sorguAyikla(req.body);
  if (typeof s === "string") return hataCevap(res, 400, s);

  const terimler = [`"${s.baslik}"`];
  if (s.yazar) terimler.push(`"${s.yazar}"`);
  if (s.yil) terimler.push(String(s.yil));
  const elleAdres = `https://www.bing.com/search?q=${encodeURIComponent(terimler.join(" "))}`;

  try {
    const isler = await sureSinirli(() => genelArama(s), ayar.kaynakTimeoutMs);

    res.json({
      sorgu: s,
      sureMs: 0,
      gruplar: grupla(isler, s),
      kaynakDurumlari: [
        {
          id: "web-genel",
          ad: "Genel Web Araması",
          tur: ["kitap", "makale", "slayt"],
          aciklama: isler.length
            ? `Bing üzerinden ${isler.length} bağlantı`
            : "Bing bu ortamdan site: / filetype: filtrelerini uygulamadı; elle arama adresi aşağıda",
          hazir: true,
          sonucSayisi: isler.length,
          sureMs: 0,
        },
      ],
      toplamSonuc: isler.length,
      elleAramaAdresi: elleAdres,
      gruplamaNotu: isler.length
        ? "Bu sonuçlar arama motorundan gelen bağlantılardır. Program içerik indirmedi; yalnızca nerede bulunabileceğini gösterir."
        : "Program üzerinden genel web araması bu ortamda güvenilir sonuç vermiyor. Aşağıdaki adresi tarayıcınızda açarsanız sonuçları kendiniz görürsünüz.",
    });
  } catch (hata) {
    // Sunucu tarafi arama calismasa bile elle acilabilir adresi don.
    res.json({
      sorgu: s,
      sureMs: 0,
      gruplar: [],
      kaynakDurumlari: [
        {
          id: "web-genel",
          ad: "Genel Web Araması",
          tur: ["kitap", "makale", "slayt"],
          aciklama: `Otomatik arama başarısız: ${(hata as Error).message}`,
          hazir: false,
          sonucSayisi: 0,
          sureMs: 0,
        },
      ],
      toplamSonuc: 0,
      elleAramaAdresi: elleAdres,
      gruplamaNotu:
        "Otomatik web araması bu ortamda engellendi. Aşağıdaki adresi tarayıcınızda açabilirsiniz.",
    });
  }
});

/** Kaynak listesi ve hazirlik durumu. */
uygulama.get("/api/sources", async (_req: Request, res: Response) => {
  await kaynaklariYukle();
  res.json({ kaynaklar: kaynakListesi(), yuklenmeHatalari: yuklenmeHataListesi() });
});

/**
 * Kapak gorselleri arayuzde gosterilir ama bazi kaynaklar (Google, Open Library)
 * tarayicidan dogran istegi reddeder. Bu proxy yalnizca gorsel (paket) dondurur.
 */
const IZINLI_KAPAK_ALANLARI = [
  "covers.openlibrary.org",
  "books.google.com",
  "books.googleusercontent.com",
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
  "upload.wikimedia.org",
  "gutenberg.org",
];

uygulama.get("/api/kapak", async (req: Request, res: Response) => {
  const url = guvenliUrl(req.query.url);
  if (!url) return hataCevap(res, 400, "Geçersiz kapak adresi");

  const alan = new URL(url).hostname;
  if (!IZINLI_KAPAK_ALANLARI.some((a) => alan === a || alan.endsWith(`.${a}`))) {
    return hataCevap(res, 403, "Bu kapak kaynağına izin verilmiyor");
  }

  try {
    const kaynak = await get(url, {
      ham: true,
      disAg: true,
      tekrar: 0,
      timeoutMs: 10_000,
      boslukMs: 200,
      izinliHost: (host) => IZINLI_KAPAK_ALANLARI.some((a) => host === a || host.endsWith(`.${a}`)),
    });
    const tip = String(kaynak.headers.get("content-type") ?? "").split(";")[0]!;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(tip)) {
      await kaynak.body?.cancel();
      return hataCevap(res, 502, "Kapak yanıtı desteklenen bir görsel değil");
    }
    res.setHeader("cache-control", "public, max-age=86400");
    res.type(tip);
    res.send(Buffer.from(await sinirliGovde(kaynak, 5 * 1024 * 1024)));
  } catch (hata) {
    res.status(502).end();
    void hata;
  }
});

/** Tek bir kaynagi dogrudan calistir (hata ayiklama icin). */
uygulama.post("/api/source/:id/run", async (req: Request, res: Response) => {
  const s = sorguAyikla(req.body);
  if (typeof s === "string") return hataCevap(res, 400, s);

  const { kaynakGetir } = await import("./registry.js");
  const kaynak = await kaynakGetir(String(req.params.id));
  if (!kaynak) return hataCevap(res, 404, "Kaynak bulunamadı");
  const hazirlik = kaynakHazirligi(kaynak);
  if (!hazirlik.hazir) {
    return hataCevap(res, 409, hazirlik.hata ?? "Kaynak hazır değil");
  }

  const t0 = Date.now();
  try {
    const isler = await sureSinirli(() => kaynak.ara(s), ayar.kaynakTimeoutMs);
    res.json({
      kaynak: kaynak.id,
      sureMs: Date.now() - t0,
      sonucSayisi: isler.length,
      sonuclar: isler,
    });
  } catch (hata) {
    res.status(502).json({
      hata: `${(hata as Error).message}`,
      kaynak: kaynak.id,
      sureMs: Date.now() - t0,
    });
  }
});

/** Icerik indirme. */
uygulama.post("/api/download", async (req: Request, res: Response) => {
  const g = (req.body ?? {}) as Record<string, unknown>;
  const url = guvenliUrl(g.url);
  if (!url) return hataCevap(res, 400, "Geçersiz indirme adresi");

  const baslik =
    typeof g.baslik === "string" && g.baslik.trim() ? g.baslik.trim().slice(0, 150) : "icerik";
  const tur = g.tur === "epub" ? "epub" : g.tur === "metin" ? "metin" : "pdf";

  try {
    const sonuc = await indir({ url, varsayilanAd: baslik }, tur);
    res.json({ ...sonuc, tamAd: path.resolve(sonuc.yol) });
  } catch (hata) {
    hataCevap(res, 502, `İndirme başarısız: ${(hata as Error).message}`);
  }
});

/** Ozet. */
uygulama.post("/api/summary", async (req: Request, res: Response) => {
  const g = (req.body ?? {}) as Record<string, unknown>;
  const url = guvenliUrl(g.url);
  if (!url) return hataCevap(res, 400, "Geçersiz içerik adresi");

  const baslik =
    typeof g.baslik === "string" && g.baslik.trim() ? g.baslik.trim().slice(0, 150) : "İçerik";
  const tur = g.tur === "metin" ? "metin" : "pdf";

  try {
    const sonuc = await ozetUret({ url, tur, baslik, oncedenIndir: Boolean(g.oncedenIndir) });
    res.json(sonuc);
  } catch (hata) {
    hataCevap(res, 502, `Özet üretilemedi: ${(hata as Error).message}`);
  }
});

/**
 * Sayfa sayisi. Kaynaklar cogunlukla vermiyor (arXiv, Zenodo, OpenAIRE);
 * burada PDF indirilip icinden okunuyor, sonuc onbellege aliniyor.
 */
uygulama.post("/api/sayfa-sayisi", async (req: Request, res: Response) => {
  const g = (req.body ?? {}) as Record<string, unknown>;
  const ham = Array.isArray(g.adresler) ? g.adresler : [];
  const adresler = ham
    .slice(0, 30)
    .map((a) => guvenliUrl(a))
    .filter((a): a is string => Boolean(a));

  if (!adresler.length) return hataCevap(res, 400, "Geçerli adres gerekli");

  try {
    res.json({ sonuclar: await topluSayfaSayisi(adresler) });
  } catch (hata) {
    hataCevap(res, 502, `Sayfa sayısı alınamadı: ${(hata as Error).message}`);
  }
});

/* ------------------------------- saglik ucu ------------------------------ */

/**
 * Saglik kontrolu. CI'da ve kullanici teshislerinde kullanilir:
 * "program ayakta mi ve kaynaklar yuklendi mi?"
 */
uygulama.get("/api/saglik", (_req: Request, res: Response) => {
  const kaynaklar = kaynakListesi();
  const yuklene = kaynaklar.filter((k) => k.hazir);

  const saglikli = yuklene.length > 0;

  res.status(saglikli ? 200 : 503).json({
    durum: saglikli ? "ok" : "kaynak yok",
    surum: SURUM,
    node: process.versions.node,
    sure: Math.round(process.uptime()),
    kaynak: {
      toplam: kaynaklar.length,
      hazir: yuklene.length,
      kapali: kaynaklar.filter((k) => !k.hazir).map((k) => k.id),
      yuklenmeHatalari: yuklenmeHataListesi(),
    },
    yapilandirma: {
      // Anahtarlarin varligini yaziyoruz, degerlerini ASLA.
      eposta: Boolean(ayar.contactEmail),
      googleBooks: Boolean(ayar.googleBooksKey),
      semanticScholar: Boolean(ayar.semanticScholarKey),
      llm: Boolean(ayar.llm.apiKey),
    },
    dizin: {
      kaynak: ayar.sourcesDir,
      indirme: ayar.downloadsDir,
      onbellek: ayar.cacheDir,
    },
  });
});

/** Indirilen dosyalar. */
uygulama.get("/api/downloads", async (_req: Request, res: Response) => {
  res.json({ dosyalar: await indirilenleriListele() });
});

/** Yalnızca downloads içindeki tamamlanmış normal dosyaları sunar. */
uygulama.get("/api/downloads/:dosya", async (req, res) => {
  const ad = String(req.params.dosya);
  if (
    !ad ||
    ad !== path.basename(ad) ||
    /[\\/:]/.test(ad) ||
    ad.startsWith(".") ||
    !/\.(pdf|txt|epub)$/i.test(ad)
  )
    return hataCevap(res, 400, "Geçersiz dosya adı");
  const yol = path.join(ayar.downloadsDir, ad);
  try {
    const st = await fs.lstat(yol);
    if (!st.isFile() || st.isSymbolicLink()) return hataCevap(res, 404, "Dosya bulunamadı");
    const [kok, gercek] = await Promise.all([fs.realpath(ayar.downloadsDir), fs.realpath(yol)]);
    if (path.dirname(gercek) !== kok) return hataCevap(res, 403, "Dosya klasör dışında");
    res.setHeader("content-security-policy", "default-src 'none'; sandbox");
    res.download(gercek, ad);
  } catch {
    hataCevap(res, 404, "Dosya bulunamadı");
  }
});

/** Kullanicinin kayit ettigi kaynak dosyalarini okur (hata ayiklama). */
uygulama.get("/api/custom-sources", async (_req: Request, res: Response) => {
  try {
    const dosyalar = await fs.readdir(ayar.sourcesDir);
    res.json({
      klasor: ayar.sourcesDir,
      dosyalar: dosyalar.filter((d) => d.endsWith(".ts")),
      ipucu: "Bu klasöre varsayılan export'u SourceModule olan bir .ts dosyası eklemen yeterli.",
    });
  } catch (hata) {
    hataCevap(res, 500, (hata as Error).message);
  }
});

/** Onbellegi temizle. */
uygulama.post("/api/cache/clear", async (_req: Request, res: Response) => {
  const { onbellekTemizle } = await import("./cache.js");
  await onbellekTemizle();
  res.json({ temizlendi: true });
});

/* ------------------------------ statik dosyalar ------------------------- */

uygulama.use(express.static(ayar.publicDir));
uygulama.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => {
  res.sendFile(path.join(ayar.publicDir, "index.html"));
});

uygulama.use("/api", (_req, res) => hataCevap(res, 404, "API yolu bulunamadı"));
uygulama.use((hata: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const durum = hata.status === 413 ? 413 : hata.status === 400 ? 400 : 500;
  hataCevap(
    res,
    durum,
    durum === 413
      ? "İstek gövdesi çok büyük"
      : durum === 400
        ? "Geçersiz JSON isteği"
        : "İstek işlenemedi",
  );
});
