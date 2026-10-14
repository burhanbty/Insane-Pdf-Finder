import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ayar } from "../src/config.js";
import { indir } from "../src/download.js";

const oncekiDizin = ayar.downloadsDir;
let dizin: string;
beforeEach(async () => {
  dizin = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-download-test-"));
  ayar.downloadsDir = dizin;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  ayar.downloadsDir = oncekiDizin;
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(dizin));
  if (
    !relative.startsWith("kaynak-bul-download-test-") ||
    relative.includes("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Geçici test dizini sınır dışında");
  }
  await fs.rm(dizin, { recursive: true, force: true });
});

describe("indirme dosyalarının izolasyonu", () => {
  it("HTML hata sayfasını PDF adıyla kaydetmez", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>Login required</html>", {
            headers: { "content-type": "application/pdf" },
          }),
      ),
    );
    await expect(
      indir({ url: "https://file.test/paper.pdf", varsayilanAd: "paper" }, "pdf"),
    ).rejects.toThrow("PDF yerine");
    expect(await fs.readdir(dizin)).toEqual([]);
  });
  it("imzası birden fazla parçaya bölünen PDF'i korur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode("%P"));
                c.enqueue(new TextEncoder().encode("DF-1.4\nrest"));
                c.close();
              },
            }),
          ),
      ),
    );
    const s = await indir({ url: "https://file.test/doc", varsayilanAd: "paper" }, "pdf");
    expect(s.dosya).toBe("paper.pdf");
    expect(await fs.readFile(s.yol, "utf8")).toBe("%PDF-1.4\nrest");
  });
  it("ZIP arşivini EPUB gibi sunmaz ve kısa gövdede temiz hata verir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("PK")),
    );
    await expect(
      indir({ url: "https://file.test/book", varsayilanAd: "book" }, "epub"),
    ).rejects.toThrow("EPUB");
    expect(await fs.readdir(dizin)).toEqual([]);
  });
  it("EPUB mimetype imzasını doğrular ve doğru uzantıyla kaydeder", async () => {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(8, 26);
    const b = Buffer.concat([header, Buffer.from("mimetypeapplication/epub+zip")]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(b)),
    );
    const s = await indir({ url: "https://file.test/book", varsayilanAd: "book" }, "epub");
    expect(s.dosya).toBe("book.epub");
    expect(s.tur).toBe("epub");
  });
  it("aynı adlı üç eşzamanlı indirmeyi ayrı dosyalara, tam içerikle yazar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const icerik = `contents:${url}`;
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode(icerik.slice(0, 8)));
              setTimeout(() => {
                c.enqueue(new TextEncoder().encode(icerik.slice(8)));
                c.close();
              }, 100);
            },
          }),
          { headers: { "content-type": "text/plain" } },
        );
      }),
    );
    const urls = ["https://first.test/a", "https://second.test/b", "https://third.test/c"];
    const sonuc = await Promise.all(
      urls.map((url) => indir({ url, varsayilanAd: "same title" }, "metin")),
    );
    expect(new Set(sonuc.map((s) => s.dosya)).size).toBe(3);
    expect(await Promise.all(sonuc.map((s) => fs.readFile(s.yol, "utf8")))).toEqual(
      urls.map((u) => `contents:${u}`),
    );
    expect((await fs.readdir(dizin)).some((d) => d.endsWith(".part"))).toBe(false);
  });

  it("mevcut dosyayı ve devam eden indirme rezervasyonunu korur", async () => {
    await fs.writeFile(path.join(dizin, "same.txt"), "existing");
    await fs.writeFile(path.join(dizin, "same_2.txt.part"), "in-progress");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("new")),
    );
    const s = await indir({ url: "https://existing.test/file", varsayilanAd: "same" }, "metin");
    expect(s.dosya).toBe("same_3.txt");
    expect(await fs.readFile(path.join(dizin, "same.txt"), "utf8")).toBe("existing");
    expect(await fs.readFile(path.join(dizin, "same_2.txt.part"), "utf8")).toBe("in-progress");
  });

  it("yarıda kesilen gövdenin geçici dosyasını temizler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode("partial"));
                setTimeout(() => c.error(new Error("connection lost")), 30);
              },
            }),
          ),
      ),
    );
    await expect(
      indir({ url: "https://broken.test/file", varsayilanAd: "broken" }, "metin"),
    ).rejects.toThrow("connection lost");
    expect(await fs.readdir(dizin)).toEqual([]);
  });

  it("rename başarısız olduğunda geçici dosyayı temizler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("complete")),
    );
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename failed"));
    try {
      await expect(
        indir({ url: "https://rename.test/file", varsayilanAd: "broken" }, "metin"),
      ).rejects.toThrow("rename failed");
      expect(await fs.readdir(dizin)).toEqual([]);
    } finally {
      rename.mockRestore();
    }
  });
});
