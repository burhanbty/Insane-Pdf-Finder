import dns from "node:dns/promises";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export class AdresHatasi extends Error {}

export function genelIp(adres: string): boolean {
  try {
    const ip = ipaddr.process(adres);
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}

export function disAdres(adres: string): URL {
  const u = new URL(adres);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port)) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (ipaddr.isValid(host) && !genelIp(host))
  )
    throw new AdresHatasi("Yerel/özel ağ adreslerine ve standart dışı portlara erişim engellendi");
  return u;
}

/** Doğrulanan DNS cevabı doğrudan sokete verilir; ikinci DNS çözümü yapılmaz. */
export async function genelAdresler(host: string) {
  const adresler = await dns.lookup(host, { all: true, verbatim: true });
  if (!adresler.length || adresler.some((a) => !genelIp(a.address))) {
    throw new AdresHatasi("Kaynak özel veya ayrılmış bir IP adresine yönleniyor");
  }
  return adresler;
}

const lookup: LookupFunction = (host, secenek, done) => {
  void genelAdresler(host).then(
    (adresler) => {
      if (secenek.all) done(null, adresler);
      else {
        const adres = adresler.find((a) => !secenek.family || a.family === secenek.family);
        if (!adres) done(new Error("Uyumlu genel IP adresi bulunamadı"), "", 0);
        else done(null, adres.address, adres.family);
      }
    },
    (hata: Error) => done(hata, "", 0),
  );
};
const agent = new Agent({ connect: { lookup, timeout: 10_000 } });

/** Her yönlendirme ayrı doğrulanır; kimlik bilgileri dış isteklere taşınmaz. */
export async function disFetch(
  url: string,
  init: RequestInit,
  izinliHost?: (host: string) => boolean,
): Promise<Response> {
  let hedef = url;
  for (let i = 0; i <= 5; i++) {
    const u = disAdres(hedef);
    if (izinliHost && !izinliHost(u.hostname))
      throw new AdresHatasi("Yönlendirme kaynağına izin verilmiyor");
    const cevap = await fetch(u, { ...init, redirect: "manual", dispatcher: agent } as RequestInit);
    if (![301, 302, 303, 307, 308].includes(cevap.status)) return cevap;
    const konum = cevap.headers.get("location");
    await cevap.body?.cancel();
    if (!konum) throw new AdresHatasi("Yönlendirme adresi eksik");
    hedef = new URL(konum, u).href;
  }
  throw new AdresHatasi("Çok fazla yönlendirme");
}
