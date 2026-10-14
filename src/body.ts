/** Beyan edilen boyuta güvenmeden, akış okunurken bellek sınırını uygular. */
export async function sinirliGovde(cevap: Response, limit: number): Promise<Uint8Array> {
  if (Number(cevap.headers.get("content-length")) > limit) {
    await cevap.body?.cancel();
    throw new Error("Dosya boyut sınırını aşıyor");
  }
  if (!cevap.body) throw new Error("Boş yanıt gövdesi");
  const reader = cevap.body.getReader();
  const parcalar: Uint8Array[] = [];
  let toplam = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      toplam += value.byteLength;
      if (toplam > limit) throw new Error("Dosya boyut sınırını aşıyor");
      parcalar.push(value);
    }
  } catch (hata) {
    await reader.cancel().catch(() => undefined);
    throw hata;
  } finally {
    reader.releaseLock();
  }
  const bayt = new Uint8Array(toplam);
  let konum = 0;
  for (const parca of parcalar) {
    bayt.set(parca, konum);
    konum += parca.byteLength;
  }
  return bayt;
}

export function pdfImzasi(b: Uint8Array): boolean {
  return new TextDecoder().decode(b.subarray(0, 5)) === "%PDF-";
}
