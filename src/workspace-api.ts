import { Router, type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { ayar } from "./config.js";
import { CalismaAlani, CalismaHatasi } from "./workspace.js";

export const calismaAlani = new CalismaAlani(() => path.join(ayar.dataDir, "workspace.json"));
export const calismaRotalari = Router();
// Kişisel notlar ağda paylaşılan HOST ayarında dahi doğrudan uzak istemciye açılmaz.
calismaRotalari.use((req, res, next) => {
  const adres = req.socket.remoteAddress ?? "";
  if (!(adres.startsWith("127.") || adres === "::1" || adres.startsWith("::ffff:127."))) {
    res
      .status(403)
      .json({ hata: "Kişisel çalışma alanı yalnızca bu bilgisayardan kullanılabilir" });
    return;
  }
  next();
});
function rota(is: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void is(req, res).catch((hata: unknown) => {
      if (hata instanceof CalismaHatasi) res.status(hata.status).json({ hata: hata.message });
      else next(hata);
    });
  };
}
calismaRotalari.get(
  "/",
  rota(async (_req, res) => res.json(await calismaAlani.listele())),
);
calismaRotalari.post(
  "/items",
  rota(async (req, res) => {
    const sonuc = await calismaAlani.ekle(req.body?.eser);
    res.status(sonuc.eklendi ? 201 : 200).json(sonuc);
  }),
);
calismaRotalari.post(
  "/items/:id",
  rota(async (req, res) => res.json(await calismaAlani.guncelle(String(req.params.id), req.body))),
);
calismaRotalari.post(
  "/searches",
  rota(async (req, res) => res.json(await calismaAlani.aramaKaydet(req.body))),
);
calismaRotalari.post(
  "/course-list",
  rota(async (req, res) => {
    if (typeof req.body?.onizleme !== "boolean")
      throw new CalismaHatasi("Ders listesi önizleme seçimi gerekli");
    res.json(await calismaAlani.dersListesi(req.body, req.body.onizleme));
  }),
);
calismaRotalari.post(
  "/searches/:id/remove",
  rota(async (req, res) => res.json(await calismaAlani.aramaKaldir(String(req.params.id)))),
);
calismaRotalari.get(
  "/backup",
  rota(async (_req, res) => {
    res.attachment("kaynak-bul-yedek.json").json(await calismaAlani.listele());
  }),
);
calismaRotalari.post(
  "/import",
  rota(async (req, res) => {
    if (typeof req.body?.onizleme !== "boolean")
      throw new CalismaHatasi("İçe aktarma önizleme seçimi gerekli");
    res.json(await calismaAlani.birlestir(req.body?.yedek, req.body.onizleme));
  }),
);
