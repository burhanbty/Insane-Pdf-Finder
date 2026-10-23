import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { domKur, dom, belge, aramaYap, tikla } from "./helpers/dom.js";

let controller: ReadableStreamDefaultController<Uint8Array>;
let signal: AbortSignal | undefined;
const encoder = new TextEncoder();
const grup = (baslik = "İlk Araştırma Sonucu") => ({
  anahtar: "same-work",
  tur: "makale",
  baslik,
  yazarlar: ["Jane Smith"],
  puan: 0.9,
  konular: [],
  kaynaklar: [
    {
      kaynak: "fast",
      kaynakAd: "Fast",
      tur: "makale",
      baslik,
      yazarlar: ["Jane Smith"],
      link: "https://stream.test/record",
    },
  ],
});
const cevap = (tamamlandi: boolean, gruplar = [grup()]) => ({
  tamamlandi,
  gruplar,
  toplamSonuc: gruplar.length,
  kaynakDurumlari: [
    { id: "fast", ad: "Fast", hazir: true, sonucSayisi: 1, sureMs: 10 },
    { id: "slow", ad: "Slow", hazir: true, sonucSayisi: 0, sureMs: 0, bekliyor: !tamamlandi },
  ],
});
const yaz = (v: unknown) => controller.enqueue(encoder.encode(JSON.stringify(v) + "\n"));
beforeEach(async () => {
  await domKur();
  Object.assign(dom.window, { TextDecoder });
  const onceki = dom.window.fetch;
  dom.window.fetch = (async (url: string, opts: RequestInit) => {
    if (url !== "/api/search") return onceki(url, opts);
    signal = opts.signal!;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          signal!.addEventListener(
            "abort",
            () => {
              try {
                c.error(signal!.reason);
              } catch {
                /* akış kapanmış olabilir */
              }
            },
            { once: true },
          );
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } },
    );
  }) as typeof dom.window.fetch;
  belge().querySelector<HTMLInputElement>("#webDahil")!.checked = false;
});
afterEach(() => {
  signal = undefined;
  dom.window.close();
});

it("erken kartı son yanıt gelmeden gösterir, parçalı UTF-8 çözer ve indirme panelini korur", async () => {
  await aramaYap({ baslik: "Neural Models" }, 10);
  const bytes = encoder.encode(JSON.stringify({ cevap: cevap(false) }) + "\n");
  const konum = bytes.indexOf(196) + 1; // İ harfinin UTF-8 baytları iki parçaya ayrılır.
  controller.enqueue(bytes.slice(0, konum));
  controller.enqueue(bytes.slice(konum));
  await vi.waitFor(() =>
    expect(belge().querySelector(".kart h3")?.textContent).toBe("İlk Araştırma Sonucu"),
  );
  expect(belge().querySelector("#ozetPanel")?.textContent).toContain("Aranıyor");
  const panel = belge().querySelector(".indirme-icerik")!;
  panel.textContent = "İndirme sürüyor";
  const yeni = grup();
  yeni.kaynaklar[0]!.kaynakAd = "Fast güncellendi";
  yaz({ cevap: cevap(true, [yeni]) });
  controller.close();
  await vi.waitFor(() =>
    expect(belge().querySelector<HTMLButtonElement>("#aramaIptal")!.hidden).toBe(true),
  );
  expect(belge().querySelector(".indirme-icerik")).toBe(panel);
  expect(panel.textContent).toBe("İndirme sürüyor");
});

it("kesilen akışta bulunan kartları tutar ve eksik sonuç uyarısı verir", async () => {
  await aramaYap({ baslik: "Neural Models" }, 10);
  yaz({ cevap: cevap(false) });
  controller.close();
  await vi.waitFor(() =>
    expect(belge().querySelector("#ozetPanel")?.textContent).toContain("akışı kesildi"),
  );
  expect(belge().querySelectorAll(".kart")).toHaveLength(1);
});

it("aramayı durdurunca isteği iptal eder; erken kartlar ve eksik tarama bilgisi kalır", async () => {
  await aramaYap({ baslik: "Neural Models" }, 10);
  yaz({ cevap: cevap(false) });
  await vi.waitFor(() => expect(belge().querySelectorAll(".kart")).toHaveLength(1));
  tikla("#aramaIptal");
  expect(signal?.aborted).toBe(true);
  expect(belge().querySelectorAll(".kart")).toHaveLength(1);
  expect(belge().querySelector("#ozetPanel")?.textContent).toContain("tarama eksik olabilir");
});
