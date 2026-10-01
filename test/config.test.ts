import { describe, expect, it, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { ayar } from "../src/config.js";
import { kayitTemizle, kaynaklariYukle } from "../src/registry.js";
import type { SourceModule } from "../src/types.js";

/*
 * Bu dosya, "0 ham kayit, 0 birlesek sonuc / 1 kaynak sorgulandi"
 * goruntusunun neden ortaya ciktigini koruyor.
 *
 * Sebep: yollar process.cwd()'ye gore cozuluyordu. Sunucu proje
 * klasorunden degil baska bir klasorden baslatildiginda
 * src/sources bulunamaz, kayit defteri bos donuyor ve arama sessizce
 * 0 sonuc veriyordu.
 */

describe("proje yollari", () => {
  it("kaynak klasoru kodun konumuna gore cozulur", () => {
    expect(ayar.sourcesDir).toBe(path.join(ayar.projeKok, "src", "sources"));
  });

  it("kaynak klasoru gercekten var", () => {
    // Asil regresyon kontrolu: yanlis cozumlenmis yol burada patlar.
    expect(fs.existsSync(ayar.sourcesDir), `kaynak klasoru yok: ${ayar.sourcesDir}`).toBe(true);
  });

  it("public ve downloads klasorleri de proje kokunden cozulur", () => {
    expect(ayar.publicDir).toBe(path.join(ayar.projeKok, "public"));
    expect(ayar.downloadsDir).toBe(path.join(ayar.projeKok, "downloads"));
  });
});

describe("kaynak kayit defteri", () => {
  let kaynaklar: SourceModule[];

  beforeEach(async () => {
    kayitTemizle();
    kaynaklar = await kaynaklariYukle();
  });

  afterEach(() => {
    kayitTemizle();
  });

  it("kaynak dosyalarini bulur", () => {
    // Bos liste, ekranda gordugumuz "1 kaynak sorgulandi / 0 sonuc"
    // durumunun kaynagiydi.
    expect(kaynaklar.length).toBeGreaterThan(0);
  });

  it("her kaynagin gecerli kimligi var", () => {
    for (const k of kaynaklar) {
      expect(k.id, "id eksik").toBeTruthy();
      expect(k.ad, "ad eksik").toBeTruthy();
      expect(Array.isArray(k.tur), "tur dizi degil").toBe(true);
      expect(k.tur.length, "tur bos").toBeGreaterThan(0);
      expect(typeof k.ara, "ara fonksiyonu degil").toBe("function");
    }
  });

  it("kimlikler benzersiz", () => {
    const idler = kaynaklar.map((k) => k.id);
    expect(new Set(idler).size, `tekrar eden id: ${idler.join(", ")}`).toBe(idler.length);
  });

  it("bilinen kaynaklar yuklenmis", () => {
    const idler = new Set(kaynaklar.map((k) => k.id));
    for (const beklenen of ["open-library", "internet-archive", "arxiv", "crossref", "openalex"]) {
      expect(idler.has(beklenen), `"${beklenen}" kaynagi yuklenmiadi`).toBe(true);
    }
  });
});

describe("arama kaynak yokken sessizce bos donmez", () => {
  it("kayit defteri bosken acik hata firlatir", async () => {
    // Bu, ekranda gordugumuz "0 ham kayit / 0 birlesek sonuc" tablosunun
    // donusumudur. Program artik nedenini soylemeli.
    const { ara } = await import("../src/search.js");

    const eskiDir = ayar.sourcesDir;
    (ayar as { sourcesDir: string }).sourcesDir = path.join(ayar.projeKok, "yok-boyle-bir-klasor");
    kayitTemizle();

    try {
      await expect(ara({ baslik: "Sapiens", tur: "kitap", limit: 5 })).rejects.toThrow(/kaynak/i);
    } finally {
      (ayar as { sourcesDir: string }).sourcesDir = eskiDir;
      kayitTemizle();
      await kaynaklariYukle();
    }
  });
});