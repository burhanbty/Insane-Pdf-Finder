import { katalogdaAra, katalogSurumu } from "../book-catalog.js";
import type { SourceModule } from "../types.js";

export default {
  id: "doab",
  ad: "DOAB",
  tur: ["kitap"],
  aciklama:
    "Açık erişimli kitap keşfi; resmî üstverinin yerel indeksi. PDF ve yayınevi kayıt bağlantıları ayrı tutulur. Güncelleme: npm run sources:sync -- doab",
  onbellekSurumu: () => katalogSurumu("doab"),
  hazirMi: () => !katalogSurumu("doab").endsWith(":hazir-degil"),
  hazirDegilAciklamasi:
    "Yerel DOAB indeksi eksik. npm run sources:sync -- doab komutuyla resmî üstveriyi indirin.",
  ara: (sorgu) => katalogdaAra("doab", sorgu),
} satisfies SourceModule;
