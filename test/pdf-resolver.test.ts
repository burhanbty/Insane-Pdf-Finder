import { afterEach, expect, it, vi } from "vitest";
import { pdfYanitiniBul, sayfadakiPdfler } from "../src/pdf-resolver.js";

afterEach(() => vi.unstubAllGlobals());
it("göreli künye PDF adresini ve HTML karakterlerini çözer", () => {
  expect(
    sayfadakiPdfler(
      '<META content="../paper.pdf?a=1&amp;b=2" NAME="citation_pdf_url">',
      "https://journal.test/record/1",
    ),
  ).toEqual(["https://journal.test/paper.pdf?a=1&b=2"]);
});
it("yönlenen son sayfanın adresine göre alternatif PDF'i bulur", async () => {
  const f = vi.fn(async (url: URL) => {
    if (String(url).endsWith("/redirect"))
      return new Response(null, { status: 302, headers: { location: "/article/1" } });
    if (String(url).endsWith("/article/1")) {
      const r = new Response('<link rel="alternate" type="application/pdf" href="paper.pdf">');
      Object.defineProperty(r, "url", { value: "https://journal.test/article/1" });
      return r;
    }
    return new Response("%PDF-1.4\nbody");
  });
  vi.stubGlobal("fetch", f);
  expect(await (await pdfYanitiniBul(["https://journal.test/redirect"])).text()).toBe(
    "%PDF-1.4\nbody",
  );
  expect(f.mock.calls.map(([u]) => String(u))).toContain("https://journal.test/article/paper.pdf");
});
it("PDF imzası parçalı gelse de başlangıç baytlarını kaybetmez", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("%P"));
              c.enqueue(new TextEncoder().encode("DF-1.7\nwhole file"));
              c.close();
            },
          }),
        ),
    ),
  );
  expect(await (await pdfYanitiniBul(["https://split.test/file"])).text()).toBe(
    "%PDF-1.7\nwhole file",
  );
});
it("bozuk ilk kaynaktan sonra ikinci PDF adayını dener", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (u: URL) =>
        new Response(String(u).includes("bad") ? "<html>missing file</html>" : "%PDF-1.4\nok"),
    ),
  );
  expect(
    await (await pdfYanitiniBul(["https://bad.test/a", "https://good.test/b"])).text(),
  ).toContain("%PDF-");
});
it("script ve yorum içindeki sahte meta ile kaynakçadaki PDF'i takip etmez", () => {
  expect(
    sayfadakiPdfler(
      '<!-- <meta name="citation_pdf_url" content="wrong.pdf"> --><script>"<meta name=\'citation_pdf_url\' content=\'wrong.pdf\'>"</script><a href="reference.pdf">A cited paper</a>',
      "https://safe.test/",
    ),
  ).toEqual([]);
});
it("tek açık PDF bağlantısını kabul eder; birden fazla belirsiz dosyayı seçmez", () => {
  expect(sayfadakiPdfler('<a href="full.pdf">Download PDF</a>', "https://site.test/")).toEqual([
    "https://site.test/full.pdf",
  ]);
  expect(
    sayfadakiPdfler('<a href="one.pdf">PDF</a><a href="two.pdf">PDF</a>', "https://site.test/"),
  ).toEqual([]);
});
it("sayfadaki özel IP, URL kimlik bilgisi ve javascript adresini engeller", () => {
  for (const href of [
    "http://127.0.0.1/file.pdf",
    "http://169.254.169.254/file.pdf",
    "https://user:pass@public.test/file.pdf",
    "javascript:alert(1)",
  ])
    expect(
      sayfadakiPdfler(`<meta name="citation_pdf_url" content="${href}">`, "https://site.test/"),
    ).toEqual([]);
});
it("PDF yönlendirmesi özel ağa giderse ikinci adresi çağırmaz", async () => {
  const f = vi.fn(
    async () =>
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
  );
  vi.stubGlobal("fetch", f);
  await expect(pdfYanitiniBul(["https://blocked.test/paper"])).rejects.toThrow("engellendi");
  expect(f).toHaveBeenCalledTimes(1);
});
it("döngülü sayfayı tekrar çağırmaz ve indirme yoksa anlaşılır hata verir", async () => {
  const f = vi.fn(async () => new Response('<meta name="citation_pdf_url" content="/article">'));
  vi.stubGlobal("fetch", f);
  await expect(pdfYanitiniBul(["https://cycle.test/article"])).rejects.toThrow(
    "doğrudan PDF bağlantısı bulunamadı",
  );
  expect(f).toHaveBeenCalledTimes(1);
});
it("HTML sayfasını sınırsız belleğe almaz", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>" + "x".repeat(2 * 1024 * 1024))),
  );
  await expect(pdfYanitiniBul(["https://big.test/article"])).rejects.toThrow("boyut sınırını");
});
it("erişim reddini PDF bulunamadı şeklinde gizlemez", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("forbidden", { status: 403 })),
  );
  await expect(pdfYanitiniBul(["https://denied.test/file.pdf"])).rejects.toThrow("HTTP 403");
});
