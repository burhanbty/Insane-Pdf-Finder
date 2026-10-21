/* Arama ve kitaplık aynı kuyruğu kullanır. Sayfa yenilenince dosya indirmelerini yeniden tetikleme. */
(() => {
  const liste = document.querySelector("#indirmeKuyrugu");
  const hata = document.querySelector("#kuyrukHata");
  const sayac = document.querySelector("#kuyrukSayisi");
  if (!liste || !hata || !sayac) return;
  const isler = new Map();
  const satirlar = new Map();
  const izlenenler = new Map();
  const otomatik = new Set();
  const aktarilanDosyalar = new Set();
  let zamanlayici;
  let surum = 0;
  const bitti = (i) => ["tamamlandi", "basarisiz", "iptal"].includes(i.durum);
  const etiket = {
    sirada: "Sırada",
    baglaniyor: "Kaynağa bağlanıyor",
    indiriliyor: "İndiriliyor",
    dogrulaniyor: "Dosya doğrulanıyor",
    "iptal-ediliyor": "İptal ediliyor…",
    tamamlandi: "Hazır",
    basarisiz: "İndirilemedi",
    iptal: "İptal edildi",
  };
  const boyut = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1024 ** 2
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1024 ** 2).toFixed(1)} MB`;
  const adres = (i) => `/api/downloads/${encodeURIComponent(i.dosya)}`;
  async function api(yol = "", govde) {
    const r = await fetch(`/api/download-jobs${yol}`, {
      method: govde ? "POST" : "GET",
      headers: govde ? { "content-type": "application/json" } : undefined,
      body: govde ? JSON.stringify(govde) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.hata ?? "İndirme kuyruğuna ulaşılamadı");
    return d;
  }
  function dosyaLinki(i) {
    const a = document.createElement("a");
    a.href = adres(i);
    a.download = i.dosya;
    a.textContent = "Dosyayı indir";
    return a;
  }
  function durumMetni(i) {
    return `${etiket[i.durum] ?? i.durum}${i.durum === "indiriliyor" || i.durum === "dogrulaniyor" ? ` · ${boyut(i.alinan)}${i.toplam ? ` / ${boyut(i.toplam)}` : " · toplam boyut bilinmiyor"}` : ""}${i.mevcut ? " · Aynı dosya zaten vardı, mevcut dosya kullanıldı" : ""}${i.hata ? ` · ${i.hata}` : ""}`;
  }
  function izleyiciCiz(kutu, i) {
    kutu.replaceChildren(document.createTextNode(durumMetni(i) + " "));
    if (i.durum === "tamamlandi" && i.dosya) kutu.append(dosyaLinki(i));
    else {
      const a = document.createElement("a");
      a.href = "#indirilenBolum";
      a.textContent = "Kuyruğu göster";
      kutu.append(a);
    }
  }
  function ciz() {
    sayac.textContent = String([...isler.values()].filter((i) => !bitti(i)).length);
    for (const i of isler.values()) {
      let s = satirlar.get(i.id);
      if (!s) {
        const kart = document.createElement("article");
        kart.className = "indirme-isi";
        const baslik = document.createElement("h4");
        baslik.textContent = i.baslik;
        const durum = document.createElement("p");
        const ilerleme = document.createElement("progress");
        ilerleme.setAttribute("aria-label", `${i.baslik} indirme ilerlemesi`);
        const eylemler = document.createElement("div");
        eylemler.className = "indirme-is-eylem";
        kart.append(baslik, durum, ilerleme, eylemler);
        liste.append(kart);
        s = { kart, durum, ilerleme, eylemler };
        satirlar.set(i.id, s);
      }
      s.durum.textContent = durumMetni(i);
      s.ilerleme.hidden = bitti(i) || i.durum === "sirada";
      if (i.toplam) {
        s.ilerleme.max = i.toplam;
        s.ilerleme.value = Math.min(i.alinan, i.toplam);
      } else s.ilerleme.removeAttribute("value");
      if (s.kart.dataset.durum !== i.durum) {
        s.kart.dataset.durum = i.durum;
        s.eylemler.replaceChildren();
        if (i.durum === "tamamlandi" && i.dosya) s.eylemler.append(dosyaLinki(i));
        else if (i.durum !== "iptal-ediliyor") {
          const b = document.createElement("button");
          b.type = "button";
          const eylem = bitti(i) ? "tekrar" : "iptal";
          b.textContent = eylem === "tekrar" ? "Tekrar dene" : "İptal et";
          b.addEventListener("click", async () => {
            b.disabled = true;
            try {
              const r = await api(`/${encodeURIComponent(i.id)}/${eylem}`, {});
              surum++;
              if (eylem === "tekrar") otomatik.add(r.is.id);
              isler.set(r.is.id, r.is);
              hata.textContent = "";
              ciz();
              planla();
            } catch (e) {
              hata.textContent = e.message;
            } finally {
              b.disabled = false;
            }
          });
          s.eylemler.append(b);
        }
      }
      for (const kutu of izlenenler.get(i.id) ?? []) {
        if (!kutu.isConnected) {
          izlenenler.get(i.id).delete(kutu);
          continue;
        }
        izleyiciCiz(kutu, i);
      }
      if (i.durum === "tamamlandi" && otomatik.delete(i.id)) {
        if (!aktarilanDosyalar.has(i.dosya)) {
          aktarilanDosyalar.add(i.dosya);
          const a = dosyaLinki(i);
          document.body.append(a);
          a.click();
          a.remove();
        }
        document.dispatchEvent(new CustomEvent("indirmeler-degisti"));
      }
    }
    for (const [id, s] of satirlar)
      if (!isler.has(id)) {
        s.kart.remove();
        satirlar.delete(id);
        izlenenler.delete(id);
      }
    if (!isler.size)
      liste.textContent = "Henüz indirme yok. Sonuçlardan veya kitaplığından bir dosya seç.";
  }
  function planla(ms = 800) {
    clearTimeout(zamanlayici);
    if ([...isler.values()].some((i) => !bitti(i))) zamanlayici = setTimeout(yenile, ms);
  }
  async function yenile() {
    const simdi = surum;
    try {
      const d = await api();
      if (simdi !== surum) {
        planla();
        return;
      }
      if (!Array.isArray(d.isler)) throw new Error("İndirme kuyruğu yanıtı geçersiz");
      for (const [id, kutular] of izlenenler)
        if (!d.isler.some((i) => i.id === id)) {
          for (const kutu of kutular)
            if (kutu.isConnected)
              kutu.textContent =
                "İndirme kaydı bulunamadı; sunucu yeniden başlatılmış olabilir. Tamamlanan dosyalar İndirilenler bölümünde kalır.";
          izlenenler.delete(id);
          otomatik.delete(id);
        }
      if (!isler.size) liste.replaceChildren();
      isler.clear();
      for (const i of d.isler) isler.set(i.id, i);
      hata.textContent = "";
      ciz();
      planla();
    } catch (e) {
      hata.textContent = `${e.message}. Bağlantı yeniden denenecek.`;
      clearTimeout(zamanlayici);
      zamanlayici = setTimeout(yenile, 3000);
    }
  }
  window.indirmeYoneticisi = {
    async ekle(govde, kutu) {
      const d = await api("", govde);
      surum++;
      if (!isler.size) liste.replaceChildren();
      isler.set(d.is.id, d.is);
      otomatik.add(d.is.id);
      if (kutu) {
        if (!izlenenler.has(d.is.id)) izlenenler.set(d.is.id, new Set());
        izlenenler.get(d.is.id).add(kutu);
      }
      hata.textContent = "";
      ciz();
      planla();
      return d.is;
    },
  };
  void yenile();
  window.addEventListener("focus", () => void yenile());
  window.addEventListener("hashchange", () => {
    if (location.hash === "#indirilenBolum") void yenile();
  });
})();
