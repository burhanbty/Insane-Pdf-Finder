import { describe, expect, it, vi } from "vitest";
import libgen from "../src/sources/libgen.js";
import annasArchive from "../src/sources/annas-archive.js";

describe("libgen kaynak modülü", () => {
  it("modül tanımı geçerlidir", () => {
    expect(libgen.id).toBe("libgen");
    expect(libgen.ad).toBe("Library Genesis");
    expect(libgen.tur).toEqual(["kitap", "makale"]);
    expect(typeof libgen.ara).toBe("function");
  });

  it("boş başlıkta boş dizi döner", async () => {
    const sonuclar = await libgen.ara({
      baslik: "   ",
      tur: "kitap",
      limit: 10,
    });
    expect(sonuclar).toEqual([]);
  });

  it("örnek libgen HTML çıktısını doğru çözümler", async () => {
    const mockHtml = `
      <html>
        <body>
          <table>
            <tr>
              <td><a href="edition.php?id=123">Clean Code: A Handbook of Agile Software Craftsmanship</a></td>
              <td><a href="/author/1">Robert C. Martin</a></td>
              <td>Prentice Hall</td>
              <td>2008</td>
              <td>English</td>
              <td>464</td>
              <td>12 MB</td>
              <td>pdf</td>
              <td><a href="file.php?id=999">ads.php?md5=0123456789abcdef0123456789abcdef</a></td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockHtml,
    } as unknown as Response);

    try {
      const sonuclar = await libgen.ara({
        baslik: "Clean Code",
        tur: "kitap",
        limit: 10,
      });

      expect(sonuclar).toHaveLength(1);
      const k = sonuclar[0]!;
      expect(k.kaynak).toBe("libgen");
      expect(k.baslik).toBe("Clean Code: A Handbook of Agile Software Craftsmanship");
      expect(k.yazarlar).toEqual(["Robert C. Martin"]);
      expect(k.yil).toBe(2008);
      expect(k.yayinci).toBe("Prentice Hall");
      expect(k.dil).toBe("English");
      expect(k.sayfaSayisi).toBe(464);
      expect(k.erisim).toBe("yonlendir");
      expect(k.link).toContain("0123456789abcdef0123456789abcdef");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("yıl filtresi belirtildiğinde farklı yılı eler", async () => {
    const mockHtml = `
      <html>
        <body>
          <table>
            <tr>
              <td><a href="edition.php?id=1">Kitap A</a></td>
              <td>Yazar</td>
              <td>Yayınevi</td>
              <td>2010</td>
              <td>tr</td>
              <td>100</td>
              <td>1 MB</td>
              <td>pdf</td>
              <td><a href="file.php?id=1">ads.php?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</a></td>
            </tr>
            <tr>
              <td><a href="edition.php?id=2">Kitap B</a></td>
              <td>Yazar</td>
              <td>Yayınevi</td>
              <td>2020</td>
              <td>tr</td>
              <td>200</td>
              <td>2 MB</td>
              <td>pdf</td>
              <td><a href="file.php?id=2">ads.php?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</a></td>
            </tr>
          </table>
        </body>
      </html>
    `;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockHtml,
    } as unknown as Response);

    try {
      const sonuclar = await libgen.ara({
        baslik: "Kitap",
        yil: 2020,
        tur: "kitap",
        limit: 10,
      });

      expect(sonuclar).toHaveLength(1);
      expect(sonuclar[0]!.baslik).toBe("Kitap B");
      expect(sonuclar[0]!.yil).toBe(2020);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("annas-archive kaynak modülü", () => {
  it("modül tanımı geçerlidir", () => {
    expect(annasArchive.id).toBe("annas-archive");
    expect(annasArchive.ad).toBe("Anna's Archive");
    expect(annasArchive.tur).toEqual(["kitap", "makale"]);
    expect(typeof annasArchive.ara).toBe("function");
  });

  it("boş başlıkta boş dizi döner", async () => {
    const sonuclar = await annasArchive.ara({
      baslik: "   ",
      tur: "kitap",
      limit: 10,
    });
    expect(sonuclar).toEqual([]);
  });

  it("örnek Anna's Archive HTML çıktısını doğru çözümler", async () => {
    const mockHtml = `
      <html>
        <body>
          <div class="flex pt-3 pb-3">
            <a href="/md5/fedcba9876543210fedcba9876543210" class="js-vim-focus">The Pragmatic Programmer</a>
            <div class="text-gray-800 font-semibold">
              English [en] · PDF · 5.2MB · 1999 · Book
            </div>
            <a><span class="mdi--user-edit"></span> Andrew Hunt; David Thomas</a>
            <a><span class="mdi--company"></span> Addison-Wesley</a>
            <div class="text-gray-600">Klasik yazılım geliştirme kitabı.</div>
          </div>
        </body>
      </html>
    `;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockHtml,
    } as unknown as Response);

    try {
      const sonuclar = await annasArchive.ara({
        baslik: "Pragmatic Programmer",
        tur: "kitap",
        limit: 10,
      });

      expect(sonuclar).toHaveLength(1);
      const k = sonuclar[0]!;
      expect(k.kaynak).toBe("annas-archive");
      expect(k.baslik).toBe("The Pragmatic Programmer");
      expect(k.yazarlar).toEqual(["Andrew Hunt", "David Thomas"]);
      expect(k.yil).toBe(1999);
      expect(k.yayinci).toBe("Addison-Wesley");
      expect(k.dil).toBe("en");
      expect(k.erisim).toBe("yonlendir");
      expect(k.link).toContain("fedcba9876543210fedcba9876543210");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gerçek boş sonuç durumunu doğru anlar", async () => {
    const mockHtml = `
      <html>
        <body>
          <div>No results were found</div>
        </body>
      </html>
    `;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => mockHtml,
    } as unknown as Response);

    try {
      const sonuclar = await annasArchive.ara({
        baslik: "Hiç Olmayan Kitap 123456",
        tur: "kitap",
        limit: 10,
      });

      expect(sonuclar).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
