/* İlk boyamadan önce temayı seç; kişisel kitaplık verilerine dokunma. */
(() => {
  const anahtar = "kaynak-bul-tema";
  const kok = document.documentElement;
  const sistem = window.matchMedia?.("(prefers-color-scheme: dark)");
  const gecerli = (v) => ["acik", "koyu", "sistem"].includes(v);
  let tercih = "sistem";
  try {
    const kayitli = localStorage.getItem(anahtar);
    if (gecerli(kayitli)) tercih = kayitli;
  } catch {
    // Depolama kapalı olsa da tema bu sayfa boyunca değiştirilebilir.
  }

  function uygula() {
    kok.dataset.tema = tercih === "sistem" ? (sistem?.matches ? "koyu" : "acik") : tercih;
    document.querySelectorAll("button[data-tema-sec]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.temaSec === tercih));
    });
  }
  uygula();
  sistem?.addEventListener("change", () => {
    if (tercih === "sistem") uygula();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== anahtar && e.key !== null) return;
    tercih = gecerli(e.newValue) ? e.newValue : "sistem";
    uygula();
  });
  function bagla() {
    document.querySelectorAll("button[data-tema-sec]").forEach((b) => {
      b.addEventListener("click", () => {
        if (!gecerli(b.dataset.temaSec)) return;
        tercih = b.dataset.temaSec;
        try {
          localStorage.setItem(anahtar, tercih);
        } catch {
          // Kitaplık ve diğer işlemler depolama izninden etkilenmez.
        }
        uygula();
      });
    });
    uygula();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bagla, { once: true });
  else bagla();
})();
