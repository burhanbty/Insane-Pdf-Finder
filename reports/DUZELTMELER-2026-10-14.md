# Beş sorun için düzeltme ve doğrulama

Tarih: 14 Ekim 2026. Ortam: Windows, Node v24.18.1.

İlk rapordaki F17, F07, F01, F04 ve F03 düzeltildi. Dört ürün dosyası değişti: `src/sources/openaire.ts`, `src/search.ts`, `src/download.ts`, `src/http.ts`. Diğer 13 bulgu bu çalışmanın kapsamı dışında kaldı. Bağımlılıklar, `.env`, kullanıcı indirmeleri ve mevcut önbellek değiştirilmedi; commit/push yapılmadı.

## Değişiklikler

| Bulgu                            | Düzeltme                                                                                                                    | Doğrulanan davranış                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| F17 — OpenAIRE ayrıştırması      | Gerçek `metadata["oaf:entity"]["oaf:result"]` zarfı açılır; tek nesne/dizi desteklenir; tanınmayan dolu zarf hata verir     | Önceden 0 sonuç veren gerçek API snapshot'ından 2 kayıt, başlık ve yazarlarıyla çıkar                                        |
| F07 — OpenAIRE URL seçimi        | Instance URL'si önceliklendirilir, HTTP(S) PID yedek bağlantıdır; URL dizileri desteklenir; DOI metni dosya adresi sayılmaz | PDF adresi `10.1234/example` yerine `https://repository.test/paper.pdf`; PID olmadan link korunur                            |
| F01 — Birleştirmede kaynak kaybı | Benzerlik yoluyla eşleşen kayıt da grubun kaynak listesine bir kez eklenir                                                  | Benzer başlık + sonraki kesin eşleşme senaryosunda üç kaynak ve ikinci kaydın PDF'i korunur                                  |
| F04 — Eşzamanlı indirme          | `.part` adları da kullanımda kabul edilir; `open(...,"wx")` atomik rezervasyon yapar; rename hatası da temizlenir           | Üç eşzamanlı aynı başlıklı indirme ayrı dosyalarda doğru içerikle tamamlanır; eski dosya ve başka işlem rezervasyonu korunur |
| F03 — Gövde zaman aşımı          | Fetch için `AbortSignal.timeout` kullanılır; başlıklar geldikten sonra sinyal kaldırılmaz                                   | Yavaş JSON, text, arrayBuffer ve Node indirme akışı iptal olur; hızlı geçerli cevap çalışır                                  |

OpenAIRE için açık erişimli bir kayıt sayfası artık otomatik PDF kabul edilmez. PDF alanı yalnızca seçilen erişim örneğinin geçerli HTTP(S) adresleri arasında `.pdf` dosya yoluyla tanınabilen bir aday varsa doldurulur. Dosya yolu uzantısız olan gerçek PDF'ler bu yöntemle otomatik tanınmayabilir; tam içerik/MIME doğrulaması veya yeni PDF adresi çözümleme servisi bu çalışmada eklenmedi.

HTTP süresi her fetch denemesi için gövdeyi de kapsar. Kuyrukta bekleme ve yeniden deneme toplamına ayrı süre sınırı getirilmedi. Gövde sırasında native fetch'in AbortError hatası tüketiciye ulaşır; mevcut rota/kaynak hata yakalama kodu bunu işler. Bu değişiklik eskiden süresiz bekleyebilen büyük/yavaş belgelerin artık mevcut süre sınırlarında durması anlamına gelir.

## Regresyon testleri

18 yeni test eklendi: `test/grupla.test.ts` içine 1; `test/openaire.test.ts` içinde 8; `test/http.test.ts` içinde 5; `test/download.test.ts` içinde 4. Gerçek OpenAIRE yanıtının testte gerekli alanları `test/fixtures/openaire-live.json` içinde korunur; birim testleri ağa ihtiyaç duymaz.

Düzeltmeden önce hedefli çalıştırmada **15 başarısız / 11 başarılı** test görüldü. Düzeltmeden sonra aynı dört test dosyası **26/26** geçti. Böylece testlerin değişiklik öncesindeki kusurları yakaladığı, değişiklik sonrası doğru davranışı kabul ettiği doğrulandı.

| Son kontrol                                     | Sonuç                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run check`                                 | Lint ve TypeScript başarılı; 11 test dosyasında **115/115** test başarılı |
| `npm run format:check`                          | Başarılı                                                                  |
| `git diff --check`                              | Başarılı                                                                  |
| `node scripts/dogrula-kurulum.mjs`              | **31/31** sunucu/kurulum kontrolü başarılı                                |
| `node --import tsx reports/audit-reproduce.mjs` | Beş düzeltme doğrulandı; kalan 13 gözlem yeniden üretildi                 |

Önceki bağımsız örneklerin yeni sonuçları: iki yerel HTTP indirmesi `collision.txt` ve `collision_2.txt` dosyalarında **AAAAAAAA / BBBBBBBB** içerikleriyle tamamlandı. `timeoutMs:50` olan yavaş JSON çağrısı yaklaşık **68 ms** içinde iptal oldu; işletim sistemi zamanlaması nedeniyle bu ölçüm mutlak 50 ms garantisi değildir. Tek sayfalı sentetik PDF sayımı, metin çıkarımı ve LLM kullanılmadan özetleme de başarılı kaldı.

Canlı OpenAIRE adaptörüne tek sorguyla ek doğrulama denendi; 10 saniyelik ağ sınırı altında yeniden denemeler de zaman aşımına uğradı. Bu nedenle **canlı servisin bu çalıştırmada başarılı olduğu iddia edilmiyor**. Şema/URL düzeltmeleri önceki canlı API'den kaydedilmiş gerçek yanıt ve kontrollü uç durumlar üzerinden doğrulandı. API anahtarı, kişisel iletişim bilgisi, LLM veya uzak belge indirmesi kullanılmadı.

## Tekrar çalıştırma

```powershell
npm run check
npm run format:check
node scripts/dogrula-kurulum.mjs
node --import tsx reports/audit-reproduce.mjs
```

Son komut test indirmelerini ve önbelleğini izole geçici klasörlerde oluşturup temizler. Sonuçlar `reports/audit-after-fixes.json` içine yazılır; ilk incelemenin `audit-evidence.json` dosyası korunur. JSON çıktısı yeniden üretildikten sonra repo biçim kontrolü gerekirse `npx prettier --write reports/audit-after-fixes.json` ile uygulanabilir.
