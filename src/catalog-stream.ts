/** OPDS benzeri resmî JSON akışının publications dizisini dosyanın tamamını belleğe almadan okur. */
export async function* yayinlariOku(
  parcalar: AsyncIterable<Uint8Array>,
  baslik: (metadata: unknown) => void = () => undefined,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let tampon = "",
    bulundu = false,
    bitti = false,
    nesne = "",
    derinlik = 0;
  let tirnak = false,
    kacis = false,
    bayt = 0;
  let beklenen: "ilk" | "deger" | "ayirici" = "ilk";
  for await (const parca of parcalar) {
    bayt += parca.length;
    if (bayt > 800 * 1024 * 1024) throw Error("Katalog 800 MB sınırını aşıyor");
    let metin = decoder.decode(parca, { stream: true });
    if (!bulundu) {
      tampon += metin;
      const m = /"publications"\s*:\s*\[/.exec(tampon);
      if (!m) {
        if (tampon.length > 65536) throw Error("Katalog başlığı geçersiz");
        continue;
      }
      const header = JSON.parse(tampon.slice(0, m.index) + '"publications":[]}') as {
        metadata?: unknown;
      };
      baslik(header.metadata);
      metin = tampon.slice(m.index + m[0].length);
      tampon = "";
      bulundu = true;
    }
    for (const c of metin) {
      if (bitti) {
        tampon += c;
        if (tampon.length > 65536) throw Error("Katalog sonu geçersiz");
        continue;
      }
      if (!derinlik) {
        if (/\s/.test(c)) continue;
        if (c === "]") {
          if (beklenen === "deger") throw Error("Katalog dizisinde sonda virgül var");
          bitti = true;
          continue;
        }
        if (beklenen === "ayirici") {
          if (c !== ",") throw Error("Katalog öğeleri arasında virgül gerekli");
          beklenen = "deger";
          continue;
        }
        if (c !== "{") throw Error("Katalog öğesi nesne olmalı");
        nesne = "{";
        derinlik = 1;
        continue;
      }
      nesne += c;
      if (nesne.length > 4 * 1024 * 1024) throw Error("Katalog öğesi çok büyük");
      if (tirnak) {
        if (kacis) kacis = false;
        else if (c === "\\") kacis = true;
        else if (c === '"') tirnak = false;
      } else if (c === '"') tirnak = true;
      else if (c === "{" || c === "[") derinlik++;
      else if (c === "}" || c === "]") derinlik--;
      if (!derinlik) {
        yield JSON.parse(nesne);
        nesne = "";
        beklenen = "ayirici";
      }
    }
  }
  const son = decoder.decode();
  if (son || !bitti || derinlik || tampon.trim() !== "}")
    throw Error("Katalog tamamlanmadan kesildi veya biçimi geçersiz");
}

/** JSONL ayıracı yalnızca LF'dir; U+2028/U+2029 JSON dizgilerinin içinde geçerlidir. */
export async function* jsonSatirlariniOku(
  parcalar: AsyncIterable<Uint8Array>,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let kalan = "";
  for await (const parca of parcalar) {
    kalan += decoder.decode(parca, { stream: true });
    let baslangic = 0,
      son: number;
    while ((son = kalan.indexOf("\n", baslangic)) >= 0) {
      const line = kalan.slice(baslangic, son);
      if (line.length > 4 * 1024 * 1024) throw Error("Katalog satırı çok büyük");
      if (line.trim()) yield JSON.parse(line);
      baslangic = son + 1;
    }
    kalan = kalan.slice(baslangic);
    if (kalan.length > 4 * 1024 * 1024) throw Error("Katalog satırı çok büyük");
  }
  kalan += decoder.decode();
  if (kalan.trim()) yield JSON.parse(kalan);
}
