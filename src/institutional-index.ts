import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ayar } from "./config.js";
import { tokenlar } from "./normalize.js";
import { istekSinyali } from "./deadline.js";
import type { Sorgu, Work } from "./types.js";

const MAX_KAYIT = 20_000,
  MAX_BAYT = 20 * 1024 * 1024;
interface Kayit {
  eser: Work;
  goruldu: string;
}
interface Indeks {
  surum: 1;
  guncellendi: string;
  kayitlar: Kayit[];
}
export const arsivIndeksYolu = () => path.join(ayar.dataDir, "archives", "observed.json");
let sira: Promise<unknown> = Promise.resolve();
export function arsivIndeksSurumu(): string {
  try {
    const s = fs.statSync(arsivIndeksYolu());
    return `v1:${s.mtimeMs}:${s.size}`;
  } catch {
    return "v1:yok";
  }
}
async function oku(): Promise<Indeks> {
  const yol = arsivIndeksYolu();
  try {
    if ((await fsp.stat(yol)).size > MAX_BAYT)
      throw Error("Yerel arşiv indeksi 20 MB sınırını aşıyor");
    const v = JSON.parse(await fsp.readFile(yol, "utf8")) as Indeks;
    if (
      v.surum !== 1 ||
      !Array.isArray(v.kayitlar) ||
      v.kayitlar.length > MAX_KAYIT ||
      v.kayitlar.some(
        (r) =>
          !r?.eser ||
          typeof r.eser.baslik !== "string" ||
          typeof r.eser.link !== "string" ||
          !Array.isArray(r.eser.yazarlar) ||
          !["openmetu", "bilkent", "sabanci"].includes(r.eser.kaynak),
      )
    )
      throw Error("Yerel arşiv indeksi bozuk; mevcut dosya korundu");
    return v;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { surum: 1, guncellendi: "", kayitlar: [] };
    throw e;
  }
}

/** Yalnızca gerçekten sorgulanmış kamuya açık kayıtların künyesi; toplu tarama ve PDF depolama yapmaz. */
export async function arsiveKaydet(eserler: Work[]): Promise<void> {
  if (!eserler.length) return;
  const signal = istekSinyali.getStore();
  const is = sira
    .catch(() => undefined)
    .then(async () => {
      signal?.throwIfAborted();
      const onceki = await oku();
      const kayitlar = new Map(onceki.kayitlar.map((r) => [r.eser.link, r]));
      const zaman = new Date().toISOString();
      for (const w of eserler) {
        // Kaynak ham yanıtlarını saklama; kayıtların boyutu ve arama metni sınırlıdır.
        const { ham: _ham, ...eser } = w;
        kayitlar.delete(w.link);
        kayitlar.set(w.link, {
          eser: { ...eser, ozet: eser.ozet?.slice(0, 8000), konular: eser.konular?.slice(0, 20) },
          goruldu: zaman,
        });
      }
      const liste = [...kayitlar.values()].slice(-MAX_KAYIT);
      let json = JSON.stringify({ surum: 1, guncellendi: zaman, kayitlar: liste });
      while (Buffer.byteLength(json) > MAX_BAYT && liste.length) {
        liste.splice(0, Math.max(1, Math.ceil(liste.length / 10)));
        json = JSON.stringify({ surum: 1, guncellendi: zaman, kayitlar: liste });
      }
      const yol = arsivIndeksYolu();
      await fsp.mkdir(path.dirname(yol), { recursive: true });
      const gecici = `${yol}.${randomUUID()}.part`;
      try {
        await fsp.writeFile(gecici, json, { flag: "wx" });
        signal?.throwIfAborted();
        await fsp.rename(gecici, yol);
      } finally {
        await fsp.rm(gecici, { force: true });
      }
    });
  sira = is;
  try {
    await is;
  } catch (e) {
    signal?.throwIfAborted();
    // İndeksin yazılamaması, canlı kaynağın başarılı sonucunu kaybettirmez.
    console.warn(`[yerel-arsiv] Künye saklanamadı: ${(e as Error).message}`);
  }
}

interface KelimeIndeksi {
  belgeler: Kayit[];
  uzunluklar: number[];
  ortalama: number;
  kelimeler: Map<string, Map<number, number>>;
}
let bellekSurumu = "";
const kelimeIndeksleri = new Map<string, KelimeIndeksi>();
async function kelimeIndeksi(tur: Sorgu["tur"]): Promise<KelimeIndeksi> {
  const surum = `${arsivIndeksYolu()}:${arsivIndeksSurumu()}`;
  if (surum !== bellekSurumu) {
    kelimeIndeksleri.clear();
    bellekSurumu = surum;
  }
  const onceki = kelimeIndeksleri.get(tur);
  if (onceki) return onceki;
  const belgeler = (await oku()).kayitlar.filter((r) => r.eser.tur === tur);
  const kelimeler = new Map<string, Map<number, number>>();
  const uzunluklar = belgeler.map((r, id) => {
    const w = r.eser;
    const tokens = tokenlar(
      `${w.baslik} ${w.baslik} ${w.baslik} ${(w.konular ?? []).join(" ")} ${w.ozet ?? ""}`,
    );
    for (const t of tokens) {
      let liste = kelimeler.get(t);
      if (!liste) {
        liste = new Map();
        kelimeler.set(t, liste);
      }
      liste.set(id, (liste.get(id) ?? 0) + 1);
    }
    return tokens.length;
  });
  const indeks = {
    belgeler,
    uzunluklar,
    kelimeler,
    ortalama: uzunluklar.reduce((a, b) => a + b, 0) / belgeler.length || 1,
  };
  // Okuma sırasında dosya değiştiyse eski görünümü sonraki aramaya taşıma.
  if (surum === `${arsivIndeksYolu()}:${arsivIndeksSurumu()}`) kelimeIndeksleri.set(tur, indeks);
  return indeks;
}

/** Başlık, konu ve özet üzerinde ters kelime indeksi + BM25; yeni URL üretmez. */
export async function yerelArsivdeAra(s: Sorgu): Promise<Work[]> {
  const sorgu = [...new Set(tokenlar(s.baslik))];
  if (!sorgu.length) return [];
  const indeks = await kelimeIndeksi(s.tur);
  const puanlar = new Map<number, { puan: number; ortak: number }>();
  for (const t of sorgu) {
    const liste = indeks.kelimeler.get(t);
    if (!liste) continue;
    const idf = Math.log(1 + (indeks.belgeler.length - liste.size + 0.5) / (liste.size + 0.5));
    for (const [id, f] of liste) {
      const d = puanlar.get(id) ?? { puan: 0, ortak: 0 };
      d.puan +=
        (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * indeks.uzunluklar[id]!) / indeks.ortalama));
      d.ortak++;
      puanlar.set(id, d);
    }
  }
  return [...puanlar]
    .filter(([, d]) => d.ortak >= Math.max(1, Math.ceil(sorgu.length * 0.5)))
    .sort((a, b) => b[1].puan - a[1].puan)
    .slice(0, s.limit)
    .map(([id]) => {
      const r = indeks.belgeler[id]!;
      return {
        ...r.eser,
        kaynak: "yerel-arsiv",
        kaynakAd: `Yerel indeks · ${r.eser.kaynakAd}`,
        arsivGorulmeZamani: r.goruldu,
      };
    });
}
