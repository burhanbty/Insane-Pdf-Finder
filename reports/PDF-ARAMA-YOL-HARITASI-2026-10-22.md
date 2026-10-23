# PDF arama ve bulma: inceleme ve geliştirme yol haritası

Tarih: 22 Ekim 2026. Kapsam: mevcut kaynak kodunun incelenmesi ve kaynakların resmî belgelerinin araştırılması. Bu rapor öneridir; uygulama davranışı değiştirilmedi. Yeni sağlayıcılarda uçtan uca arama/indirme testi veya karşılaştırmalı başarı ölçümü yapılmadı.

## Karar

En yüksek öncelik, bulunan eserin bütün erişim konumlarını değerlendiren ortak bir tam metin çözümleme katmanıdır. Buna açık erişimli kitap kaynakları ve Türkçe kurumsal arşiv kapsamı eklenmelidir. Yeni kaynakların değerini kayıt sayısıyla değil, ekledikleri benzersiz ve doğrulanmış PDF sayısıyla ölçmek gerekir.

Bugünkü başarı oranı ölçülmeden yüzde kaç iyileşme sağlanacağı veya sektör liderliği söylenemez. Özellikle Türkçe eser bulma, doğru baskıyı ayırma ve çalışan dosya sunma birlikte ölçülürse ürünün güçlü bir uzmanlık alanı olabilir.

## Koddan doğrulanan durum

| Bileşen                          | Mevcut davranış                                                                                        | İyileştirme fırsatı                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/search.ts:71`               | Kaynaklar paralel çalışıyor; cevap tüm kaynak görevleri tamamlanınca oluşturuluyor.                    | Hızlı sonuçları akıtmak; kalan kaynakları durumlarıyla güncellemek.                                                                                                |
| `src/search.ts:136`              | Gruplar eşleşme puanıyla sıralanıyor ve limit uygulanıyor.                                             | Eser uygunluğunu koruyarak erişim kalitesiyle ikinci aşama sıralama.                                                                                               |
| `src/sources/openalex.ts:72`     | Unpaywall yalnızca bu adaptörün içinde çağrılıyor.                                                     | Crossref, Semantic Scholar, OpenAIRE ve diğer kaynaklardan gelen DOI'leri de ortak çözümleyiciye göndermek.                                                        |
| `src/sources/openalex.ts:116`    | Kayıtlar döngüde işleniyor; gerektiğinde Unpaywall çağrısı bekleniyor.                                 | Künye sonuçlarını önce korumak; DOI çözümlemelerini ayrı bütçe ve sınırlı eşzamanlılıkla yapmak. Kaynak zaman aşımında künye kaybı olasılığı ayrıca test edilmeli. |
| `src/sources/openalex.ts:131`    | `best_oa_location` veya ilk alternatif seçiliyor.                                                      | Tüm `oa_locations` ve OpenAlex `locations` adaylarını değerlendirmek.                                                                                              |
| `src/sources/openalex.ts:90`     | Seçilen alanlarda `locations`, `has_content`, `content_urls` yok; OpenAlex API anahtarı gönderilmiyor. | Güncel erişim alanlarını ve isteğe bağlı anahtar desteğini eklemek.                                                                                                |
| `src/types.ts:43`                | Kaynak kaydında tek `pdf` alanı bulunuyor.                                                             | Aynı kaynağın birden fazla dosyasını, sürümünü ve doğrulama kanıtını saklamak. Farklı kaynakların PDF'leri zaten ayrı kayıtlarda korunuyor.                        |
| `src/pdf-resolver.ts:32`         | Citation meta, alternate PDF ve dar kapsamlı indirme bağlantıları okunuyor.                            | JSON-LD `contentUrl`/`encoding`, HTTP Link ve DSpace/OJS/Invenio bağlantılarını kimlik kontrolüyle çözmek.                                                         |
| `src/pdf-resolver.ts:144`        | PDF imzası kontrol edilince yanıt kabul ediliyor.                                                      | PDF içeriği ile eser kimliğini ayrıca karşılaştırmak; imza kontrolü eser doğrulaması değildir.                                                                     |
| `src/normalize.ts:285`           | Ana puan başlık token benzerliği, yazar ve yıldan hesaplanıyor.                                        | DOI/ISBN kesin eşleşmesi, baskı/dil tutarlılığı, ayırt edici kelimeler ve erişim kanıtı. Baskı/dil kontrolleri mevcut `matching.ts` içinde zaten kısmen var.       |
| `src/sources/web-slayt.ts:81`    | Genel web araması Bing HTML yapısını ayrıştırıyor.                                                     | Sağlayıcı arayüzü üzerinden resmî arama API'si kullanmak; HTML yolunun gerçek başarısını ayrı ölçmek.                                                              |
| `src/http.ts:28`, `src/cache.ts` | Host kuyruğu, tekrar deneme ve önbellek zaten var.                                                     | Bunları koruyup kaynak sağlık geçmişi, kota bütçesi ve geçici devre kesici eklemek.                                                                                |

## Önerilen arama akışı

1. **Sorguyu anla:** eser adı, DOI, ISBN, URL, yapıştırılmış kaynakça veya konu sorgusu. Kitap/makale/slayt ayrımına tez ve rapor eklenebilir.
2. **Kimlik adaylarını bul:** DOI/ISBN varsa doğrudan kayıt; yoksa başlık ve yazar. İlk başarısızlıkta sınırlı sorgu çeşitleri: alt başlıksız ad, özgün Türkçe yazım, ASCII karşılığı, yazar soyadı. Dil ve baskı kısıtlarını otomatik gevşetme.
3. **Eseri belirle:** makale kimliği, kitap eseri, dil, baskı ve dosya ayrı düzeylerde tutulmalı. Farklı ISBN'ler aynı eserin farklı biçimleri olabilir; bunları tek doğrulanmış baskı gibi sunmamalı.
4. **Bütün erişim adaylarını topla:** OpenAlex konumları, Unpaywall konumları, mevcut kaynak PDF'leri, depo kayıt sayfaları ve isteğe bağlı OpenAlex içerik hizmeti.
5. **Adayları doğrula:** sınırlı istek ve bayt bütçesi, yönlendirme kontrolü, PDF imzası, dosyanın açılabilmesi, DOI/ISBN/başlık/yazar kanıtı. İlk sayfa tek başına yeterli olmayabilir; künye sayfası veya OCR gerekebilir. Kanıt eksikse “belirsiz” durumunu koru.
6. **Sonuçları güncelle:** ilk künye sonuçları erken gelsin; PDF doğrulaması geldikçe kartlar yenilensin. Kullanıcı iptali alt isteklere yayılsın.
7. **Alternatif sun:** ana dosya erişilemiyorsa aynı eserin başka doğrulanmış konumu. Özet, ek dosya, kitap bölümü, önizleme ve tam kitap ayrı etiketlensin.

Önerilen erişim adayı alanları: URL, kaynak, kayıt URL'si, DOI/ISBN, sürüm, biçim, erişim türü, lisans, kontrol zamanı, son hata ve doğrulama kanıtı. Kimlik uygunluğu ve dosyaya erişim ayrı puanlar olmalı; indirilebilir ilgisiz dosya doğru eseri geçmemeli.

## Yeni kaynaklar ve mevcut kaynak genişletmeleri

| Öncelik           | Kaynak                                   | Sağlayacağı kapsam                                              | Bağlantı yolu ve sınır                                                                                                                     |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| P0                | OAPEN Library                            | Açık erişimli akademik kitaplar ve kitap bölümleri.             | Resmî REST araması ve dosya bilgileri; kitap/bölüm ayrımı gerekli.                                                                         |
| P0                | DOAB                                     | Açık erişimli kitap keşfi ve yayınevi/depo bağlantıları.        | Resmî REST araması; her kayıt doğrudan PDF barındırmaz. OAPEN ile örtüşme kimlik üzerinden giderilmeli.                                    |
| P0                | DergiPark                                | Türkçe akademik makaleler.                                      | OAI-PMH üstveri toplama ve kayıt sayfasından dosya çözümleme. OAI-PMH tam metin arama API'si değildir; yerel indeks gerekebilir.           |
| P1                | Üniversite arşivleri, başlangıç OpenMETU | Tez, makale, rapor ve sunumlar.                                 | Depo sürümüne göre DSpace/OAI-PMH/API adaptörü; kurum uç noktaları ayrıca doğrulanmalı. Ambargolu kayıt PDF sayılmaz.                      |
| P1                | OpenStax                                 | Açık ders kitapları.                                            | Resmî kitap sayfasından PDF; makine erişim yolu için ayrı keşif testi gerekli.                                                             |
| P1                | MIT OpenCourseWare                       | Ders notları, alıştırmalar ve ders materyalleri.                | Ders/dosya sayfası çözümleyicisi; ders notu tam kitap gibi sınıflandırılmamalı.                                                            |
| P1                | Figshare                                 | Makale dosyaları, sunum, poster ve araştırma çıktıları.         | Resmî arama ve dosya API'si; veri kümesi ile PDF belge ayrımı gerekli.                                                                     |
| P2                | DOAJ                                     | Açık erişimli dergi ve makale kayıtları; tam metne yönlendirme. | Resmî API/veri hizmetleri; yeni benzersiz katkısı mevcut indekslerle karşılaştırılmalı.                                                    |
| P2                | YÖK Ulusal Tez Merkezi                   | İzinli tezlerin keşfi ve erişim sayfası.                        | Açık ve desteklenen makine erişim yolu bu araştırmada doğrulanmadı; önce fizibilite, gerekirse kaynak sayfasına yönlendirme.               |
| P0, mevcut kaynak | OpenAlex içerik hizmeti                  | OpenAlex'in kendi sakladığı PDF kopyaları.                      | `has_content` ve `content_urls`; API anahtarı ve kullanım bütçesi gerekiyor. Mevcut orijinal yayınevi URL'lerinden farklı bir erişim yolu. |

Mevcut arXiv, CORE, OpenAIRE, HAL, Europe PMC, Zenodo, Semantic Scholar, Internet Archive, Open Library ve Gutenberg entegrasyonları yeniden “yeni kaynak” diye eklenmemeli. Önce çalışırlıkları ve benzersiz katkıları ölçülmeli. PMC için Europe PMC'den bağımsız yeni arama adaptörü yerine gerekirse resmî tam metin erişim yolu araştırılabilir.

## Algoritma öncelikleri

- **P0: Ortak DOI çözümleme ve çoklu PDF adayları.** Kaynak başına tek URL yerine bütün uygun konumlar; DOI bazlı önbellek ve tekrar istek birleştirme.
- **P0: Eser ve dosya doğrulamasını ayırma.** “Künye bulundu”, “PDF adayı”, “PDF açıldı”, “eserle eşleşti” farklı durumlar. Kontrol zamanı gösterilmeli.
- **P0: Altın veri kümesi ve ölçüm.** Yanlış baskı, yanlış yazar, kitap eleştirisi, örnek bölüm, kapalı erişim, Türkçe karakter ve yazım hatası örnekleri içermeli.
- **P1: Aşamalı arama ve sonuç akışı.** Hızlı kimlik sorguları, sonra depo çözümleme, gerektiğinde web. Kullanıcı “hızlı” ve “derin” arama seçebilir.
- **P1: Resmî web arama API'si.** Brave bir aday; `site:`/`filetype:` desteği olsa da sonuçlar yine doğrulanmalı. Hesap ve kullanım maliyeti ayrıca değerlendirilir.
- **P1: Kaynak değerine göre yönlendirme.** Türkçe kitap ile biyomedikal makalede aynı kaynak bütçesini kullanmama. Başarı oranını konu/dil bazında tutma.
- **P2: Yerel indeks.** İzinli OAI-PMH/veri akışlarını artımlı toplama; önce tam metin/kelime indeksi, ardından gerekirse anlamsal aday bulma.
- **P2: Anlamsal arama ve yeniden sıralama.** Konudan eser bulmada yararlı olabilir; tam eser aramasında DOI, ISBN ve baskı çelişkilerini geçersiz kılamaz. LLM'nin ürettiği URL, kaynakta gözlenmeden sonuç olamaz.
- **P2: Kullanıcının belgesinden arama.** Kaynakça yapıştırma, toplu DOI/ISBN, kapak/künye OCR; her satır için ayrı sonuç ve belirsizlik.

## Başarı nasıl ölçülecek?

Başlangıç önerisi 500 elle etiketlenmiş sorgu: 200 Türkçe kitap, 100 yabancı dil kitap, 100 makale, 50 tez/rapor, 50 sunum/ders notu. Hedef kullanım dağılımına göre ağırlıklar değiştirilebilir. Geliştirmede kullanılan örneklerden ayrı bir test bölümü tutulmalı.

- İlk sırada doğru eser ve doğru baskı oranı.
- İlk 5 sonuç içinde doğru eser bulunma oranı.
- Bağımsız olarak erişilebilir olduğu bilinen belgelerde, doğru tam metnin bulunup gerçekten indirilebilme oranı. Bilinmeyen tam metin evreni için mutlak recall iddiası yapılmamalı.
- Yanlış dosyayı doğrulanmış gösterme, yanlış eser birleştirme ve farklı baskı birleştirme oranı.
- İlk yararlı sonuç ve ilk doğrulanmış PDF için P50/P95 süre; sıcak/soğuk önbellek ayrı.
- Kaynak başına benzersiz doğrulanmış eser katkısı, kota/403/429 oranı ve başarılı PDF başına API maliyeti.
- Kaynak erişilemediğinde eksik taramayı “eser yok” diye göstermeme.

Her kaynak eklentisini ayrı çalıştırıp marjinal kazancı ölçmek gerekir. Bir kaynak aynı eserleri tekrar getiriyorsa, sayısı artsa da bulma başarısı artmayabilir. Sektör karşılaştırması aynı sabit sorgular, tarihler, bütçeler ve erişim koşullarıyla yapılmalı; katalog keşfi ile gerçek dosya indirme başarısı ayrı raporlanmalı.

## Uygulama sırası

1. Ölçüm kümesi ve mevcut sistemin başlangıç ölçümü.
2. Ortak DOI/Unpaywall çözümleme, OpenAlex konumları/anahtar desteği, çoklu dosya veri modeli.
3. OAPEN ve DOAB adaptörleri; DergiPark üstveri ve PDF keşif fizibilitesi.
4. Kimlik doğrulama, alternatif dosya denemesi, erken sonuç akışı ve kaynak sağlık ölçümü.
5. Kurumsal arşivler, OpenStax, MIT OCW ve Figshare; her biri için benzersiz katkı değerlendirmesi.
6. Karşılaştırma sonucu gerekliyse yerel indeks ve anlamsal sıralama.

Bu sıralama bir teknik öncelik önerisidir; süre veya başarı yüzdesi taahhüdü değildir.

## Resmî kaynaklar ve doğrulama sınırı

Belgeler 22 Ekim 2026 tarihinde araştırıldı. OAPEN/DOAB belgeleri arama indeksinden okunabildi; doğrudan sayfa açma denemeleri bu araştırma aracında 403 döndürdü. DergiPark genel `Identify` isteği araştırma aracıyla açılamadı; dergiye ait OAI yanıtı indekslenmişti. Bunlar uygulama sunucusundan yapılmış entegrasyon testleri değildir.

- OAPEN REST: https://www.oapen.org/article/8185269-search-using-a-rest-api
- OAPEN metadata/OAI-PMH: https://www.oapen.org/article/metadata
- DOAB REST: https://www.doabooks.org/en/article/api-search-doab
- DergiPark OAI örneği: https://dergipark.org.tr/api/public/oai/ap/
- OAI-PMH protokolü: https://www.openarchives.org/pmh/
- OpenMETU kapsamı: https://open.metu.edu.tr/about ve https://open.metu.edu.tr/faq
- OpenStax PDF erişimi: https://help.openstax.org/s/article/student-book-access?language=en_US
- MIT OCW indirilebilir ders materyalleri: https://ocwtogo.mit.edu/
- Figshare arama/dosya API: https://info.figshare.com/user-guide/how-to-use-the-figshare-api/
- DOAJ metadata/API: https://doaj.org/docs/faq/ ve https://doaj.org/terms/
- YÖK erişim koşulları: https://tez.yok.gov.tr/UlusalTezMerkezi
- Unpaywall bütün OA konumları: https://data.unpaywall.org/data-format
- OpenAlex güncel kimlik doğrulama: https://help.openalex.org/api/authentication/
- OpenAlex tam metin hizmeti: https://help.openalex.org/access/fulltext/
- OpenAlex konum alanları: https://help.openalex.org/data/locations/
- Brave resmî arama API: https://brave.com/search/api/
- Brave sorgu operatörleri: https://search.brave.com/help/operators
