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
  siralama: $("#siralama"),
};

/** Son aramanın ham sonucu, filtrelemede kullanılır. */
let sonCevap = null;
let suzgec = "hepsi";
const ozetYuklenen = new Map();
let kaynakAdlari = new Map();
let aramaSurumu = 0;
let aramaKontrol = null;
const kartDugumleri = new WeakMap();
const kartVerileri = new WeakMap();
const akisKartlari = new Map();

function baskiAlanlariniGuncelle() {
  $(".baski-tercihleri").disabled =
    el.form.querySelector("input[name=tur]:checked")?.value !== "kitap";
}
el.form.addEventListener("change", baskiAlanlariniGuncelle);
baskiAlanlariniGuncelle();

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

// Kapalı seçeneklerdeki geçersiz alanı, tarayıcı odağı oraya taşımadan aç.
el.form.addEventListener(
  "invalid",
  (olay) => {
    const ayrinti = olay.target.closest("details");
    if (ayrinti) ayrinti.open = true;
  },
  true,
);

el.form.addEventListener("submit", async (olay) => {
  olay.preventDefault();

  const baslik = el.baslik.value.trim();
  if (!baslik) return;
  const aramaId = ++aramaSurumu;
  aramaKontrol?.abort();
  const kontrol = new AbortController();
  aramaKontrol = kontrol;
  $("#aramaIptal").hidden = false;
  sonCevap = null;
  const webDahil = el.webDahil.checked;

  const govde = {
    baslik,
    yazar: el.yazar.value.trim(),
    yil: el.yil.value ? Number(el.yil.value) : undefined,
    tur: el.form.querySelector("input[name=tur]:checked")?.value ?? "kitap",
    limit: Number(el.limit.value) || 20,
  };
  if (govde.tur === "kitap") {
    for (const [alan, id] of [
      ["isbn", "hedefIsbn"],
      ["baski", "hedefBaski"],
      ["dil", "hedefDil"],
      ["yayinci", "hedefYayinci"],
    ]) {
      const deger = document.getElementById(id).value.trim();
      if (deger) govde[alan] = deger;
    }
  }

  el.araBtn.disabled = false;
  el.araBtn.textContent = "Yeniden ara";
  el.kartlar.innerHTML = "";
  akisKartlari.clear();
  el.sonucBolum.classList.add("gizli");
  el.ozetPanel.classList.remove("gizli");
  el.ozetPanel.innerHTML =
    '<div class="durum-satir"><span class="nokta uyari"></span><span class="bilgi">Kaynaklar sorgulanıyor, bu birkaç saniye sürebilir…</span></div>';

  try {
    const anahtar = JSON.stringify(govde);
    const cevaplar = [null, null];

    function guncelle() {
      if (aramaId !== aramaSurumu) return;
      const [ana, web] = cevaplar;
      const gruplar = [];
      const durumlar = [];
      const hatalar = [];
      let webNotu = null;
      let elleAramaAdresi = null;

      if (ana?.status === "fulfilled") {
        gruplar.push(...ana.value.gruplar);
        durumlar.push(...ana.value.kaynakDurumlari);
      } else if (ana) hatalar.push(`Kitap/makale araması: ${ana.reason.message}`);

      if (web?.status === "fulfilled") {
        gruplar.push(...web.value.gruplar);
        durumlar.push(...web.value.kaynakDurumlari);
        webNotu = web.value.gruplamaNotu ?? null;
        elleAramaAdresi = web.value.elleAramaAdresi ?? null;
      } else if (web) hatalar.push(`Web araması: ${web.reason.message}`);

      sonCevap = { gruplar, kaynakDurumlari: durumlar, hatalar, anahtar, sorgu: govde };
      cizDurumlar(durumlar, hatalar, webNotu, elleAramaAdresi);
      cizKartlar(gruplar);
      el.sonucBolum.classList.remove("gizli");
      const bekleyen = !ana
        ? "Ana kaynak araması sürüyor…"
        : ana.status === "fulfilled" && ana.value.tamamlandi === false
          ? "Diğer kaynaklar ve tam metin konumları taranıyor; sonuçlar güncelleniyor…"
          : webDahil && !web
            ? "Web araması sürüyor…"
            : null;
      if (bekleyen) {
        el.ozetPanel.insertAdjacentHTML(
          "beforeend",
          `<div class="durum-satir"><span class="nokta uyari"></span><span class="bilgi">${kacis(bekleyen)}</span></div>`,
        );
        if (!gruplar.length) el.bos.innerHTML = `<p>${kacis(bekleyen)}</p>`;
      }
      // Ana arama bittiginde yeni sorguya izin ver; web arka planda surer.
      el.araBtn.disabled = false;
      el.araBtn.textContent = !ana || ana.value?.tamamlandi === false ? "Yeniden ara" : "Ara";
    }

    async function sorgula(yol, indeks) {
      try {
        const r = await fetch(yol, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/x-ndjson" },
          body: JSON.stringify(govde),
          signal: kontrol.signal,
        });
        if (r.ok && r.headers?.get("content-type")?.includes("application/x-ndjson") && r.body) {
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let kalan = "",
            tamamlandi = false;
          const satirOku = (satir) => {
            if (!satir.trim()) return;
            const v = JSON.parse(satir);
            if (v.hata) throw new Error(v.hata);
            if (!v.cevap || !Array.isArray(v.cevap.gruplar))
              throw new Error("Arama yanıtı geçersiz");
            tamamlandi = v.cevap.tamamlandi === true;
            cevaplar[indeks] = { status: "fulfilled", value: v.cevap };
            guncelle();
          };
          try {
            for (;;) {
              const p = await reader.read();
              kalan += decoder.decode(p.value, { stream: !p.done });
              if (kalan.length > 4 * 1024 * 1024) throw new Error("Arama yanıtı çok büyük");
              let n;
              while ((n = kalan.indexOf("\n")) >= 0) {
                satirOku(kalan.slice(0, n));
                kalan = kalan.slice(n + 1);
              }
              if (p.done) break;
            }
            satirOku(kalan);
            if (!tamamlandi)
              throw new Error("Arama akışı kesildi; görünen sonuçlar eksik olabilir");
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        } else {
          const veri = await r.json();
          if (!r.ok) throw new Error(veri.hata ?? `İstek başarısız (${r.status})`);
          cevaplar[indeks] = { status: "fulfilled", value: veri };
        }
      } catch (hata) {
        if (kontrol.signal.aborted) return;
        // Kesilen akışta daha önce bulunan kayıtlar korunur.
        if (cevaplar[indeks]?.status === "fulfilled") {
          cevaplar[indeks].value.tamamlandi = true;
          cevaplar[indeks].value.kaynakDurumlari.push({
            ad: "Arama akışı",
            hazir: true,
            sonucSayisi: 0,
            sureMs: 0,
            hataMesaji: hata.message,
          });
        } else cevaplar[indeks] = { status: "rejected", reason: hata };
      }
      guncelle();
    }

    const istekler = [sorgula("/api/search", 0)];
    if (webDahil) istekler.push(sorgula("/api/web-search", 1));
    await Promise.all(istekler);
  } catch (hata) {
    if (aramaId === aramaSurumu) mesajGoster(`Arama başarısız: ${hata.message}`);
  } finally {
    if (aramaId === aramaSurumu) {
      el.araBtn.disabled = false;
      el.araBtn.textContent = "Ara";
      $("#aramaIptal").hidden = true;
    }
  }
});

$("#aramaIptal").addEventListener("click", () => {
  aramaSurumu++;
  aramaKontrol?.abort();
  $("#aramaIptal").hidden = true;
  el.araBtn.disabled = false;
  el.araBtn.textContent = "Ara";
  if (sonCevap) {
    sonCevap.kaynakDurumlari = sonCevap.kaynakDurumlari.map((d) =>
      d.bekliyor
        ? { ...d, bekliyor: false, hataMesaji: "Arama durduruldu; bu kaynak tamamlanmadı" }
        : d,
    );
    sonCevap.hatalar.push("Arama durduruldu; bulunan sonuçlar korundu, tarama eksik olabilir.");
    cizDurumlar(sonCevap.kaynakDurumlari, sonCevap.hatalar);
  } else mesajGoster("Arama durduruldu.", "uyari");
});

/* ------------------------------ durum paneli ---------------------------- */

function cizDurumlar(durumlar, hatalar, webNotu, elleAramaAdresi) {
  const satirlar = durumlar.map((d) => {
    const sinif = d.bekliyor ? "uyari" : d.hataMesaji ? (d.hazir ? "uyari" : "hata") : "iyi";
    const bilgi = d.bekliyor
      ? "Aranıyor…"
      : d.hataMesaji
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
  el.ozetPanel.innerHTML = `<div class="durum-satir" style="border:none">
       <span class="ad">${sonCevap.gruplar.length} sonuç bulundu</span>
       <span class="bilgi">${durumlar.filter((d) => d.hazir && !d.bekliyor).length} katalog tarandı · ${durumlar.filter((d) => d.bekliyor).length} bekleniyor · ${toplam} kayıt incelendi</span>
     </div><details class="kaynak-ayrinti"><summary>Arama ayrıntılarını göster${hatalar.length || durumlar.some((d) => d.hataMesaji) ? " · Bazı kaynaklara ulaşılamadı" : ""}</summary>${satirlar.join("")}</details>`;
}

/* -------------------------------- kartlar ------------------------------- */

function cizKartlar(gruplar) {
  el.kartlar.innerHTML = "";
  const oneriler = $("#aramaOnerileri");
  oneriler.replaceChildren();
  const tam = gruplar.filter((g) => g.eslesme?.tur === "tam").length;
  const yakin = gruplar.filter((g) => g.eslesme?.tur === "yakin").length;
  $("#eslesmeOzeti").textContent = gruplar.length
    ? `${tam} aramanla eşleşen · ${yakin} yakın eşleşme · ${gruplar.length - tam - yakin} diğer sonuç. Başlık eşleşmesi, PDF içeriğinin veya baskının doğrulandığı anlamına gelmez.`
    : "";
  const basliklar = !tam
    ? [...new Set(gruplar.filter((g) => g.eslesme?.oneri).map((g) => g.baslik))].slice(0, 3)
    : [];
  oneriler.classList.toggle("gizli", !basliklar.length);
  if (basliklar.length) {
    oneriler.append(document.createTextNode("Bunu mu aradın? "));
    for (const baslik of basliklar) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = baslik;
      b.addEventListener("click", () => {
        el.baslik.value = baslik;
        el.form.requestSubmit();
      });
      oneriler.append(b);
    }
  }

  if (!gruplar.length) {
    el.sonucBaslik.textContent = "0 sonuç";
    kaynakSecimiDoldur([]);
    el.kaynakSayaci.textContent = "";
    el.bos.classList.remove("gizli");
    const hazir = sonCevap.kaynakDurumlari.filter((d) => d.hazir);
    const ulasilamadi =
      sonCevap.hatalar.length || (hazir.length && hazir.every((d) => d.hataMesaji));
    el.bos.innerHTML = ulasilamadi
      ? "<p>Arama tamamlanamadı veya bazı kaynaklara ulaşılamadı.</p><p>Arama ayrıntılarını kontrol edip tekrar deneyebilirsin.</p>"
      : "<p>Sonuç bulunamadı.</p><p>Başlığı kısaltmayı veya yazarı kaldırmayı deneyin.</p>";
    return;
  }
  el.bos.classList.add("gizli");

  el.sonucBaslik.textContent = `${sonCevap.gruplar.length} sonuç`;
  gruplar.forEach((g, i) => {
    let kart = kartDugumleri.get(g);
    if (!kart) {
      const onceki = akisKartlari.get(g.anahtar);
      const surum = JSON.stringify(g);
      if (onceki?.surum === surum) kart = onceki.kart;
      else {
        kart = kartYap(g);
        // İndirme izleyicisini ve açılmış özeti akış güncellemesi sırasında koru.
        if (onceki)
          for (const secici of [".indirme-icerik", ".ozet-icerik"]) {
            const eski = onceki.kart.querySelector(secici),
              yeni = kart.querySelector(secici);
            if (eski && yeni) yeni.replaceWith(eski);
          }
        akisKartlari.set(g.anahtar, { kart, surum });
      }
      kartDugumleri.set(g, kart);
    }
    kartVerileri.set(kart, g);
    kart.dataset.sira = String(i);
    el.kartlar.appendChild(kart);
  });

  kaynakSecimiDoldur(gruplar);
  filtreUygula();

  // Sayfa sayilari kaynakta yoksa arka planda tek istekte getirilir.
  if (!sonCevap.kaynakDurumlari.some((d) => d.bekliyor)) sayfalariArkaPlanda(gruplar);
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

  const sirali = [...el.kartlar.querySelectorAll(".kart")].sort((a, b) => {
    const secim = el.siralama.value;
    if (secim === "uyum") {
      const sira = { tam: 0, yakin: 1, ilgili: 2 };
      const fark = (sira[a.dataset.eslesme] ?? 2) - (sira[b.dataset.eslesme] ?? 2);
      if (fark) return fark;
    }
    if (secim === "baslik") return a.dataset.baslik.localeCompare(b.dataset.baslik, "tr");
    if (secim === "yeni" || secim === "eski") {
      if (!a.dataset.yil) return b.dataset.yil ? 1 : 0;
      if (!b.dataset.yil) return -1;
      const fark = Number(a.dataset.yil) - Number(b.dataset.yil);
      if (fark) return secim === "yeni" ? -fark : fark;
    }
    return Number(a.dataset.sira) - Number(b.dataset.sira);
  });
  if (!aktif || !gorunurKartlar.length) {
    el.kartlar.append(...sirali);
    return;
  }

  const gruplar = new Map();
  for (const kart of sirali) {
    if (kart.classList.contains("gizli")) continue;
    const ana = kart.dataset.anaKaynak || "diger";
    if (!gruplar.has(ana)) gruplar.set(ana, []);
    gruplar.get(ana).push(kart);
  }

  /*
   * Kartlari DOM'da yeniden kuruyoruz: baslik + kart çiftleri hâlinde.
   * Gizli kartlari en sona tasiyoruz ki siralamayi bozmasinlar.
   */
  const parca = document.createDocumentFragment();
  for (const [ana, kartlar] of gruplar) {
    parca.appendChild(baslikOlustur(kovAd(ana), kartlar.length, ana));
    parca.append(...kartlar);
  }

  for (const kart of sirali) {
    if (kart.classList.contains("gizli")) {
      kart.remove();
      parca.appendChild(kart);
    }
  }

  el.kartlar.appendChild(parca);
}

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
  kart.dataset.baslik = g.baslik;
  kart.dataset.yil = g.yil ?? "";
  kart.dataset.kunye = [
    g.yazarlar.join(", "),
    g.yil ? `(${g.yil})` : "",
    g.baslik,
    g.kaynaklar.map((k) => guvenliAdres(k.link)).find(Boolean),
  ]
    .filter(Boolean)
    .join(". ");

  // Filtre bayraklari
  kart.dataset.indirilebilir = g.kaynaklar.some((k) =>
    [k.pdf, k.epub, k.tamMetin].some(guvenliAdres),
  )
    ? "1"
    : "0";
  kart.dataset.ozetli = g.kaynaklar.some((k) => k.ozet || k.tamMetin) ? "1" : "0";
  kart.dataset.uyum = g.eslesme?.tur === "tam" ? "1" : "0";
  kart.dataset.eslesme = g.eslesme?.tur ?? "ilgili";

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
  etiketler.push(
    `<span class="etiket eslesme-${kacis(kart.dataset.eslesme)}">${{ tam: "Aramanla eşleşen", yakin: "Yakın eşleşme · kontrol et", ilgili: "Diğer sonuç" }[kart.dataset.eslesme]}</span>`,
  );
  if (g.yil) etiketler.push(`<span class="etiket">${g.yil}</span>`);
  const katalogIsbn = g.kaynaklar.find((k) => k.isbn)?.isbn;
  if (katalogIsbn)
    etiketler.push(
      `<span class="etiket" title="Kaynak kaydındaki ISBN; hocanızın istediği baskıyla karşılaştırın">ISBN ${kacis(katalogIsbn)}</span>`,
    );
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
      const url = guvenliAdres(k.link);
      const ad = url
        ? `<a href="${kacis(url)}" target="_blank" rel="noopener noreferrer">${kacis(k.kaynakAd)}</a>`
        : `<span>${kacis(k.kaynakAd)}</span>`;
      return `<span class="kaynak-rozet" data-kaynak="${kacis(k.kaynak)}">
      <span class="badge ${sinif}">${etiket}</span>
      ${k.belgeTuru ? `<span class="badge">${kacis({ "kitap-bolumu": "Kitap bölümü", tez: "Tez", rapor: "Rapor", "ders-notu": "Ders notu", sunum: "Sunum", kitap: "Kitap" }[k.belgeTuru] ?? k.belgeTuru)}</span>` : ""}
      ${k.arsivGorulmeZamani ? `<span class="pdf-bilgi">Yerel künye · ${kacis(k.arsivGorulmeZamani.slice(0, 10))} tarihinde görüldü; erişim yeniden kontrol edilir</span>` : ""}
      ${ad}
    </span>`;
    })
    .join("");

  const indirilebilir = g.kaynaklar.find((k) => guvenliAdres(k.pdf));
  const pdfSayfasi = g.kaynaklar.find((k) => k.erisim !== "odunc" && guvenliAdres(k.link));
  const ozetlenebilir = g.kaynaklar
    .flatMap((k) => [
      { url: guvenliAdres(k.pdf), tur: "pdf" },
      { url: guvenliAdres(k.tamMetin), tur: "metin" },
    ])
    .find((k) => k.url);

  /*
   * Sayfa sayisi. Oncelikle kaynaktan gelen bilgi kullanilir; yoksa
   * PDF'in icinden okunur. Diger kaynaklardan gelen sayfa bilgisi de
   * (orn. Crossref'in sayfa araligi) burada gosterilir.
   */
  const sayfaParcasi = sayfaEtiketi(g, indirilebilir);

  const eylemler = [];
  eylemler.push('<button data-eylem="kitaplik" class="kitaplik-kaydet">Kitaplığa kaydet</button>');
  if (indirilebilir) {
    eylemler.push(
      `<button class="birincil" data-eylem="indir" data-url="${kacis(indirilebilir.pdf)}" data-tur="pdf" data-baslik="${kacis(g.baslik)}">PDF indir</button>`,
    );
  } else if (pdfSayfasi) {
    eylemler.push(
      `<button data-eylem="indir" data-url="${kacis(pdfSayfasi.link)}" data-tur="pdf" data-baslik="${kacis(g.baslik)}" title="Kaynak sayfasının bildirdiği PDF bağlantısını kontrol eder">PDF bağlantısını bul</button><span class="pdf-bilgi">Doğrudan PDF bağlantısı henüz yok.</span>`,
    );
  } else {
    eylemler.push(
      '<span class="pdf-bilgi">Bu kayıt PDF indirme sunmuyor; erişim seçenekleri için kaynağı aç.</span>',
    );
  }

  if (ozetlenebilir) {
    const { tur, url } = ozetlenebilir;
    eylemler.push(
      `<button data-eylem="ozet" data-url="${kacis(url)}" data-tur="${tur}" data-baslik="${kacis(g.baslik)}">Özet çıkar</button>`,
    );
  }

  for (const [alan, tur, ad] of [
    ["epub", "epub", "EPUB indir"],
    ["tamMetin", "metin", "Metin indir"],
  ]) {
    const url = g.kaynaklar.map((k) => guvenliAdres(k[alan])).find(Boolean);
    if (url)
      eylemler.push(
        `<button data-eylem="indir" data-url="${kacis(url)}" data-tur="${tur}" data-baslik="${kacis(g.baslik)}">${ad}</button>`,
      );
  }
  eylemler.push(
    `<button data-eylem="kunye" title="Kaynakça için yazar, yıl, başlık ve bağlantıyı kopyala">Künyeyi kopyala</button>`,
  );

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
      ${g.eslesme ? `<p class="eslesme-aciklama">${kacis(g.eslesme.aciklama)}</p>` : ""}
      ${g.karsilastirma?.length ? `<details class="baski-karsilastirma"><summary>Baskı ve dili karşılaştır</summary><p class="ipucu">Katalog bilgileri karşılaştırılır. Eksik alanlar doğrulanmış sayılmaz; indirilen dosyanın baskısını ayrıca kontrol et.</p>${g.karsilastirma.map((k) => `<h4>${guvenliAdres(k.kaynakLink) ? `<a href="${kacis(guvenliAdres(k.kaynakLink))}" target="_blank" rel="noopener noreferrer">${kacis(k.kaynakAd)} · Kaydı aç ↗</a>` : kacis(k.kaynakAd)}</h4><div class="tablo-kaydir"><table><caption class="atla">${kacis(k.kaynakAd)} künye karşılaştırması</caption><thead><tr><th scope="col">Bilgi</th><th scope="col">İstenen</th><th scope="col">Bu kayıt</th><th scope="col">Durum</th></tr></thead><tbody>${k.alanlar.map((a) => `<tr><th scope="row">${kacis(a.alan)}</th><td>${kacis(a.istenen)}</td><td>${kacis(a.bulunan)}</td><td class="kunye-${kacis(a.durum)}">${{ uygun: "Uyuşuyor", farkli: "Farklı", bilinmiyor: "Doğrulanamadı" }[a.durum]}</td></tr>`).join("")}</tbody></table></div>`).join("")}</details>` : ""}
      <div class="kart-eylem">
        ${sayfaParcasi}
        ${eylemler.join("")}
      </div>
      ${kaynakSatiri}
      <div class="kaynaklar">${kaynakRozetleri}</div>
      <div class="ozet-icerik"></div>
      <div class="indirme-icerik" role="status" aria-live="polite"></div>
    </div>`;

  kartVerileri.set(kart, g);
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

  if (eylem === "kitaplik") {
    buton.disabled = true;
    try {
      const sonuc = await istek("/api/workspace/items", {
        eser: kartVerileri.get(buton.closest(".kart")),
      });
      buton.textContent = sonuc.eklendi ? "Kitaplığa kaydedildi" : "Kitaplığınızda mevcut";
      document.dispatchEvent(new CustomEvent("kitaplik-degisti"));
    } catch (hata) {
      buton.disabled = false;
      buton.textContent = "Tekrar kaydet";
      hedefKutu.textContent = `Kitaplığa kaydedilemedi: ${hata.message}`;
    }
    return;
  }

  if (eylem === "kunye") {
    const kunye = buton.closest(".kart").dataset.kunye;
    try {
      await navigator.clipboard.writeText(kunye);
      buton.textContent = "Kopyalandı";
    } catch {
      hedefKutu.textContent = kunye;
      buton.textContent = "Künye aşağıda — seçip kopyalayın";
    }
    return;
  }

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
      const g = kartVerileri.get(buton.closest(".kart"));
      const k = g.kaynaklar.find((k) => k.pdf === url || k.link === url) ?? g.kaynaklar[0];
      const kimlik =
        tur === "pdf"
          ? {
              baslik: g.baslik,
              yazarlar: g.yazarlar.slice(0, 20),
              doi: k?.doi,
              isbn: sonCevap.sorgu?.isbn || k?.isbn,
              baski: sonCevap.sorgu?.baski || k?.baski,
            }
          : undefined;
      const alternatifler =
        tur === "pdf"
          ? [
              ...new Set(
                [
                  ...g.kaynaklar.flatMap((k) => [
                    guvenliAdres(k.pdf),
                    ...(k.pdfAdaylari ?? []).map((a) => guvenliAdres(a.url)),
                  ]),
                  ...g.kaynaklar
                    .filter((k) => k.erisim !== "odunc")
                    .map((k) => guvenliAdres(k.link)),
                ].filter((u) => u && u !== url),
              ),
            ].slice(0, 5)
          : [];
      await window.indirmeYoneticisi.ekle(
        {
          url,
          tur,
          baslik,
          ...(kimlik ? { kimlik } : {}),
          ...(alternatifler.length ? { alternatifler } : {}),
        },
        buton.closest(".kart").querySelector(".indirme-icerik"),
      );
    } catch (hata) {
      buton.title = hata.message;
      buton.closest(".kart").querySelector(".indirme-icerik").innerHTML =
        `<p class="islem-hata">${kacis(hata.message)}</p><p>Kaynak bağlantısını açarak önizleme, ödünç veya indirme seçeneklerini kontrol edebilirsin.</p>`;
    } finally {
      buton.textContent = eski;
      buton.disabled = false;
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
el.siralama.addEventListener("change", () => filtreUygula());

$("#risAktar").addEventListener("click", () => {
  const gosterilen = new Set($$(".kart:not(.gizli)").map((k) => k.dataset.anahtar));
  const gruplar = (sonCevap?.gruplar ?? []).filter((g) => gosterilen.has(g.anahtar));
  if (!gruplar.length) {
    mesajGoster("Aktarılacak görünür sonuç yok.", "uyari");
    return;
  }
  const tekSatir = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");
  const icerik = gruplar
    .map((g) => {
      const k = g.kaynaklar.find((k) => k.doi) ?? g.kaynaklar[0];
      const alanlar = [
        ["TY", g.tur === "kitap" ? "BOOK" : g.tur === "makale" ? "JOUR" : "GEN"],
        ["TI", g.baslik],
        ...g.yazarlar.map((a) => ["AU", a]),
        ["PY", g.yil],
        ["DO", k?.doi],
        ["UR", guvenliAdres(k?.link)],
        ["AB", g.ozet],
      ];
      return (
        alanlar
          .filter(([, v]) => v)
          .map(([ad, v]) => `${ad}  - ${tekSatir(v)}`)
          .join("\r\n") + "\r\nER  -\r\n"
      );
    })
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([icerik], { type: "application/x-research-info-systems;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "kaynaklar.ris";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

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
        <a class="ad" href="/api/downloads/${encodeURIComponent(d.dosya)}" download>${kacis(d.dosya)}</a>
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
        const durum = k.hazir ? "hazır" : (k.hata ?? "anahtar gerekli");
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

document.addEventListener("indirmeler-degisti", () => void indirmeleriYenile());

await indirmeleriYenile();

try {
  const { kaynaklar } = await istek("/api/sources");
  const klasor = `${kaynaklar.length} kaynak`;
  el.dosyaKlasor.textContent = klasor;
} catch {
  /* sunucu henuz hazir degilse sorun degil */
}
