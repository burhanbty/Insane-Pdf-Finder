/* Ortak veri tipleri. Tum kaynaklar Work[] doner, sunucu hepsini birlestirir. */

export type Tur = "kitap" | "makale" | "slayt";

export interface Sorgu {
  baslik: string;
  yazar?: string;
  yil?: number;
  tur: Tur;
  limit: number;
}

/** Tek bir kaynaktan gelen ham sonuc. */
export interface Work {
  kaynak: string;
  kaynakAd: string;
  tur: Tur;

  baslik: string;
  altBaslik?: string;
  yazarlar: string[];
  yil?: number;

  ozet?: string;
  konular?: string[];
  yayinci?: string;
  dil?: string;
  isbn?: string;
  doi?: string;
  /** Metin olarak sayfa bilgisi (örn. "412 sayfa", "12: 30-58"). */
  sayfa?: string;
  /** Sayfanin sayisi. Kaynaga gore ya da PDF icinden olculur. */
  sayfaSayisi?: number;
  atif?: number;

  kapak?: string;
  /** Kaynağın kendi sayfası (her zaman var). */
  link: string;
  /** Dogrudan indirilebilir yasal PDF/metin. */
  pdf?: string;
  /** Dogrudan okunabilir tam metin. */
  tamMetin?: string;
  /** Tarayici uzerinde acilacak erisim turu. */
  erisim?: "acik" | "sinirli" | "odunc" | "yonlendir";

  ham?: unknown;
}

/** Eslesme sonrasi birlestirilmis eser. */
export interface Gruplanmis {
  anahtar: string;
  tur: Tur;
  baslik: string;
  altBaslik?: string;
  yazarlar: string[];
  yil?: number;
  ozet?: string;
  konular: string[];
  kapak?: string;
  puan: number;
  /** Esere ait bilinen sayfa sayisi (varsa). */
  sayfaSayisi?: number;
  /** Sayfa bilgisi metin olarak (ornegin kunye bilgisinden). */
  sayfa?: string;
  kaynaklar: Work[];
}

export interface KaynakInfo {
  id: string;
  ad: string;
  tur: Tur[];
  aciklama: string;
  hazir: boolean;
  hata?: string;
}

export interface SourceModule {
  id: string;
  ad: string;
  tur: Tur[];
  aciklama?: string;
  /** Anahtar yoksa kaynak sessizce atlanir. */
  hazirMi?(): boolean;
  ara(sorgu: Sorgu): Promise<Work[]>;
}