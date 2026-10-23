# Dosya–eser doğrulaması, erken sonuçlar ve üniversite arşivleri

Tarih: 23 Ekim 2026. Kapsam: uygulama değişiklikleri, doğrulama sonuçları ve canlı erişim sınırları.

## Teslim durumu

| İş                                     | Durum                           | Kanıt / sınır                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dosya–eser kimliği ve alternatif kopya | COMPLETED                       | Arama ve kitaplık PDF indirmeleri kimlik taşır. PDF parser, ön sayfalar, başlık/yazar ve mevcut DOI/ISBN/baskı kanıtları değerlendirilir. Uyuşmayan/açılamayan kopyada sonraki bağlantıya geçilir. |
| Erken sonuç akışı                      | COMPLETED                       | Aynı arama API'sinde isteğe bağlı NDJSON; kaynaklar tamamlandıkça kartlar gelir. JSON uyumluluğu, iptal, kesilen akışta sonuç koruma ve açık indirme paneli test edildi.                           |
| Bilkent ve Sabancı kaynakları          | COMPLETED / LIMITED_LIVE_SAMPLE | Tek ortak konu sorgusunda sırasıyla 5 ve 4 kayıt; bütün arşiv kapsamı veya recall ölçümü değildir.                                                                                                 |
| ODTÜ OpenMETU kaynağı                  | PARTIAL / EXTERNAL_LIMIT        | Gerçek kayıt/arama sayfasının yapısı incelendi, ayrıştırıcı ve kayıt filtreleri test edildi; son canlı uygulama aramaları zaman aşımına uğradı. Uçtan uca canlı arama başarısı iddia edilmiyor.    |
| Yerel üniversite indeksi               | COMPLETED / SCOPED              | Yalnızca aramalarda gerçekten gözlenen künyeler, atomik JSON saklama, bellekte ters kelime indeksi ve BM25. Tam arşiv veya PDF tam metin indeksi değildir.                                         |
| Anlamsal arama                         | DEFERRED                        | Kelime aramasına kıyasla ek katkı ölçülmedi. Haricî model, model indirmesi, API anahtarı veya ücretli servis eklenmedi.                                                                            |

## Uygulama kararları

### Dosya kimliği

PDF imzası eser kanıtı değildir. Dosya indirilirken önce `.part` olarak saklanır;
kimlik kontrolü atomik yayımlamadan önce yapılır. PDF başlığı/ön sayfalarındaki
başlıkla birlikte yazar, DOI veya ISBN kanıtı aranır. Açık DOI/ISBN/baskı çelişkisi
reddedilir. Kaynakça bölümünün sonrasındaki kanıtlar eşleştirmede kullanılmaz;
önizleme ve kitap eleştirisi işaretleri tam eser doğrulaması sayılmaz.

Doğrulama sonucu **eşleşti / belirsiz**, kanıtlar, incelenen sayfa sayısı ve kontrol
zamanıyla kuyruğa taşınır. Yanlış dosya yayımlanmaz; sıradaki bağlantı denenir.
Bağlantı sayacı indirme kuyruğunda görünür. Bozuk dosya ve aktarım hataları da
alternatif denemesine izin verir. İptalde yarım dosya temizliği beklenir.
Kuyruk tekilleştirmesi URL yanında kimlik ve alternatif listesini de dikkate alır;
aynı URL için farklı baskı isteği eski işe yanlışlıkla bağlanmaz.

Sınırlar: en çok sekiz bağlantı, bağlantı başına 30 saniye, toplam 120 saniye;
dosya başına 300 MB. İçerik kontrolü en çok 40 MB ve ilk dört sayfa. OCR yoktur;
metinsiz/büyük dosya belirsiz kalır. Kontrol kitabın tamamlığını, bütün sayfaları veya
her baskı ayrıntısını ispatlamaz. Belirsiz ilk dosya kullanılabilir olarak sunulur;
sonraki bütün alternatiflerde daha iyi kanıt aramak bu sürümde yoktur.
Eski API istemcisi kimlik göndermiyorsa biçim denetimi sürer, eser doğrulaması
iddia edilmez. Doğrulama indirme sırasında yapılır; arama kartındaki PDF hâlâ adaydır.

### Erken sonuçlar

`POST /api/search`, `Accept: application/x-ndjson` başlığıyla durum/sonuç
görünümleri gönderir. Başlıksız çağrılar JSON yanıtını korur. Hızlı kaynaklar yavaş
kaynakları ve ortak DOI zenginleştirmesini beklemez. Nihai sıralama kaynakların
tamamlanma sırasından bağımsızdır. Başarılı kaynak önbelleği korunur; hatalı veya
kısmi kaynaklar yeniden sorgulanır. İptal edilen arama başarı diye saklanmaz.

Tarayıcı UTF-8 ve satır sınırları parçalanmış yanıtları birleştirir. Arama durdurma,
yeni sorguya geçme ve HTTP bağlantısının kapanması alt isteklere iptal sinyali
gönderir. Kesilen akışta eski sonuçlar ve eksik tarama uyarısı kalır. Bekleyen
kaynaklar taranmış sayılmaz. Akış güncellemelerinde açık indirme/özet panelleri
korunur; otomatik sayfa sayımı kaynaklar bitince başlar.

### Arşivler ve yerel indeks

Bilkent resmî DSpace keşif API'sinden; ODTÜ/Sabancı arama sonuçları ve gözlenen
DC/citation üstverilerinden okunur. Kayıt adresleri kuruma özgü origin/yol
kurallarıyla sınırlandırılır. Kitap, bölüm, tez, rapor, ders notu ve sunum ayrı
etiketlenir. Tez/raporlar Makale, ders notu/sunumlar Slayt altında bulunur.
Yıl veya tür sorgudan uydurulmaz. Ambargo/kısıt bilgisi bulunan kayıt açık PDF
adayı sayılmaz; dosyasız künye erişim sayfası olarak kalır.

ODTÜ/Sabancı için konu sorgusundan en fazla beş kayıt incelenir. Bazı kayıtların
künyesi alınamazsa kalanlar korunur, kaynak uyarısı görünür ve eksik cevap tam
başarı olarak önbelleğe alınmaz. HTML sağlayıcı değişiklikleri ileride adaptör
bakımı gerektirebilir. API/HTTP kaynak hata yalıtımı ve mevcut SSRF kontrolleri
korunur.

Yerel saklama `.data/archives/observed.json`: en çok 20.000 kayıt/20 MB; sınırda
eski gözlemler çıkarılır. Bir sunucu sürecinde yazılar sıralanır ve atomik yayımlanır.
Bozuk indeks sessizce sıfırlanmaz; yerel kaynak hata verirken canlı kaynak sonucu
korunur. Sürüm değişimi arama/kaynak önbelleğini ve bellekteki kelime indeksini
geçersiz kılar. Başlık üç kez ağırlıklandırılır; konu/özet de aranır. Yerel kartlar
son canlı gözlem tarihini ve arşiv adını korur. Erişim indirmede yeniden kontrol edilir.

## Canlı kanıt

Tekrarlanabilir komut: `npx tsx scripts/probe-institutional.ts`. Son kayıt
`universite-dogrulama-live-2026-10-23.json` dosyasındadır. Komut geçici ESM kaynak,
indirme, önbellek ve indeks klasörlerinde çalışır; bitince geçici dosyaları temizler.

- `machine learning`: Bilkent 5, Sabancı 4 makale/tez kaydı; ODTÜ zaman aşımı.
- Bilkent'ten **Classification of regional ionospheric disturbance based on machine learning techniques**
  PDF'si gerçekten indirildi: **769.800 bayt, 1 sayfa**; ön sayfadaki başlık ve yazar
  kanıtı eşleşti. SHA-256: `0670da42cb4a2e588b9fccce855f63e47967bb7b87b0cc9af24f5b6805bb1bbb`.
- Yerel indeks de açıkken `neural network` sorgusunda ilk sonuç **19 ms**, tarama
  **7.028 ms**. Bu tek sıcak/önceden gözlenmiş örnektir; P50/P95, soğuk başlangıç
  veya genel hız artışı iddiası değildir. ODTÜ hatası kaynak durumunda kaldı.

## Doğrulama

- `npm run check`: lint, TypeScript ve **36 test dosyasında 412/412 test** geçti.
- Gerçek HTTP NDJSON akışı, istemci bağlantısının kapanmasıyla kaynak iptali ve
  tarayıcıdaki erken kartlar/kesilen UTF-8/indirme panelinin korunması test edildi.
- Gerçek PDF parser ile yanlış eser → doğru alternatif, bozuk dosya → sonraki
  kopya, metinsiz dosya belirsizliği ve reddedilen dosyanın yayımlanmaması test edildi.
- ISBN/baskı/DOI çelişkileri, kaynakça/eleştiri/dağınık kelime kanıtları, üniversite
  kayıt alanları, ambargo, bozuk indeks ve eşzamanlı kayıt güncellemeleri kapsandı.
- `npm run smoke`: yerel HTTP duman kontrolleri geçti.
- `node scripts/dogrula-kurulum.mjs`: **31/31** geçti; 25 kaynak yüklendi, yükleme
  hatası yok. Kurulum kontrolü her dış sağlayıcının canlı erişimini ispatlamaz.

Windows kısıtlı test ortamında atomik `rename` işlemleri EPERM verdi; aynı testler
normal dosya erişimiyle çalıştırıldı ve geçti. Bu nedenle ürünün atomik dosya
işlemleri kaldırılmadı veya daha zayıf kopyalama yöntemiyle değiştirilmedi.

## İncelenen resmî yüzeyler

- [DSpace keşif sözleşmesi](https://github.com/DSpace/RestContract/blob/main/search-endpoint.md)
- [Bilkent resmî API kökü](https://repository.bilkent.edu.tr/server/api)
- [Bilkent doğrulanan kayıt](https://repository.bilkent.edu.tr/items/1d9e98a7-c82c-426b-9149-a3ea274da54d)
- [ODTÜ OpenMETU](https://open.metu.edu.tr/)
- [ODTÜ incelenen kayıt](https://open.metu.edu.tr/handle/11511/120946)
- [Sabancı resmî arşivi](https://research.sabanciuniv.edu/)
- [Sabancı incelenen künye](https://research.sabanciuniv.edu/id/eprint/54962/)

Anlamsal arama için sonraki karar: kelime aramasının kaçırdığı, yazar/baskı/DOI
çelişkileri de içeren ayrı konu sorgularında ek faydayı ölçmek; ancak bundan sonra
isteğe bağlı yerel model değerlendirmek. Üretilmiş URL ve katalog dışı eser sonucu
eklemek bu akışın parçası değildir.
