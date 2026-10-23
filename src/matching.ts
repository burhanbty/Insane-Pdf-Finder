import { eslestir, normalizeMetin } from "./normalize.js";
import { isbnDogrula } from "./isbn.js";
import type { Gruplanmis, Sorgu, Work } from "./types.js";

export function dilAnahtari(s: string): string {
  const n = normalizeMetin(s.replace(/^.*\//, ""));
  const diller: Record<string, string> = {
    tr: "tr",
    tur: "tr",
    turkish: "tr",
    turkce: "tr",
    en: "en",
    eng: "en",
    english: "en",
    ingilizce: "en",
    de: "de",
    ger: "de",
    deu: "de",
    german: "de",
    almanca: "de",
    fr: "fr",
    fre: "fr",
    fra: "fr",
    french: "fr",
    fransizca: "fr",
    es: "es",
    spa: "es",
    spanish: "es",
    ispanyolca: "es",
  };
  return diller[n] ?? n;
}

function baskiAnahtari(s: string): string {
  return normalizeMetin(s)
    .replace(
      /\b(first|second|third|fourth|fifth)\b/g,
      (x) => ({ first: "1", second: "2", third: "3", fourth: "4", fifth: "5" })[x]!,
    )
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/\b(edition|ed|baski|basim)\b/g, "")
    .replace(/\s/g, "");
}

/** Bilinen çelişkiler, eksik bir kayıt üzerinden de birleşemez. */
export function baskilarUyumlu(a: Work, b: Work): boolean {
  if (a.belgeTuru && b.belgeTuru && a.belgeTuru !== b.belgeTuru) return false;
  const simgeler = (s: string) => s.match(/[+#]/g)?.join("") ?? "";
  if (simgeler(a.baslik) !== simgeler(b.baslik)) return false;
  const sayilar = (s: string) => {
    const roman = [
      "i",
      "ii",
      "iii",
      "iv",
      "v",
      "vi",
      "vii",
      "viii",
      "ix",
      "x",
      "xi",
      "xii",
      "xiii",
      "xiv",
      "xv",
      "xvi",
      "xvii",
      "xviii",
      "xix",
      "xx",
    ];
    const n = normalizeMetin(s).replace(/\b[a-z]+$/, (son) =>
      roman.includes(son) ? String(roman.indexOf(son) + 1) : son,
    );
    return n.match(/\b\d+\b/g)?.join(",");
  };
  const an = sayilar(a.baslik),
    bn = sayilar(b.baslik);
  if (an && bn && an !== bn) return false;
  if (a.tur !== "kitap" || b.tur !== "kitap") return true;
  const ai = isbnDogrula(a.isbn),
    bi = isbnDogrula(b.isbn);
  if (ai && bi && ai !== bi) return false;
  if (a.dil && b.dil && dilAnahtari(a.dil) !== dilAnahtari(b.dil)) return false;
  if (a.baski && b.baski && baskiAnahtari(a.baski) !== baskiAnahtari(b.baski)) return false;
  if (a.yil && b.yil && a.yil !== b.yil) return false;
  // Cilt ve ders numaraları anlam taşır. Yalnızca iki tarafta da biliniyorsa ayır.
  return true;
}

export function baskiKarsilastir(
  s: Sorgu,
  w: Work,
): NonNullable<Gruplanmis["karsilastirma"]>[number] {
  const alanlar: NonNullable<Gruplanmis["karsilastirma"]>[number]["alanlar"] = [];
  function ekle(
    alan: string,
    istenen: string | undefined,
    bulunan: string | undefined,
    anahtar = normalizeMetin,
  ) {
    alanlar.push({
      alan,
      istenen: istenen || "Belirtilmedi",
      bulunan: bulunan || "Bilinmiyor",
      durum:
        !istenen || !bulunan
          ? "bilinmiyor"
          : anahtar(istenen) === anahtar(bulunan)
            ? "uygun"
            : "farkli",
    });
  }
  ekle("ISBN", s.isbn, isbnDogrula(w.isbn) ?? undefined, (x) => isbnDogrula(x) ?? x);
  ekle("Baskı", s.baski, w.baski, baskiAnahtari);
  ekle("Dil", s.dil, w.dil, dilAnahtari);
  ekle("Yayınevi", s.yayinci, w.yayinci);
  ekle("Yıl", s.yil?.toString(), w.kunyeTuru === "eser" ? undefined : w.yil?.toString());
  return { kaynakLink: w.link, kaynakAd: w.kaynakAd, alanlar };
}

/** Sınırlı uzunlukta yazım uzaklığı; öneriler yalnızca gerçekten dönen başlıklardır. */
function yakinYazim(a: string, b: string): boolean {
  const sayilar = (s: string) => s.match(/\b\d+\b/g)?.join(",") ?? "";
  if (sayilar(a) !== sayilar(b)) return false;
  if (a.length < 5 || a.length > 300 || b.length > 300 || Math.abs(a.length - b.length) > 3)
    return false;
  let onceki = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const simdi = [i];
    for (let j = 1; j <= b.length; j++)
      simdi[j] = Math.min(
        simdi[j - 1]! + 1,
        onceki[j]! + 1,
        onceki[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    onceki = simdi;
  }
  return onceki[b.length]! <= Math.min(3, Math.floor(a.length * 0.2));
}

export function sonucuAcikla(g: Gruplanmis, s: Sorgu): void {
  const p = eslestir({ baslik: s.baslik, yazarlar: s.yazar ? [s.yazar] : [], yil: s.yil }, g);
  const baslikAyni = normalizeMetin(s.baslik) === normalizeMetin(g.baslik);
  const yazarUygun = !s.yazar || p.yazar >= (normalizeMetin(s.yazar).includes(" ") ? 0.9 : 0.75);
  const oneri =
    g.tur === s.tur &&
    !baslikAyni &&
    yakinYazim(normalizeMetin(s.baslik), normalizeMetin(g.baslik)) &&
    yazarUygun;
  g.karsilastirma = g.tur === "kitap" ? g.kaynaklar.map((w) => baskiKarsilastir(s, w)) : undefined;
  const istenenAlanlar = Boolean(s.isbn || s.baski || s.dil || s.yayinci || s.yil);
  // En az bir kayıt, istenen bütün alanları kendisi doğrulamalı; farklı kayıtlardan kanıt toplama.
  const baskiUygun =
    g.tur !== "kitap"
      ? !s.yil || s.yil === g.yil
      : !istenenAlanlar ||
        g.karsilastirma?.some((k) =>
          k.alanlar.every((a) => a.istenen === "Belirtilmedi" || a.durum === "uygun"),
        );
  const tur =
    g.tur !== s.tur
      ? "ilgili"
      : baslikAyni && yazarUygun && baskiUygun
        ? "tam"
        : (baslikAyni || p.baslik >= 0.45 || oneri) && yazarUygun
          ? "yakin"
          : "ilgili";
  g.eslesme = {
    tur,
    oneri,
    aciklama:
      tur === "tam"
        ? "Başlık ve girilen bilgiler eşleşiyor. Dosyanın içeriğini kaynakta kontrol et."
        : tur === "yakin"
          ? "Benzer başlık veya farklı / eksik baskı bilgisi. Künyeyi karşılaştır."
          : "Aradığın eser olduğu doğrulanamadı; başlık ve yazarı kontrol et.",
  };
  if (tur === "ilgili") g.puan *= 0.3;
}
