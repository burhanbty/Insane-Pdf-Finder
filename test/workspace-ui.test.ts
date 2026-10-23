import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";

let dom: JSDOM;
let d: Document;
const eser = (baslik = "Book <example>") => ({
  anahtar: baslik,
  tur: "kitap",
  baslik,
  yazarlar: ["Jane Doe"],
  yil: 2024,
  konular: [],
  puan: 1,
  kaynaklar: [
    {
      kaynak: "example",
      kaynakAd: "Example",
      link: "https://example.com/book",
      doi: "10.1000/test",
    },
  ],
});
const kayit = (id = "one", extra: Record<string, unknown> = {}) => ({
  id,
  eser: eser(),
  koleksiyon: "Thesis",
  durum: "okunacak",
  notlar: "Private personal note",
  arsiv: false,
  ...extra,
});
const calls: { url: string; body?: Record<string, unknown> }[] = [];
async function kur(handler: (url: string, body?: Record<string, unknown>) => unknown) {
  calls.length = 0;
  dom = new JSDOM(await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8"), {
    url: "http://127.0.0.1:3000",
    runScripts: "outside-only",
  });
  d = dom.window.document;
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "showModal", {
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "close", {
    value() {
      this.open = false;
    },
  });
  dom.window.fetch = (async (url: string, opts?: { body?: string }) => {
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url, body });
    const v = (
      url === "/api/download-jobs" && !body ? { isler: [] } : await handler(url, body)
    ) as Record<string, unknown>;
    return { ok: !v.hata, json: async () => v };
  }) as typeof dom.window.fetch;
  dom.window.eval(
    await fs.readFile(new URL("../public/download-manager.js", import.meta.url), "utf8"),
  );
  const js = await fs.readFile(new URL("../public/workspace.js", import.meta.url), "utf8");
  dom.window.eval(`globalThis.__workspace = (async () => {\n${js}\n})();`);
  await (dom.window as unknown as { __workspace: Promise<void> }).__workspace;
}
const click = (s: string) => (d.querySelector(s) as HTMLElement).click();
const change = (s: string, value: string) => {
  const el = d.querySelector<HTMLInputElement>(s)!;
  el.value = value;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
};
const state = (kitaplik: unknown[] = [], aramalar: unknown[] = []) => ({
  surum: 1,
  kitaplik,
  aramalar,
});
afterEach(() => {
  dom?.window.close();
  vi.restoreAllMocks();
});

it("filtreye uymayan kitaplar için ilk kullanım yerine filtreyi değiştirme önerisi verir", async () => {
  await kur(() => state([kayit()]));
  const input = d.querySelector<HTMLInputElement>("#kitaplikAra")!;
  input.value = "eşleşmeyen kitap";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  expect(d.querySelector(".kitaplik-bos")?.textContent).toContain("filtrelerini değiştirebilirsin");
  expect(d.querySelector(".kitaplik-bos a")).toBeNull();
});

it("ISBN kaydı formu doldurur ve otomatik arama başlatmadan kitaplığa kaydedilebilir", async () => {
  await kur((url) =>
    url === "/api/isbn"
      ? { eser: eser("C Programming"), isbn: "9780131103627", baski: "Second edition" }
      : url.endsWith("/items")
        ? { eklendi: true }
        : state(),
  );
  change("#isbnGirdi", "0-13-110362-8");
  click("#isbnBul");
  await vi.waitFor(() =>
    expect((d.querySelector("#baslik") as HTMLInputElement).value).toBe("C Programming"),
  );
  expect(d.querySelector("#isbnSonuc")?.textContent).toContain("Second edition");
  expect(calls.some((c) => c.url === "/api/search")).toBe(false);
  click("#isbnKaydet");
  await vi.waitFor(() =>
    expect(calls.find((c) => c.url.endsWith("/items"))?.body?.eser).toMatchObject({
      baslik: "C Programming",
    }),
  );
});

it("kaydedilmiş kitap doğrudan indirilebilir; kişisel notlar indirme isteğine eklenmez", async () => {
  const g = eser();
  Object.assign(g.kaynaklar[0]!, { pdf: "https://example.com/book.pdf" });
  await kur((yol) =>
    yol === "/api/download-jobs"
      ? { is: { id: "job", baslik: "Book", durum: "tamamlandi", dosya: "book.pdf", alinan: 42 } }
      : state([kayit("one", { eser: g })]),
  );
  const downloads: string[] = [];
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.getAttribute("href")!);
  };
  click('[data-alan="indir"]');
  await vi.waitFor(() =>
    expect(d.querySelector(".indirme-icerik a")?.getAttribute("download")).toBe("book.pdf"),
  );
  const istek = calls.find((c) => c.url === "/api/download-jobs" && c.body)?.body;
  expect(istek).toEqual({
    url: "https://example.com/book.pdf",
    tur: "pdf",
    baslik: g.baslik,
    alternatifler: ["https://example.com/book"],
    kimlik: { baslik: g.baslik, yazarlar: ["Jane Doe"], doi: "10.1000/test" },
  });
  expect(downloads).toEqual(["/api/downloads/book.pdf"]);
});
it("ISBN alanı değişirse eski katalog yanıtı formun üzerine yazılmaz", async () => {
  let resolve!: (v: unknown) => void;
  const pending = new Promise((r) => {
    resolve = r;
  });
  await kur((url) => (url === "/api/isbn" ? pending : state()));
  change("#isbnGirdi", "9780131103627");
  click("#isbnBul");
  const input = d.querySelector<HTMLInputElement>("#isbnGirdi")!;
  input.value = "9780306406157";
  input.dispatchEvent(new dom.window.Event("input"));
  resolve({ eser: eser("Stale title"), isbn: "9780131103627" });
  await new Promise((r) => setTimeout(r, 0));
  expect((d.querySelector("#baslik") as HTMLInputElement).value).toBe("");
  expect(d.querySelector("#isbnKaydet")?.classList.contains("gizli")).toBe(true);
});
it("ders listesi önizlenir; değişiklik olursa tekrar önizleme gerekir", async () => {
  await kur((url) => (url.endsWith("/course-list") ? { yeniArama: 2, mevcut: 0 } : state()));
  change("#dersAdi", "CENG 201");
  change("#dersKitaplari", "Book | Writer | 2024");
  click("#dersOnizle");
  await vi.waitFor(() =>
    expect((d.querySelector("#dersKaydet") as HTMLButtonElement).disabled).toBe(false),
  );
  expect(calls.find((c) => c.url.endsWith("/course-list"))?.body?.onizleme).toBe(true);
  const input = d.querySelector<HTMLInputElement>("#dersAdi")!;
  input.value = "Changed";
  input.dispatchEvent(new dom.window.Event("input"));
  expect((d.querySelector("#dersKaydet") as HTMLButtonElement).disabled).toBe(true);
  click("#dersOnizle");
  await vi.waitFor(() =>
    expect((d.querySelector("#dersKaydet") as HTMLButtonElement).disabled).toBe(false),
  );
  click("#dersKaydet");
  await vi.waitFor(() =>
    expect(d.querySelector("#dersSonuc")?.textContent).toContain("kaydedildi"),
  );
  expect(calls.filter((c) => c.url.endsWith("/course-list")).at(-1)?.body?.onizleme).toBe(false);
});

it("not ve başlıkları HTML olarak çalıştırmaz; kaynak bağlantısı güvenlidir", async () => {
  await kur(() =>
    state([
      kayit("one", {
        notlar: '<img src=x onerror="alert(1)">',
        eser: { ...eser(), kaynaklar: [{ link: "javascript:alert(1)" }] },
      }),
    ]),
  );
  expect(d.querySelector(".kitaplik-karti h3")?.textContent).toBe("Book <example>");
  expect(d.querySelector(".kitaplik-karti img")).toBeNull();
  expect(d.querySelector(".kitaplik-karti a")).toBeNull();
  expect(d.querySelector(".kitaplik-notu")?.textContent).toContain("<img");
});
it("koleksiyon, okuma durumu, not araması ve arşiv filtresi birlikte çalışır", async () => {
  await kur(() =>
    state([
      kayit(),
      kayit("two", { durum: "okundu", koleksiyon: "Other", eser: eser("Second") }),
      kayit("three", { arsiv: true }),
    ]),
  );
  expect(d.querySelectorAll(".kitaplik-karti")).toHaveLength(2);
  change("#koleksiyonFiltre", "Other");
  expect(d.querySelectorAll(".kitaplik-karti")).toHaveLength(1);
  change("#okumaFiltre", "okunacak");
  expect(d.querySelectorAll(".kitaplik-karti")).toHaveLength(0);
  change("#koleksiyonFiltre", "");
  change("#okumaFiltre", "arsiv");
  expect(d.querySelector(".kitaplik-karti")?.getAttribute("data-kayit")).toBe("three");
  change("#okumaFiltre", "");
  const input = d.querySelector<HTMLInputElement>("#kitaplikAra")!;
  input.value = "personal";
  input.dispatchEvent(new dom.window.Event("input"));
  expect(d.querySelectorAll(".kitaplik-karti")).toHaveLength(2);
});
it("not ve okuma durumu API'ye kaydedilir; modal başarıda kapanır", async () => {
  let k = kayit();
  await kur((url, body) => {
    if (url.endsWith("/items/one")) {
      k = { ...k, ...body };
      return k;
    }
    return state([k]);
  });
  click('[data-alan="duzenle"]');
  expect((d.querySelector("#kayitDialog") as HTMLDialogElement).open).toBe(true);
  change("#kayitKoleksiyon", "New Collection");
  change("#kayitDurum", "okundu");
  change("#kayitNotlar", "Saved note");
  d.querySelector("#kayitForm")!.dispatchEvent(
    new dom.window.Event("submit", { cancelable: true }),
  );
  await vi.waitFor(() => expect(d.querySelector(".kitaplik-notu")?.textContent).toBe("Saved note"));
  expect(calls.find((c) => c.url.endsWith("/items/one"))?.body).toMatchObject({
    koleksiyon: "New Collection",
    durum: "okundu",
    notlar: "Saved note",
  });
  expect((d.querySelector("#kayitDialog") as HTMLDialogElement).open).toBe(false);
});
it("başarısız not kaydında editör ve yazılan metin korunur", async () => {
  await kur((url) => (url.endsWith("/items/one") ? { hata: "Disk full" } : state([kayit()])));
  click('[data-alan="duzenle"]');
  change("#kayitNotlar", "Unsaved important text");
  d.querySelector("#kayitForm")!.dispatchEvent(
    new dom.window.Event("submit", { cancelable: true }),
  );
  await vi.waitFor(() => expect(d.querySelector("#kayitHata")?.textContent).toBe("Disk full"));
  expect((d.querySelector("#kayitNotlar") as HTMLInputElement).value).toBe(
    "Unsaved important text",
  );
  expect((d.querySelector("#kayitDialog") as HTMLDialogElement).open).toBe(true);
});
it("arşivleme ve geri alma bir kaydı silmeden uygulanır", async () => {
  let k = kayit();
  await kur((url, body) => {
    if (url.endsWith("/items/one")) {
      k = { ...k, ...body };
      return k;
    }
    return state([k]);
  });
  click('[data-alan="arsiv"]');
  await vi.waitFor(() => expect(d.querySelectorAll(".kitaplik-karti")).toHaveLength(0));
  change("#okumaFiltre", "arsiv");
  expect(d.querySelector(".kitaplik-notu")?.textContent).toBe("Private personal note");
  click('[data-alan="arsiv"]');
  await vi.waitFor(() => expect(d.querySelectorAll(".kitaplik-karti")).toHaveLength(0));
  change("#okumaFiltre", "");
  expect(d.querySelectorAll(".kitaplik-karti")).toHaveLength(1);
});
it("kayıtlı sorgu formu doldurur; kendiliğinden dış arama başlatmaz", async () => {
  await kur(() =>
    state(
      [],
      [
        {
          id: "s",
          ad: "My query",
          sorgu: { baslik: "Attention", yazar: "Writer", yil: 2017, tur: "makale", limit: 5 },
          webDahil: false,
        },
      ],
    ),
  );
  click('[data-alan="arama-ac"]');
  expect((d.querySelector("#baslik") as HTMLInputElement).value).toBe("Attention");
  expect((d.querySelector('input[value="makale"]') as HTMLInputElement).checked).toBe(true);
  expect((d.querySelector("#webDahil") as HTMLInputElement).checked).toBe(false);
  expect(calls.filter((c) => c.url.includes("/api/search"))).toHaveLength(0);
});
it("formdaki aramayı web tercihiyle kaydeder", async () => {
  await kur(() => state());
  change("#baslik", "Saved query");
  (d.querySelector("#webDahil") as HTMLInputElement).checked = false;
  click("#aramaKaydet");
  await vi.waitFor(() =>
    expect(calls.find((c) => c.url.endsWith("/searches"))?.body).toMatchObject({
      ad: "Saved query",
      webDahil: false,
      sorgu: { baslik: "Saved query", tur: "kitap", limit: 20 },
    }),
  );
});
it("kitaplık kaynakça çıktısı filtreyi uygular ve kişisel notları dışarı vermez", async () => {
  await kur(() =>
    state([
      kayit("one", { eser: eser("Title {injection}\n%") }),
      kayit("two", { koleksiyon: "Other", eser: eser("Hidden title") }),
    ]),
  );
  let blob: Blob | undefined;
  Object.assign(dom.window.URL, {
    createObjectURL: (b: Blob) => {
      blob = b;
      return "blob:test";
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(dom.window.HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  change("#koleksiyonFiltre", "Thesis");
  click("#kitaplikBib");
  const text = await blobText(blob!);
  expect(text).toContain("\\{injection\\}");
  expect(text).not.toContain("Private personal note");
  expect(text).not.toContain("Hidden title");
  click("#kitaplikRis");
  const ris = await blobText(blob!);
  expect(ris).toContain("TY  - BOOK");
  expect(ris).not.toContain("Private personal note");
});
function blobText(blob: Blob) {
  return new Promise<string>((resolve) => {
    const r = new dom.window.FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsText(blob);
  });
}
it("yedek önizlemesi ile birleştirme ayrı eylemlerdir", async () => {
  await kur((url, body) =>
    url.endsWith("/import")
      ? { yeniKitap: 1, yeniArama: 0, korunan: body?.onizleme ? 2 : 3 }
      : state(),
  );
  const file = new dom.window.File([JSON.stringify(state())], "backup.json", {
    type: "application/json",
  });
  const input = d.querySelector<HTMLInputElement>("#yedekDosya")!;
  Object.defineProperty(input, "files", { value: [file] });
  input.dispatchEvent(new dom.window.Event("change"));
  await vi.waitFor(() =>
    expect((d.querySelector("#yedekBirlestir") as HTMLButtonElement).disabled).toBe(false),
  );
  expect(calls.filter((c) => c.url.endsWith("/import"))).toHaveLength(1);
  expect(calls.find((c) => c.url.endsWith("/import"))?.body?.onizleme).toBe(true);
  click("#yedekBirlestir");
  await vi.waitFor(() =>
    expect(d.querySelector("#yedekOnizleme")?.textContent).toContain("Birleştirildi"),
  );
  expect(calls.filter((c) => c.url.endsWith("/import"))[1]?.body?.onizleme).toBe(false);
});
it("bozuk yedek ve yükleme hatası mevcut veriyi silmez", async () => {
  await kur(() => ({ hata: "Storage unavailable" }));
  expect(d.querySelector("#calismaMesaj")?.textContent).toBe("Storage unavailable");
  const input = d.querySelector<HTMLInputElement>("#yedekDosya")!;
  Object.defineProperty(input, "files", { value: [new dom.window.File(["{bad"], "bad.json")] });
  input.dispatchEvent(new dom.window.Event("change"));
  await vi.waitFor(() =>
    expect(d.querySelector("#yedekOnizleme")?.textContent).toContain("Yedek açılamadı"),
  );
  expect((d.querySelector("#yedekBirlestir") as HTMLButtonElement).disabled).toBe(true);
  expect(calls.some((c) => c.url.endsWith("/import"))).toBe(false);
});
