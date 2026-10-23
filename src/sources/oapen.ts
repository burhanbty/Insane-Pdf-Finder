import { katalogdaAra, katalogSurumu } from "../book-catalog.js";
import type { SourceModule } from "../types.js";

export default {
  id: "oapen",
  ad: "OAPEN",
  tur: ["kitap"],
  aciklama:
    "Açık akademik kitaplar ve kitap bölümleri; resmî üstverinin yerel indeksi. Güncelleme: npm run sources:sync -- oapen",
  onbellekSurumu: () => katalogSurumu("oapen"),
  hazirMi: () => !katalogSurumu("oapen").endsWith(":hazir-degil"),
  hazirDegilAciklamasi:
    "Yerel OAPEN indeksi eksik. npm run sources:sync -- oapen komutuyla resmî üstveriyi indirin.",
  ara: (sorgu) => katalogdaAra("oapen", sorgu),
} satisfies SourceModule;
