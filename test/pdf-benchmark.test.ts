import { expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  hedefMi,
  metrikler,
  sorgulariUret,
  veriDogrula,
  type BenchmarkVeri,
} from "../scripts/pdf-benchmark.js";
it("500 sorgu gerçek kanıtlı 100 esere bağlıdır ve aynı eser test/geliştirmeye bölünmez", async () => {
  const veri = JSON.parse(
    await fs.readFile(new URL("../benchmark/pdf-search-v1.json", import.meta.url), "utf8"),
  ) as BenchmarkVeri;
  expect(veri.eserler).toHaveLength(100);
  expect(veri.sorgular).toHaveLength(500);
  veriDogrula(veri);
  expect(sorgulariUret(veri.eserler)).toEqual(veri.sorgular);
  expect(new Set(veri.sorgular.map((s) => JSON.stringify(s.sorgu))).size).toBe(500);
  expect(veri.sorgular.some((s) => s.bolum === "test")).toBe(true);
  for (const eser of veri.eserler) {
    expect(eser.kanit.url).toMatch(/^https:\/\//);
    expect(Number.isFinite(Date.parse(eser.kanit.alindi))).toBe(true);
  }
});
it("oracle yüksek puanı kimlik kanıtı saymaz; boş örneklemin oranını sıfır diye uydurmaz", () => {
  const w = {
    kaynak: "x",
    kaynakAd: "X",
    tur: "kitap" as const,
    baslik: "Target",
    yazarlar: [],
    link: "https://source.org/target",
  };
  const grup = {
    anahtar: "x",
    tur: "kitap" as const,
    baslik: "Target",
    yazarlar: [],
    konular: [],
    puan: 1,
    kaynaklar: [{ ...w, link: "https://source.org/wrong" }],
  };
  expect(hedefMi(grup, w)).toBe(false);
  expect(metrikler([]).ilkSirada).toBeNull();
  expect(
    metrikler([
      { sira: 1, sureMs: 1 },
      { sira: 4, sureMs: 5 },
      { sira: 0, sureMs: 10, hata: "network" },
    ]),
  ).toMatchObject({ ilkSirada: 1 / 3, ilkBeste: 2 / 3, hata: 1, p95Ms: 10 });
});
