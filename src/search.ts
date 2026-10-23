import { onbellekli } from "./cache.js";
import { createHash } from "node:crypto";
import { tamMetniZenginlestir, type TamMetinDurumu } from "./fulltext.js";
import { ayar } from "./config.js";
import { istekSinyali, sureSinirli } from "./deadline.js";
import { kaynakHazirligi } from "./source-state.js";
import { baskilarUyumlu, sonucuAcikla } from "./matching.js";
import { eserAnahtari, eslestir, yazarParcalari, yilUyumlu } from "./normalize.js";
import { kaynaklariYukle, yuklenmeHataListesi } from "./registry.js";
import type { Gruplanmis, KaynakInfo, KaynakSonuclari, Sorgu, Work } from "./types.js";

export interface KaynakDurumu extends KaynakInfo {
  sonucSayisi: number;
  sureMs: number;
  hataMesaji?: string;
  bekliyor?: boolean;
}

export interface AramaCevabi {
  sorgu: Sorgu;
  sureMs: number;
  gruplar: Gruplanmis[];
  kaynakDurumlari: KaynakDurumu[];
  toplamSonuc: number;
  gruplamaNotu: string;
  tamMetinDurumu?: TamMetinDurumu;
  tamamlandi?: boolean;
}

export interface AramaSecenekleri {
  signal?: AbortSignal;
  guncelle?: (cevap: AramaCevabi) => void;
}

/**
 * Tum kaynaklari paralel sorgular.
 *
 * Kritik davranis: bir kaynak coktugunde (api anahtari yok, kota, ag hatasi)
 * digerleri ETKILENMEZ. Hatalar durum listesinde gorunur, arama yine sonuc doner.
 */
export async function ara(sorgu: Sorgu, secenek: AramaSecenekleri = {}): Promise<AramaCevabi> {
  if (secenek.signal) {
    secenek.signal.throwIfAborted();
    return istekSinyali.run(secenek.signal, () => ara(sorgu, { guncelle: secenek.guncelle }));
  }
  // Ayni sorgu tekrar ederse diskteki onbellegi doneruz. arXiv ve Semantic
  // Scholar gibi anahtarsiz API'ler kotali; tekrar eden aramalar onlari yiyor.
  // Eski gruplama kuraliyla birlestirilmis disk kayitlarini yeniden kullanma.
  const kaynaklar = await kaynaklariYukle();
  const ayarSurumu = createHash("sha256")
    .update(JSON.stringify([ayar.unpaywallEmail, ayar.openalexKey]))
    .digest("hex");
  const kaynakSurumleri = kaynaklar.map((k) => {
    let surum: string;
    try {
      surum = k.onbellekSurumu?.() ?? "v1";
    } catch {
      surum = "surum-hatasi";
    }
    return [k.id, surum, kaynakHazirligi(k).hazir];
  });
  const anahtar = `arama:v9:${ayarSurumu}:${JSON.stringify(kaynakSurumleri)}:${JSON.stringify(sorgu)}`;
  const cevap = await onbellekli(anahtar, () => araCanlı(sorgu, secenek.guncelle), {
    sakla: (cevap) =>
      !cevap.kaynakDurumlari.some((k) => k.hazir && k.hataMesaji) &&
      !cevap.tamMetinDurumu?.hatalar.length,
  });
  istekSinyali.getStore()?.throwIfAborted();
  const son = { ...cevap, tamamlandi: true };
  secenek.guncelle?.(son);
  return son;
}

async function araCanlı(
  sorgu: Sorgu,
  guncelle?: AramaSecenekleri["guncelle"],
): Promise<AramaCevabi> {
  const baslangic = Date.now();
  const kaynaklar = await kaynaklariYukle();
  const hazirliklar = new Map(kaynaklar.map((k) => [k.id, kaynakHazirligi(k)]));

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
    return hazirliklar.get(k.id)!.hazir;
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
  const kaynakSonuclari = new Map<string, Work[]>();

  function anlik(): AramaCevabi {
    const gruplar = grupla(hepsi, sorgu)
      .sort((a, b) => b.puan - a.puan)
      .slice(0, sorgu.limit);
    return {
      sorgu,
      sureMs: Date.now() - baslangic,
      gruplar,
      kaynakDurumlari: kaynaklar
        .filter((k) => k.tur.includes(sorgu.tur))
        .map((k) => {
          const bitti = durumlar.find((d) => d.id === k.id);
          const h = hazirliklar.get(k.id)!;
          return (
            bitti ?? {
              id: k.id,
              ad: k.ad,
              tur: k.tur,
              aciklama: k.aciklama ?? "",
              hazir: h.hazir,
              hataMesaji: h.hata,
              sonucSayisi: 0,
              sureMs: 0,
              bekliyor: h.hazir,
            }
          );
        }),
      toplamSonuc: hepsi.length,
      tamamlandi: false,
      gruplamaNotu:
        "Kaynaklar geldikçe sonuçlar güncellenir; PDF adayları henüz dosya içeriğiyle doğrulanmamıştır.",
    };
  }
  guncelle?.(anlik());

  await Promise.all(
    uygun.map(async (k) => {
      const t0 = Date.now();
      let isler: KaynakSonuclari = [];
      let hataMesaji: string | undefined;
      try {
        const kaynakSurumu =
          k.onbellekSurumu?.() ??
          (["internet-archive", "open-library"].includes(k.id)
            ? "v3"
            : k.id === "openalex"
              ? `v2:${createHash("sha256").update(ayar.openalexKey).digest("hex")}`
              : "v1");
        isler = await onbellekli(
          `kaynak:${kaynakSurumu}:${k.id}:${JSON.stringify(sorgu)}`,
          async () => {
            const sonuc = await sureSinirli(() => k.ara(sorgu), ayar.kaynakTimeoutMs);
            if (
              !Array.isArray(sonuc) ||
              sonuc.some(
                (w) =>
                  !w ||
                  typeof w.baslik !== "string" ||
                  !Array.isArray(w.yazarlar) ||
                  w.yazarlar.some((a) => typeof a !== "string") ||
                  typeof w.link !== "string" ||
                  !["kitap", "makale", "slayt"].includes(w.tur),
              )
            ) {
              throw new Error("Kaynak geçerli eser listesi döndürmedi");
            }
            return sonuc;
          },
          { sakla: (r) => !r.uyarilar?.length },
        );
        hataMesaji = isler.uyarilar?.join("; ");
      } catch (hata) {
        istekSinyali.getStore()?.throwIfAborted();
        hataMesaji = (hata as Error).message;
      }
      istekSinyali.getStore()?.throwIfAborted();
      kaynakSonuclari.set(
        k.id,
        isler.map((w) => ({ ...w, pdfAdaylari: w.pdfAdaylari?.map((a) => ({ ...a })) })),
      );
      // Kaynakların geliş sırası son gruplama/sıralama kararını değiştirmesin.
      hepsi.splice(0, hepsi.length, ...uygun.flatMap((k) => kaynakSonuclari.get(k.id) ?? []));
      durumlar.push({
        id: k.id,
        ad: k.ad,
        tur: k.tur,
        aciklama: k.aciklama ?? "",
        hazir: true,
        sonucSayisi: isler.length,
        sureMs: Date.now() - t0,
        hataMesaji,
      });
      guncelle?.(anlik());
    }),
  );

  // Kullanilamayan kaynaklari da durum listesinde goster.
  for (const k of kaynaklar) {
    if (!k.tur.includes(sorgu.tur)) continue;
    const { hazir, hata } = hazirliklar.get(k.id)!;
    if (hazir) continue;
    durumlar.push({
      id: k.id,
      ad: k.ad,
      tur: k.tur,
      aciklama: k.aciklama ?? "",
      hazir: false,
      sonucSayisi: 0,
      sureMs: 0,
      hataMesaji: hata,
    });
  }

  const gruplar = grupla(hepsi, sorgu);
  gruplar.sort((a, b) => b.puan - a.puan);
  const secilen = gruplar.slice(0, sorgu.limit);
  const tamMetinDurumu = await tamMetniZenginlestir(secilen.flatMap((g) => g.kaynaklar));

  return {
    sorgu,
    sureMs: Date.now() - baslangic,
    gruplar: secilen,
    tamMetinDurumu,
    kaynakDurumlari: durumlar.sort((a, b) => a.sureMs - b.sureMs),
    toplamSonuc: hepsi.length,
    gruplamaNotu:
      "Kayıtlar başlık, yazar ve bilinen baskı bilgilerine göre birleştirildi. Eksik künye bilgisi doğrulanmış eşleşme sayılmaz.",
  };
}

/** Iki yazar listesi en az bir soyadda kesisiyor mu. */
function ortakSoyadVar(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  return a.some((x) =>
    b.some((y) => {
      const ax = yazarParcalari(x),
        by = yazarParcalari(y);
      if (!ax.soyad.some((s) => by.soyad.includes(s))) return false;
      return (
        !ax.ad.length ||
        !by.ad.length ||
        ax.ad.some((ad) =>
          by.ad.some(
            (bd) => ad === bd || ((ad.length === 1 || bd.length === 1) && ad[0] === bd[0]),
          ),
        )
      );
    }),
  );
}

/** Baslik ayni olsa da bilinen yazar/DOI celiskileri farkli eserlerdir. */
function grupUyumlu(g: Gruplanmis, w: Work): boolean {
  const doiAnahtari = (doi: string) =>
    doi
      .trim()
      .toLowerCase()
      .replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/, "");
  return g.kaynaklar.every((k) => {
    if (k.belgeTuru && w.belgeTuru && k.belgeTuru !== w.belgeTuru) return false;
    if (k.doi && w.doi) return doiAnahtari(k.doi) === doiAnahtari(w.doi);
    if (!baskilarUyumlu(k, w)) return false;
    return !k.yazarlar.length || !w.yazarlar.length || ortakSoyadVar(k.yazarlar, w.yazarlar);
  });
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
  const anahtarIndeksi = new Map<string, number[]>();
  function anahtarKaydet(anahtar: string, indeks: number) {
    const indeksler = anahtarIndeksi.get(anahtar) ?? [];
    if (!indeksler.includes(indeks)) indeksler.push(indeks);
    anahtarIndeksi.set(anahtar, indeksler);
  }

  for (const w of sirali) {
    const es = eslestir(
      { baslik: sorgu.baslik, yazarlar: sorgu.yazar ? [sorgu.yazar] : [], yil: sorgu.yil },
      { baslik: w.baslik, yazarlar: w.yazarlar, yil: w.yil },
    );

    // Kesin anahtar: ayni tur + ayni normalize baslik + ayni yil (yil biliniyorsa).
    // Tur anahtarinin parcasi olmali, yoksa ayni basliktaki bir kitap ile
    // makale tek grupta birlesebilir.
    const kesin = `${w.tur}::${eserAnahtari(w.baslik)}::${w.yil ?? "?"}`;

    const adaylar = (anahtarIndeksi.get(kesin) ?? []).filter((i) => grupUyumlu(gruplar[i]!, w));
    // Yazari/kimligi eksik kayit birden fazla esere uyuyorsa tahmin etme.
    let hedef = adaylar.length === 1 ? adaylar[0] : undefined;

    // Anahtar tutmadiysa benzer eser gruplarini birlestir.
    if (hedef === undefined) {
      const benzerler =
        adaylar.length > 1
          ? []
          : gruplar.flatMap((g, indeks) => {
              if (g.tur !== w.tur || !grupUyumlu(g, w)) return [];

              const uygun = g.kaynaklar.some((k) => {
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
              return uygun ? [indeks] : [];
            });
      hedef = benzerler.length === 1 ? benzerler[0]! : -1;

      if (hedef >= 0) {
        anahtarKaydet(kesin, hedef);
        gruplar[hedef]!.kaynaklar.push(w);
      } else {
        gruplar.push({
          anahtar: anahtarIndeksi.has(kesin) ? `${kesin}::${gruplar.length}` : kesin,
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
        anahtarKaydet(kesin, hedef);
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
    sonucuAcikla(g, sorgu);
  }

  return gruplar;
}
