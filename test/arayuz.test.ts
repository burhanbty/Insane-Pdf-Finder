/*
 * index.html ile app.js arasindaki id tutarliligini denetler.
 * Bu test, "Cannot read properties of null" gibi hatalarin kaynagini
 * (yanlis yazilmis/boşluklu id) yakalamak icin var.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const kok = process.cwd();

async function oku(dosya: string): Promise<string> {
  return fs.readFile(path.join(kok, dosya), "utf8");
}

describe("arayuz id tutarliligi", () => {
  it("app.js'teki her sorgu index.html'de karsilik bulur", async () => {
    const [html, js] = await Promise.all([oku("public/index.html"), oku("public/app.js")]);

    const htmlIdleri = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));

    const sorgular = [
      ...[...js.matchAll(/\$\("#([^"]+)"\)/g)].map((m) => m[1]!),
      ...[...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]!),
    ];

    const eksikler = sorgular.filter((s) => !htmlIdleri.has(s));
    expect(eksikler, `index.html'de olmayan id'ler: ${eksikler.join(", ")}`).toEqual([]);
  });

  it("index.html'de bosluklu id bulunmaz", async () => {
    const html = await oku("public/index.html");
    // "id=\"web Dahil\"" gibi yazimlar gecersiz CSS secicisi uretir ve
    // querySelector her zaman null doner.
    const boşluklu = [...html.matchAll(/\bid="([^"]*\s[^"]*)"/g)].map((m) => m[1]!);
    expect(boşluklu, `Boşluk içeren id'ler: ${boşluklu.join(", ")}`).toEqual([]);
  });

  it("id degerleri CSS secicisi olarak gecerlidir", async () => {
    const html = await oku("public/index.html");
    const idler = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!);

    // querySelector("#" + id) yazildiginda guvenli olmasi icin
    // ozel karakter ve bosluk icermemeli.
    const gecersiz = idler.filter((i) => /[\s.:#[\]>~+*()]/.test(i));
    expect(gecersiz, `Geçersiz id'ler: ${gecersiz.join(", ")}`).toEqual([]);
  });
});
