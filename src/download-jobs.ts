import { randomUUID } from "node:crypto";
import { Router } from "express";
import { indir, type Indirilebilir, type IndirmeSonucu } from "./download.js";

export type IndirmeDurumu =
  | "sirada"
  | "baglaniyor"
  | "indiriliyor"
  | "dogrulaniyor"
  | "iptal-ediliyor"
  | "tamamlandi"
  | "basarisiz"
  | "iptal";
export interface IndirmeIsi {
  id: string;
  baslik: string;
  tur: "pdf" | "epub" | "metin";
  durum: IndirmeDurumu;
  alinan: number;
  toplam?: number;
  deneme: number;
  hata?: string;
  dosya?: string;
  boyut?: number;
  mevcut?: boolean;
}
interface IcIs {
  bilgi: IndirmeIsi;
  hedef: Indirilebilir;
  kontrol: AbortController;
}
const bitti = (s: IndirmeDurumu) => ["tamamlandi", "basarisiz", "iptal"].includes(s);

/** Kuyruk sunucu açıkken yaşar; tamamlanmış dosyalar kalıcıdır. */
export class IndirmeYoneticisi {
  private isler = new Map<string, IcIs>();
  private kuyruk: string[] = [];
  private etkin = 0;
  constructor(
    private indirici: typeof indir = indir,
    private eszamanli = 2,
  ) {}

  listele(): IndirmeIsi[] {
    return [...this.isler.values()].map((i) => ({ ...i.bilgi }));
  }
  ekle(hedef: Indirilebilir, tur: IndirmeIsi["tur"]): IndirmeIsi {
    const ayni = [...this.isler.values()].find(
      (i) =>
        i.hedef.url === hedef.url &&
        i.bilgi.tur === tur &&
        !bitti(i.bilgi.durum) &&
        i.bilgi.durum !== "iptal-ediliyor",
    );
    if (ayni) return { ...ayni.bilgi };
    if ([...this.isler.values()].filter((i) => !bitti(i.bilgi.durum)).length >= 20)
      throw new Error("Kuyruk dolu; en fazla 20 indirme bekleyebilir");
    while (this.isler.size >= 100) {
      const eski = [...this.isler.values()].find((i) => bitti(i.bilgi.durum));
      if (!eski) break;
      this.isler.delete(eski.bilgi.id);
    }
    const bilgi: IndirmeIsi = {
      id: randomUUID(),
      baslik: hedef.varsayilanAd,
      tur,
      durum: "sirada",
      alinan: 0,
      deneme: 1,
    };
    this.isler.set(bilgi.id, { bilgi, hedef, kontrol: new AbortController() });
    this.kuyruk.push(bilgi.id);
    queueMicrotask(() => this.baslat());
    return { ...bilgi };
  }
  iptal(id: string): IndirmeIsi {
    const i = this.bul(id);
    if (!bitti(i.bilgi.durum)) {
      if (i.bilgi.durum === "sirada") {
        this.kuyruk = this.kuyruk.filter((x) => x !== id);
        i.bilgi.durum = "iptal";
      } else i.bilgi.durum = "iptal-ediliyor";
      i.kontrol.abort(new Error("İndirme iptal edildi"));
    }
    return { ...i.bilgi };
  }
  tekrar(id: string): IndirmeIsi {
    const i = this.bul(id);
    if (!["basarisiz", "iptal"].includes(i.bilgi.durum))
      throw new Error("Yalnızca başarısız veya iptal edilen indirme tekrar denenebilir");
    if ([...this.isler.values()].filter((j) => !bitti(j.bilgi.durum)).length >= 20)
      throw new Error("Kuyruk dolu");
    i.bilgi = {
      id,
      baslik: i.bilgi.baslik,
      tur: i.bilgi.tur,
      durum: "sirada",
      alinan: 0,
      deneme: i.bilgi.deneme + 1,
    };
    i.kontrol = new AbortController();
    this.kuyruk.push(id);
    queueMicrotask(() => this.baslat());
    return { ...i.bilgi };
  }
  private bul(id: string): IcIs {
    const i = this.isler.get(id);
    if (!i) throw new Error("İndirme bulunamadı; sunucu yeniden başlatılmış olabilir");
    return i;
  }
  private baslat(): void {
    while (this.etkin < this.eszamanli && this.kuyruk.length) {
      const i = this.bul(this.kuyruk.shift()!);
      if (i.bilgi.durum !== "sirada") continue;
      this.etkin++;
      i.bilgi.durum = "baglaniyor";
      void this.calistir(i);
    }
  }
  private async calistir(i: IcIs): Promise<void> {
    try {
      const r: IndirmeSonucu = await this.indirici(i.hedef, i.bilgi.tur, {
        signal: i.kontrol.signal,
        tekillestir: true,
        ilerleme: (p) => {
          if (i.kontrol.signal.aborted) return;
          i.bilgi.durum = p.asama;
          i.bilgi.alinan = p.alinan;
          i.bilgi.toplam = p.toplam;
        },
      });
      // Dosya atomik olarak tamamlandıysa, son anda gelen iptal dosyayı silmez.
      Object.assign(i.bilgi, {
        durum: "tamamlandi",
        dosya: r.dosya,
        boyut: r.boyut,
        alinan: r.boyut,
        mevcut: r.mevcut,
      });
    } catch (hata) {
      i.bilgi.durum = i.kontrol.signal.aborted ? "iptal" : "basarisiz";
      i.bilgi.hata = i.kontrol.signal.aborted ? undefined : (hata as Error).message;
    } finally {
      this.etkin--;
      this.baslat();
    }
  }
}

function girdiOku(v: unknown): { hedef: Indirilebilir; tur: IndirmeIsi["tur"] } {
  const g = (v ?? {}) as Record<string, unknown>;
  const adres = (s: unknown): string => {
    if (typeof s !== "string" || s.length > 2000) throw new Error("Geçersiz indirme adresi");
    const u = new URL(s);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      throw new Error("Geçersiz indirme adresi");
    return u.href;
  };
  if (g.tur !== undefined && !["pdf", "epub", "metin"].includes(g.tur as string))
    throw new Error("Geçersiz dosya türü");
  if (
    g.alternatifler !== undefined &&
    (!Array.isArray(g.alternatifler) || g.alternatifler.length > 5)
  )
    throw new Error("En fazla 5 alternatif adres gönderilebilir");
  return {
    hedef: {
      url: adres(g.url),
      varsayilanAd:
        typeof g.baslik === "string" && g.baslik.trim() ? g.baslik.trim().slice(0, 150) : "icerik",
      alternatifler: (g.alternatifler as unknown[] | undefined)?.map(adres),
    },
    tur: (g.tur as IndirmeIsi["tur"]) ?? "pdf",
  };
}

export function indirmeRotalari(yonetici = new IndirmeYoneticisi()): Router {
  const r = Router();
  r.get("/", (_req, res) => {
    res.json({ isler: yonetici.listele() });
  });
  r.post("/", (req, res) => {
    try {
      const { hedef, tur } = girdiOku(req.body);
      res.status(202).json({ is: yonetici.ekle(hedef, tur) });
    } catch (h) {
      res.status(400).json({ hata: (h as Error).message });
    }
  });
  for (const eylem of ["iptal", "tekrar"] as const)
    r.post(`/:id/${eylem}`, (req, res) => {
      try {
        res.json({ is: yonetici[eylem](String(req.params.id)) });
      } catch (h) {
        res.status(400).json({ hata: (h as Error).message });
      }
    });
  return r;
}
