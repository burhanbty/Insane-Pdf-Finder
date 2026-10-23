import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as bekle } from "node:timers/promises";

export const istekSinyali = new AsyncLocalStorage<AbortSignal>();

/** Süre sınırı hem kaynak sonucunu hem bu kaynak içindeki HTTP isteklerini kapsar. */
export async function sureSinirli<T>(
  is: () => Promise<T>,
  ms: number,
  temizligiBekle = false,
): Promise<T> {
  const kontrol = new AbortController();
  const temizlik = new AbortController();
  const ust = istekSinyali.getStore();
  const signal = ust ? AbortSignal.any([ust, kontrol.signal]) : kontrol.signal;
  signal.throwIfAborted();
  let iptal!: () => void;
  let calisma: Promise<T> | undefined;
  try {
    return await istekSinyali.run(signal, () =>
      Promise.race([
        (calisma = Promise.resolve().then(is)),
        new Promise<never>((_r, reject) => {
          iptal = () => reject(signal.reason);
          signal.addEventListener("abort", iptal, { once: true });
        }),
        bekle(ms, undefined, { signal: temizlik.signal }).then(() => {
          const hata = new Error(`Kaynak ${ms / 1000} saniyede yanıt vermedi`);
          kontrol.abort(hata);
          throw hata;
        }),
      ]),
    );
  } finally {
    if (temizligiBekle && signal.aborted) await calisma?.catch(() => undefined);
    signal.removeEventListener("abort", iptal);
    temizlik.abort();
  }
}
