import express, { type Request, type Response } from "express";
import { ayar } from "./config.js";
import { ara, grupla } from "./search.js";
import { kaynakListesi, kaynaklariYukle, yuklenmeHataListesi } from "./registry.js";
import { indir, indirilenleriListele } from "./download.js";
import { topluSayfaSayisi } from "./sayfa.js";
import { ozetUret } from "./summary.js";
import { genelArama } from "./sources/web-slayt.js";
import { get } from "./http.js";
import type { Sorgu, Tur } from "./types.js";
import fs from "node:fs/promises";
import path from "node:path";

const uygulama = express();
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

  const tur = TURLER.includes(g.tur as Tur) ? (g.tur as Tur) : "kitap";

  let yil: number | undefined;
  if (g.yil !== undefined && g.yil !== null && g.yil !== "") {
    const n = Number(g.yil);
    if (!Number.isInteger(n) || n < 1000 || n > 2100) return "Yıl 1000-2100 arası olmalı";
    yil = n;
  }

  const limit = Math.min(50, Math.max(1, Number(g.limit) || 20));

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
    const isler = await genelArama(s);

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
];

uygulama.get("/api/kapak", async (req: Request, res: Response) => {
  const url = guvenliUrl(req.query.url);
  if (!url) return hataCevap(res, 400, "Geçersiz kapak adresi");

  const alan = new URL(url).hostname;
  if (!IZINLI_KAPAK_ALANLARI.some((a) => alan === a || alan.endsWith(`.${a}`))) {
    return hataCevap(res, 403, "Bu kapak kaynağına izin verilmiyor");
  }

  try {
    const kaynak = await get(url, { ham: true, timeoutMs: 10_000, boslukMs: 200 });
    res.setHeader("cache-control", "public, max-age=86400");
    res.type(String(kaynak.headers.get("content-type") ?? "image/jpeg"));
    res.send(Buffer.from(await kaynak.arrayBuffer()));
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
  if (kaynak.hazirMi && !kaynak.hazirMi()) {
    return hataCevap(res, 409, "Kaynak için API anahtarı gerekli");
  }

  const t0 = Date.now();
  try {
    const isler = await kaynak.ara(s);
    res.json({ kaynak: kaynak.id, sureMs: Date.now() - t0, sonucSayisi: isler.length, sonuclar: isler });
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

  const baslik = typeof g.baslik === "string" && g.baslik.trim() ? g.baslik.trim().slice(0, 150) : "icerik";
  const tur = g.tur === "metin" ? "metin" : "pdf";

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

  const baslik = typeof g.baslik === "string" && g.baslik.trim() ? g.baslik.trim().slice(0, 150) : "İçerik";
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

/** Indirilen dosyalar. */
uygulama.get("/api/downloads", async (_req: Request, res: Response) => {
  res.json({ dosyalar: await indirilenleriListele() });
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

/* --------------------------------- calistir ------------------------------ */

const yuklenen = await kaynaklariYukle();

console.log(`[kaynak-bul] proje koku: ${ayar.projeKok}`);
console.log(`[kaynak-bul] kaynak klasoru: ${ayar.sourcesDir}`);

for (const h of yuklenmeHataListesi()) {
  console.warn(`[kaynak-bul] UYARI "${h.dosya}" yuklenemedi: ${h.hata}`);
}

if (!yuklenen.length) {
  // Sunucu ayaga kalkiyor ama arama yapamaz; bunu sessizce gecmek
  // kullaniciyi "0 sonuc" ile bas basina birakirdi.
  console.error("");
  console.error("[kaynak-bul] HATA: hic kaynak yuklenemedi. Arama calismaz.");
  console.error(`[kaynak-bul] Beklenen konum: ${ayar.sourcesDir}`);
  console.error("[kaynak-bul] Dogrulamak icin: curl http://" + ayar.host + ":" + ayar.port + "/api/sources");
  console.error("");
} else {
  console.log(`[kaynak-bul] ${yuklenen.length} kaynak yuklendi: ${yuklenen.map((k) => k.id).join(", ")}`);
  const anahtarsiz = yuklenen.filter((k) => k.hazirMi && !k.hazirMi()).map((k) => k.id);
  if (anahtarsiz.length) {
    console.log(`[kaynak-bul] anahtar gerektiren kaynaklar (kapali): ${anahtarsiz.join(", ")}`);
  }
}

console.log(`[kaynak-bul] http://${ayar.host}:${ayar.port}`);

uygulama.listen(ayar.port, ayar.host, () => {
  console.log(`[kaynak-bul] sunucu hazir`);
});