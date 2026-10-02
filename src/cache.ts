import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ayar } from "./config.js";

/*
 * Basit iki katmanli onbellek: bellek (LRU) + disk.
 * Open Library kendi kuralini koyuyor ("cache whenever possible"),
 * Google Books anahtari yoksa kota agir sekilde daraliyor.
 */

const BELLEK_TTL_MS = 30 * 60 * 1000;
const DISK_TTL_MS = 12 * 60 * 60 * 1000;
const BELLEK_MAX = 500;

interface Kayit<T> {
  zaman: number;
  deger: T;
}

const bellek = new Map<string, Kayit<unknown>>();

function bellekEkle(anahtar: string, deger: unknown) {
  bellek.set(anahtar, { zaman: Date.now(), deger });
  while (bellek.size > BELLEK_MAX) {
    const enEski = bellek.keys().next().value;
    if (enEski === undefined) break;
    bellek.delete(enEski);
  }
}

function diskYol(anahtar: string): string {
  const h = crypto.createHash("sha1").update(anahtar).digest("hex");
  return path.join(ayar.cacheDir, h.slice(0, 2), `${h}.json`);
}

/**
 * Onbellekli GET. Anahtar ayni oldugu surece diskten/bellekten doner.
 */
export async function onbellekli<T>(
  anahtar: string,
  uretici: () => Promise<T>,
  secenek: { disk?: boolean } = {},
): Promise<T> {
  const { disk = true } = secenek;

  const bel = bellek.get(anahtar) as Kayit<T> | undefined;
  if (bel && Date.now() - bel.zaman < BELLEK_TTL_MS) return bel.deger;

  if (disk) {
    const p = diskYol(anahtar);
    try {
      const ham = await fs.readFile(p, "utf8");
      const kayit = JSON.parse(ham) as Kayit<T>;
      if (Date.now() - kayit.zaman < DISK_TTL_MS) {
        bellekEkle(anahtar, kayit.deger);
        return kayit.deger;
      }
    } catch {
      /* onbellek yok, sorun degil */
    }
  }

  const deger = await uretici();
  bellekEkle(anahtar, deger);

  if (disk) {
    const p = diskYol(anahtar);
    try {
      await fs.mkdir(path.dirname(p), { recursive: true });
      const kayit: Kayit<T> = { zaman: Date.now(), deger };
      await fs.writeFile(p, JSON.stringify(kayit), "utf8");
    } catch {
      /* yazamazsak sadece bellek onbellegi gecerli */
    }
  }

  return deger;
}

export function onbellekTemizle() {
  bellek.clear();
  return fs.rm(ayar.cacheDir, { recursive: true, force: true });
}
