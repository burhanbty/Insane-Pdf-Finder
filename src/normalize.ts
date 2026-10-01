/*
 * Turkce metin normalizasyonu + eser eslestirme/puanlama.
 * Ayni eser farkli kaynaklarda farkli yazimla gelir ("Sapiens: A Brief
 * History of Humankind" / "SAPIENS - KISA INSA TARIHI"). Burada hepsi
 * tek bir karsilastirma anahtarina indirgenir.
 */

/** Turkce ve Latin-1 karakterleri ASCII karsiliklarina indirger. */
const HARF_MAP: Record<string, string> = {
  ç: "c", Ç: "c", ğ: "g", Ğ: "g", ı: "i", İ: "i", I: "i",
  ö: "o", Ö: "o", ş: "s", Ş: "s", ü: "u", Ü: "u",
  â: "a", Â: "a", î: "i", Î: "i", û: "u", Û: "u",
  é: "e", É: "e", è: "e", È: "e", á: "a", Á: "a",
  í: "i", Í: "i", ó: "o", Ó: "o", ú: "u", Ú: "u", ñ: "n", Ñ: "n",
};

/** Basliklarda atilan ama anlam tasiyan kelimeler. */
const EDATLAR = new Set([
  "the", "a", "an", "of", "and", "or", "in", "on", "to", "for", "with",
  "is", "are", "was", "were", "be", "been", "it", "its", "this", "that",
  "these", "those", "as", "by", "at", "from", "you", "your", "we", "our",
  "not", "no", "do", "does", "did", "how", "what", "why", "when", "who",
  "can", "will", "all", "any", "more", "most", "than", "then", "so",
  "bir", "ve", "ile", "icin", "uzere", "da", "de", "dan", "den", "bu",
  "ne", "nasil", "neden", "hangi", "her", "daha", "cok", "veya", "gibi",
]);

/** Surucu harflerini ve gereksiz noktalama isaretlerini atar. */
export function normalizeMetin(girdi: string): string {
  if (!girdi) return "";
  let s = girdi.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  let cikis = "";
  for (const harf of s) {
    cikis += HARF_MAP[harf] ?? harf;
  }

  return cikis
    .replace(/[’'`´]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Anlamli tokenlari sirayla, tekrarsiz dondurur. */
export function tokenlar(metin: string): string[] {
  const ham = normalizeMetin(metin).split(" ").filter(Boolean);
  const gecerli = ham.filter((t) => t.length > 1 && !EDATLAR.has(t));
  return [...new Set(gecerli.length ? gecerli : ham)];
}

/** Tam eserler icin karsilastirma anahtari. */
export function eserAnahtari(baslik: string): string {
  return tokenlar(baslik).sort().join(" ");
}

/** Soyadin parcası sayılan edatlar ("de Cervantes Saavedra"). */
const SOYAD_EDATLARI = new Set([
  "de", "del", "della", "di", "da", "do", "dos", "das", "van", "von",
  "der", "den", "ten", "ter", "la", "le", "el", "al", "ibn", "yildiz",
  "sark",
]);

/** Yazar adindan soyad ve ad parcalarini cikarir. */
export function yazarParcalari(yazar: string): { tam: string; soyad: string[]; ad: string[] } {
  const parcalar = yazar
    .split(/[,;]|\band\b/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const isimler = parcalar.length ? parcalar : [yazar.trim()];

  const soyad: string[] = [];
  const ad: string[] = [];
  for (const isim of isimler) {
    const parca = normalizeMetin(isim).split(" ").filter(Boolean);
    if (!parca.length) continue;

    const son = parca[parca.length - 1]!;
    soyad.push(son);
    ad.push(...parca.slice(0, -1).filter((p) => !SOYAD_EDATLARI.has(p)));
  }
  return { tam: normalizeMetin(isimler.join(" ")), soyad: [...new Set(soyad)], ad: [...new Set(ad)] };
}

/** Jaccard benzerligi. */
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let kesisim = 0;
  for (const t of sa) if (sb.has(t)) kesisim++;
  return kesisim / (sa.size + sb.size - kesisim);
}

/**
 * Baslik benzerligi. Jaccard tek basina yetersiz: kullanici "Sapiens"
 * yazip kaynakta "Sapiens: A Brief History of Humankind" bulundugunda
 * kesisim 1/4 ile cok dusuk kaliyor. Bu yuzden kisa tarafin ne kadar
 * tamamen kapsandigi da hesaba katilir; ek puan, kapsama oraniyla
 * olceklenir ki tek kelimelik genel basliklar yuksek puan almasin.
 */
function baslikBenzerligi(sorguTokenlari: string[], eserTokenlari: string[]): number {
  if (!sorguTokenlari.length || !eserTokenlari.length) return 0;
  const j = jaccard(sorguTokenlari, eserTokenlari);

  const kisa = sorguTokenlari.length <= eserTokenlari.length ? sorguTokenlari : eserTokenlari;
  const uzun = sorguTokenlari.length <= eserTokenlari.length ? eserTokenlari : sorguTokenlari;
  const kume = new Set(uzun);
  const kaplanan = kisa.filter((t) => kume.has(t)).length;
  const kaplama = kaplanan / kisa.length;
  const oran = kisa.length / uzun.length;

  return Math.min(1, j + 0.5 * kaplama * oran);
}

/** Yazar eslesmesi: soyad eslesmesi agir, sadece ad eslesmesi hafif. */
function yazarPuani(sorguYazarlar: string[], eserYazarlar: string[]): number {
  if (!sorguYazarlar.length || !eserYazarlar.length) return 0;
  let enIyi = 0;

  for (const sy of sorguYazarlar) {
    const s = yazarParcalari(sy);
    for (const ey of eserYazarlar) {
      const e = yazarParcalari(ey);
      const ortakSoyad = s.soyad.filter((x) => e.soyad.includes(x));
      const ortakAd = s.ad.filter((x) => e.ad.includes(x));
      const benzerlik = jaccard(s.soyad, e.soyad);

      let p = 0;
      if (ortakSoyad.length) {
        p = 0.55 + 0.25 * benzerlik + (ortakAd.length ? 0.2 : 0);
      } else if (ortakAd.length) {
        p = 0.2;
      }
      if (normalizeMetin(sy) === normalizeMetin(ey)) p = 1;
      if (p > enIyi) enIyi = p;
    }
  }
  return enIyi;
}

/** Yil sapmasi: 0 yil fark ideal, 1 yil kabul edilebilir. */
function yilPuani(sorguYil: number | undefined, eserYil: number | undefined): number | null {
  if (!sorguYil || !eserYil) return null;
  const fark = Math.abs(sorguYil - eserYil);
  if (fark === 0) return 1;
  if (fark === 1) return 0.7;
  if (fark <= 3) return 0.4;
  return 0;
}

export interface EslestirmeGirdi {
  baslik: string;
  yazarlar: string[];
  yil?: number;
}

export interface Eslestirme {
  puan: number;
  baslik: number;
  yazar: number;
  yil: number | null;
  anahtar: string;
}

/**
 * Sorgu ile eser arasindaki eslesme puani (0-1).
 * Baslik en agir agirlik; yil yoksa puanlamaya hic katilmaz.
 */
export function eslestir(sorgu: EslestirmeGirdi, eser: EslestirmeGirdi): Eslestirme {
  const baslik = baslikBenzerligi(tokenlar(sorgu.baslik), tokenlar(eser.baslik));
  const yazar = yazarPuani(sorgu.yazarlar, eser.yazarlar);
  const yil = yilPuani(sorgu.yil, eser.yil);

  const parcalar: number[] = [baslik, yazar];
  const agirliklar: number[] = [0.6, 0.4];
  if (yil !== null) {
    parcalar.push(yil);
    agirliklar.push(0.15);
  }

  const toplamAgirlik = agirliklar.reduce((a, b) => a + b, 0);
  const puan = parcalar.reduce((a, b, i) => a + b * agirliklar[i]!, 0) / toplamAgirlik;

  return {
    puan,
    baslik,
    yazar,
    yil,
    anahtar: eserAnahtari(eser.baslik),
  };
}

/** Baslikta verilen yili (varsa) metinden cikarir. */
export function metindenYil(baslik: string): number | undefined {
  const eslesme = baslik.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  if (!eslesme) return undefined;
  const y = Number(eslesme[1]);
  return y >= 1500 && y <= 2100 ? y : undefined;
}

/** Yil kontrolu: sorgudaki yil verilmisse ve uyumsuzsa sonucu ele. */
export function yilUyumlu(sorguYil: number | undefined, eserYil: number | undefined): boolean {
  if (!sorguYil || !eserYil) return true;
  return Math.abs(sorguYil - eserYil) <= 1;
}