import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { eserAnahtari } from "./normalize.js";
import type { Gruplanmis, Sorgu, Work } from "./types.js";
import { isbnDogrula } from "./isbn.js";
import { pdfAdaylariniBirlestir } from "./pdf-candidates.js";
import type { PdfAdayi } from "./types.js";

export class CalismaHatasi extends Error {
  constructor(
    mesaj: string,
    readonly status = 400,
  ) {
    super(mesaj);
  }
}
const DURUMLAR = ["okunacak", "okunuyor", "okundu"] as const;
export interface KitaplikKaydi {
  id: string;
  eser: Gruplanmis;
  koleksiyon: string;
  durum: (typeof DURUMLAR)[number];
  notlar: string;
  arsiv: boolean;
  olusturuldu: string;
  guncellendi: string;
}
export interface KayitliArama {
  id: string;
  ad: string;
  sorgu: Sorgu;
  webDahil: boolean;
}
interface Alan {
  surum: 1;
  kitaplik: KitaplikKaydi[];
  aramalar: KayitliArama[];
}
const BOS = (): Alan => ({ surum: 1, kitaplik: [], aramalar: [] });
const nesne = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new CalismaHatasi("Geçersiz kayıt");
  return v as Record<string, unknown>;
};
function metin(v: unknown, limit: number, zorunlu = false): string {
  if (v === undefined && !zorunlu) return "";
  if (typeof v !== "string" || v.length > limit || (zorunlu && !v.trim()))
    throw new CalismaHatasi(`Metin geçersiz veya ${limit} karakter sınırını aşıyor`);
  return v.trim();
}
function adres(v: unknown): string | undefined {
  if (!v) return undefined;
  try {
    const u = new URL(metin(v, 2000));
    if (["http:", "https:"].includes(u.protocol) && !u.username && !u.password) return u.href;
  } catch {
    /* Geçersiz dış bağlantı kaydedilmez. */
  }
  return undefined;
}
function yil(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (!Number.isInteger(v) || Number(v) < 1000 || Number(v) > 2100)
    throw new CalismaHatasi("Geçersiz yayın yılı");
  return Number(v);
}
function liste(v: unknown, adet: number, uzunluk: number): string[] {
  if (!Array.isArray(v) || v.length > adet) throw new CalismaHatasi("Geçersiz metin listesi");
  return v.map((s) => metin(s, uzunluk, true));
}
function tur(v: unknown): Sorgu["tur"] {
  if (v !== "kitap" && v !== "makale" && v !== "slayt")
    throw new CalismaHatasi("Geçersiz eser türü");
  return v;
}
function eserOku(v: unknown): Gruplanmis {
  const g = nesne(v);
  if (!Array.isArray(g.kaynaklar) || !g.kaynaklar.length || g.kaynaklar.length > 30)
    throw new CalismaHatasi("Eserin kaynak bilgisi gerekli (en fazla 30)");
  const baslik = metin(g.baslik, 1000, true);
  const yazarlar = liste(g.yazarlar, 30, 300);
  const tipi = tur(g.tur);
  const kaynaklar: Work[] = g.kaynaklar.map((v) => {
    const k = nesne(v);
    const link = adres(k.link);
    if (!link) throw new CalismaHatasi("Geçerli kaynak bağlantısı gerekli");
    return {
      kaynak: metin(k.kaynak, 100, true),
      kaynakAd: metin(k.kaynakAd, 200, true),
      tur: tipi,
      baslik: k.baslik === undefined ? baslik : metin(k.baslik, 1000, true),
      yazarlar: k.yazarlar === undefined ? yazarlar : liste(k.yazarlar, 30, 300),
      yil: yil(k.yil),
      link,
      doi: metin(k.doi, 300) || undefined,
      isbn: metin(k.isbn, 40) || undefined,
      baski: metin(k.baski, 200) || undefined,
      arsivGorulmeZamani:
        typeof k.arsivGorulmeZamani === "string" && /^\d{4}-\d{2}-\d{2}T/.test(k.arsivGorulmeZamani)
          ? k.arsivGorulmeZamani.slice(0, 30)
          : undefined,
      kunyeTuru: k.kunyeTuru === "eser" || k.kunyeTuru === "baski" ? k.kunyeTuru : undefined,
      dil: metin(k.dil, 200) || undefined,
      yayinci: metin(k.yayinci, 500) || undefined,
      pdf: adres(k.pdf),
      pdfAdaylari: pdfAdaylariOku(k.pdfAdaylari),
      erisim: ["acik", "sinirli", "odunc", "yonlendir"].includes(String(k.erisim))
        ? (k.erisim as Work["erisim"])
        : undefined,
      belgeTuru: ["kitap", "kitap-bolumu", "tez", "rapor", "ders-notu", "sunum"].includes(
        String(k.belgeTuru),
      )
        ? (k.belgeTuru as Work["belgeTuru"])
        : undefined,
      epub: adres(k.epub),
      tamMetin: adres(k.tamMetin),
    };
  });
  return {
    anahtar: metin(g.anahtar, 2000) || eserAnahtari(baslik),
    tur: tipi,
    baslik,
    yazarlar,
    altBaslik: metin(g.altBaslik, 1000) || undefined,
    yil: yil(g.yil),
    ozet: metin(g.ozet, 10_000) || undefined,
    konular: liste(g.konular ?? [], 30, 300),
    puan: 0,
    kaynaklar,
  };
}
function pdfAdaylariOku(v: unknown): PdfAdayi[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 30)
    throw new CalismaHatasi("En fazla 30 PDF adayı kaydedilebilir");
  return pdfAdaylariniBirlestir(
    v.map((v) => {
      const a = nesne(v);
      return {
        url: adres(a.url) ?? "",
        kaynak: metin(a.kaynak, 100, true),
        kayitUrl: adres(a.kayitUrl),
        doi: metin(a.doi, 300) || undefined,
        lisans: metin(a.lisans, 500) || undefined,
        surum: metin(a.surum, 100) || undefined,
        hostTuru:
          a.hostTuru === "publisher" || a.hostTuru === "repository" ? a.hostTuru : undefined,
        baglantiTuru: a.baglantiTuru === "kayit" ? "kayit" : "pdf",
        durum: "aday" as const,
      };
    }),
  );
}
function kimlik(eser: Gruplanmis): string {
  const doi = eser.kaynaklar
    .find((k) => k.doi)
    ?.doi?.toLowerCase()
    .replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, "")
    .trim();
  // Arama eşleştirmesi baskı numaralarını silebilir; kalıcı kimlikte sayılar korunur.
  const ayniMetin = (s: string) =>
    s.normalize("NFKC").trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
  return createHash("sha256")
    .update(
      doi && /^10\.\d{4,9}\/\S+$/.test(doi)
        ? `doi:${doi}`
        : JSON.stringify([
            eser.tur,
            ayniMetin(eser.baslik),
            eser.yil,
            eser.yazarlar.map(ayniMetin).sort(),
            eser.tur === "kitap"
              ? eser.kaynaklar.map((k) => isbnDogrula(k.isbn)).find(Boolean)
              : undefined,
          ]),
    )
    .digest("hex")
    .slice(0, 32);
}
function aramaOku(v: unknown): Omit<KayitliArama, "id"> {
  const a = nesne(v);
  const s = nesne(a.sorgu);
  const limit = Number(s.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || typeof a.webDahil !== "boolean")
    throw new CalismaHatasi("Arama seçenekleri geçersiz");
  return {
    ad: metin(a.ad, 100, true),
    webDahil: a.webDahil,
    sorgu: {
      baslik: metin(s.baslik, 300, true),
      yazar: metin(s.yazar, 200) || undefined,
      yil: yil(s.yil),
      tur: tur(s.tur),
      limit,
      isbn: s.isbn
        ? (isbnDogrula(s.isbn) ??
          (() => {
            throw new CalismaHatasi("Geçersiz ISBN");
          })())
        : undefined,
      baski: metin(s.baski, 200) || undefined,
      dil: metin(s.dil, 200) || undefined,
      yayinci: metin(s.yayinci, 200) || undefined,
    },
  };
}
function kayitOku(v: unknown): KitaplikKaydi {
  const k = nesne(v);
  const eser = eserOku(k.eser);
  if (!DURUMLAR.includes(k.durum as KitaplikKaydi["durum"]) || typeof k.arsiv !== "boolean")
    throw new CalismaHatasi("Okuma durumu geçersiz");
  const tarih = (v: unknown) => {
    const s = metin(v, 50, true);
    if (!Number.isFinite(Date.parse(s))) throw new CalismaHatasi("Kayıt tarihi geçersiz");
    return new Date(s).toISOString();
  };
  return {
    id: kimlik(eser),
    eser,
    koleksiyon: metin(k.koleksiyon, 80),
    notlar: metin(k.notlar, 5000),
    durum: k.durum as KitaplikKaydi["durum"],
    arsiv: k.arsiv,
    olusturuldu: tarih(k.olusturuldu),
    guncellendi: tarih(k.guncellendi),
  };
}
function alanOku(v: unknown): Alan {
  const a = nesne(v);
  if (a.surum !== 1) throw new CalismaHatasi("Çalışma alanı sürümü desteklenmiyor");
  if (
    !Array.isArray(a.kitaplik) ||
    a.kitaplik.length > 1000 ||
    !Array.isArray(a.aramalar) ||
    a.aramalar.length > 50
  )
    throw new CalismaHatasi("Kitaplık (1000) veya kayıtlı arama (50) sınırı aşıldı");
  const kitaplik = a.kitaplik.map(kayitOku);
  const aramalar = a.aramalar.map((v) => {
    const arama = aramaOku(v);
    return { ...arama, id: aramaKimligi(arama) };
  });
  if (
    new Set(kitaplik.map((k) => k.id)).size !== kitaplik.length ||
    new Set(aramalar.map((a) => a.id)).size !== aramalar.length
  )
    throw new CalismaHatasi("Yedekte yinelenen kayıt var");
  return { surum: 1, kitaplik, aramalar };
}
function aramaKimligi(a: Omit<KayitliArama, "id">) {
  return createHash("sha256")
    .update(JSON.stringify([a.sorgu, a.webDahil]))
    .digest("hex")
    .slice(0, 32);
}

/** Tek süreçte sıralı güncellemeler ve atomik dosya değişimi; okunamayan veri korunur. */
export class CalismaAlani {
  private kuyruk: Promise<unknown> = Promise.resolve();
  constructor(private readonly dosya: () => string) {}
  private async oku(dosya: string): Promise<Alan> {
    try {
      if ((await fs.stat(dosya)).size > 20 * 1024 * 1024)
        throw new Error("Dosya boyutu sınırı aşıldı");
      return alanOku(JSON.parse(await fs.readFile(dosya, "utf8")));
    } catch (hata) {
      if ((hata as NodeJS.ErrnoException).code === "ENOENT") return BOS();
      throw new CalismaHatasi(
        "Çalışma alanı okunamadı. Mevcut dosya korundu; yedeğinizi ve veri klasörünü kontrol edin.",
        500,
      );
    }
  }
  private async yaz(dosya: string, alan: Alan) {
    const data = JSON.stringify(alan);
    if (Buffer.byteLength(data) > 20 * 1024 * 1024)
      throw new CalismaHatasi("Çalışma alanı 20 MB sınırını aşıyor");
    await fs.mkdir(path.dirname(dosya), { recursive: true });
    const gecici = `${dosya}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(gecici, data, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
      await fs.rename(gecici, dosya);
    } finally {
      await fs.rm(gecici, { force: true });
    }
  }
  private degistir<T>(is: (alan: Alan) => T | Promise<T>, yaz = true): Promise<T> {
    const dosya = this.dosya();
    const sonuc = this.kuyruk.then(async () => {
      const alan = await this.oku(dosya);
      const deger = await is(alan);
      if (yaz) await this.yaz(dosya, alan);
      return deger;
    });
    this.kuyruk = sonuc.catch(() => undefined);
    return sonuc;
  }
  listele() {
    return this.degistir((a) => a, false);
  }
  async ekle(girdi: unknown) {
    const eser = eserOku(girdi);
    const id = kimlik(eser);
    return this.degistir((a) => {
      const mevcut = a.kitaplik.find((k) => k.id === id);
      if (mevcut) return { kayit: mevcut, eklendi: false };
      if (a.kitaplik.length >= 1000) throw new CalismaHatasi("Kitaplık 1000 kayıt sınırına ulaştı");
      const zaman = new Date().toISOString();
      const kayit: KitaplikKaydi = {
        id,
        eser,
        koleksiyon: "",
        notlar: "",
        durum: "okunacak",
        arsiv: false,
        olusturuldu: zaman,
        guncellendi: zaman,
      };
      a.kitaplik.unshift(kayit);
      return { kayit, eklendi: true };
    });
  }
  async guncelle(id: string, girdi: unknown) {
    const v = nesne(girdi);
    return this.degistir((a) => {
      const k = a.kitaplik.find((k) => k.id === id);
      if (!k) throw new CalismaHatasi("Kitaplık kaydı bulunamadı", 404);
      if (v.koleksiyon !== undefined) k.koleksiyon = metin(v.koleksiyon, 80);
      if (v.notlar !== undefined) k.notlar = metin(v.notlar, 5000);
      if (v.durum !== undefined) {
        if (!DURUMLAR.includes(v.durum as KitaplikKaydi["durum"]))
          throw new CalismaHatasi("Okuma durumu geçersiz");
        k.durum = v.durum as KitaplikKaydi["durum"];
      }
      if (v.arsiv !== undefined) {
        if (typeof v.arsiv !== "boolean") throw new CalismaHatasi("Arşiv seçimi geçersiz");
        k.arsiv = v.arsiv;
      }
      k.guncellendi = new Date().toISOString();
      return k;
    });
  }
  async aramaKaydet(girdi: unknown) {
    const arama = aramaOku(girdi);
    const id = aramaKimligi(arama);
    return this.degistir((a) => {
      const mevcut = a.aramalar.find((s) => s.id === id);
      if (mevcut) {
        mevcut.ad = arama.ad;
        return mevcut;
      }
      if (a.aramalar.length >= 50) throw new CalismaHatasi("En fazla 50 arama kaydedilebilir");
      const kayit = { id, ...arama };
      a.aramalar.unshift(kayit);
      return kayit;
    });
  }
  async dersListesi(girdi: unknown, onizleme: boolean) {
    const g = nesne(girdi);
    const ders = metin(g.ders, 60, true);
    const satirlar = metin(g.metin, 10_000, true)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!satirlar.length || satirlar.length > 20)
      throw new CalismaHatasi("Bir defada 1-20 kitap eklenebilir");
    const aramalar = satirlar.map((s, i) => {
      const alanlar = s
        .replace(/^\d+[.)]\s+/, "")
        .split("|")
        .map((v) => v.trim());
      if (alanlar.length > 3)
        throw new CalismaHatasi(`${i + 1}. satır: Başlık | Yazar | Yıl biçimini kullanın`);
      const [baslik, yazar, yilMetni] = alanlar;
      const a = aramaOku({
        ad: `${ders} · ${baslik}`.slice(0, 100),
        webDahil: true,
        sorgu: {
          baslik,
          yazar,
          yil: yilMetni ? Number(yilMetni) : undefined,
          tur: "kitap",
          limit: 20,
        },
      });
      return { ...a, id: aramaKimligi(a) };
    });
    return this.degistir((a) => {
      const mevcut = new Set(a.aramalar.map((s) => s.id));
      const yeni = aramalar.filter((s) => {
        if (mevcut.has(s.id)) return false;
        mevcut.add(s.id);
        return true;
      });
      if (a.aramalar.length + yeni.length > 50)
        throw new CalismaHatasi("En fazla 50 arama kaydedilebilir");
      if (!onizleme) a.aramalar.push(...yeni);
      return {
        yeniArama: yeni.length,
        mevcut: aramalar.length - yeni.length,
        adlar: yeni.map((s) => s.ad),
      };
    }, !onizleme);
  }
  aramaKaldir(id: string) {
    return this.degistir((a) => {
      a.aramalar = a.aramalar.filter((s) => s.id !== id);
      return { kaldirildi: true };
    });
  }
  async birlestir(yedek: unknown, onizleme: boolean) {
    const gelen = alanOku(yedek);
    return this.degistir((a) => {
      const yeniKitaplar = gelen.kitaplik.filter((k) => !a.kitaplik.some((m) => m.id === k.id));
      const yeniAramalar = gelen.aramalar.filter((k) => !a.aramalar.some((m) => m.id === k.id));
      if (
        a.kitaplik.length + yeniKitaplar.length > 1000 ||
        a.aramalar.length + yeniAramalar.length > 50
      )
        throw new CalismaHatasi("Birleştirme kitaplık veya arama sınırını aşıyor");
      if (!onizleme) {
        a.kitaplik.push(...yeniKitaplar);
        a.aramalar.push(...yeniAramalar);
      }
      return {
        yeniKitap: yeniKitaplar.length,
        yeniArama: yeniAramalar.length,
        korunan:
          gelen.kitaplik.length + gelen.aramalar.length - yeniKitaplar.length - yeniAramalar.length,
      };
    }, !onizleme);
  }
}
