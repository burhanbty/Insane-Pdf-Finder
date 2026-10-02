import { get } from "../http.js";
import type { SourceModule, Sorgu, Work } from "../types.js";

/* arXiv Atom API: onceden yazilmis bilimsel makaleler, hepsi acik PDF. */

function xmlKacis(c: string): string {
  return c
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// arXiv Atom (XML) donduruyor; JSON desteklemiyor. Minimal bir ayristirma
// yeterli: entry bloklarini ve iclerindeki <tag>...</tag> degerlerini aliyoruz.
function kacisCoz(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function etiketIcerik(blok: string, etiket: string): string | undefined {
  const m = blok.match(new RegExp(`<${etiket}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiket}>`));
  return m?.[1] === undefined ? undefined : kacisCoz(m[1]).replace(/\s+/g, " ").trim();
}

function tumEtiketler(blok: string, etiket: string): string[] {
  const cikti: string[] = [];
  const re = new RegExp(`<${etiket}(?:\\s[^>]*)?>([\\s\\S]*?)</${etiket}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(blok)) !== null) {
    const d = kacisCoz(m[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (d) cikti.push(d);
  }
  return cikti;
}

function girisleriAyir(xml: string): string[] {
  const cikti: string[] = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) cikti.push(m[1] ?? "");
  return cikti;
}

async function ara(sorgu: Sorgu): Promise<Work[]> {
  const parcalar = [`ti:"${xmlKacis(sorgu.baslik)}"`];
  if (sorgu.yazar) parcalar.push(`au:${xmlKacis(sorgu.yazar)}`);

  const u = new URL("https://export.arxiv.org/api/query");
  u.searchParams.set("search_query", parcalar.join(" AND "));
  u.searchParams.set("start", "0");
  u.searchParams.set("max_results", String(Math.min(50, sorgu.limit * 2)));
  u.searchParams.set("sortBy", "relevance");

  const cevap = await get(u.toString(), { timeoutMs: 25_000, boslukMs: 900, ham: true });
  const xml = await cevap.text();

  const sonuc: Work[] = [];
  for (const blok of girisleriAyir(xml)) {
    const baslik = etiketIcerik(blok, "title");
    const hamId = etiketIcerik(blok, "id");
    if (!baslik || !hamId) continue;

    const doi = hamId.match(/doi\.org\/(10\.\S+)$/)?.[1];

    // arXiv <link .../> etiketleri kendini kapatan (self-closing), yani
    // </link> yoktur; href ozelligini okumamiz gerekir.
    const linklerin: string[] = [];
    const linkRe = /<link\s[^>]*\/?>/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(blok)) !== null) linklerin.push(lm[0]);

    const pdfEtiket = linklerin.find((l) => l.includes('title="pdf"')) ?? "";
    const pdf = pdfEtiket.match(/href="([^"]+)"/)?.[1];

    const absEtiket =
      linklerin.find((l) => l.includes('rel="alternate"')) ??
      linklerin.find((l) => !l.includes('title="pdf"')) ??
      "";
    const absLink = absEtiket.match(/href="([^"]+)"/)?.[1];

    const yazarlar = tumEtiketler(blok, "name");

    sonuc.push({
      kaynak: "arxiv",
      kaynakAd: "arXiv",
      tur: "makale",
      baslik,
      yazarlar,
      yil: Number(etiketIcerik(blok, "published")?.slice(0, 4)) || undefined,
      ozet: etiketIcerik(blok, "summary"),
      konular: [...new Set(tumEtiketler(blok, "term"))],
      doi,
      link: absLink ? kacisCoz(absLink) : `https://arxiv.org/abs/${hamId}`,
      pdf: pdf ? kacisCoz(pdf) : undefined,
      erisim: "acik",
    });
  }

  return sonuc;
}

const kaynak: SourceModule = {
  id: "arxiv",
  ad: "arXiv",
  tur: ["makale"],
  aciklama: "Acik erisimli on baskilar, tam PDF",
  ara,
};

export default kaynak;
