/** Resmî üniversite arşivleri: sınırlı canlı arama, gerçek PDF ve erken sonuç kanıtı. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { ayar } from "../src/config.js";
import { universiteKaynagi, kurumSayfasindanEser, type Universite } from "../src/institutional.js";
import { yerelArsivdeAra } from "../src/institutional-index.js";
import { indir } from "../src/download.js";
import { get } from "../src/http.js";
import { sinirliGovde } from "../src/body.js";
import { sureSinirli } from "../src/deadline.js";
import { ara } from "../src/search.js";
import type { Work } from "../src/types.js";

const temp = await fs.mkdtemp(path.join(os.tmpdir(), "kaynak-bul-institution-probe-"));
const rapor: Record<string, unknown> = {
  tarih: new Date().toISOString(),
  kapsam: "Üç resmî arşiv, tek ortak konu sorgusu; kapsam/recall ölçümü değildir.",
};
const sorgu = { baslik: "machine learning", tur: "makale" as const, limit: 5 };
try {
  ayar.dataDir = path.join(temp, "data");
  ayar.cacheDir = path.join(temp, "cache");
  ayar.downloadsDir = path.join(temp, "downloads");
  ayar.sourcesDir = path.join(temp, "sources");
  ayar.unpaywallEmail = "";
  await fs.mkdir(ayar.sourcesDir);
  await fs.writeFile(path.join(temp, "package.json"), '{"type":"module"}\n');
  const sonuclar = await Promise.all(
    (["openmetu", "bilkent", "sabanci"] as Universite[]).map(async (id) => {
      const t = Date.now();
      try {
        const works = await sureSinirli(() => universiteKaynagi(id).ara(sorgu), 20_000);
        return { kaynak: id, sureMs: Date.now() - t, sayi: works.length, eserler: works };
      } catch (e) {
        return {
          kaynak: id,
          sureMs: Date.now() - t,
          hata: (e as Error).message,
          eserler: [] as Work[],
        };
      }
    }),
  );
  rapor.kaynaklar = sonuclar;
  rapor.yerelIndeks = (await yerelArsivdeAra(sorgu)).map((w) => ({
    baslik: w.baslik,
    kaynakAd: w.kaynakAd,
    link: w.link,
    goruldu: w.arsivGorulmeZamani,
  }));
  const bilkent = sonuclar.find((r) => r.kaynak === "bilkent")?.eserler[0];
  if (bilkent) {
    try {
      const r = await get(bilkent.link, { disAg: true, ham: true, tekrar: 0, timeoutMs: 10_000 });
      const html = new TextDecoder().decode(await sinirliGovde(r, 4 * 1024 * 1024));
      const w = kurumSayfasindanEser("bilkent", html, bilkent.link)!;
      const d = await indir(
        {
          url: w.pdf ?? w.link,
          varsayilanAd: w.baslik,
          kimlik: { baslik: w.baslik, yazarlar: w.yazarlar.slice(0, 20), doi: w.doi },
        },
        "pdf",
      );
      rapor.pdf = {
        kaynak: w.link,
        pdf: w.pdf,
        boyut: d.boyut,
        sha256: createHash("sha256")
          .update(await fs.readFile(d.yol))
          .digest("hex"),
        dogrulama: d.dogrulama,
      };
    } catch (e) {
      rapor.pdf = { hata: (e as Error).message };
    }
  }
  for (const id of ["openmetu", "bilkent", "sabanci", "yerel-arsiv"]) {
    const url = pathToFileURL(path.join(ayar.projeKok, "src", "sources", `${id}.ts`)).href;
    await fs.writeFile(
      path.join(ayar.sourcesDir, `${id}.ts`),
      `export { default } from ${JSON.stringify(url)};\n`,
    );
  }
  let ilkSonucMs: number | undefined;
  const akis: { sureMs: number; grup: number; bekleyen: number; tamamlandi: boolean }[] = [];
  const r = await ara(
    { ...sorgu, baslik: "neural network" },
    {
      guncelle: (r) => {
        if (r.gruplar.length && ilkSonucMs === undefined) ilkSonucMs = r.sureMs;
        akis.push({
          sureMs: r.sureMs,
          grup: r.gruplar.length,
          bekleyen: r.kaynakDurumlari.filter((d) => d.bekliyor).length,
          tamamlandi: r.tamamlandi === true,
        });
      },
    },
  );
  rapor.akis = { ilkSonucMs, toplamMs: r.sureMs, olaylar: akis, kaynaklar: r.kaynakDurumlari };
  const yol = path.join(ayar.projeKok, "reports", "universite-dogrulama-live-2026-10-23.json");
  await fs.writeFile(yol, JSON.stringify(rapor, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        rapor: yol,
        kaynaklar: sonuclar.map((r) => ({
          kaynak: r.kaynak,
          sayi: r.eserler.length,
          hata: r.hata,
        })),
        pdf: rapor.pdf,
        ilkSonucMs,
        toplamMs: r.sureMs,
      },
      null,
      2,
    ),
  );
} finally {
  await geciciyiTemizle(temp);
}

async function geciciyiTemizle(dir: string) {
  if (
    path.dirname(dir) !== path.resolve(os.tmpdir()) ||
    !path.basename(dir).startsWith("kaynak-bul-institution-probe-")
  )
    throw Error("Geçici dizin sınırı ihlali");
  await fs.rm(dir, { recursive: true, force: true });
}
