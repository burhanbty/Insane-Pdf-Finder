import { afterEach, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "node:fs/promises";

const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const js = await fs.readFile(new URL("../public/theme.js", import.meta.url), "utf8");
let dom: JSDOM;
const key = "kaynak-bul-tema";
async function kur(options: { dark?: boolean; saved?: string; blocked?: boolean } = {}) {
  dom = new JSDOM(html, { url: "http://localhost:3000", runScripts: "outside-only" });
  const d = dom.window.document;
  let matches = options.dark ?? false;
  let systemChanged = () => {};
  Object.defineProperty(dom.window, "matchMedia", {
    value: () => ({
      get matches() {
        return matches;
      },
      addEventListener(_type: string, callback: () => void) {
        systemChanged = callback;
      },
    }),
  });
  if (options.saved) dom.window.localStorage.setItem(key, options.saved);
  if (options.blocked) {
    Object.defineProperty(dom.window, "localStorage", {
      get() {
        throw Error("blocked");
      },
    });
  }
  dom.window.eval(js);
  // The head script must resolve the theme before the controls are bound.
  const initial = d.documentElement.dataset.tema;
  d.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  return {
    d,
    initial,
    click: (value: string) =>
      d.querySelector<HTMLButtonElement>(`[data-tema-sec="${value}"]`)!.click(),
    theme: () => d.documentElement.dataset.tema,
    system: (value: boolean) => {
      matches = value;
      systemChanged();
    },
    pressed: () =>
      [...d.querySelectorAll('[aria-pressed="true"][data-tema-sec]')].map(
        (b) => (b as HTMLElement).dataset.temaSec,
      ),
  };
}
afterEach(() => {
  dom?.window.close();
  vi.restoreAllMocks();
});

it("ilk boyamadan önce sistemin koyu tercihini uygular; kontrol sistem olarak kalır", async () => {
  const ui = await kur({ dark: true });
  expect(ui.initial).toBe("koyu");
  expect(ui.pressed()).toEqual(["sistem"]);
});
it("kayıtlı açık tema sistemin koyu tercihinden önce gelir", async () => {
  const ui = await kur({ dark: true, saved: "acik" });
  expect(ui.initial).toBe("acik");
  expect(ui.pressed()).toEqual(["acik"]);
});
it("tema düğmeleri tercihi saklar ve yalnızca seçileni basılı bildirir", async () => {
  const ui = await kur();
  ui.click("koyu");
  expect(ui.theme()).toBe("koyu");
  expect(ui.pressed()).toEqual(["koyu"]);
  expect(dom.window.localStorage.getItem(key)).toBe("koyu");
  ui.click("acik");
  expect(ui.theme()).toBe("acik");
  expect(ui.pressed()).toEqual(["acik"]);
});
it("sistem değişiklikleri yalnızca sistem seçiliyken uygulanır", async () => {
  const ui = await kur();
  ui.system(true);
  expect(ui.theme()).toBe("koyu");
  ui.click("acik");
  ui.system(true);
  expect(ui.theme()).toBe("acik");
  ui.click("sistem");
  expect(ui.theme()).toBe("koyu");
  ui.system(false);
  expect(ui.theme()).toBe("acik");
});
it("yeniden açılışta kayıtlı koyu temayı korur", async () => {
  const ui = await kur({ saved: "koyu" });
  expect(ui.initial).toBe("koyu");
  expect(ui.pressed()).toEqual(["koyu"]);
});
it("depolama engellendiğinde tema seçimini ve diğer sayfa öğelerini bozmaz", async () => {
  const ui = await kur({ blocked: true });
  ui.click("koyu");
  expect(ui.theme()).toBe("koyu");
  expect(ui.d.querySelector("#aramaForm")).not.toBeNull();
});
it("bozuk kayıt sistem tercihine döner", async () => {
  const ui = await kur({ saved: "invalid", dark: true });
  expect(ui.theme()).toBe("koyu");
  expect(ui.pressed()).toEqual(["sistem"]);
});
it("diğer sekmedeki tema değişikliklerini izler; alakasız kayıtları yok sayar", async () => {
  const ui = await kur();
  dom.window.dispatchEvent(new dom.window.StorageEvent("storage", { key, newValue: "koyu" }));
  expect(ui.theme()).toBe("koyu");
  dom.window.dispatchEvent(
    new dom.window.StorageEvent("storage", { key: "other", newValue: "acik" }),
  );
  expect(ui.theme()).toBe("koyu");
  dom.window.dispatchEvent(new dom.window.StorageEvent("storage", { key, newValue: null }));
  expect(ui.pressed()).toEqual(["sistem"]);
  expect(ui.theme()).toBe("acik");
});
