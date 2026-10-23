/* Kalıcı araştırma alanı. Kullanıcı notları yalnızca yerel API'ye gider. */
const q = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const durumAdi = { okunacak: "Okunacak", okunuyor: "Okunuyor", okundu: "Okundu" };
let alan = { kitaplik: [], aramalar: [] };
let duzenlenen = null;
let bekleyenYedek = null;
let yedekSurumu = 0;
let yuklemeSurumu = 0;
let isbnEseri = null;
let isbnSurumu = 0;
let bekleyenDers = null;

async function api(yol = "", body) {
  const r = await fetch(`/api/workspace${yol}`, {
    signal: AbortSignal.timeout(15_000),
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.hata ?? "Çalışma alanına ulaşılamadı");
  return data;
}
function mesaj(s, hata = false) {
  q("#calismaMesaj").textContent = s;
  q("#calismaMesaj").classList.toggle("islem-hata", hata);
}
function url(v) {
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
function gorunenler() {
  const aranacak = q("#kitaplikAra").value.trim().toLocaleLowerCase("tr");
  const koleksiyon = q("#koleksiyonFiltre").value;
  const durum = q("#okumaFiltre").value;
  return alan.kitaplik.filter(
    (k) =>
      (durum === "arsiv" ? k.arsiv : !k.arsiv) &&
      (!durum || durum === "arsiv" || k.durum === durum) &&
      (!koleksiyon || k.koleksiyon === koleksiyon) &&
      (!aranacak ||
        [k.eser.baslik, ...k.eser.yazarlar, k.notlar, k.koleksiyon]
          .join(" ")
          .toLocaleLowerCase("tr")
          .includes(aranacak)),
  );
}
function ciz() {
  const koleksiyonlar = [...new Set(alan.kitaplik.map((k) => k.koleksiyon).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "tr"),
  );
  const onceki = q("#koleksiyonFiltre").value;
  q("#koleksiyonFiltre").innerHTML =
    '<option value="">Tüm koleksiyonlar</option>' +
    koleksiyonlar.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  q("#koleksiyonFiltre").value = koleksiyonlar.includes(onceki) ? onceki : "";
  q("#koleksiyonOnerileri").innerHTML = koleksiyonlar
    .map((s) => `<option value="${esc(s)}"></option>`)
    .join("");
  q("#kitaplikSayisi").textContent = alan.kitaplik.filter((k) => !k.arsiv).length;
  const kayitlar = gorunenler();
  q("#kitaplikListe").innerHTML = kayitlar.length
    ? kayitlar
        .map((k) => {
          const link = k.eser.kaynaklar.map((s) => url(s.link)).find(Boolean);
          const indirmeler = [
            ["pdf", "PDF indir"],
            ["epub", "EPUB indir"],
            ["tamMetin", "Metin indir"],
          ]
            .map(([alan, ad]) => {
              const dogrudan = k.eser.kaynaklar.map((s) => url(s[alan])).find(Boolean);
              const adres =
                dogrudan ??
                (alan === "pdf"
                  ? k.eser.kaynaklar
                      .filter((s) => s.erisim !== "odunc")
                      .map((s) => url(s.link))
                      .find(Boolean)
                  : null);
              return adres
                ? `<button type="button" data-alan="indir" data-url="${esc(adres)}" data-tur="${alan === "tamMetin" ? "metin" : alan}">${alan === "pdf" && !dogrudan ? "PDF bağlantısını bul" : ad}</button>`
                : "";
            })
            .join("");
          return `<article class="kitaplik-karti" data-kayit="${esc(k.id)}">
      <div><h3>${esc(k.eser.baslik)}</h3><p class="ipucu">${esc([k.eser.yazarlar.join(", "), k.eser.yil, k.eser.kaynaklar.find((s) => s.isbn)?.isbn ? `ISBN ${k.eser.kaynaklar.find((s) => s.isbn).isbn}` : ""].filter(Boolean).join(" · "))}</p></div>
      <div class="kitaplik-etiketler"><span class="etiket">${esc(durumAdi[k.durum])}</span>${k.koleksiyon ? `<span class="etiket">${esc(k.koleksiyon)}</span>` : ""}</div>
      ${k.notlar ? `<p class="kitaplik-notu">${esc(k.notlar)}</p>` : ""}
      <div class="kitaplik-eylemler"><button type="button" data-alan="duzenle">Not ve koleksiyon</button>
      ${link ? `<a class="mini" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Kaynağı aç</a>` : ""}
      ${indirmeler}
      <button type="button" data-alan="arsiv">${k.arsiv ? "Arşivden geri al" : "Arşivle"}</button></div>
      <div class="indirme-icerik" role="status" aria-live="polite"></div>
    </article>`;
        })
        .join("")
    : alan.kitaplik.length
      ? '<p class="ipucu kitaplik-bos">Bu filtrelere uyan kitap yok. Arama metnini veya filtrelerini değiştirebilirsin.</p>'
      : '<p class="ipucu kitaplik-bos"><strong>Yeni bir sayfa açmaya hazır mısın?</strong>Bulduğun kitapları buraya kaydet; derslerini, notlarını ve okuma ilerlemeni bir arada tut.<br /><a href="#aramaForm">İlk kitabını bul →</a></p>';
  q("#kayitliAramalar").innerHTML = alan.aramalar.length
    ? alan.aramalar
        .map(
          (a) =>
            `<div class="arama-kaydi" data-arama="${esc(a.id)}"><button type="button" data-alan="arama-ac" title="Formu doldurur; aramayı siz başlatırsınız">${esc(a.ad)}</button><button type="button" class="mini" data-alan="arama-kaldir" aria-label="${esc(a.ad)} aramasının kaydını kaldır">Kaydı kaldır</button></div>`,
        )
        .join("")
    : '<p class="ipucu">Sık kullandığınız aramayı kaydedin; daha sonra formu tek tıkla doldurun.</p>';
}
async function yenile() {
  const surum = ++yuklemeSurumu;
  const data = await api();
  if (surum === yuklemeSurumu) {
    alan = data;
    ciz();
  }
}
document.addEventListener("kitaplik-degisti", () => {
  void yenile()
    .then(() => mesaj("Kitaplık güncellendi."))
    .catch((h) => mesaj(h.message, true));
});
q("#kitaplikYenile").addEventListener(
  "click",
  () =>
    void yenile()
      .then(() => mesaj("Kitaplık güncel."))
      .catch((h) => mesaj(h.message, true)),
);
q("#kitaplikAra").addEventListener("input", ciz);
q("#koleksiyonFiltre").addEventListener("change", ciz);
q("#okumaFiltre").addEventListener("change", ciz);

q("#kitaplikListe").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-alan]");
  if (!b) return;
  const k = alan.kitaplik.find((k) => k.id === b.closest("[data-kayit]").dataset.kayit);
  if (!k) return;
  if (b.dataset.alan === "indir") {
    b.disabled = true;
    const onceki = b.textContent;
    b.textContent = "İndiriliyor…";
    try {
      const alternatifler =
        b.dataset.tur === "pdf"
          ? [
              ...new Set(
                [
                  ...k.eser.kaynaklar.flatMap((s) => [
                    url(s.pdf),
                    ...(s.pdfAdaylari ?? []).map((a) => url(a.url)),
                  ]),
                  ...k.eser.kaynaklar.filter((s) => s.erisim !== "odunc").map((s) => url(s.link)),
                ].filter((u) => u && u !== b.dataset.url),
              ),
            ].slice(0, 5)
          : [];
      await window.indirmeYoneticisi.ekle(
        {
          url: b.dataset.url,
          tur: b.dataset.tur,
          baslik: k.eser.baslik,
          ...(alternatifler.length ? { alternatifler } : {}),
        },
        b.closest(".kitaplik-karti").querySelector(".indirme-icerik"),
      );
      mesaj("İndirme kuyruğuna eklendi. İndirilenler bölümünden takip edebilirsin.");
    } catch (h) {
      mesaj(h.message, true);
      b.closest(".kitaplik-karti").querySelector(".indirme-icerik").textContent = h.message;
    } finally {
      b.disabled = false;
      b.textContent = onceki;
    }
    return;
  }
  if (b.dataset.alan === "duzenle") {
    duzenlenen = k.id;
    q("#kayitEserBaslik").textContent = k.eser.baslik;
    q("#kayitKoleksiyon").value = k.koleksiyon;
    q("#kayitDurum").value = k.durum;
    q("#kayitNotlar").value = k.notlar;
    q("#kayitHata").textContent = "";
    q("#kayitDialog").showModal();
    return;
  }
  b.disabled = true;
  try {
    await api(`/items/${encodeURIComponent(k.id)}`, { arsiv: !k.arsiv });
    await yenile();
    mesaj(
      k.arsiv
        ? "Kayıt kitaplığa geri alındı."
        : "Kayıt arşivlendi. Okuma durumu filtresinden geri alabilirsiniz.",
    );
  } catch (h) {
    mesaj(h.message, true);
    b.disabled = false;
  }
});
q("#kayitKapat").addEventListener("click", () => q("#kayitDialog").close());
q("#kayitDialog").addEventListener("cancel", (e) => {
  if (q("#kayitKaydet").disabled) e.preventDefault();
});
q("#kayitForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = duzenlenen;
  const b = q("#kayitKaydet");
  b.disabled = true;
  q("#kayitKapat").disabled = true;
  try {
    await api(`/items/${encodeURIComponent(id)}`, {
      koleksiyon: q("#kayitKoleksiyon").value,
      durum: q("#kayitDurum").value,
      notlar: q("#kayitNotlar").value,
    });
    q("#kayitDialog").close();
    await yenile();
    mesaj("Notlar ve okuma durumu kaydedildi.");
  } catch (h) {
    q("#kayitHata").textContent = h.message;
  } finally {
    b.disabled = false;
    q("#kayitKapat").disabled = false;
  }
});

q("#aramaKaydet").addEventListener("click", async (e) => {
  const form = q("#aramaForm");
  if (!form.reportValidity()) return;
  const baslik = q("#baslik").value.trim();
  if (!baslik) return;
  const b = e.currentTarget;
  b.disabled = true;
  try {
    await api("/searches", {
      ad: baslik.slice(0, 100),
      webDahil: q("#webDahil").checked,
      sorgu: {
        baslik,
        yazar: q("#yazar").value.trim(),
        yil: q("#yil").value ? Number(q("#yil").value) : undefined,
        tur: form.querySelector("input[name=tur]:checked").value,
        limit: Number(q("#limit").value),
        ...(form.querySelector("input[name=tur]:checked").value === "kitap"
          ? Object.fromEntries(
              [
                ["isbn", "hedefIsbn"],
                ["baski", "hedefBaski"],
                ["dil", "hedefDil"],
                ["yayinci", "hedefYayinci"],
              ]
                .map(([k, id]) => [k, q(`#${id}`).value.trim()])
                .filter(([, v]) => v),
            )
          : {}),
      },
    });
    await yenile();
    mesaj("Arama kaydedildi.");
  } catch (h) {
    mesaj(h.message, true);
  } finally {
    b.disabled = false;
  }
});
q("#kayitliAramalar").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-alan]");
  if (!b) return;
  const a = alan.aramalar.find((a) => a.id === b.closest("[data-arama]").dataset.arama);
  if (!a) return;
  if (b.dataset.alan === "arama-ac") {
    const s = a.sorgu;
    q("#baslik").value = s.baslik;
    q("#yazar").value = s.yazar ?? "";
    q("#yil").value = s.yil ?? "";
    q("#limit").value = s.limit;
    q("#webDahil").checked = a.webDahil;
    q(`#aramaForm input[value="${s.tur}"]`).checked = true;
    for (const [k, id] of [
      ["isbn", "hedefIsbn"],
      ["baski", "hedefBaski"],
      ["dil", "hedefDil"],
      ["yayinci", "hedefYayinci"],
    ])
      q(`#${id}`).value = s[k] ?? "";
    q("#aramaForm").dispatchEvent(new Event("change", { bubbles: true }));
    q("#baslik").focus();
    mesaj("Kayıtlı arama forma aktarıldı. Başlatmak için Ara düğmesine basın.");
    return;
  }
  b.disabled = true;
  try {
    await api(`/searches/${encodeURIComponent(a.id)}/remove`, {});
    await yenile();
    mesaj("Arama kaydı kaldırıldı.");
  } catch (h) {
    mesaj(h.message, true);
    b.disabled = false;
  }
});

function indir(metin, ad, tip) {
  const adres = URL.createObjectURL(new Blob([metin], { type: tip }));
  const a = document.createElement("a");
  a.href = adres;
  a.download = ad;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(adres), 1000);
}
function kaynakca(bicim) {
  const kayitlar = gorunenler();
  if (!kayitlar.length) {
    mesaj("Aktarılacak görünür kayıt yok.");
    return;
  }
  const tek = (s) => String(s ?? "").replace(/[\r\n]+/g, " ");
  const bib = (s) =>
    tek(s).replace(
      /[\\{}%&#_$~^]/g,
      (c) =>
        ({ "\\": "\\textbackslash{}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[c] ??
        `\\${c}`,
    );
  const data = kayitlar
    .map((k, i) => {
      const g = k.eser;
      const kaynak = g.kaynaklar.find((s) => s.doi) ?? g.kaynaklar[0];
      const link = url(kaynak.link);
      if (bicim === "ris") {
        const alanlar = [
          ["TY", g.tur === "kitap" ? "BOOK" : g.tur === "makale" ? "JOUR" : "GEN"],
          ["TI", g.baslik],
          ...g.yazarlar.map((a) => ["AU", a]),
          ["PY", g.yil],
          ["DO", kaynak.doi],
          ["UR", link],
        ];
        return (
          alanlar
            .filter(([, v]) => v)
            .map(([a, v]) => `${a}  - ${tek(v)}`)
            .join("\r\n") + "\r\nER  -\r\n"
        );
      }
      const alanlar = [
        ["title", g.baslik],
        ["year", g.yil],
        ["doi", kaynak.doi],
        ["isbn", kaynak.isbn],
        ["url", link],
        ["publisher", kaynak.yayinci],
      ];
      const satirlar = alanlar.filter(([, v]) => v).map(([a, v]) => `  ${a} = {${bib(v)}}`);
      if (g.yazarlar.length)
        satirlar.push(`  author = {${g.yazarlar.map((a) => `{${bib(a)}}`).join(" and ")}}`);
      return `@${g.tur === "kitap" ? "book" : "misc"}{kaynak${i + 1},\n${satirlar.join(",\n")}\n}\n`;
    })
    .join("\n");
  indir(data, `kitapligim.${bicim === "ris" ? "ris" : "bib"}`, "text/plain;charset=utf-8");
  mesaj(`${kayitlar.length} kayıt kaynakça dosyasına aktarıldı. Kişisel notlar dahil edilmedi.`);
}
q("#kitaplikRis").addEventListener("click", () => kaynakca("ris"));
q("#kitaplikBib").addEventListener("click", () => kaynakca("bib"));
q("#yedekIndir").addEventListener("click", async () => {
  try {
    indir(JSON.stringify(await api("/backup")), "kaynak-bul-yedek.json", "application/json");
    mesaj("Yedek indirildi. Dosya kişisel notlarınızı da içerir.");
  } catch (h) {
    mesaj(h.message, true);
  }
});
q("#yedekDosya").addEventListener("change", async (e) => {
  const surum = ++yedekSurumu;
  bekleyenYedek = null;
  q("#yedekBirlestir").disabled = true;
  const dosya = e.target.files[0];
  if (!dosya) return;
  try {
    if (dosya.size > 30 * 1024 * 1024) throw new Error("Yedek dosyası 30 MB sınırını aşıyor");
    const metin = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Yedek okunamadı"));
      r.readAsText(dosya);
    });
    const yedek = JSON.parse(metin);
    const sonuc = await api("/import", { yedek, onizleme: true });
    if (surum !== yedekSurumu) return;
    bekleyenYedek = yedek;
    q("#yedekOnizleme").textContent =
      `${sonuc.yeniKitap} yeni eser, ${sonuc.yeniArama} yeni arama eklenecek. ${sonuc.korunan} mevcut kayıt korunacak. Henüz veri yazılmadı.`;
    q("#yedekBirlestir").disabled = false;
  } catch (h) {
    if (surum === yedekSurumu) q("#yedekOnizleme").textContent = `Yedek açılamadı: ${h.message}`;
  }
});
q("#yedekBirlestir").addEventListener("click", async (e) => {
  if (!bekleyenYedek) return;
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const sonuc = await api("/import", { yedek: bekleyenYedek, onizleme: false });
    bekleyenYedek = null;
    await yenile();
    q("#yedekOnizleme").textContent =
      `Birleştirildi: ${sonuc.yeniKitap} eser ve ${sonuc.yeniArama} arama eklendi. Mevcut notlar korundu.`;
  } catch (h) {
    q("#yedekOnizleme").textContent = h.message;
    b.disabled = false;
  }
});

q("#isbnBul").addEventListener("click", async (e) => {
  const surum = ++isbnSurumu;
  const b = e.currentTarget;
  b.disabled = true;
  isbnEseri = null;
  q("#isbnKaydet").classList.add("gizli");
  q("#isbnSonuc").textContent = "ISBN katalogda aranıyor…";
  try {
    const r = await fetch("/api/isbn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isbn: q("#isbnGirdi").value }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.hata ?? "ISBN kaydı alınamadı");
    if (surum !== isbnSurumu) return;
    isbnEseri = data.eser;
    const g = data.eser;
    q("#baslik").value = g.baslik;
    q("#yazar").value = g.yazarlar[0] ?? "";
    q("#yil").value = g.yil ?? "";
    q("#hedefIsbn").value = data.isbn;
    q("#hedefBaski").value = data.baski ?? "";
    q("#hedefDil").value = "";
    q("#hedefYayinci").value = g.kaynaklar.find((k) => k.yayinci)?.yayinci?.slice(0, 200) ?? "";
    q('#aramaForm input[value="kitap"]').checked = true;
    q("#aramaForm").dispatchEvent(new Event("change", { bubbles: true }));
    q("#isbnSonuc").textContent = [
      g.baslik,
      g.yazarlar.join(", "),
      g.yil,
      data.baski,
      `ISBN ${data.isbn}`,
      "Künye forma aktarıldı. Erişim seçeneklerini görmek için Ara’ya basın.",
    ]
      .filter(Boolean)
      .join(" · ");
    q("#isbnKaydet").disabled = false;
    q("#isbnKaydet").textContent = "Bu ISBN kaydını kitaplığa ekle";
    q("#isbnKaydet").classList.remove("gizli");
  } catch (h) {
    if (surum === isbnSurumu) q("#isbnSonuc").textContent = h.message;
  } finally {
    if (surum === isbnSurumu) b.disabled = false;
  }
});
q("#isbnGirdi").addEventListener("input", () => {
  isbnSurumu++;
  isbnEseri = null;
  q("#isbnKaydet").classList.add("gizli");
  q("#isbnBul").disabled = false;
  q("#isbnSonuc").textContent = "";
});
q("#isbnKaydet").addEventListener("click", async (e) => {
  if (!isbnEseri) return;
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const sonuc = await api("/items", { eser: isbnEseri });
    await yenile();
    b.textContent = sonuc.eklendi ? "Kitaplığa eklendi" : "Kitaplığınızda mevcut";
  } catch (h) {
    mesaj(h.message, true);
    b.disabled = false;
  }
});
function dersiGecersizKil() {
  bekleyenDers = null;
  q("#dersKaydet").disabled = true;
  q("#dersSonuc").textContent = "Liste değişti; yeniden önizleyin.";
}
q("#dersAdi").addEventListener("input", dersiGecersizKil);
q("#dersKitaplari").addEventListener("input", dersiGecersizKil);
q("#dersOnizle").addEventListener("click", async () => {
  bekleyenDers = null;
  q("#dersKaydet").disabled = true;
  const girdi = { ders: q("#dersAdi").value, metin: q("#dersKitaplari").value };
  try {
    const sonuc = await api("/course-list", { ...girdi, onizleme: true });
    if (girdi.ders !== q("#dersAdi").value || girdi.metin !== q("#dersKitaplari").value) return;
    bekleyenDers = girdi;
    q("#dersSonuc").textContent =
      `${sonuc.yeniArama} yeni kitap araması eklenecek; ${sonuc.mevcut} sorgu zaten kayıtlı. Henüz arama başlatılmadı.`;
    q("#dersKaydet").disabled = false;
  } catch (h) {
    q("#dersSonuc").textContent = h.message;
  }
});
q("#dersKaydet").addEventListener("click", async (e) => {
  if (!bekleyenDers) return;
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const sonuc = await api("/course-list", { ...bekleyenDers, onizleme: false });
    bekleyenDers = null;
    await yenile();
    q("#dersSonuc").textContent =
      `${sonuc.yeniArama} kitap araması kaydedildi. Yukarıdaki listeden kitabı seçip Ara’ya basabilirsiniz.`;
  } catch (h) {
    q("#dersSonuc").textContent = h.message;
    b.disabled = false;
  }
});

try {
  await yenile();
} catch (h) {
  q("#kitaplikListe").textContent = "Kitaplık yüklenemedi. Yenile düğmesiyle tekrar deneyin.";
  mesaj(h.message, true);
}
