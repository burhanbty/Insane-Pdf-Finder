/* Kaynak Bul — tarayici arayuzu. Build yok, dogrudan ES modulu. */

/*
 * DOM sorgulama. Eksik bir id sessizce null donmesin: kaynak kodda id
 * yazim hatasi (ornegin "web Dahil" gibi bosluklu id) tarayicida
 * "Cannot read properties of null" hatasi olarak cok geci ortaya cikiyor.
 */
const $ = (secici) => {
  const dugum = document.querySelector(secici);
  if (!dugum) {
    console.error(`[kaynak-bul] HTML'de bulunamayan ogre: ${secici}`);
    throw new Error(`Arayüz hatası: "${secici}" bulunamadı (index.html ile app.js uyuşmuyor)`);
  }
  return dugum;
};

const $$ = (s) => [...document.querySelectorAll(s)];

const el = {
  form: $("#aramaForm"),
  baslik: $("#baslik"),
  yazar: $("#yazar"),
  yil: $("#yil"),
  limit: $("#limit"),
  webDahil: $("#webDahil"),
  araBtn: $("#araBtn"),
  sonucBolum: $("#sonucBolum"),
  sonucBaslik: $("#sonucBaslik"),
  kartlar: $("#kartlar"),
  bos: $("#bos"),
  ozetPanel: $("#ozetPanel"),
  dosyaListesi: $("#indirmeListesi"),
  dosyaSayisi: $("#indirmeSayisi"),
  dosyaKlasor: $("#indirmeKlasor"),
  dialog: $("#kaynakDialog"),
  kaynakListesi: $("#kaynakListesi"),
  kaynakSecim: $("#kaynakSecim"),
  grupla: $("#grupla"),
  sadeceTekKaynak: $("#sadeceTekKaynak"),
  kaynakSayaci: $("#kaynakSayaci"),
};

/** Son aramanın ham sonucu, filtrelemede kullanılır. */
let sonCevap = null;
let suzgec = "hepsi";
const ozetYuklenen = new Map();

/* ------------------------------- yardimcilar ----------------------------- */

const ERISIM_ETIKET = {
  acik: ["badge acik", "Açık erişim"],
  sinirli: ["badge sinirli", "Kısmen erişilebilir"],
  odunc: ["badge odunc", "Ödünç / kütüphane"],
  yonlendir: ["badge yonlendir", "Kaynağa yönlendirir"],
};

function kacis(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** Yalnizca guvenli http(s) adreslerini baglanti olarak kullan. */
function guvenliAdres(s) {
  try {
    const u = new URL(String(s));
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function baytBicim(b) {
  if (!b && b !== 0) return "—";
  const birim = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < birim.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${birim[i]}`;
}

async function istek(yol, govde) {
  const cevap = await fetch(yol, {
    method: govde ? "POST" : "GET",
    headers: govde ? { "content-type": "application/json" } : undefined,
    body: govde ? JSON.stringify(govde) : undefined,
  });
  const veri = await cevap.json().catch(() => ({}));
  if (!cevap.ok) throw new Error(veri.hata ?? `İstek başarısız (${cevap.status})`);
  return veri;
}

function mesajGoster(metin, tur = "hata") {
  el.ozetPanel.classList.remove("gizli");
  el.ozetPanel.innerHTML = `<div class="durum-satir"><span class="nokta ${tur}"></span><span class="bilgi">${kacis(metin)}</span></div>`;
}

/* -------------------------------- arama --------------------------------- */

el.form.addEventListener("submit", async (olay) => {
  olay.preventDefault();

  const baslik = el.baslik.value.trim();
  if (!baslik) return;

  const govde = {
    baslik,
    yazar: el.yazar.value.trim(),
    yil: el.yil.value ? Number(el.yil.value) : undefined,
    tur: el.form.querySelector("input[name=tur]:checked")?.value ?? "kitap",
    limit: Number(el.limit.value) || 20,
  };

  el.araBtn.disabled = true;
  el.araBtn.textContent = "Aranıyor…";
  el.kartlar.innerHTML = "";
  el.sonucBolum.classList.add("gizli");
  el.ozetPanel.classList.remove("gizli");
  el.ozetPanel.innerHTML =
    '<div class="durum-satir"><span class="nokta uyari"></span><span class="bilgi">Kaynaklar sorgulanıyor, bu birkaç saniye sürebilir…</span></div>';

  try {
    const anahtar = JSON.stringify(govde);
    const istekler = [istek("/api/search", govde)];
    if (el.webDahil.checked) istekler.push(istek("/api/web-search", govde));

    // Web aramasini beklemeden ana sonuclari goster.
    const [ana, web] = await Promise.allSettled(istekler);

    const gruplar = [];
    const durumlar = [];
    const hatalar = [];
    let webNotu = null;
    let elleAramaAdresi = null;

    if (ana.status === "fulfilled") {
      gruplar.push(...ana.value.gruplar);
      durumlar.push(...ana.value.kaynakDurumlari);
    } else hatalar.push(`Kitap/makale araması: ${ana.reason.message}`);

    if (web?.status === "fulfilled") {
      gruplar.push(...web.value.gruplar);
      durumlar.push(...web.value.kaynakDurumlari);
      if (web.value.elleAramaAdresi) elleAramaAdresi = web.value.elleAramaAdresi;
      if (web.value.gruplamaNotu) webNotu = web.value.gruplamaNotu;
    } else if (el.webDahil.checked) hatalar.push(`Web araması: ${web.reason.message}`);

    sonCevap = { gruplar, kaynakDurumlari: durumlar, hatalar, anahtar };
    cizDurumlar(durumlar, hatalar, webNotu, elleAramaAdresi);
    cizKartlar(gruplar);
    el.sonucBolum.classList.remove("gizli");
  } catch (hata) {
    mesajGoster(`Arama başarısız: ${hata.message}`);
  } finally {
    el.araBtn.disabled = false;
    el.araBtn.textContent = "Ara";
  }
});

/* ------------------------------ durum paneli ---------------------------- */

function cizDurumlar(durumlar, hatalar, webNotu, elleAramaAdresi) {
  const satirlar = durumlar.map((d) => {
    const sinif = d.hataMesaji ? (d.hazir ? "uyari" : "hata") : "iyi";
    const bilgi = d.hataMesaji
      ? d.hataMesaji
      : `${d.sonucSayisi} sonuç · ${(d.sureMs / 1000).toFixed(1)} sn`;
    return `<div class="durum-satir">
      <span class="nokta ${sinif}"></span>
      <span class="ad">${kacis(d.ad)}</span>
      <span class="bilgi">${kacis(bilgi)}</span>
    </div>`;
  });

  for (const h of hatalar) {
    satirlar.push(
      `<div class="durum-satir"><span class="nokta hata"></span><span class="bilgi">${kacis(h)}</span></div>`,
    );
  }

  // Genel web aramasi sonuc vermediginde kullaniciya elle acabilecegi adresi ver.
  if (elleAramaAdresi) {
    const guvenli = guvenliAdres(elleAramaAdresi);
    satirlar.push(`<div class="durum-satir" style="border:none;padding-top:12px">
      <span class="nokta uyari"></span>
      <span class="bilgi">${kacis(webNotu ?? "Genel web araması")}</span>
    </div>`);
    if (guvenli) {
      satirlar.push(`<div class="durum-satir">
        <span class="ad"><a href="${kacis(guvenli)}" target="_blank" rel="noopener noreferrer">Aramayı tarayıcıda aç →</a></span>
      </div>`);
    }
  }

  const toplam = durumlar.reduce((a, d) => a + d.sonucSayisi, 0);
  el.ozetPanel.innerHTML =
    `<div class="durum-satir" style="border:none">
       <span class="ad">${toplam} ham kayıt, ${sonCevap.gruplar.length} birleşik sonuç</span>
       <span class="bilgi">${durumlar.length} kaynak sorgulandı</span>
     </div>` + satirlar.join("");
}

/* -------------------------------- kartlar ------------------------------- */

function cizKartlar(gruplar) {
  el.kartlar.innerHTML = "";

  if (!gruplar.length) {
    el.bos.classList.remove("gizli");
    el.bos.innerHTML =
      "<p>Sonuç bulunamadı.</p><p>Başlığı kısaltmayı veya yazarı kaldırmayı deneyin.</p>";
    return;
  }
  el.bos.classList.add("gizli");

  el.sonucBaslik.textContent = `${sonCevap.gruplar.length} sonuç`;
  for (const g of gruplar) el.kartlar.appendChild(kartYap(g));

  kaynakSecimiDoldur(gruplar);
  filtreUygula();

  // Sayfa sayilari kaynakta yoksa arka planda tek istekte getirilir.
  sayfalariArkaPlanda(gruplar);
}

/* ------------------------- kaynak bazli ozellikler ------------------------ */

/** Sonuclarda hangi kaynaklar var, kac sonuc verdikleri. */
function kaynakIstatistikleri(gruplar) {
  const istatistik = new Map();

  for (const g of gruplar) {
    for (const k of g.kaynaklar) {
      const id = k.kaynak;
      if (!id) continue;
      const mevcut = istatistik.get(id);
      if (mevcut) {
        mevcut.adet++;
        // Ayni kaynaktan birden fazla kayit varsa hepsini gosterme.
        if (!mevcut.ids.has(g.anahtar)) mevcut.ids.add(g.anahtar);
      } else {
        istatistik.set(id, {
          ad: k.kaynakAd || id,
          adet: 1,
          ids: new Set([g.anahtar]),
        });
      }
    }
  }

  return istatistik;
}

/** Kaynak secim kutusunu mevcut sonuclara gore doldurur. */
function kaynakSecimiDoldur(gruplar) {
  const istatistik = kaynakIstatistikleri(gruplar);
  const secim = el.kaynakSecim;
  const onceki = secim.value;

  // Grup basliklarinda ve istatistikte kullanilacak id -> ad eslemesi.
  kaynakAdlari = new Map([...istatistik].map(([id, s]) => [id, s.ad]));

  secim.innerHTML = `<option value="">Tüm kaynaklar (${gruplar.length})</option>`;

  // Cok sonuc veren kaynaklar basa.
  const sirali = [...istatistik.entries()].sort((a, b) => b[1].adet - a[1].adet);

  for (const [id, s] of sirali) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${s.ad} (${s.adet})`;
    secim.appendChild(option);
  }

  // Onceki secim hala gecerliyse koru (yeni aramada kaybolmasin).
  if (onceki && istatistik.has(onceki)) {
    secim.value = onceki;
  } else {
    secim.value = "";
  }
}

/** Kaynak süzgeci, gruplama ve diger filtreleri birlikte uygular. */
function filtreUygula() {
  const secilenKaynak = el.kaynakSecim.value;
  const gruplaAcik = el.grupla.checked;
  const tekKaynakFiltre = el.sadeceTekKaynak.checked;

  // Gorunur kartlari hesapla.
  const gorunur = [];
  for (const kart of $$(".kart")) {
    const kaynaklar = (kart.dataset.kaynaklar ?? "").split(",").filter(Boolean);

    const turGec = kartGecerFiltre(kart);
    const kaynakGec = !secilenKaynak || kaynaklar.includes(secilenKaynak);
    const tekKaynakGec = !tekKaynakFiltre || kaynaklar.length === 1;

    const goster = turGec && kaynakGec && tekKaynakGec;
    kart.classList.toggle("gizli", !goster);
    if (goster) gorunur.push(kart);
  }

  grupBasliklariniCiz(gorunur, gruplaAcik);
  istatistikGuncelle(gorunur, secilenKaynak);

  if (!sonCevap) return;

  if (!gorunur.length) {
    el.sonucBaslik.textContent = "0 sonuç";
    el.bos.classList.remove("gizli");
    el.bos.innerHTML =
      "<p>Bu filtreye uyan sonuç yok.</p><p>Farklı bir kaynak seçmeyi deneyin.</p>";
  } else {
    el.sonucBaslik.textContent = `${gorunur.length} sonuç`;
    el.bos.classList.add("gizli");
  }
}

/** Sadece ust sekmelerin filtreleri. */
function kartGecerFiltre(kart) {
  return (
    suzgec === "hepsi" ||
    (suzgec === "acik" && kart.dataset.indirilebilir === "1") ||
    (suzgec === "ozet" && kart.dataset.ozetli === "1") ||
    (suzgec === "uyum" && kart.dataset.uyum === "1")
  );
}

/**
 * Kaynağa göre gruplama. Kartlar ana kaynaklarına göre yeniden dizilir
 * ve aralarına grup başlıkları girer.
 */
function grupBasliklariniCiz(gorunurKartlar, aktif) {
  // Önceki başlıkları temizle.
  for (const b of $$(".grup-basligi")) b.remove();

  if (!aktif || !gorunurKartlar.length) return;

  // Ana kaynak → o kaynaktan gelen kart sayısı
  const adetler = new Map();
  for (const kart of gorunurKartlar) {
    const ana = kart.dataset.anaKaynak || "diger";
    adetler.set(ana, (adetler.get(ana) ?? 0) + 1);
  }

  /*
   * Kartlari DOM'da yeniden kuruyoruz: baslik + kart çiftleri hâlinde.
   * Gizli kartlari en sona tasiyoruz ki siralamayi bozmasinlar.
   */
  const parca = document.createDocumentFragment();
  let oncekiAna = null;

  for (const kart of el.kartlar.querySelectorAll(".kart")) {
    if (kart.classList.contains("gizli")) continue;

    const ana = kart.dataset.anaKaynak || "diger";
    if (ana !== oncekiAna) {
      parca.appendChild(baslikOlustur(kovAd(ana), adetler.get(ana) ?? 0, ana));
      oncekiAna = ana;
    }

    kart.remove();
    parca.appendChild(kart);
  }

  for (const kart of el.kartlar.querySelectorAll(".kart")) {
    if (kart.classList.contains("gizli")) {
      kart.remove();
      parca.appendChild(kart);
    }
  }

  el.kartlar.appendChild(parca);
}

let kaynakAdlari = new Map();

function kovAd(id) {
  return kaynakAdlari.get(id) ?? id;
}

function baslikOlustur(ad, adet, id) {
  const baslik = document.createElement("div");
  baslik.className = "grup-basligi";
  baslik.innerHTML = `<span class="grup-ad">${kacis(ad)}</span><span class="grup-sayi">${adet} sonuç</span>`;

  // Basliga tiklayinca o kaynaga gore suz.
  baslik.addEventListener("click", () => {
    el.kaynakSecim.value = el.kaynakSecim.value === id ? "" : id;
    filtreUygula();
  });

  return baslik;
}

/** Sag ustteki sayaci guncelle: "7 sonuç · 4 kaynak · 3 çoklu kaynak". */
function istatistikGuncelle(gorunurKartlar, secilenKaynak) {
  if (!gorunurKartlar.length) {
    el.kaynakSayaci.textContent = "";
    return;
  }

  const kaynakSet = new Set();
  let coklu = 0;

  for (const kart of gorunurKartlar) {
    const liste = (kart.dataset.kaynaklar ?? "").split(",").filter(Boolean);
    for (const k of liste) kaynakSet.add(k);
    if (liste.length > 1) coklu++;
  }

  const parcalar = [`${kaynakSet.size} kaynak`];
  if (coklu) parcalar.push(`${coklu} çoklu eşleşme`);
  if (secilenKaynak) parcalar.push(`süzgeç: ${kovAd(secilenKaynak)}`);

  el.kaynakSayaci.textContent = parcalar.join(" · ");
}

/**
 * Sayfa sayisini onceden yukler. Kullaniciyi bekletmez: kartlar once
 * cizilir, sayfa etiketleri sonra tamamlanir.
 *
 * Onemli: her PDF sunucu uzerinden indirilip aciliyor ve bazi kaynaklar
 * (arxiv.org) yavas yanit veriyor. Bu yuzden tum sonuclari birden
 * yuklemiyoruz; yalnizca en ustteki birkac kart icin tek istek atilir,
 * geri kalani kullanici kendi istegine birakinca ogrenilir.
 */
async function sayfalariArkaPlanda(gruplar) {
  const adresler = gruplar
    .slice(0, 3) // yalnizca ilk 3 kart
    .filter((g) => !g.sayfaSayisi && !g.kaynaklar.some((k) => k.sayfa))
    .map((g) => g.kaynaklar.find((k) => k.pdf)?.pdf)
    .filter(Boolean);

  if (!adresler.length) return;
  if (!adresler.some((a) => !sayfaOnbellek.has(a))) return;

  try {
    await sayfalariGetir(adresler);
    sayfalariKartlaraYaz();
  } catch {
    /* sayfa bilgisi alinamadi; kartlar "Sayfa: ?" olarak kalir */
  }
}

function kartYap(g) {
  const kart = document.createElement("article");
  kart.className = "kart";
  kart.dataset.anahtar = g.anahtar;

  // Filtre bayraklari
  kart.dataset.indirilebilir = g.kaynaklar.some((k) => k.pdf) ? "1" : "0";
  kart.dataset.ozetli = g.kaynaklar.some((k) => k.ozet || k.tamMetin) ? "1" : "0";
  kart.dataset.uyum = g.puan >= 0.6 ? "1" : "0";

  /*
   * Kaynak kimlikleri. Kaynak bazli suzgec ve gruplama bunlari kullanir.
   * Virgulle ayiriyoruz; kaynak id'lerinde virgul olmamali (kayit taniminda
   * belirtiliyor), yine de veri-guvenli tarafta yapiyoruz.
   */
  const kaynakIdleri = [...new Set(g.kaynaklar.map((k) => k.kaynak).filter(Boolean))];
  kart.dataset.kaynaklar = kaynakIdleri.join(",");
  kart.dataset.kaynakSayisi = String(kaynakIdleri.length);
  // Gruplamada kartin hangi baslik altinda gorunecegi: en iyi eslesme
  // yapan kaynak (ilk siralama zaten puana gore).
  kart.dataset.anaKaynak = kaynakIdleri[0] ?? "";

  const kapakUrl = g.kapak ? `/api/kapak?url=${encodeURIComponent(g.kapak)}` : null;

  const etiketler = [];
  if (g.puan >= 0.85) etiketler.push(`<span class="etiket uyum">Tam eşleşme</span>`);
  else if (g.puan >= 0.6) etiketler.push(`<span class="etiket uyum">Büyük olasılık</span>`);
  if (g.yil) etiketler.push(`<span class="etiket">${g.yil}</span>`);
  etiketler.push(`<span class="etiket tur">${g.tur}</span>`);
  for (const k of g.konular.slice(0, 4)) etiketler.push(`<span class="etiket">${kacis(k)}</span>`);

  const aciklama = g.ozet
    ? `<div class="aciklama" id="ac-${kacisId(g.anahtar)}">${kacis(g.ozet)}</div>`
    : "";

  // Kaynak rozetleri. Cok kaynakta bulunan eserlerde ust satir belirtiyoruz.
  const kaynakSatiri =
    kaynakIdleri.length > 1
      ? `<div class="kaynak-notu">Bu eser ${kaynakIdleri.length} kaynakta bulundu — eşleştirildi</div>`
      : "";

  const kaynakRozetleri = g.kaynaklar
    .map((k) => {
      const [sinif, etiket] = ERISIM_ETIKET[k.erisim ?? "yonlendir"];
      return `<span class="kaynak-rozet" data-kaynak="${kacis(k.kaynak)}">
      <span class="badge ${sinif}">${etiket}</span>
      <a href="${kacis(k.link)}" target="_blank" rel="noopener noreferrer">${kacis(k.kaynakAd)}</a>
    </span>`;
    })
    .join("");

  const indirilebilir = g.kaynaklar.find((k) => k.pdf);
  const ozetlenebilir =
    g.kaynaklar.find((k) => k.pdf || k.tamMetin) ?? g.kaynaklar.find((k) => k.ozet);

  /*
   * Sayfa sayisi. Oncelikle kaynaktan gelen bilgi kullanilir; yoksa
   * PDF'in icinden okunur. Diger kaynaklardan gelen sayfa bilgisi de
   * (orn. Crossref'in sayfa araligi) burada gosterilir.
   */
  const sayfaParcasi = sayfaEtiketi(g, indirilebilir);

  const eylemler = [];
  if (indirilebilir) {
    eylemler.push(
      `<button class="birincil" data-eylem="indir" data-url="${kacis(indirilebilir.pdf)}" data-tur="pdf" data-baslik="${kacis(g.baslik)}">PDF indir</button>`,
    );
  } else {
    eylemler.push(
      `<button class="bos-durum" disabled title="Bu kayıt için doğrudan PDF bağlantısı yok">PDF indir</button>`,
    );
  }

  if (ozetlenebilir) {
    const tur = ozetlenebilir.pdf ? "pdf" : "metin";
    const url = ozetlenebilir.pdf ?? ozetlenebilir.tamMetin;
    eylemler.push(
      `<button data-eylem="ozet" data-url="${kacis(url)}" data-tur="${tur}" data-baslik="${kacis(g.baslik)}">Özet çıkar</button>`,
    );
  }

  kart.innerHTML = `
    ${
      kapakUrl
        ? `<img class="kapak" src="${kacis(kapakUrl)}" alt="" loading="lazy">`
        : `<div class="kapak yok">📄</div>`
    }
    <div class="kart-govde">
      <h3>${kacis(g.baslik)}</h3>
      ${g.altBaslik ? `<div class="alt">${kacis(g.altBaslik)}</div>` : ""}
      <div class="kunye">
        ${g.yazarlar.length ? `<span class="etiket">${kacis(g.yazarlar.slice(0, 3).join(", "))}</span>` : ""}
        ${etiketler.join("")}
      </div>
      ${aciklama}
      <div class="kart-eylem">
        ${sayfaParcasi}
        ${eylemler.join("")}
      </div>
      ${kaynakSatiri}
      <div class="kaynaklar">${kaynakRozetleri}</div>
      <div class="ozet-icerik"></div>
    </div>`;

  return kart;
}

function kacisId(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12);
}

/* ----------------------------- sayfa sayisi ------------------------------ */

/** Kartta gosterilecek sayfa bilgisini uretir. */
function sayfaEtiketi(g, indirilebilir) {
  // 1) Toplanmis grup bilgisi (Google Books, Open Library vb.)
  if (g.sayfaSayisi) {
    return `<span class="sayfa" title="Kayıttan alındı">${g.sayfaSayisi} sayfa</span>`;
  }

  // 2) Herhangi bir kaynaktan gelen ham sayfa bilgisi
  const ham = g.kaynaklar.find((k) => k.sayfa);
  if (ham) {
    return `<span class="sayfa" title="${kacis(ham.kaynakAd)} kaydından">${kacis(ham.sayfa)}</span>`;
  }

  // 3) Onbellekten onceki aramadan ogrenilmis olabilir
  if (indirilebilir?.pdf) {
    const onbellekteki = sayfaOnbellek.get(indirilebilir.pdf);
    if (onbellekteki?.sayfaSayisi) {
      return `<span class="sayfa" title="PDF içinden okundu">${onbellekteki.sayfaSayisi} sayfa</span>`;
    }
    if (onbellekteki?.not) {
      return `<span class="sayfa bilinmiyor" title="${kacis(onbellekteki.not)}">Sayfa: ?</span>`;
    }
    return `<button class="sayfa duzenle" data-eylem="sayfa"
              data-url="${kacis(indirilebilir.pdf)}"
              title="PDF indirilip sayfa sayısı okunur">Sayfa: ?</button>`;
  }

  return "";
}

/** Sayfa sonuclarini tutar: url -> { sayfaSayisi?, not? } */
const sayfaOnbellek = new Map();

/** Birden fazla kart icin sayfa sayisi getirir (toplu istek). */
async function sayfalariGetir(adresler) {
  const eksikler = [...new Set(adresler)].filter((a) => !sayfaOnbellek.has(a));
  if (!eksikler.length) return;

  const veri = await istek("/api/sayfa-sayisi", { adresler: eksikler });
  for (const [adres, sonuc] of Object.entries(veri.sonuclar ?? {})) {
    sayfaOnbellek.set(adres, sonuc);
  }
}

/** Onbellekten alinan sayfalari kartlara yazar. */
function sayfalariKartlaraYaz() {
  for (const kart of document.querySelectorAll(".kart")) {
    const dugme = kart.querySelector('[data-eylem="sayfa"]');
    if (!dugme) continue;

    const url = dugme.dataset.url;
    const sonuc = sayfaOnbellek.get(url);
    if (!sonuc) continue;

    const yeni = sonuc.sayfaSayisi
      ? `<span class="sayfa" title="PDF içinden okundu">${sonuc.sayfaSayisi} sayfa</span>`
      : `<span class="sayfa bilinmiyor" title="${kacis(sonuc.not ?? "")}">Sayfa: ?</span>`;
    dugme.outerHTML = yeni;
  }
}

/* --------------------------- kart eylemleri ----------------------------- */

el.kartlar.addEventListener("click", async (olay) => {
  const buton = olay.target.closest("button[data-eylem]");
  if (!buton) return;

  const eylem = buton.dataset.eylem;
  const url = buton.dataset.url;
  const tur = buton.dataset.tur;
  const baslik = buton.dataset.baslik;
  const hedefKutu = buton.closest(".kart").querySelector(".ozet-icerik");

  if (eylem === "sayfa") {
    buton.disabled = true;
    buton.textContent = "Sayılıyor…";
    try {
      await sayfalariGetir([url]);
      sayfalariKartlaraYaz();
    } catch (hata) {
      buton.textContent = "Sayfa: ?";
      buton.title = hata.message;
    } finally {
      buton.disabled = false;
    }
    return;
  }

  if (eylem === "indir") {
    buton.disabled = true;
    const eski = buton.textContent;
    buton.textContent = "İndiriliyor…";
    try {
      const sonuc = await istek("/api/download", { url, tur, baslik });
      buton.textContent = `Kaydedildi: ${sonuc.dosya}`;
      setTimeout(() => {
        buton.textContent = eski;
        buton.disabled = false;
      }, 3500);
      await indirmeleriYenile();
    } catch (hata) {
      buton.textContent = "İndirilemedi";
      buton.title = hata.message;
      setTimeout(() => {
        buton.textContent = eski;
        buton.disabled = false;
      }, 4000);
    }
    return;
  }

  if (eylem === "ozet") {
    const anahtar = `${baslik}|${url}`;
    buton.disabled = true;
    buton.textContent = "Özetleniyor…";
    hedefKutu.innerHTML =
      '<div class="ozet-metin">İçerik alınıyor ve özetleniyor… (büyük dosyalarda biraz sürebilir)</div>';

    try {
      if (!ozetYuklenen.has(anahtar)) {
        const sonuc = await istek("/api/summary", { url, tur, baslik });
        ozetYuklenen.set(anahtar, sonuc);
      }
      const sonuc = ozetYuklenen.get(anahtar);
      const basliklar = {
        llm: "Model özeti",
        extractive: "Otomatik özet (anahtar kelime yöntemi)",
      };
      hedefKutu.innerHTML = `
        <div class="ozet-metin">${kacis(sonuc.ozet || "Özet üretilemedi.")}</div>
        <div class="kunye">
          <span class="etiket">${kacis(basliklar[sonuc.yontem])}</span>
          ${sonuc.sayfaSayisi ? `<span class="etiket">${sonuc.sayfaSayisi} sayfa</span>` : ""}
          <span class="etiket">${baytBicim(sonuc.karakterSayisi)} metin</span>
        </div>
        ${sonuc.uyari ? `<div class="etiket uyum">${kacis(sonuc.uyari)}</div>` : ""}`;
    } catch (hata) {
      hedefKutu.innerHTML = `<div class="ozet-metin">Özet üretilemedi: ${kacis(hata.message)}</div>`;
    } finally {
      buton.disabled = false;
      buton.textContent = "Özet çıkar";
    }
  }
});

/* ------------------------------ filtreler -------------------------------- */

/* Ust sekmeler: hepsi / indirilebilir / ozetli / tam eslesme */
$$(".sekme").forEach((sekme) => {
  sekme.addEventListener("click", () => {
    $$(".sekme").forEach((s) => s.classList.remove("etkin"));
    sekme.classList.add("etkin");
    suzgec = sekme.dataset.suzgec;
    filtreUygula();
  });
});

/* Kaynak süzgeci ve gruplama */
el.kaynakSecim.addEventListener("change", () => filtreUygula());
el.grupla.addEventListener("change", () => filtreUygula());
el.sadeceTekKaynak.addEventListener("change", () => filtreUygula());

/* ---------------------------- indirilenler ------------------------------ */

async function indirmeleriYenile() {
  try {
    const { dosyalar } = await istek("/api/downloads");
    el.dosyaSayisi.textContent = dosyalar.length;

    if (!dosyalar.length) {
      el.dosyaListesi.innerHTML = '<div class="dosya-yok">Henüz dosya indirilmedi.</div>';
      return;
    }

    el.dosyaListesi.innerHTML = dosyalar
      .map(
        (d) => `<div class="dosya">
        <span>${d.tur === "pdf" ? "📕" : "📄"}</span>
        <span class="ad">${kacis(d.dosya)}</span>
        <span class="boyut">${baytBicim(d.boyut)}</span>
        <span class="boyut">${new Date(d.tarih).toLocaleString("tr-TR")}</span>
      </div>`,
      )
      .join("");
  } catch {
    el.dosyaListesi.innerHTML = '<div class="dosya-yok">Liste alınamadı.</div>';
  }
}

/* ----------------------------- kaynaklar --------------------------------- */

$("#kaynaklarBtn").addEventListener("click", async () => {
  el.kaynakListesi.innerHTML = '<p class="ipucu">Yükleniyor…</p>';
  el.dialog.showModal();

  try {
    const { kaynaklar, yuklenmeHatalari } = await istek("/api/sources");
    el.kaynakListesi.innerHTML = kaynaklar
      .map((k) => {
        const nokta = k.hazir ? "iyi" : "uyari";
        const durum = k.hazir ? "hazır" : "anahtar gerekli";
        return `<div class="durum-satir">
          <span class="nokta ${nokta}"></span>
          <span class="ad">${kacis(k.ad)} <span class="etiket">${kacis(k.tur.join(", "))}</span></span>
          <span class="bilgi">${kacis(durum)}</span>
        </div>
        <div class="bilgi" style="color:var(--soluk);font-size:12.5px;padding:0 0 6px 19px">${kacis(k.aciklama)}</div>`;
      })
      .join("");

    if (yuklenmeHatalari?.length) {
      el.kaynakListesi.innerHTML += `<p class="ipucu" style="margin-top:14px">Yüklenemeyen dosyalar: ${yuklenmeHatalari
        .map((h) => kacis(h.dosya))
        .join(", ")}</p>`;
    }
  } catch (hata) {
    el.kaynakListesi.innerHTML = `<p class="ipucu">${kacis(hata.message)}</p>`;
  }
});

$("#kaynakKapat").addEventListener("click", () => el.dialog.close());

/* ------------------------------ baslangic ------------------------------- */

await indirmeleriYenile();

try {
  const { kaynaklar } = await istek("/api/sources");
  const klasor = `${kaynaklar.length} kaynak`;
  el.dosyaKlasor.textContent = klasor;
} catch {
  /* sunucu henuz hazir degilse sorun degil */
}
