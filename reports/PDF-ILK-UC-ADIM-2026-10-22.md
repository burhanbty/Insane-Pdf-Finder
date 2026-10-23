# PDF araması: ilk üç adımın teslim raporu

Tarih: 22 Ekim 2026. Değişiklikler yerel çalışma alanında; commit/push yapılmadı.

## Durum

| İş                                                        | Sonuç                    | Kanıt ve sınır                                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ölçüm altyapısı ve başlangıç ölçümü                       | COMPLETED                | 100 gerçek eser × 5 sorgu çeşidi = 500 sabit aday değerlendirmesi; ayrıca aynı 20 sorguyla canlı başlangıç/son karşılaştırma.                                                    |
| Ortak DOI/Unpaywall katmanı                               | COMPLETED                | Kaynaklardan bağımsız çözümleme, alternatifler, lisans/sürüm, DOI çelişkisi kontrolü, süre/bütçe ve önbellek. Gerçek iletişim adresiyle üç DOI ve ürünün arama akışı doğrulandı. |
| OAPEN/DOAB entegrasyonları                                | COMPLETED                | Resmî tam JSON akışlarından yerel indeksler kuruldu; ikisi de kitap aramasına otomatik kayıtlı.                                                                                  |
| DergiPark fizibilitesi                                    | COMPLETED                | OAI Identify, ListMetadataFormats, ListRecords, GetRecord; kayıt sayfası → PDF keşfi ve gerçek indirme doğrulandı.                                                               |
| Seçilen OAPEN PDF'sinin indirilmesi                       | PARTIAL / EXTERNAL_LIMIT | Katalog araması çalışıyor; seçilen dosya ve denenen erişim yollarında dış kaynak 403 döndürdü. Genel OAPEN erişim durumu hakkında daha geniş sonuç çıkarılmadı.                  |
| 500 bağımsız eserin insan tarafından dosya/baskı kontrolü | DEFERRED                 | Mevcut 500 sorgu 100 eserin çeşitleridir. İnsan tarafından doğrulanmış 500 ayrı eser veya gerçek PDF recall ölçümü değildir.                                                     |

## 1. Ölçüm kümesi ve sonuçlar

`benchmark/pdf-search-v1.json`: 40 Türkçe kitap, 20 yabancı dil kitap, 20 makale,
10 tez, 10 ders notu. Her eser için başlık, başlık/yazar, başlık/yazar/yıl, ASCII/yıl
ve bir harfi eksik başlık/yazar sorguları var. Beş kategoride toplam dağılım
200/100/100/50/50 sorgudur. Kaynak anlık görüntüleri, URL/zaman/SHA-256 bilgileri
`benchmark/evidence/` altında korunur. Aynı eserin bütün çeşitleri aynı geliştirme/test
bölümünde kalır; değerlendirme oracle'ı sıralama puanını kullanmaz.

| Ölçüm                                      |      Önce |     Sonra | Yorum                                                                                         |
| ------------------------------------------ | --------: | --------: | --------------------------------------------------------------------------------------------- |
| Sabit aday havuzunda ilk sırada doğru eser |   500/500 |   500/500 | Aday zaten havuzda ve başlıklar çoğunlukla ayırt edici; doygun regresyon ölçümüdür.           |
| 20 canlı sorguda ilk sırada doğru eser     |     12/20 |     12/20 | Bu küçük örneklemde artış gösterilmedi.                                                       |
| 20 canlı sorguda ilk beşte doğru eser      |     16/20 |     16/20 | Bulma oranı değişmedi.                                                                        |
| Canlı sorgu P50                            | 19.280 ms | 10.521 ms | Dış kaynakların yanıt/kota durumu da değişti; hız farkını yalnızca koda bağlamak doğru olmaz. |
| Canlı sorgu P95                            | 20.024 ms | 20.022 ms | Yavaş kaynakların 20 saniyelik sınırı etkisini sürdürüyor.                                    |

İki koşunun veri kümesi SHA-256 değeri aynı:
`5dad39555161db622a4fb57e6edf999f8f08ee321e0266200aa3a828d2bc1f0e`.

Canlı karşılaştırma Unpaywall iletişim adresi yapılandırılmadan önce yapıldı.
İletişim adresi daha sonra kullanıcı tarafından verildi; etkin Unpaywall için ayrı
canlı raporlar alındı. İki ayar durumunu aynı karşılaştırma gibi sunmuyoruz.

Son canlı koşuda OAPEN ve DOAB kitap aramalarında 8'er kez çalıştı; kaynak hatası
olmadan sırasıyla 61 ve 66 ham aday döndürdü. Bu sayılar benzersiz eser veya yeni
bulunan PDF sayısı değildir. Sunum/ders kategorisinde 0/4 bulunma devam ediyor;
bu üç adım ders kaynağı kapsamını genişletmeyi içermiyor.

Kanıtlar:

- `pdf-baseline-replay-2026-10-22.json`, `pdf-after-replay-2026-10-22.json`
- `pdf-baseline-live-2026-10-22.json`, `pdf-after-live-final-2026-10-22.json`
- Yöntem ve tekrar çalıştırma: `../benchmark/README.md`

## 2. Ortak DOI ve alternatif erişim

- Unpaywall OpenAlex adaptöründen çıkarıldı; bütün kaynaklardan bulunan DOI'ler,
  gösterilecek sonuçlar için ortak katmanda değerlendirilir.
- DOI normalizasyonu/doğrulaması, DOI başına istek birleştirme ve önbellek var.
  Farklı iptal sinyalleri birbirinin isteğini iptal etmez. 404 olumsuz yanıtı
  saklanabilir; kota, ağ ve süre hataları tam başarı olarak saklanmaz.
- En fazla 8 DOI, ayrı toplam 6 saniye bütçesi ve en fazla 3 işçiyle ele alınır.
  Host kuyruğu korunur. Süre aşımında kaynaklardan gelen künyeler kalır.
- `pdfAdaylari` URL, kaynak, kayıt sayfası, DOI, lisans, sürüm, host ve bağlantı
  türünü korur. PDF ile yalnızca kayıt sayfası sunan konumlar ayrılır. Açıkça başka
  DOI'ye yönelen aday elenir; PDF konumları kayıt sayfalarından önce denenir.
- OpenAlex'in bütün açık `locations` alanları alınır. İsteğe bağlı
  `OPENALEX_API_KEY` yalnızca Authorization başlığına konur.
- Arama ve kitaplık indirmelerinde aynı kaynağın alternatifleri de kuyruğa gider;
  kaydedilen eserlerde adaylar ve erişim durumu korunur.
- Kullanıcının verdiği e-posta yalnızca yerel, Git dışında tutulan `.env` içindeki
  Unpaywall ayarına yazıldı. Bu özel adres diğer kaynakların User-Agent veya
  OpenAlex sorgularına taşınmıyor; kaynak koda ve raporlara yazılmadığı kontrol edildi.

Boş ve yalıtılmış önbellekle canlı kontrol:

| DOI                            | PDF konumu | Yalnızca kayıt sayfası | Hata |
| ------------------------------ | ---------: | ---------------------: | ---- |
| `10.1038/s41597-023-02208-w`   |          3 |                      1 | Yok  |
| `10.1371/journal.pone.0000308` |          0 |                      4 | Yok  |
| `10.1038/s41586-021-03819-2`   |          1 |                      1 | Yok  |

CORE makalesinin üretim arama fonksiyonuyla aramasında üç DOI'nin üçü de işlendi;
tam metin katmanında hata oluşmadı. Raporlar:
`pdf-fulltext-live-2026-10-22.json` ve `pdf-configured-search-live-2026-10-22.json`.
Bu konumlar hâlâ adaydır; ürün genelinde dosya içeriği/baskı doğrulaması eklenmedi.

## 3. OAPEN, DOAB ve DergiPark

REST aramalarının bu ağdan 403 döndürmesi nedeniyle resmî olarak sunulan toplu
JSON üstveri hizmetleri kullanıldı. Bu yol erişim korumasını aşmaya dayanmaz.

| Kaynak | İndeksteki kayıt | Tam akışın alınma zamanı (UTC) |
| ------ | ---------------: | ------------------------------ |
| OAPEN  |           51.463 | 2026-10-22 19:49:00            |
| DOAB   |          107.229 | 2026-10-22 19:49:23            |

Kaynaklar örtüşebilir; toplamları benzersiz eser sayısı değildir. İndeksler
`.data/catalogs/` içinde ve Git dışındadır. Güncelleme komutu `npm run sources:sync`.
Başarısız veya kesilmiş akış eski indeksi bozmaz; bildirilen toplam kontrol edilir,
tamamlanan dosya atomik yayımlanır. Bir kaynağın güncellemesi hata verirse diğer
kaynak denenir. İndeks sürümü değişince arama/kaynak önbelleği geçersiz olur.

Unicode satır ayıracı bulunan gerçek DOAB kayıtları için JSONL okuyucusu düzeltildi.
Kitap bölümleri etiketlenir; bölümün üst kitabına ait ISBN/sayfa sayısı bölümün
kimliği olarak sunulmaz. Editör adı yazar diye uydurulmaz; birden fazla ISBN'den
PDF baskısı için keyfi seçim yapılmaz.

DOAB örneği: **A World of Nourishment** gerçekten indirildi; 9.433.209 bayt,
352 sayfa; ilk sayfalarda başlık görüldü. SHA-256:
`87f5842befaf178bffad9dca895c78abe88f1f7eda2c2e4182439d9dd687e481`.
Seçilen OAPEN örneğinin indirmesi 403 ile sınırlı kaldı.
Kanıt: `pdf-new-sources-live-2026-10-22.json`.

DergiPark'ta OAI-PMH 2.0 ve dört üstveri biçimi gözlendi. Örnek makalenin kayıt
sayfasının bildirdiği PDF indirildi: 438.480 bayt, `%PDF-` imzası. SHA-256:
`40fef0cd2cdfefe59afa198740eacd6577eca919259f4f004cc761ef49a9f439`.
Kanıt: `dergipark-feasibility-2026-10-22.json` ve `dergipark-evidence/`.
Bu aşama fizibilitedir; DergiPark için geniş kapsamlı arama kaynağı yayımlanmadı.
Sonraki entegrasyon OAI üstverisini artımlı toplayan yerel indeks gerektirir.

## Doğrulama ve kalan sınırlar

- `npm run check`: lint ve TypeScript geçti; 31 test dosyasında **384/384 test geçti**.
- `npm run format:check`: geçti.
- `node scripts/dogrula-kurulum.mjs`: 31/31 geçti.
- `git diff --check`: geçti. `.env` ve `.data` Git dışında.
- Bozuk kaynak/sürüm, kaynak zaman aşımı, DOI uyuşmazlığı, 404/429, cache yenileme,
  Unicode, kesilmiş katalog, atomik eski indeks koruması, kitap/bölüm ayrımı,
  kitaplık kalıcılığı ve arayüz indirme alternatifleri regresyonlarla kapsandı.

Sektör liderliği, bütün PDF'lerin erişilebilirliği veya 500 bağımsız gerçek dosyada
başarı iddiası yok. Otomatik dosya-kimlik doğrulaması, erken sonuç akışı ve daha
geniş kaynak kapsamı ilk üç adımın dışında kaldı. Mevcut çalışan sunucu izleme
modunda değilse yeni kaynakları ve iletişim ayarını kullanması için yeniden başlatılmalı.
