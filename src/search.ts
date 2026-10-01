import { onbellekli } from "./cache.js";
import { eserAnahtari, eslestir, yazarParcalari, yilUyumlu } from "./normalize.js";
import { kaynaklariYukle, yuklenmeHataListesi } from "./registry.js";
import type { Gruplanmis, KaynakInfo, Sorgu, Work } from "./types.js";

export interface KaynakDurumu extends KaynakInfo {
  sonucSayisi: number;
  sureMs: number;
  hataMesaji?: string;
}

export interface AramaCevabi {
  sorgu: Sorgu;
  sureMs: number;
  gruplar: Gruplanmis[];
  kaynakDurumlari: KaynakDurumu[];
  toplamSonuc: number;
  gruplamaNotu: string;
}

/**
 * Tum kaynaklari paralel sorgular.
 *
 * Kritik davranis: bir kaynak coktugunde (api anahtari yok, kota, ag hatasi)
 * digerleri ETKILENMEZ. Hatalar durum listesinde gorunur, arama yine sonuc doner.
 */
export async function ara(sorgu: Sorgu): Promise<AramaCevabi> {
  // Ayni sorgu tekrar ederse diskteki onbellegi doneruz. arXiv ve Semantic
  // Scholar gibi anahtarsiz API'ler kotali; tekrar eden aramalar onlari yiyor.
  const anahtar = `arama:${sorgu.tur}:${sorgu.baslik.toLowerCase().trim()}:${(sorgu.yazar ?? "").toLowerCase().trim()}:${sorgu.yil ?? ""}:${sorgu.limit}`;
  return onbellekli(anahtar, () => araCanlı(sorgu));
}

async function araCanlı(sorgu: Sorgu): Promise<AramaCevabi> {
  const baslangic = Date.now();
  const kaynaklar = await kaynaklariYukle();

  // hic kaynak yuklenemediyse (klasor yanlsi, kurulum hatasi) kullaniciya
  // sessizce bos sonuc donmek yerine ne oldugunu soyle.
  if (!kaynaklar.length) {
    const hatalar = yuklenmeHataListesi();
    const sebep = hatalar.length
      ? hatalar.map((h) => `${h.dosya}: ${h.hata}`).join("; ")
      : "src/sources klasöründe kaynak dosyası bulunamadı";
    throw new Error(`Hiç kaynak yüklenemedi — ${sebep}`);
  }

  const uygun = kaynaklar.filter((k) => {
    if (!k.tur.includes(sorgu.tur)) return false;
    return k.hazirMi ? Boolean(k.hazirMi()) : true;
  });

  // Bu tur icin uygun kaynak yoksa da sessizce bos donme.
  if (!uygun.length) {
    throw new Error(
      `"${sorgu.tur}" türünü destekleyen hazır kaynak yok. ` +
        `Yüklü kaynaklar: ${kaynaklar.map((k) => k.id).join(", ")}`,
    );
  }

  const durumlar: KaynakDurumu[] = [];
  const hepsi: Work[] = [];

  const sonuclar = await Promise.all(
    uygun.map(async (k) => {
      const t0 = Date.now();
      try {
        const isler = await k.ara(sorgu);
        return { k, isler, sure: Date.now() - t0, hata: undefined as string | undefined };
      } catch (hata) {
        return { k, isler: [] as Work[], sure: Date.now() - t0, hata: (hata as Error).message };
      }
    }),
  );

  for (const r of sonuclar) {
    hepsi.push(...r.isler);
    durumlar.push({
      id: r.k.id,
      ad: r.k.ad,
      tur: r.k.tur,
      aciklama: r.k.aciklama ?? "",
      hazir: true,
      sonucSayisi: r.isler.length,
      sureMs: r.sure,
      hataMesaji: r.hata,
    });
  }

  // Kullanilamayan kaynaklari da durum listesinde goster.
  for (const k of kaynaklar) {
    if (!k.tur.includes(sorgu.tur)) continue;
    const hazir = k.hazirMi ? Boolean(k.hazirMi()) : true;
    if (hazir) continue;
    durumlar.push({
      id: k.id,
      ad: k.ad,
      tur: k.tur,
      aciklama: k.aciklama ?? "",
      hazir: false,
      sonucSayisi: 0,
      sureMs: 0,
      hataMesaji: "API anahtarı yok (.env dosyasına ekleyin)",
    });
  }

  const gruplar = grupla(hepsi, sorgu);
  gruplar.sort((a, b) => b.puan - a.puan);

  return {
    sorgu,
    sureMs: Date.now() - baslangic,
    gruplar: gruplar.slice(0, sorgu.limit),
    kaynakDurumlari: durumlar.sort((a, b) => a.sureMs - b.sureMs),
    toplamSonuc: hepsi.length,
    gruplamaNotu:
      "Aynı eserin farklı kaynaklardaki kayıtları, başlık + yazar + yıl karşılaştırılarak tek kartta birleştirildi.",
  };
}

/** Iki yazar listesi en az bir soyadda kesisiyor mu. */
function ortakSoyadVar(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  const bSoyad = new Set(b.flatMap((x) => yazarParcalari(x).soyad));
  return a.some((x) => yazarParcalari(x).soyad.some((s) => bSoyad.has(s)));
}

/**
 * Ayni eserin farkli kaynaklardaki kopyalarini birlestirir.
 * Gruplama anahtari once normalize baslik + yil, sonra eslesme puani.
 */
export function grupla(works: Work[], sorgu: Sorgu): Gruplanmis[] {
  const gecerli = works.filter((w) => w.baslik?.trim());
  const sirali = [...gecerli].sort((a, b) => {
    const ea = eslestir(
      { baslik: sorgu.baslik, yazarlar: sorgu.yazar ? [sorgu.yazar] : [], yil: sorgu.yil },
      { baslik: a.baslik, yazarlar: a.yazarlar, yil: a.yil },
    ).puan;
    const eb = eslestir(
      { baslik: sorgu.baslik, yazarlar: sorgu.yazar ? [sorgu.yazar] : [], yil: sorgu.yil },
      { baslik: b.baslik, yazarlar: b.yazarlar, yil: b.yil },
    ).puan;
    return eb - ea;
  });

  const gruplar: Gruplanmis[] = [];
  const anahtarIndeksi = new Map<string, number>();

  for (const w of sirali) {
    const es = eslestir(
      { baslik: sorgu.baslik, yazarlar: sorgu.yazar ? [sorgu.yazar] : [], yil: sorgu.yil },
      { baslik: w.baslik, yazarlar: w.yazarlar, yil: w.yil },
    );

    // Kesin anahtar: ayni tur + ayni normalize baslik + ayni yil (yil biliniyorsa).
    // Tur anahtarinin parcasi olmali, yoksa ayni basliktaki bir kitap ile
    // makale tek grupta birlesebilir.
    const kesin = `${w.tur}::${eserAnahtari(w.baslik)}::${w.yil ?? "?"}`;

    let hedef = anahtarIndeksi.get(kesin);

    // Anahtar tutmadiysa benzer eser gruplarini birlestir.
    if (hedef === undefined) {
      hedef = gruplar.findIndex((g) => {
        if (g.tur !== w.tur) return false;

        return g.kaynaklar.some((k) => {
          if (!k.baslik) return false;
          const p = eslestir(
            { baslik: g.baslik, yazarlar: g.yazarlar, yil: g.yil },
            { baslik: w.baslik, yazarlar: w.yazarlar, yil: w.yil },
          ).puan;
          if (p > 0.72) return true;

          // Ayni yil + ayni yazar soyadi: kaynaklar farkli baski adi kullansa
          // bile ayni eserdir ("Sapiens" ile "Sapiens: A Brief History...").
          if (g.yil !== undefined && w.yil !== undefined && g.yil === w.yil && p > 0.5) {
            if (ortakSoyadVar(g.yazarlar, w.yazarlar)) return true;
          }
          return false;
        });
      });

      if (hedef >= 0) anahtarIndeksi.set(kesin, hedef);
      else {
        gruplar.push({
          anahtar: kesin,
          tur: w.tur,
          baslik: w.baslik,
          altBaslik: w.altBaslik,
          yazarlar: w.yazarlar,
          yil: w.yil,
          ozet: w.ozet,
          konular: [...new Set(w.konular ?? [])],
          kapak: w.kapak,
          puan: es.puan,
          kaynaklar: [w],
        });
        // findIndex -1 dondugu icin yeni grubun indeksini burada ata,
        // yoksa asagida gruplar[-1] undefined olur.
        hedef = gruplar.length - 1;
        anahtarIndeksi.set(kesin, hedef);
      }
    } else {
      gruplar[hedef]!.kaynaklar.push(w);
    }

    const g = gruplar[hedef]!;
    // Daha eksiksiz alanlarla zenginlestir.
    if (!g.ozet && w.ozet) g.ozet = w.ozet;
    if (!g.kapak && w.kapak) g.kapak = w.kapak;
    if (!g.altBaslik && w.altBaslik) g.altBaslik = w.altBaslik;
    if (!g.yil && w.yil) g.yil = w.yil;
    if (!g.sayfaSayisi && w.sayfaSayisi) g.sayfaSayisi = w.sayfaSayisi;
    if (!g.sayfa && w.sayfa) g.sayfa = w.sayfa;
    if (g.yazarlar.length < 4) {
      g.yazarlar = [...new Set([...g.yazarlar, ...w.yazarlar])].slice(0, 6);
    }
    for (const k of w.konular ?? []) {
      if (g.konular.length < 14 && !g.konular.includes(k)) g.konular.push(k);
    }
    g.puan = Math.max(g.puan, es.puan);
  }

  // Yil filtresi: sorguda yil verilmis ve eserin yili biliniyorsa, 1 yildan
  // fazla sapma gosteren sonucu ele. Kaynak API'leri cogu zaman yil
  // filtresi desteklemiyor; bu yuzden burada uyguluyoruz.
  if (sorgu.yil) {
    for (const g of gruplar) {
      if (g.yil !== undefined && !yilUyumlu(sorgu.yil, g.yil)) {
        g.puan *= 0.25;
      }
    }
  }

  // Yazar bos olan sonuclari (genel katalog kayitlari) one cikarma.
  for (const g of gruplar) {
    if (g.yazarlar.length === 0) g.puan *= 0.85;
  }

  return gruplar;
}