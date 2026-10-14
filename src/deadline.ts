import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as bekle } from "node:timers/promises";

export const istekSinyali = new AsyncLocalStorage<AbortSignal>();

/** Süre sınırı hem kaynak sonucunu hem bu kaynak içindeki HTTP isteklerini kapsar. */
export async function sureSinirli<T>(is: () => Promise<T>, ms: number): Promise<T> {
  const kontrol = new AbortController();
  const temizlik = new AbortController();
  try {
    return await istekSinyali.run(kontrol.signal, () =>
      Promise.race([
        Promise.resolve().then(is),
        bekle(ms, undefined, { signal: temizlik.signal }).then(() => {
          const hata = new Error(`Kaynak ${ms / 1000} saniyede yanıt vermedi`);
          kontrol.abort(hata);
          throw hata;
        }),
      ]),
    );
  } finally {
    temizlik.abort();
  }
}
