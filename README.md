# Kaynak Bul

Başlık, yazar ve yıl yazıyorsun; program birden çok açık kaynakta arıyor, aynı eserin
farklı kayıtlarını tek kartta birleştiriyor, bulduğu PDF'leri indirebiliyor ve
içeriklerinden özet çıkarıyor.

Arayüz tarayıcıda açılıyor, Türkçe. Node.js + TypeScript, build adımı yok.

## Çalıştırma

```bash
npm install
npm start
```

Sonra tarayıcıda `http://127.0.0.1:3000`.

Geliştirirken izleme modu: `npm run dev`.

## API anahtarları (isteğe bağlı)

`.env.example` dosyasını `.env` olarak kopyalayıp doldur. Anahtarsız da çalışır,
sadece bazı kaynaklar devre dışı kalır.

| Değişken                                   | Nereye alınır                                        | Etkisi                                                        |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| `CONTACT_EMAIL`                            | kendi e-postan                                       | Open Library ve Unpaywall ister; kota 3 katına çıkar          |
| `GOOGLE_BOOKS_API_KEY`                     | Google Cloud Console → APIs & Services → Credentials | Google Books kaynağı açılır                                   |
| `SEMANTIC_SCHOLAR_API_KEY`                 | semanticscholar.org/product/api                      | Semantic Scholar hızlanır                                     |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | OpenAI uyumlu herhangi bir servis                    | Özet modelle yazılır; yoksa anahtar kelime yöntemi kullanılır |

## Kaynaklar

`src/sources/` klasöründe her biri bağımsız bir dosya. Arama sırasında hepsi
paralel sorgulanır; **biri hata verse bile diğerlerinin sonucu döner** ve
arayüzde o kaynağın durumu ayrı satırda görünür.

| Kaynak               | Tür           | Ne verir                                                              |
| -------------------- | ------------- | --------------------------------------------------------------------- |
| Open Library         | kitap         | Katalog kaydı, kapak, ödünç/arşiv bağlantıları                        |
| Internet Archive     | kitap         | Açık metin ve PDF; tam metin okunabilen kayıtlar                      |
| Google Books         | kitap         | Künye, kapak, bazı durumlarda önizleme bağlantısı _(anahtar gerekir)_ |
| OpenAIRE             | kitap, makale | DOAB/OAPEN ve kurumsal arşivler dahil açık erişim kopyalar            |
| arXiv                | makale        | Ön baskılar, tam PDF                                                  |
| Semantic Scholar     | makale        | Özet, atıf sayısı, açık erişim PDF bağlantısı                         |
| OpenAlex + Unpaywall | makale        | Künye ve DOI üzerinden yasal açık erişim PDF'si                       |
| Crossref             | makale, kitap | Kesin künye (DOI, sayfa, cilt)                                        |
| CORE                 | makale        | Açık erişim makale indeksi, çoğunda tam metin PDF                     |
| Zenodo               | makale, slayt | Veri setleri, çalışma kâğıtları, sunum dosyaları                      |
| Türkçe Wikipedia     | hepsi         | Anahtarsız açık API; **senin eklediğin kaynak için örnek**            |
| Web araması          | slayt         | SlideShare, Speaker Deck, Google Slides vb. — yalnızca bağlantı       |

### Kaynak hakkında bilinmesi gerekenler

- **DOAB'in kendi REST API'si 403 döndürüyor** (Cloudflare koruması). Aynı
  kayıtları OpenAIRE indekslediği için o yol kullanılıyor.
- **Crossref** `select` listesinde `language` ve `ISBN` geçerli alan değil;
  gönderilirse 400 döner.
- **arXiv** JSON döndürmüyor, Atom (XML) döndürüyor. `<link>` etiketleri
  kendini kapattığı için ayrıca ele alınıyor.
- **Open Library** `title=` parametresi tam başlık eşleşmesi istiyor; uzun
  başlıklarda sıfır sonuç veriyor. Solr sorgusu (`q=`) kullanılıyor.
- **OpenAlex** `filter` parametresini 400 ile reddediyor; yazar ve yıl
  filtresi sonuç listesinde uygulanıyor.
- **CORE** ve **Semantic Scholar** anahtarsız erişimde kotayı hızlı tüketir.
  Tekrarlanan aramalar diskte önbelleğe alınır, ama arka arkaya farklı
  aramalarda 429 alabilirsin.
- **Genel web araması güvenilir çalışmıyor.** DuckDuckGo bu ortamda IP'yi
  tamamen engelliyor (202 + CAPTCHA), Brave 429, Mojeek 403, Startpage ve
  SearX bot koruması kullanıyor. Bing çalışıyor ama `site:` ve `filetype:`
  filtrelerini uygulamadığı için sonuçlar eleme sonrası çoğu zaman boş
  çıkıyor. Bu yüzden program boş döndüğünde tarayıcıda elle açabileceğin bir
  arama adresi gösteriyor.

## Kendi kaynağını eklemek

`src/sources/` klasörüne dosya atman yeterli, kayıt defteri otomatik bulur.
`baslat.bat`'ı tekrar açman yeterli.

**En kolay yol:** `src/sources/ORNEK-SABLON.ts` dosyasını kopyalayıp
`src/sources/benim-sitem.ts` adıyla kaydet, içindeki yorumlu bloğu aç.
Hazır çalışan bir örnek de var: `src/sources/wikipedia-tr.ts`.

En küsa hali:

```ts
import { getJson } from "../http.js";
import type { SourceModule } from "../types.js";

const kaynak: SourceModule = {
  id: "benim-sitem", // benzersiz olmalı
  ad: "Benim Sitem", // kartta görünen isim
  tur: ["kitap", "makale"], // hangi türlerde aransın
  aciklama: "Ne yaptığını yaz", // "Kaynaklar" penceresinde görünür

  // Anahtar gerekiyorsa: anahtar yoksa kaynak atlanır, arayüzde
  // "anahtar gerekli" yazar. (google-books.ts buna örnektir.)
  hazirMi: () => Boolean(process.env.BENIM_API_KEY),

  ara: async (sorgu) => {
    // sorgu: { baslik, yazar?, yil?, tur, limit }
    const u = new URL("https://api.siteniz.com/v1/ara");
    u.searchParams.set("q", sorgu.baslik);

    const veri = await getJson<{ sonuclar?: { ad: string; url: string }[] }>(u.toString(), {
      boslukMs: 500, // sitenin hız limiti varsa artır
      timeoutMs: 20_000,
    });

    return (veri.sonuclar ?? []).map((k) => ({
      kaynak: "benim-sitem",
      kaynakAd: "Benim Sitem",
      tur: sorgu.tur,
      baslik: k.ad, // zorunlu
      link: k.url, // zorunlu
      // ...isteğe bağlı: yazarlar, yil, ozet, pdf, kapak, erisim
    }));
  },
};

export default kaynak;
```

`getJson` zaman aşımı, 429/5xx'te tekrar deneme ve User-Agent başlığını
kendisi hallediyor. HTML/XML dönen siteler için `get(url, { ham: true })`
kullan.

### Sık yapılan hatalar

- **`baslik` ve `link` boş bırakılırsa** kayıt sessizce atlanır.
- **`id` benzersiz olmalı.** İki kaynak aynı `id`'yi kullanırsa hangisinin
  çalıştığı belirsizleşir.
- **`hazirMi` yazmayı unutursan** anahtar gerektiren bir API her aramada
  hata fırlatır; arayüz o kaynağı kırmızı noktayla gösterir ama arama yine
  çalışır.
- **Adı `_` ile başlayan dosyalar** (ör. `_yardimci.ts`) yüklenmez —
  ortak kodları oraya koyabilirsin.
- **Dosya hatalıysa** sunucu çökmez. Konsola uyarı yazar, arayüzdeki
  "Kaynaklar" penceresinde listeler; sadece o kaynak devre dışı kalır.

### Eklediğim kaynağı test etmek

```
npx tsx scripts/smoke.ts "Arama Başlığı" "Yazar" 2020 makale
```

Kaynaklar listesinde senin kaynağın çıkar, durum satırında kaç sonuç
geldiğini görürsün. Veya arayüzdeki **Kaynaklar** düğmesine bas.

## Eşleştirme ve gruplama

Aynı eserin farklı kaynaklardaki kayıtları tek kartta birleşir:

1. Tür + normalize başlık + yıl aynıysa doğrudan gruplanır.
2. Aksi halde başlık benzerliği > 0.72 veya (aynı yıl + ortak yazar soyadı +
   başlık benzerliği > 0.5) ile birleşir.

Normalizasyon Türkçeyi ASCII'ye indirger (`Çağdaş` → `cagdas`), edatları atar
ve kısa bir başlık sorgusunun uzun bir başlığa eşleşmesini de hesaba katar
(`Sapiens` ↔ `Sapiens: A Brief History of Humankind`).

Puan ağırlıkları: başlık %60, yazar %40, yıl %15. Yıl verilmişse sorgudan
1 yıldan fazla sapan sonuçlar puanı %25'e düşürülür.

## Özet

`pdfjs-dist` ile PDF'ten metin çıkarılır (ilk 60 sayfa), sonra:

- `LLM_BASE_URL` + `LLM_API_KEY` varsa modele gönderilir
- Yoksa cümle puanlama yöntemi: kelime sıklığı %55, metin içi konum %35,
  uzunluk uyumu %10

Taranmış görsel PDF'lerde metin çıkarılamaz; bu durumda uyarı döner.

## İndirme

`downloads/` klasörüne yazılır. Dosya adı normalize edilir, aynı isimde dosya
varsa numara eklenir. 300 MB sınırı var; dosya önce `.part` olarak yazılır,
bitince adlandırılır (yarım kalan indirmeler klasörde görünmez).

## Sayfa sayısı

Sonuç kartlarında PDF'in kaç sayfa olduğu gösterilir. Üç kaynaktan gelir:

1. **Kayıttan** — Google Books (`pageCount`), Open Library
   (`number_of_pages_median`), Crossref (sayfa aralığı → toplam).
2. **PDF içinden** — arXiv, Zenodo, OpenAIRE gibi kaynaklar sayfa
   sayısını vermediği için dosya indirilip `pdfjs` ile açılır ve
   `numPages` okunur. Sonuç diske önbelleğe alınır, ikinci istek ~3 ms.

Denenmede HTTP `Range` isteğiyle sayfa sayısını dosyanın sonundan okumak daha
hızlı görünüyordu ama güvenilir değil: aynı dosyada birden fazla `/Count`
değeri çıkabiliyor (alt ağaçlar, ekler) — 15 sayfalık bir makale "7" de
raporluyordu. Bu yüzden tam açma kullanılıyor.

Bilinen sınır: arxiv.org yanıt vermekte çok yavaş (2 MB dosyayı ~90 saniyede
veriyor). Bu yüzden arayüz **yalnızca ilk 3 kartın** sayfasını arka planda
otomatik getirir; kullanıcı bekletilmez. Alttaki kartlarda tıklanabilir bir
`Sayfa: ?` düğmesi durur, onu tıklayınca o PDF indirilip ölçülür.

## Kaynak bazlı süzgeç ve gruplama

Sonuçların hangi kaynaktan geldiğini incelemek için:

- **Kaynak açılır listesi** — o aramada sonuç veren kaynaklar, kaç sonuç
  verdikleriyle. Çok sonuç verenler başta. Seçince yalnızca o kaynağın
  sonuçları kalır. Bir eser iki kaynakta da bulunuyorsa her ikisinde de
  görünür (birlestirme zaten çalışıyor).
- **Sonuçları kaynağa göre grupla** — kartlar ana kaynaklarına göre
  toplanır, aralarına başlık girer. Başlığa tıklamak o kaynağa göre süzer,
  tekrar tıklamak süzgeci kaldırır.
- **Yalnızca tek kaynakta bulunanlar** — iki kaynakta eşleşen (yani aslında
  aynı eserin iki kopyası olan) kayıtları gizler. Tekil kaynak arıyorsan
  işe yarar.
- **Kart üzerinde** birden çok kaynakta bulunan eserlerde "Bu eser N
  kaynakta bulundu — eşleştirildi" notu çıkar.
- **Sağ üstteki sayaç**: kaç kaynak yanıt verdi, kaç çoklu eşleşme var.

## Kalite kontrolleri

```bash
npm run check          # lint + tip kontrolü + testler (hepsi)
npm run lint           # eslint
npm run typecheck      # tsc --noEmit
npm test               # 80 birim testi (çevrimdışı, ~3 sn)
npm run format         # prettier ile biçimlendir
npm run format:check   # biçimi doğrula (CI'da çalışır)
```

GitHub Actions şu kontroleri her push'ta ve her PR'da çalıştırır:
Node 20/22/24 üzerinde kurulum, biçim denetimi, lint, tip kontrolü, birim
testleri ve **temiz klonlama testi** (`scripts/dogrula-kurulum.mjs` — 31
kontrol: dosyalar mevcut mu, sunucu ayakta mı, rotalar yanıt veriyor mu,
arayüz sunuluyor mu, zarif kapanış çalışıyor mu).

### Bilinen tip kontrolü istisnası

`libgen.ts` ve `annas-archive.ts` şu anda `tsconfig.json` içindeki `exclude`
listesinde. Gerekçesi: bu dosyalarda `match()`/`matchAll()` indekslerinin
`string | undefined` dönmesi ele alınmamış. Lint ve testler bu dosyaları yine
de kontrol ediyor. Düzeltildiklerinde `tsconfig.json` içindeki `exclude`
bloğu **silinmelidir**.

## Testler

```bash
npm test          # 80 birim testi (normalizasyon, puanlama, gruplama, arayüz)
npm run typecheck # TypeScript hataları

# gerçek kaynaklara istek atan duman testleri
npx tsx scripts/smoke.ts "Attention Is All You Need" "Vaswani" 2017 makale
npx tsx scripts/smoke-download.ts
npx tsx scripts/smoke-sayfa.ts
npx tsx scripts/smoke-server.ts
```

`test/arayuz-dyn.test.ts` arayüzü jsdom ile gerçek DOM'da çalıştırır: formu
doldurur, gönderir, `fetch`'i sahte cevaplarla değiştirir ve kartların
doğru çizildiğini denetler.

## API

| Yol                        | Ne yapar                                        |
| -------------------------- | ----------------------------------------------- |
| `POST /api/search`         | Kayıtlı kaynaklarda arar, gruplar               |
| `POST /api/web-search`     | Genel web araması (kısıtlı, bkz. yukarı)        |
| `GET /api/sources`         | Kaynak listesi ve hazırlık durumu               |
| `POST /api/source/:id/run` | Tek kaynağı doğrudan çalıştırır (hata ayıklama) |
| `POST /api/download`       | URL'den indirir                                 |
| `POST /api/sayfa-sayisi`   | PDF'lerin sayfa sayısını ölçür (önbellekli)     |
| `POST /api/summary`        | PDF/metin özeti üretir                          |
| `GET /api/downloads`       | İndirilen dosyalar                              |
| `GET /api/custom-sources`  | Kaynak klasörü içeriği                          |
| `POST /api/cache/clear`    | Önbelleği siler                                 |
| `GET /api/kapak`           | Kapak görseli proxy'si (izinli alanlar)         |

## Kapsam

Program telif hakkıyla korunan içeriklerin korsan kopyalarını barındıran
siteleri (LibGen, Z-Library, Anna's Archive vb.) kaynak olarak kullanmaz.
Yalnızca açık erişimli ve kamuya ait katalog verileriyle çalışır; genel web
araması da yalnızca arama motoruna sorgu gönderip bulunan bağlantıları
gösterir, içerik çekmez.
