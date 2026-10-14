import type { SourceModule } from "./types.js";

export function kaynakHazirligi(k: SourceModule): { hazir: boolean; hata?: string } {
  try {
    const hazir = k.hazirMi ? Boolean(k.hazirMi()) : true;
    return { hazir, hata: hazir ? undefined : "API anahtarı yok (.env dosyasına ekleyin)" };
  } catch (hata) {
    return {
      hazir: false,
      hata: `Kaynak hazırlığı başarısız: ${hata instanceof Error ? hata.message : String(hata)}`,
    };
  }
}
