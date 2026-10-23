import { arsivIndeksSurumu, yerelArsivdeAra } from "../institutional-index.js";
import type { SourceModule } from "../types.js";
const kaynak: SourceModule = {
  id: "yerel-arsiv",
  ad: "Yerel üniversite indeksi",
  tur: ["kitap", "makale", "slayt"],
  aciklama:
    "Önceki üniversite aramalarında gözlenen künyelerde başlık, konu ve özet araması (BM25). Eski bağlantıların erişimi yeniden kontrol edilir.",
  hazirMi: () => arsivIndeksSurumu() !== "v1:yok",
  hazirDegilAciklamasi: "İlk üniversite araması sonrasında gözlenen kayıtlarla otomatik oluşur.",
  onbellekSurumu: arsivIndeksSurumu,
  ara: yerelArsivdeAra,
};
export default kaynak;
