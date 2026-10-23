/** 100 gerçek katalog kaydı × 5 sorgu varyantı. Etiketler kaynak üstverisine dayanır. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import {
  sorgulariUret,
  veriDogrula,
  type BenchmarkEser,
  type BenchmarkVeri,
} from "./pdf-benchmark.js";
import type { Work } from "../src/types.js";

const eserler: BenchmarkEser[] = [];
const kanitZamanlari = new Map<string, string>();
await fs.mkdir("benchmark/evidence", { recursive: true });
async function oku(ad: string, url: string): Promise<string> {
  if (!process.argv.includes("--refresh")) {
    try {
      const kanit = JSON.parse(
        await fs.readFile(`benchmark/evidence/${ad}.provenance.json`, "utf8"),
      ) as { url: string; alindi: string; sha256: string };
      const text = await fs.readFile(`benchmark/evidence/${ad}.txt`, "utf8");
      if (kanit.url === url && kanit.sha256 === createHash("sha256").update(text).digest("hex")) {
        kanitZamanlari.set(url, kanit.alindi);
        return text;
      }
    } catch {
      /* İlk toplama veya açıkça yenileme. */
    }
  }
  const r = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "user-agent": "kaynak-bul/1.0 (benchmark metadata collection)" },
  });
  if (!r.ok) throw Error(`${ad}: HTTP ${r.status}`);
  const text = await r.text();
  if (Buffer.byteLength(text) > 5 * 1024 * 1024) throw Error("Üstveri sınırı aşıldı");
  await fs.writeFile(`benchmark/evidence/${ad}.txt`, text);
  const alindi = new Date().toISOString();
  kanitZamanlari.set(url, alindi);
  await fs.writeFile(
    `benchmark/evidence/${ad}.provenance.json`,
    JSON.stringify(
      { url, alindi, sha256: createHash("sha256").update(text).digest("hex") },
      null,
      2,
    ) + "\n",
  );
  return text;
}
function ekle(kategori: string, adet: number, url: string, works: Work[]) {
  const secilen = [
    ...new Map(
      works
        .filter((w) => w.baslik.length >= 5 && w.baslik.length <= 300 && w.yazarlar.length && w.yil)
        .map((w) => [w.link, w]),
    ).values(),
  ].slice(0, adet);
  if (secilen.length !== adet)
    throw Error(`${kategori}: ${adet} yerine ${secilen.length} gerçek kayıt`);
  for (const eser of secilen)
    eserler.push({
      id: createHash("sha256").update(eser.link).digest("hex").slice(0, 16),
      kategori,
      kanit: { url, alindi: kanitZamanlari.get(url)! },
      eser,
    });
}

const trUrl =
  "https://openlibrary.org/search.json?q=language%3Atur&limit=80&fields=key,title,author_name,first_publish_year";
const tr = JSON.parse(await oku("turkce-kitap", trUrl)) as {
  docs: { key: string; title: string; author_name?: string[]; first_publish_year?: number }[];
};
ekle(
  "turkce-kitap",
  40,
  trUrl,
  tr.docs.map((d) => ({
    kaynak: "open-library",
    kaynakAd: "Open Library",
    tur: "kitap",
    baslik: d.title,
    yazarlar: d.author_name ?? [],
    yil: d.first_publish_year,
    link: `https://openlibrary.org${d.key}`,
    kunyeTuru: "eser",
  })),
);

const kitapUrl =
  "https://directory.doabooks.org/oai/request?verb=ListRecords&metadataPrefix=oai_dc";
const dom = new JSDOM(await oku("yabanci-kitap", kitapUrl), { contentType: "text/xml" });
const kitaplar: Work[] = [];
for (const record of dom.window.document.getElementsByTagNameNS("*", "record")) {
  const values = (name: string) =>
    [...record.getElementsByTagNameNS("*", name)]
      .map((e) => e.textContent?.trim() ?? "")
      .filter(Boolean);
  if (!values("resourceType").includes("book")) continue;
  const link = values("identifier").find((x) =>
    x.startsWith("https://directory.doabooks.org/handle/"),
  );
  const date = [...record.getElementsByTagNameNS("*", "date")].find(
    (e) => e.getAttribute("type")?.toLowerCase() === "issued",
  )?.textContent;
  if (link)
    kitaplar.push({
      kaynak: "doab",
      kaynakAd: "DOAB",
      tur: "kitap",
      baslik: values("title")[0] ?? "",
      yazarlar: values("creator"),
      yil: date ? Number(date.slice(0, 4)) : undefined,
      link,
      doi: values("identifierdoi")[0],
    });
}
dom.window.close();
ekle("yabanci-kitap", 20, kitapUrl, kitaplar);

const makaleUrl =
  "https://api.crossref.org/works?filter=type%3Ajournal-article&rows=30&select=DOI,title,author,published,URL";
const makale = JSON.parse(await oku("makale", makaleUrl)) as {
  message: {
    items: {
      DOI: string;
      title?: string[];
      author?: { given?: string; family?: string }[];
      published?: { "date-parts"?: number[][] };
      URL: string;
    }[];
  };
};
ekle(
  "makale",
  20,
  makaleUrl,
  makale.message.items.map((m) => ({
    kaynak: "crossref",
    kaynakAd: "Crossref",
    tur: "makale",
    baslik: m.title?.[0] ?? "",
    yazarlar: (m.author ?? [])
      .map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .filter(Boolean),
    yil: m.published?.["date-parts"]?.[0]?.[0],
    link: m.URL,
    doi: m.DOI,
  })),
);

for (const [kategori, docType, tur] of [
  ["tez-rapor", "THESE", "makale"],
  ["sunum-ders", "LECTURE", "slayt"],
] as const) {
  const url = `https://api.archives-ouvertes.fr/search/?q=docType_s%3A${docType}&rows=30&wt=json&fl=title_s,authFullName_s,producedDateY_i,uri_s,doiId_s`;
  const data = JSON.parse(await oku(kategori, url)) as {
    response: {
      docs: {
        title_s?: string[];
        authFullName_s?: string[];
        producedDateY_i?: number;
        uri_s: string;
        doiId_s?: string;
      }[];
    };
  };
  ekle(
    kategori,
    10,
    url,
    data.response.docs.map((d) => ({
      kaynak: "hal",
      kaynakAd: "HAL",
      tur,
      baslik: d.title_s?.[0] ?? "",
      yazarlar: d.authFullName_s ?? [],
      yil: d.producedDateY_i,
      link: d.uri_s,
      doi: d.doiId_s,
    })),
  );
}
eserler.sort((a, b) => a.id.localeCompare(b.id));
const veri: BenchmarkVeri = {
  surum: 1,
  aciklama:
    "100 farklı gerçek eser × 5 deterministik sorgu varyantı = 500 sorgu. İnsan tarafından etiketlenmiş 500 bağımsız eser değildir. Kimlik etiketleri kaydedilmiş resmî üstveriden gelir. Tez/sunum alt türleri mevcut uygulamanın makale/slayt türlerine eşlenir. Sabit aday sıralaması internet kapsaması ölçmez.",
  eserler,
  sorgular: sorgulariUret(eserler),
};
veriDogrula(veri);
await fs.writeFile("benchmark/pdf-search-v1.json", JSON.stringify(veri, null, 2) + "\n");
console.log(
  JSON.stringify({
    eser: eserler.length,
    sorgu: veri.sorgular.length,
    kategoriler: Object.fromEntries(
      [...new Set(eserler.map((e) => e.kategori))].map((k) => [
        k,
        eserler.filter((e) => e.kategori === k).length,
      ]),
    ),
  }),
);
