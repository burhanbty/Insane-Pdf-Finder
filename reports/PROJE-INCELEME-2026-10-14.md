# Kaynak Bul — inceleme ve test raporu

> Güncelleme: Bu belge ilk incelemenin tarihsel sonuçlarını korur. Sonraki düzeltme çalışmasında F01, F03, F04, F07 ve F17 giderildi. Güncel doğrulama: [beş düzeltme raporu](./DUZELTMELER-2026-10-14.md). Aşağıdaki eski kanıtlar düzeltme öncesine aittir; `audit-reproduce.mjs` artık beş düzeltmeyi ve kalan 13 bulguyu denetler, çıktısını `audit-after-fixes.json` dosyasına yazar.

Tarih: 14 Ekim 2026 (Europe/Istanbul). Ortam: Windows, Node v24.18.1, npm 11.16.0.

Projenin mevcut kalite kontrolleri başarılı; buna rağmen arama sonuçlarının doğruluğunu, indirmeyi ve arayüzü etkileyen sorunlar bulundu. Bu raporun 18 bulgusu aynı ağırlıkta değildir: çoğu kontrollü çalıştırmayla doğrulandı; Node sürümü uyumsuzluğu paket bildirimlerinden doğrulandı; güvenlik bulgularının erişim ve tarayıcı koşulları ayrıca belirtilmiştir. Ürün kodu, bağımlılıklar ve yapılandırma değiştirilmedi. Yalnızca `reports/` altında rapor, kanıt ve tekrar çalıştırma betikleri eklendi.

## İncelenen kapsam

Sunucu rotaları, girdi doğrulama, kaynak kayıt sistemi, 18 gerçek kaynak adaptörü ve örnek şablon, normalizasyon/puanlama/gruplama, HTTP istemcisi, disk/bellek önbelleği, indirme, PDF sayfa sayısı, metin çıkarımı/özet, HTML/CSS/JS arayüzü, mevcut sekiz test dosyası, başlatma betikleri, paket kilidi, CI ve README incelendi. `.env` içindeki gizli değerler okunmadı veya rapora yazılmadı.

## Test sonuçları

| Kontrol                                         | Sonuç                                                      | Sınır                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run check`                                 | Geçti: lint, TypeScript, 8 dosyada 97 test                 | Mevcut testler çoğunlukla sahte ağ cevapları kullanıyor                                             |
| `npm run format:check`                          | Geçti                                                      | Repo yapılandırması LibGen ve Anna dosyalarını biçim kontrolünden hariç tutuyor                     |
| `node scripts/dogrula-kurulum.mjs`              | 31/31 geçti                                                | Mevcut kurulumda çalıştırıldı; yeni klon veya yeni `npm ci` yapılmadı                               |
| `node --import tsx reports/audit-reproduce.mjs` | 18 gözlem doğrulandı                                       | Betik mevcut kusurları yeniden üretmeyi doğrular; 18 başarılı özellik testi anlamına gelmez         |
| Sentetik tek sayfalı PDF                        | Sayfa sayısı 1, metin çıkarımı ve extractive özet başarılı | Taranmış PDF/OCR veya geniş belge kümesi kabulü değildir                                            |
| Canlı kaynak kontrolleri                        | 17 adaptör: 13 kayıtlı, 2 boş, 2 hata                      | Her adaptörde tek sorgu; uçtan uca son kullanıcı araması veya tüm kaynakların genel kabulü değildir |

Canlı testlerde API anahtarları, kullanıcı iletişim bilgisi, LLM çağrıları ve belge indirmeleri kullanılmadı. İstek başına 8 saniye, ortak ağ süresi için 25 saniye sınırı uygulandı. Sonraki kaynak döngüleri/yeniden denemeler bu sürenin ardından hemen hata alabilir. Dönen kayıt sayılarının sorgu limitinden fazla olması bazı adaptörlerin gruplama öncesi daha çok aday getirmesinden kaynaklanır.

## Öncelikli bulgular

P1: temel işlevde veri kaybı veya önemli bozulma; P2: belirli koşullarda işlev/doğruluk/güvenlik sorunu; P3: daha düşük öncelikli yardımcı özellik sorunu.

### F17 — P1: OpenAIRE gerçek API cevaplarını yanlış katmandan okuyor

Konum: `src/sources/openaire.ts:75-82`.

Kod her sonuçta doğrudan `title` arıyor. Canlı yanıtın kayıtları `header` ve `metadata` alanlarından oluşuyor; yayın bilgisi `metadata["oaf:entity"]["oaf:result"]` altında. İki gerçek kaydın olduğu yanıt aynı adaptöre çevrimdışı geri verildiğinde **0 sonuç** üretti. Kullanıcı açık erişim kaynağının boş olduğunu sanıyor; durum paneli ayrıştırma hatasını bildirmiyor.

Öneri: gerçek yanıt şemasını açıp doğrulamak; tek kayıt/dizi varyasyonlarını desteklemek; dolu fakat tanınmayan yanıtı başarıyla boş sonuç olarak raporlamamak. Kanıt: `openaire-live-fixture.json`, `audit-evidence.json/F17`. Birincil kaynak: [test edilen OpenAIRE API yanıtı](https://api.openaire.eu/search/publications?title=Attention%20Is%20All%20You%20Need&size=2&format=json). Yeni API değerlendirilecekse [OpenAIRE Graph dokümantasyonu](https://graph.openaire.eu/docs/11.3.0/apis/graph-api/quickstart/) ayrıca kullanılabilir; bu yeni API'nin cevap yapısı mevcut adaptörle aynı değildir.

### F01 — P1: Benzerlik üzerinden birleşen kaydın kaynak bağlantısı kayboluyor

Konum: `src/search.ts:184-205`.

Kesin anahtar tutmadığında mevcut grup bulunuyor, fakat bu dalda `g.kaynaklar.push(w)` yapılmıyor. İki kayıt `Sapiens` ve `Sapiens: History`, aynı yazar/yılla tek gruba girdi; grubun kaynak listesinde yalnızca ilk kayıt kaldı. İkinci kaydın tek PDF bağlantısı da kayboldu. Bazı açıklama/yazar alanları yine zenginleştirildiği için sorun ilk bakışta fark edilmeyebilir.

Öneri: mevcut gruba eşleşen her kaydı tam olarak bir kez eklemek; farklı anahtarlar üzerinden birleşmede kaynak listesi/PDF/filtre korunmasını test etmek. Kanıt: F01.

### F04 — P1: Eşzamanlı aynı isimli indirmeler aynı `.part` dosyasını kullanıyor

Konum: `src/download.ts:40-51,94-98,125`.

`benzersizYol` yalnızca tamamlanmış dosyaya bakıyor. Devam eden indirme için ad rezerve edilmiyor; `createWriteStream` de varsayılan olarak aynı dosyayı açıp kesebiliyor. Aynı başlıkla başlatılan iki kontrollü indirmeden biri tamamlandı, diğeri `.part` dosyasını yeniden adlandırırken **ENOENT** verdi. Akışların aynı dosyada yazması içerik karışması/üzerine yazma riski de oluşturuyor; bu denemede içerik bütünlüğü ayrıca kabul edilmedi.

Öneri: indirme başına benzersiz geçici dosya, atomik isim rezervasyonu ve rename dahil tüm aşamalarda hata temizliği. Kanıt: F04.

### F03 — P1: HTTP zaman aşımı yalnızca yanıt başlıklarını kapsıyor

Konum: `src/http.ts:73-125,137-139`; etkilediği tüketiciler: `download.ts`, `sayfa.ts`, `summary.ts`, kapak proxy'si ve kaynaklar.

`fetch` başlıklarla tamamlanınca `finally` abort zamanlayıcısını temizliyor. `text()`, `arrayBuffer()` veya indirme akışı sonradan çalışıyor. Başlıkları hemen, gövdeyi 300 ms sonra gönderen yerel sunucuda `timeoutMs: 50` olan `getJson` 327 ms sonra başarıyla döndü. Gövde hiç bitmezse uygulama zaman aşımı işlemiyor; başka alt katmanların süreleri bu korumanın yerine geçmez.

Öneri: zaman aşımını gövde tüketimi bitene kadar etkin tutmak ve kuyruk/yeniden denemeyi içeren toplam istek bütçesini tanımlamak. Kanıt: F03.

### F06 — P2: PDF olmayan bağlantılar PDF olarak sunuluyor ve kaydedilebiliyor

Konum: `src/sources/gutenberg.ts:34-40,83,103`; `src/sources/sci-hub.ts:43,92`; `src/sources/zenodo.ts:62-63`; `src/download.ts:85-93`; `public/app.js:501-529`.

Gutenberg PDF yokken EPUB/MOBI/HTML adresini `pdf` alanına koyuyor. Canlı `Pride and Prejudice` kaydı için PDF alanı **`.epub3.images`** adresiydi. Sci-Hub adaptörü de doğrulanmış belge yerine yönlendirme sayfasını PDF alanına koyuyor; Zenodo ise PDF yoksa ilk dosyayı seçiyor. Arayüz bunlara “PDF indir” ve PDF özeti işlemi sunuyor. İndirici `ipucuTur: "pdf"` değerini gerçek içerik türünün önüne koyduğu için dosya `.pdf` uzantısıyla kaydedilebilir.

Öneri: belge formatı/landing page ayrımı; PDF imzasını doğrulamak; EPUB/TXT gibi formatları kendi eylem ve uzantılarıyla sunmak. Her canlı bağlantının içeriği indirilmedi; Gutenberg eşlemesi hem sahte cevapla hem gerçek metaveriyle doğrulandı. Kanıt: F06 ve canlı kayıt.

### F07 — P2: OpenAIRE URL seçimi PDF yerine DOI metnini döndürüyor

Konum: `src/sources/openaire.ts:100-103`.

`(instanceUrl ?? ... ?? pidStartsWithHttp) ? pid : undefined` ifadesi URL seçiminden sonra üçlü operatör uyguluyor. Doğru `https://repository.test/paper.pdf` bulunmasına rağmen `pid` değeri olan **`10.1234/example`** seçildi. PID yoksa mevcut URL de kaybolabiliyor. F17 düzeltildiğinde bu ikinci hata açık erişim/indirme bağlantılarını bozmaya devam edecektir.

Öneri: instance URL ve HTTP PID'yi ayrı değişkenlerle, geçerli HTTP(S) kontrolünden geçirerek seçmek; açık erişimli landing page'i otomatik PDF saymamak. Kanıt: F07.

### F02 — P2: Aynı başlık ve yıldaki farklı yazarların eserleri birleştiriliyor

Konum: `src/search.ts:158-160,204-205`.

Kesin anahtar yalnızca tür + başlık + yıl. `Data Structures`, 2020, `Alice Smith` ve `Bob Jones` kayıtları tek esere dönüştü; iki bağımsız yazar aynı kartın ortak yazarı gibi gösterildi. ISBN/DOI uyuşmazlığı da karar aşamasında dikkate alınmıyor.

Öneri: güçlü kimlikleri önceliklendirmek; yazar/kimlik çelişkisini kesin başlık eşleşmesiyle ezmemek. Kanıt: F02.

### F16 — P2: Bildirilen Node 20 desteği bağımlılıklarla uyumsuz

Konum: `package.json:8`, `.github/workflows/ci.yml:27`, `src/server.ts:364`, `scripts/baslat.mjs:42` ve kilitlenmiş paketlerin engine bildirimleri.

Proje `>=20` kabul ediyor, CI Node 20 çalıştırmayı hedefliyor. Kurulu/kilitli `pdfjs-dist 6.3.289` Node `>=22.13.0 || >=24`; `vitest 5.0.3` Node `^22.12.0 || ^24.0.0 || >=26.0.0`; `jsdom 30.1.1` ise `^22.22.2 || ^24.15.0 || >=26.0.0` istiyor. Node 20'nin desteklendiği beyanı bu bağımlılık setiyle tutarlı değil.

Öneri: ya paketleri gerçekten Node 20 destekleyen sürümlerde sabitlemek ya da package engines, başlangıç denetimleri, README ve CI matrisi için aynı destek politikasını uygulamak. **Node 20/22 üzerinde çalıştırma yapılmadı; gözlenmiş CI başarısızlığı iddia edilmiyor.** Kanıt: F16.

### F10 — P2: Yalnızca kayıt özeti olan kartta özet düğmesi boş URL gönderiyor

Konum: `public/app.js:501-502,538-543`; `src/server.ts:240-242`.

PDF/tam metin olmayan ama `ozet` alanı bulunan kaynak da `ozetlenebilir` kabul ediliyor. URL, yalnızca `pdf ?? tamMetin` ile oluşturuluyor. Kontrollü DOM'da “Özet çıkar” düğmesi `{url:"",tur:"metin"}` gönderdi; API bunu geçersiz adres olarak reddediyor. LibGen/Anna künyeleri ve birçok katalog kaydı bu koşula girebilir.

Öneri: mevcut açıklamayı görüntülemek veya sadece tam metin adresi bulunan kayıtlara çıkarım düğmesi vermek. Kanıt: F10.

### F12 — P2: Hazır ana sonuçlar genel web araması bitene kadar çizilmiyor

Konum: `public/app.js:128-133`; `src/search.ts:67`.

Arayüzdeki yorum “web aramasını beklemeden göster” diyor, fakat `Promise.allSettled` iki isteği de bekliyor. Ana arama hazır ve web isteği beklerken kart sayısı **0**; web tamamlanınca **1** oldu. Web seçeneği başlangıçta açık olduğu için yavaş web isteği normal aramayı da geciktiriyor. Sunucu tarafında da bütün kaynaklar tamamlanmadan cevap üretiliyor; kaynak başına toplam süre sınırı yok.

Öneri: ana sonucu geldiğinde göstermek, web sonuçlarını sonradan eklemek; uzun kaynakları toplam süre bütçesiyle sınırlandırmak. Kanıt: F12.

### F11 — P2: Kaynağa göre gruplama gerçek gruplama yapmıyor

Konum: `public/app.js:338-379`.

Kod puan sırasındaki kartları kaynağa göre sıralamadan yalnızca kaynak değişince başlık ekliyor. `A, B, A` kartlarında **“A 2 sonuç / B 1 sonuç / A 2 sonuç”** başlıkları çıktı. A kaynağı iki ayrı gruba bölünüyor; başlık sayısı altındaki görünür kart sayısıyla uyuşmuyor.

Öneri: kartları önce ana kaynak kovalarına ayırmak; gruplama kapandığında özgün puan sırasını geri kurmak. Kanıt: F11.

### F08 — P2: Künye türü ve sayfa sayısı hatalı üretilebiliyor

Konum: `src/sources/crossref.ts:42,83`; `src/sources/openaire.ts:115`.

Crossref'in `page: "e1000234"` alanı **1.000.234 sayfa** sayıldı. Tek sayfa numarası da belge toplamı gibi yorumlanıyor. Ayrıca Crossref `type:"book"` kaydını `makale`, OpenAIRE makale sorgusunun kaydını `kitap` etiketledi. Bu yanlış türler aynı eserin farklı kaynak kayıtlarının birleşmesini de engelliyor.

Öneri: yalnızca güvenilir sayfa aralığını toplam sayıya çevirmek; tek numara/e-location'ı ham künye olarak tutmak; yayın türünü API metaverisinden eşlemek. Kanıt: F08 ve F07.

### F09 — P2: Sorgudaki yıl/yazar kaynak metaverisi gibi gösteriliyor

Konum: `src/sources/wikipedia-tr.ts:104-105`, `src/sources/gutenberg.ts:94`, `src/sources/web-slayt.ts:178-179,219-220`.

Wikipedia cevabında yazar/yıl yokken adaptör `Invented Author`, **2099** değerlerini sonuç künyesine yazdı. Gutenberg de yayın yılı olmayan cevaba sorgudaki 2099'u ekledi. Web adaptöründe de aynı atama mevcut. Bu davranış kaynak doğrulamış gibi puanı yükseltir, yıl uyum kontrolünü etkisiz bırakır ve gerçek kayıtlarla yanlış birleşmeye katkıda bulunur.

Öneri: doğrulanmayan alanları boş bırakmak; arama terimlerini bibliyografik alanlara kopyalamamak. Kanıt: F09, F06; web atamaları kod incelemesiyle doğrulandı.

### F13 — P2: Kaynak bağlantılarında HTTP(S) protokol kontrolü uygulanmıyor

Konum: `public/app.js:65-73,495`.

Genel arama adresi `guvenliAdres` ile kontrol edilse de kaynak rozeti yalnızca HTML kaçışı kullanıyor. Sahte kaynak cevabındaki `javascript:alert(1)` DOM'da aynen `href` oldu. HTML kaçışı protokolü güvenli yapmaz.

Öneri: bütün dış linklerde aynı protokol doğrulamasını uygulamak ve uygunsuz adresi tıklanabilir link olarak sunmamak. **Script çalıştırılmadı; modern tarayıcıda `_blank`/`noopener` koşulları altında başarılı XSS istismarı kanıtlanmadı.** Doğrulanan bulgu güvenilmeyen URL şemasının arayüze aktarılmasıdır. Kanıt: F13.

### F14 — P2: İçerik URL'leri yerel/özel ağ adreslerine de erişebiliyor

Konum: `src/server.ts:20-25,213-226,240-261,273-290`; `src/download.ts:56-62`; `src/http.ts:76-79`.

URL doğrulaması yalnızca HTTP(S) protokolünü kontrol ediyor; hostname/IP ve yönlendirme hedefini sınırlamıyor. İzole API sunucusuna kendi kontrollü loopback sunucumuzun adresi verildiğinde **200** ile işaret metni indirildi. Yalnızca denemeye ait sunucuya erişildi; diğer yerel servisler araştırılmadı.

Öneri: iş gereksinimine uygun URL politikası; özel/loopback/link-local adreslerin, DNS çözümünün ve her yönlendirmenin doğrulanması. Varsayılan HOST `127.0.0.1` olduğundan uzaktan doğrudan erişim riski sınırlıdır; sunucu ağda açılırsa veya istemci erişimi başka şekilde sağlanırsa etki artar. İnternetten istismar kanıtlanmadı. Kanıt: F14.

### F15 — P2: Önbellek silme rotası yabancı Origin'i kabul ediyor

Konum: `src/server.ts:16-17,327-331`.

Origin/CSRF kontrolü yok. `Origin: https://foreign-origin.test`, `Content-Type: text/plain` ve boş gövdeyle POST yapıldığında **200** döndü, izole test önbelleği silindi. Gerçek `.cache` dizini bu testte silinmedi. CORS'un cevap okumayı engellemesi sunucudaki yan etkiyi tek başına engellemez.

Öneri: beklenen Origin/Host doğrulaması ve durum değiştiren rotalarda uygun CSRF/oturum politikası. **Bu test HTTP düzeyindedir; tarayıcıların özel ağ erişimi korumalarını aşan uçtan uca saldırı gösterilmedi.** Kanıt: F15.

### F18 — P2: HAL, belge yokken iç kimlikten doğrulanmamış PDF adresi üretiyor

Konum: `src/sources/hal.ts:65-68,84-85`.

Dosya listesi olmadığında `docid` değerinden `/document` adresi uyduruluyor ve `erisim:"acik"` atanıyor. Canlı kayıtta gerçek URI **`hal-04749086v1`**, üretilen PDF URI'si **`hal-4749086/document`** oldu. `docid` ile kayıt URI'sinin kimliği aynı biçimde değil; dosya bulunmadığı halde açık indirilebilir belge varmış gibi davranılıyor.

Öneri: yalnızca API'nin doğruladığı dosyayı sunmak; gerekiyorsa yayın URI'sini esas alan ve erişimi ayrıca doğrulayan çözümleme yapmak. Kontrollü metaveriyle yanlış türetim tekrarlandı. İki HEAD denemesi belge adreslerinin erişilebilirliğini kesinleştirmedi; **404 veya indirilebilir PDF sonucu iddia edilmiyor.** Kanıt: F18 ve canlı HAL kaydı.

### F05 — P3: Zorla yenileme bellek önbelleğini atlamıyor

Konum: `src/sayfa.ts:94`, `src/cache.ts:47-48`.

`zorlaGuncelle` sadece disk kullanımını kapatıyor. Bellekte kayıt varsa üretici hiç çalışmıyor. İlk çağrı ve zorla yenileme çağrısında toplam **1 fetch** görüldü; beklenen 2. Bu seçenek şu anda HTTP rotasında sunulmasa da modülün belgelenmiş davranışı yanlış.

Öneri: bellek ve disk için gerçek bypass/invalidation seçeneği. Kanıt: F05.

## Canlı kaynak sonuçları

Tam sorgular, süreler ve örnekler `audit-live-evidence.json` içinde. Kitap kaynaklarında `Pride and Prejudice`, makale/slayt kaynaklarında `Attention Is All You Need`; yazar/yıl verilmedi, aday limiti 1 kullanıldı.

| Kaynak           | Gözlenen sonuç                                                                   |
| ---------------- | -------------------------------------------------------------------------------- |
| arXiv            | 2 kayıt, hedef makale dahil                                                      |
| Crossref         | 2 kayıt; başlık varyasyonları                                                    |
| CORE             | 1 kayıt; ilgisi zayıf aday                                                       |
| Europe PMC       | 2 kayıt                                                                          |
| Gutenberg        | 1 kayıt; EPUB adresi PDF alanında                                                |
| HAL              | 1 kayıt; belge adresi türetimi sorunlu                                           |
| Internet Archive | 2 kayıt                                                                          |
| LibGen           | 1 künye kaydı; içerik indirilmedi                                                |
| OpenAlex         | 2 kayıt; aynı başlıklı başka yayın da var                                        |
| Open Library     | 2 kayıt                                                                          |
| Sci-Hub adaptörü | 1 Crossref künye kaydı; Sci-Hub belgesine erişilmedi                             |
| Türkçe Wikipedia | 1 kayıt                                                                          |
| Zenodo           | 2 kayıt                                                                          |
| OpenAIRE         | 0 çıktı; sonrasında gerçek yanıttaki kayıtların yanlış ayrıştırıldığı doğrulandı |
| Web Slayt        | 0 çıktı; bütün web aramalarının çalışmadığı anlamına gelmez                      |
| Semantic Scholar | HTTP 429 kota hatası; kod kusuru sayılmadı                                       |
| Anna's Archive   | Aynalar arasında son hata HTTP 403; kod kusuru sayılmadı                         |

Google Books anahtar gerektirdiği için canlı test dışında bırakıldı; örnek şablon dış servis testi değildir. Sandbox içindeki ilk altı ağ denemesi EACCES verdi; izinli ağ çalıştırmasında beş endpoint 200 verdi, OpenAIRE ilk denemede ECONNRESET verdi ve sonraki denemede 200 döndü. Bunlar uygulama kusuru veya kalıcı servis kesintisi olarak değerlendirilmedi.

## Mevcut testlerin boşlukları ve ek riskler

97 testin geçmesi şu davranışları kapsamıyor: benzerlik dalında kaynak kaybı, aynı isimli eşzamanlı indirme, yanıt gövdesi zaman aşımı, gerçek OpenAIRE zarfı, EPUB/PDF ayrımı, yalnızca açıklamalı kartın özet eylemi, A/B/A kaynak gruplama sırası, bekleyen web isteği ve Node 20 uyumluluğu. Eklenen betik bu boşlukların bir kısmını inceleme amacıyla yeniden üretir; normal regresyon testlerine dönüştürülürken beklentiler doğru davranışa çevrilmelidir.

Kod incelemesinde ayrıca bellek koruması açığı görüldü: `src/sayfa.ts:61-62` bildirilmeyen büyük gövdeyi tümüyle belleğe aldıktan sonra 120 MB sınırına bakıyor; `src/summary.ts:79` ve kapak proxy'si `src/server.ts:175` için gövde boyutu sınırı yok. Sayfa işçilerinin üçlü paralelliği bu yükü artırabilir. Büyük içerikle stres testi yapılmadı; bu, gerçekleşmiş OOM raporu değil, doğrulanmış sınır yerleşimi ve ek test gereksinimidir.

Başlatma betikleri Node 20 kabulünü tekrar ediyor. `scripts/smoke-server.ts` test başarısızlıklarında `null` döndürüyor fakat başarısız testleri biriktirip çıkış kodunu başarısız yapmıyor; otomatik çalıştırmada yalnızca çıkış koduna bakılırsa yanlış başarı çıkarılabilir. Bu betik canlı incelemede kullanılmadı: gerçek önbelleği temizleme rotasını çağırması mevcut kullanıcı durumunu etkileyebilirdi. Yerine izole sunucu testleri kullanıldı.

Özel kaynakların `hazirMi` çağrıları kayıt listesi/arama filtrelemesinde korunmadan çalışıyor; hata atan bir özel kaynak, kaynaklara ilişkin hata izolasyonu beklentisini bozabilir. Büyük dosya, disk doluluğu, kesilen indirme, bozuk/şifreli/görsel PDF, özel kaynak sözleşmesi ve yoğun eşzamanlı kullanıcı testleri ayrıca gerekli. Bu koşullarda fiili başarısızlık iddiası yapılmıyor.

## Önce yapılması önerilen işler

1. OpenAIRE şemasını ve URL seçimini düzeltmek, gerçek fixture ile regresyon testi eklemek.
2. Gruplamadaki kaynak kaybını ve indirme adı yarışını düzeltmek.
3. Gövde dahil süre/boyut sınırlarını uygulamak; hazır sonuçları yavaş web/kaynaklardan bağımsız göstermek.
4. PDF/EPUB/HTML ayrımını, yazar/yıl/tür/sayfa metaverisini düzeltmek.
5. Node destek politikasını bağımlılık ve CI ile eşitlemek; arayüz ve URL/Origin kontrollerini tamamlamak.

## Tekrar çalıştırma ve kanıt

```powershell
npm run check
npm run format:check
node scripts/dogrula-kurulum.mjs
node --import tsx reports/audit-reproduce.mjs
# İsteğe bağlı canlı bibliyografik sorgular; dış ağ erişimi gerekir:
node --import tsx reports/audit-live.mjs
```

`audit-reproduce.mjs` ağ çıkışı yapmaz: modül çağrılarını sahte cevaplarla, HTTP davranışlarını kendi geçici loopback sunucularıyla test eder. Sentetik PDF ve özet testinde LLM kapatılır. Test indirmeleri ve önbelleği ayrı geçici dizinlerdedir; kapanışta temizlenir. `audit-live.mjs` sonuç dosyasını günceller, mevcut uygulama önbelleğine yazmaz. `audit-evidence.json` ve `audit-live-evidence.json` yeniden çalıştırmada güncellenir.

Gerçek tarayıcıyla görsel/etkileşim kabulü, Node 20/22, temiz bağımlılık kurulumu, LLM servisi, ücretli/anahtarlı API'ler, gerçek belge indirme ve uzun süreli stres testi yapılmadı. Hiçbir düzeltme, commit veya push yapılmadı.
