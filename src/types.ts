/* Ortak veri tipleri. Tum kaynaklar Work[] doner, sunucu hepsini birlestirir. */

export type Tur = "kitap" | "makale" | "slayt";

export interface Sorgu {
  baslik: string;
  yazar?: string;
  yil?: number;
  tur: Tur;
  limit: number;
  isbn?: string;
  baski?: string;
  dil?: string;
  yayinci?: string;
}

/** Kaynak üstverisinin bildirdiği aday; dosya veya eser kimliği henüz doğrulanmış değildir. */
export interface PdfAdayi {
  url: string;
  kaynak: string;
  kayitUrl?: string;
  doi?: string;
  lisans?: string;
  surum?: string;
  hostTuru?: "publisher" | "repository";
  baglantiTuru?: "pdf" | "kayit";
  durum: "aday";
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
  baski?: string;
  doi?: string;
  /** Eser üst kaydının yılı, belirli bir baskının yayın yılı değildir. */
  kunyeTuru?: "eser" | "baski";
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
  /** Aynı eserin alternatif PDF konumları; eski istemciler için pdf alanı da korunur. */
  pdfAdaylari?: PdfAdayi[];
  belgeTuru?: "kitap" | "kitap-bolumu";
  /** EPUB, PDF'ten ayrı bir indirme biçimidir. */
  epub?: string;
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
  eslesme?: {
    tur: "tam" | "yakin" | "ilgili";
    aciklama: string;
    oneri?: boolean;
  };
  karsilastirma?: {
    kaynakLink: string;
    kaynakAd: string;
    alanlar: {
      alan: string;
      istenen: string;
      bulunan: string;
      durum: "uygun" | "farkli" | "bilinmiyor";
    }[];
  }[];
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
  hazirDegilAciklamasi?: string;
  /** Yerel indeks yenilenince hem kaynak hem arama önbelleğini geçersiz kılar. */
  onbellekSurumu?(): string;
  ara(sorgu: Sorgu): Promise<Work[]>;
}
