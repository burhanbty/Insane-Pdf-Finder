/** Sabit aday sıralaması ile canlı aramayı ayrı ölçer; PDF URL'si indirme kanıtı sayılmaz. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ara, grupla } from "../src/search.js";
import { ayar } from "../src/config.js";
import type { Gruplanmis, Sorgu, Work } from "../src/types.js";

export interface BenchmarkEser {
  id: string;
  kategori: string;
  kanit: { url: string; alindi: string };
  eser: Work;
}
export interface BenchmarkSorgu {
  id: string;
  eserId: string;
  kategori: string;
  varyant: string;
  bolum: "gelistirme" | "test";
  sorgu: Sorgu;
}
export interface BenchmarkVeri {
  surum: 1;
  aciklama: string;
  eserler: BenchmarkEser[];
  sorgular: BenchmarkSorgu[];
}

/** Oracle sıralama puanından bağımsızdır: kaynakta gözlenen kimliklerin eşitliği. */
export function hedefMi(g: Gruplanmis, hedef: Work): boolean {
  const doi = (s?: string) =>
    s
      ?.trim()
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  return g.kaynaklar.some(
    (k) =>
      (hedef.doi && doi(k.doi) === doi(hedef.doi)) ||
      (hedef.isbn && k.isbn === hedef.isbn) ||
      k.link === hedef.link,
  );
}

export function sorgulariUret(eserler: BenchmarkEser[]): BenchmarkSorgu[] {
  return eserler.flatMap((e) => {
    const w = e.eser;
    if (!w.yil || !w.yazarlar[0]) throw Error(`Yıl/yazar kanıtı eksik: ${e.id}`);
    const temel: Sorgu = { baslik: w.baslik, tur: w.tur, limit: 5 };
    const ascii = w.baslik
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");
    const harf = [...w.baslik].findIndex((c, i) => i > 1 && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(c));
    const yazim = [...w.baslik];
    yazim.splice(harf, 1);
    const varyantlar = [
      ["baslik", temel],
      ["baslik-yazar", { ...temel, yazar: w.yazarlar[0] }],
      ["baslik-yazar-yil", { ...temel, yazar: w.yazarlar[0], yil: w.yil }],
      ["ascii-yil", { ...temel, baslik: ascii, yil: w.yil }],
      ["tek-harf-eksik", { ...temel, baslik: yazim.join(""), yazar: w.yazarlar[0] }],
    ] as const;
    // Aynı eserin bütün varyantları aynı bölümde: test sızıntısı yok.
    const bolum =
      parseInt(createHash("sha256").update(e.id).digest("hex").slice(0, 2), 16) % 5 === 0
        ? ("test" as const)
        : ("gelistirme" as const);
    return varyantlar.map(([varyant, sorgu]) => ({
      id: `${e.id}:${varyant}`,
      eserId: e.id,
      kategori: e.kategori,
      varyant,
      bolum,
      sorgu,
    }));
  });
}

export function veriDogrula(v: BenchmarkVeri) {
  if (v.surum !== 1 || !v.eserler.length || !v.sorgular.length)
    throw Error("Ölçüm kümesi boş/geçersiz");
  const idler = new Set(v.eserler.map((e) => e.id));
  if (idler.size !== v.eserler.length) throw Error("Tekrarlanan eser kimliği");
  const sorgular = new Set<string>();
  const bolumler = new Map<string, string>();
  for (const s of v.sorgular) {
    if (!idler.has(s.eserId) || sorgular.has(s.id)) throw Error("Geçersiz/tekrar sorgu kimliği");
    if (bolumler.has(s.eserId) && bolumler.get(s.eserId) !== s.bolum) throw Error("Test sızıntısı");
    sorgular.add(s.id);
    bolumler.set(s.eserId, s.bolum);
  }
}

export function metrikler(satirlar: { sira: number; sureMs: number; hata?: string }[]) {
  const sureler = satirlar.map((s) => s.sureMs).sort((a, b) => a - b);
  const oran = (n: number) => (satirlar.length ? n / satirlar.length : null);
  const yuzdelik = (p: number) =>
    sureler.length ? sureler[Math.ceil(p * sureler.length) - 1] : null;
  return {
    sorgu: satirlar.length,
    ilkSirada: oran(satirlar.filter((s) => s.sira === 1).length),
    ilkBeste: oran(satirlar.filter((s) => s.sira > 0 && s.sira <= 5).length),
    hata: satirlar.filter((s) => s.hata).length,
    p50Ms: yuzdelik(0.5),
    p95Ms: yuzdelik(0.95),
  };
}

async function main() {
  const arg = (ad: string, varsayilan: string) => {
    const i = process.argv.indexOf(ad);
    return i < 0 ? varsayilan : (process.argv[i + 1] ?? varsayilan);
  };
  const mod = arg("--mode", "replay");
  if (!["replay", "live"].includes(mod)) throw Error("--mode replay veya live olmalı");
  const veri = JSON.parse(
    await fs.readFile(arg("--dataset", "benchmark/pdf-search-v1.json"), "utf8"),
  ) as BenchmarkVeri;
  veriDogrula(veri);
  const cikti = arg("--out", `reports/pdf-benchmark-${mod}.json`);
  const limit = Number(arg("--limit", String(veri.sorgular.length)));
  if (!Number.isInteger(limit) || limit < 1) throw Error("Geçersiz --limit");
  // Canlı örnek kategoriler arasında dengeli seçilir; ilk kategoride takılı kalmaz.
  const kategoriler = [...new Set(veri.sorgular.map((s) => s.kategori))];
  const havuzlar = kategoriler.map((k) =>
    veri.sorgular.filter((s) => s.kategori === k && s.varyant === "baslik-yazar"),
  );
  const canli = Array.from({ length: Math.max(...havuzlar.map((h) => h.length)) }, (_, i) =>
    havuzlar.flatMap((h) => (h[i] ? [h[i]!] : [])),
  ).flat();
  const secilen = (mod === "live" ? canli : veri.sorgular).slice(0, limit);
  // Ayrı önbellek; kullanıcının arama önbelleğine ve sıcaklık varsayımına karışmaz.
  if (mod === "live")
    ayar.cacheDir = path.join(
      ayar.projeKok,
      ".cache",
      `benchmark-${path.basename(cikti, ".json")}-${randomUUID()}`,
    );
  const satirlar: {
    id: string;
    kategori: string;
    bolum: string;
    sira: number;
    sureMs: number;
    pdfAdayi: boolean;
    kaynaklar?: unknown;
    hata?: string;
  }[] = [];
  for (const s of secilen) {
    const hedef = veri.eserler.find((e) => e.id === s.eserId)!.eser;
    const bas = performance.now();
    try {
      const cevap = mod === "live" ? await ara(s.sorgu) : undefined;
      const gruplar =
        cevap?.gruplar ??
        grupla(
          veri.eserler.map((e) => e.eser),
          s.sorgu,
        )
          .sort((a, b) => b.puan - a.puan)
          .slice(0, s.sorgu.limit);
      const i = gruplar.findIndex((g) => hedefMi(g, hedef));
      satirlar.push({
        id: s.id,
        kategori: s.kategori,
        bolum: s.bolum,
        sira: i + 1,
        sureMs: Math.round(performance.now() - bas),
        pdfAdayi: i >= 0 && gruplar[i]!.kaynaklar.some((k) => Boolean(k.pdf)),
        kaynaklar: cevap?.kaynakDurumlari,
      });
    } catch (e) {
      satirlar.push({
        id: s.id,
        kategori: s.kategori,
        bolum: s.bolum,
        sira: 0,
        sureMs: Math.round(performance.now() - bas),
        pdfAdayi: false,
        hata: String(e),
      });
    }
    const rapor = {
      tarih: new Date().toISOString(),
      mod,
      sinir:
        mod === "replay"
          ? "Gerçek üstveriden sabit aday havuzu üzerinde sıralama/gruplama; internetten bulma veya indirme başarısı değildir."
          : "Canlı kaynak araması; PDF aday URL'si dosya/kimlik doğrulaması veya başarılı indirme değildir. Kaynak hataları eksik kapsam demektir.",
      veriSha256: createHash("sha256").update(JSON.stringify(veri)).digest("hex"),
      planlanan: secilen.length,
      tamamlanan: satirlar.length,
      metrikler: metrikler(satirlar),
      kategoriler: Object.fromEntries(
        kategoriler.map((k) => [k, metrikler(satirlar.filter((s) => s.kategori === k))]),
      ),
      bolumler: Object.fromEntries(
        ["gelistirme", "test"].map((b) => [b, metrikler(satirlar.filter((s) => s.bolum === b))]),
      ),
      satirlar,
    };
    if (mod === "live" || satirlar.length === secilen.length) {
      await fs.mkdir(path.dirname(cikti), { recursive: true });
      await fs.writeFile(cikti, JSON.stringify(rapor, null, 2) + "\n");
    }
    if (mod === "live" || satirlar.length % 100 === 0)
      console.log(
        `${satirlar.length}/${secilen.length}: ${s.kategori}, sıra ${satirlar.at(-1)!.sira}`,
      );
  }
  console.log(JSON.stringify(metrikler(satirlar)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
