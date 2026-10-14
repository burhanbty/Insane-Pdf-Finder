import { afterEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns/promises";
import { disAdres, disFetch, genelAdresler, genelIp } from "../src/network.js";
import { sinirliGovde } from "../src/body.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dış ağ sınırı", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.2",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "224.0.0.1",
    "192.0.2.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2002:7f00:1::",
    "2001:db8::1",
  ])("%s genel IP değildir", (ip) => {
    expect(genelIp(ip)).toBe(false);
  });
  it.each([
    "https://127.1/x",
    "http://2130706433/x",
    "http://0x7f000001/x",
    "http://[::ffff:7f00:1]/",
    "http://localhost/",
    "http://host.local/",
    "file:///C:/x",
    "https://example.com:8080/x",
    "https://user:secret@example.com/x",
  ])("%s reddedilir", (url) => {
    expect(() => disAdres(url)).toThrow();
  });
  it("genel IPv4 ve IPv6 adreslerini kabul eder", () => {
    expect(genelIp("8.8.8.8")).toBe(true);
    expect(genelIp("2606:4700:4700::1111")).toBe(true);
  });
  it("karma DNS cevabındaki özel adresi reddeder", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ] as never);
    await expect(genelAdresler("example.com")).rejects.toThrow("özel");
  });
  it("doğrulanan DNS cevabını bağlantı için döndürür", async () => {
    const adresler = [{ address: "8.8.8.8", family: 4 }];
    const lookup = vi.spyOn(dns, "lookup").mockResolvedValue(adresler as never);
    expect(await genelAdresler("example.com")).toEqual(adresler);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("genel siteden özel ağa yönlendirmeyi ikinci istekten önce keser", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(disFetch("https://example.com/pdf", {})).rejects.toThrow("özel");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });
  it("kapak izin listesini yönlendirmede de uygular", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://other.com/" } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      disFetch("https://example.com/cover", {}, (host) => host === "example.com"),
    ).rejects.toThrow("izin");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("göreli yönlendirmeyi çözer ve döngüyü sınırlar", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "/next" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(disFetch("https://example.com/first", {})).rejects.toThrow("fazla");
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(String(fetch.mock.calls[1]![0])).toBe("https://example.com/next");
  });
});

describe("akış sırasında bellek sınırı", () => {
  it("Content-Length bulunmasa da sınırda okumayı kesip akışı iptal eder", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(4));
        },
        cancel,
      }),
    );
    await expect(sinirliGovde(response, 7)).rejects.toThrow("boyut");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("yanlış küçük Content-Length beyanına güvenmez", async () => {
    await expect(
      sinirliGovde(new Response("123456", { headers: { "content-length": "1" } }), 5),
    ).rejects.toThrow("boyut");
  });
  it("sınır içindeki çok parçalı içeriği korur", async () => {
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("abc"));
          c.enqueue(new TextEncoder().encode("def"));
          c.close();
        },
      }),
    );
    expect(new TextDecoder().decode(await sinirliGovde(response, 6))).toBe("abcdef");
  });
});
