/** DergiPark OAI-PMH keşfi: başlık araması ile üstveri harmanlama birbirine karıştırılmaz. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { get } from "../src/http.js";
import { sinirliGovde } from "../src/body.js";
import { sayfadakiPdfler, pdfYanitiniBul } from "../src/pdf-resolver.js";

const klasor = "reports/dergipark-evidence";
await fs.mkdir(klasor, { recursive: true });
const base = "https://dergipark.org.tr/api/public/oai/";
const kontroller: Record<string, unknown>[] = [];
async function xml(ad: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const yanit = await get(url.href, { timeoutMs: 20000, tekrar: 0, boslukMs: 600, ham: true });
  const metin = new TextDecoder().decode(await sinirliGovde(yanit, 5 * 1024 * 1024));
  const dom = new JSDOM(metin, { contentType: "text/xml" });
  const hatalar = [...dom.window.document.getElementsByTagNameNS("*", "error")].map((e) => ({
    kod: e.getAttribute("code"),
    mesaj: e.textContent,
  }));
  await fs.writeFile(`${klasor}/${ad}.xml`, metin);
  kontroller.push({
    ad,
    url: url.href,
    http: yanit.status,
    sha256: createHash("sha256").update(metin).digest("hex"),
    hatalar,
  });
  if (hatalar.length) {
    dom.window.close();
    throw Error(`${ad}: ${JSON.stringify(hatalar)}`);
  }
  return dom;
}
const rapor: Record<string, unknown> = {
  tarih: new Date().toISOString(),
  kontroller,
  durum: "FAILED",
};
try {
  const identify = await xml("identify", { verb: "Identify" });
  rapor.protokol = identify.window.document.getElementsByTagNameNS("*", "protocolVersion")[0]
    ?.textContent;
  identify.window.close();
  const formats = await xml("formats", { verb: "ListMetadataFormats" });
  rapor.bicimler = [...formats.window.document.getElementsByTagNameNS("*", "metadataPrefix")].map(
    (e) => e.textContent,
  );
  formats.window.close();
  const records = await xml("sample", { verb: "ListRecords", metadataPrefix: "oai_dc", set: "ap" });
  const record = records.window.document.getElementsByTagNameNS("*", "record")[0];
  if (!record) throw Error("Örnek kayıt bulunamadı");
  const alan = (ad: string) =>
    [...record.getElementsByTagNameNS("*", ad)].map((e) => e.textContent?.trim() ?? "");
  const identifier = record
    .getElementsByTagNameNS("*", "header")[0]
    ?.getElementsByTagNameNS("*", "identifier")[0]
    ?.textContent?.trim();
  const sayfa = alan("identifier").find((s) =>
    /^https:\/\/dergipark\.org\.tr\/(en|tr)\/pub\/[^/]+\/article\/\d+$/.test(s),
  );
  rapor.ornek = {
    identifier,
    basliklar: alan("title"),
    yazarlar: alan("creator"),
    sayfa,
    devamTokeniVar: Boolean(
      records.window.document.getElementsByTagNameNS("*", "resumptionToken")[0]?.textContent,
    ),
  };
  records.window.close();
  if (!identifier || !sayfa) throw Error("Örnek kaydın kimlik/sayfa bağlantısı eksik");
  const getRecord = await xml("get-record", {
    verb: "GetRecord",
    metadataPrefix: "oai_dc",
    identifier,
  });
  getRecord.window.close();
  const htmlYanit = await get(sayfa, { disAg: true, ham: true, timeoutMs: 20000, tekrar: 0 });
  const html = new TextDecoder().decode(await sinirliGovde(htmlYanit, 2 * 1024 * 1024));
  await fs.writeFile(`${klasor}/record.html`, html);
  const pdfler = sayfadakiPdfler(html, sayfa);
  rapor.pdfAdaylari = pdfler;
  if (!pdfler.length) throw Error("Kayıt sayfası PDF bildirmedi");
  const pdf = await pdfYanitiniBul(pdfler);
  const bayt = await sinirliGovde(pdf, 20 * 1024 * 1024);
  const sha256 = createHash("sha256").update(bayt).digest("hex");
  await fs.mkdir(".data/pdf-validation", { recursive: true });
  await fs.writeFile(".data/pdf-validation/dergipark.pdf", bayt);
  rapor.pdf = {
    bayt: bayt.length,
    sha256,
    imza: new TextDecoder().decode(bayt.subarray(0, 5)),
    sinir:
      "PDF biçimi ve kayıt sayfasının bağlantısı doğrulandı; bağımsız içerik-kimlik doğrulaması değildir.",
  };
  rapor.durum = "COMPLETED";
  rapor.karar =
    "OAI-PMH harmanlama ve kayıt sayfasından PDF çözümleme uygulanabilir. OAI-PMH başlık araması sunmaz; sonraki entegrasyon yerel indeks ve artımlı toplama gerektirir.";
} catch (e) {
  rapor.hata = e instanceof Error ? e.message : String(e);
  process.exitCode = 1;
} finally {
  await fs.writeFile(
    "reports/dergipark-feasibility-2026-10-22.json",
    JSON.stringify(rapor, null, 2) + "\n",
  );
  console.log(JSON.stringify(rapor));
}
