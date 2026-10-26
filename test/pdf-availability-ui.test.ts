import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { domKur, dom, belge, aramaYap, gorunurKartlar, degistir, tikla } from "./helpers/dom.js";

const group = (id: string, source: Record<string, unknown>, extra = {}) => ({
  anahtar: id,
  tur: "kitap",
  baslik: id,
  yazarlar: ["J. R. R. Tolkien"],
  puan: 1,
  konular: [],
  eslesme: { tur: "tam" },
  kaynaklar: [{ kaynak: id, kaynakAd: id, link: `https://example.org/${id}`, ...source }],
  ...extra,
});
const answer = (gruplar: unknown[]) => ({
  gruplar,
  kaynakDurumlari: [],
  toplamSonuc: gruplar.length,
  gruplamaNotu: "",
});
const visible = () => gorunurKartlar().map((k) => k.dataset.anahtar);
const find = <T extends Element>(id: string) => belge().querySelector<T>(id)!;

beforeEach(async () => {
  await domKur();
  find<HTMLInputElement>("#webDahil").checked = false;
});
afterEach(() => dom.window.close());

function respond(groups: unknown[]) {
  const previous = dom.window.fetch;
  dom.window.fetch = (async (url: string, options?: RequestInit) => {
    const data =
      url === "/api/search"
        ? answer(groups)
        : url === "/api/sayfa-sayisi"
          ? { sonuclar: {} }
          : undefined;
    return data ? { ok: true, json: async () => data } : previous(url, options);
  }) as typeof dom.window.fetch;
}

it("kitapta katalog, ödünç, EPUB, metin ve güvensiz URL yerine gerçek PDF alanını süzer", async () => {
  respond([
    group("pdf", { pdf: "https://example.org/book.pdf" }),
    group("catalog", { erisim: "yonlendir" }),
    group("loan", { erisim: "odunc" }),
    group("epub", { epub: "https://example.org/book.epub" }),
    group("text", { tamMetin: "https://example.org/book.txt" }),
    group("unsafe", { pdf: "javascript:alert(1)" }),
    group("record-candidate", {
      pdfAdaylari: [{ url: "https://example.org/record", baglantiTuru: "kayit" }],
    }),
  ]);
  await aramaYap({ baslik: "Silmarillion" });
  expect(find<HTMLInputElement>("#sadecePdf").checked).toBe(true);
  expect(visible()).toEqual(["pdf"]);
  expect(find("#pdfFiltreOzeti").textContent).toContain("6 kayıt gizlendi");
  tikla("[data-pdf-katalog]");
  expect(visible()).toHaveLength(7);
  expect(find<HTMLInputElement>("#sadecePdf").checked).toBe(false);
  tikla('[data-suzgec="acik"]');
  expect(visible()).toEqual(["pdf", "epub", "text"]);
});

it("aynı eserin herhangi bir kaynağındaki PDF'yi kabul eder ve diğer kaynak filtreleriyle birlikte çalışır", async () => {
  respond([
    group(
      "merged",
      {},
      {
        kaynaklar: [
          { kaynak: "catalog", kaynakAd: "Catalog", link: "https://example.org/catalog" },
          {
            kaynak: "repo",
            kaynakAd: "Repository",
            link: "https://example.org/repo",
            pdf: "https://example.org/file.pdf",
          },
        ],
      },
    ),
    group("only-catalog", {}),
  ]);
  await aramaYap({ baslik: "Silmarillion" });
  expect(visible()).toEqual(["merged"]);
  degistir("#kaynakSecim", "catalog");
  expect(visible()).toEqual(["merged"]);
});

it("PDF yokken kitabın hiç bulunmadığını söylemez; katalog seçeneği kayıtları geri getirir", async () => {
  respond([group("Silmarillion", { erisim: "odunc" })]);
  await aramaYap({ baslik: "Silmarillion" });
  expect(visible()).toEqual([]);
  expect(find("#bos").textContent).toContain("PDF bağlantısı bulunamadı");
  expect(find("#bos").textContent).not.toContain("Sonuç bulunamadı");
  tikla("[data-pdf-katalog]");
  expect(visible()).toEqual(["Silmarillion"]);
});

it("yalnızca ilgili araştırmanın PDF'si bulunduğunda kitabın PDF'si gibi sunmaz", async () => {
  respond([
    group("Silmarillion", {}),
    group(
      "Morgoth study",
      { pdf: "https://example.org/study.pdf" },
      { eslesme: { tur: "ilgili" } },
    ),
  ]);
  await aramaYap({ baslik: "Silmarillion" });
  expect(visible()).toEqual(["Morgoth study"]);
  expect(find("#pdfFiltreOzeti").textContent).toContain("ilgili çalışmalar olabilir");
});

it("makale aramasında kitap PDF tercihi katalogları gizlemez", async () => {
  respond([group("Article", {}, { tur: "makale" })]);
  find<HTMLInputElement>("input[name=tur][value=makale]").checked = true;
  find("#aramaForm").dispatchEvent(new dom.window.Event("change"));
  await aramaYap({ baslik: "Article" });
  expect(visible()).toEqual(["Article"]);
  expect(find<HTMLInputElement>("#sadecePdf").disabled).toBe(true);
});

it("erken katalog kartına sonradan PDF gelirse akışta görünür hale getirir", async () => {
  Object.assign(dom.window, { TextDecoder });
  const previous = dom.window.fetch;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  dom.window.fetch = (async (url: string, options: RequestInit) => {
    if (url !== "/api/search") return previous(url, options);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
        },
      }),
      {
        headers: { "content-type": "application/x-ndjson" },
      },
    );
  }) as typeof dom.window.fetch;
  await aramaYap({ baslik: "Silmarillion" }, 10);
  const encoder = new TextEncoder();
  controller!.enqueue(
    encoder.encode(
      JSON.stringify({ cevap: { ...answer([group("same", {})]), tamamlandi: false } }) + "\n",
    ),
  );
  await vi.waitFor(() => expect(belge().querySelectorAll(".kart")).toHaveLength(1));
  expect(visible()).toEqual([]);
  controller!.enqueue(
    encoder.encode(
      JSON.stringify({
        cevap: {
          ...answer([group("same", { pdf: "https://example.org/book.pdf" })]),
          tamamlandi: true,
        },
      }) + "\n",
    ),
  );
  controller!.close();
  await vi.waitFor(() => expect(visible()).toEqual(["same"]));
  expect(find("#pdfFiltreOzeti").classList.contains("gizli")).toBe(true);
});
