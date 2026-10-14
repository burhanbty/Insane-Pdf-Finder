# İkinci tur: beş düzeltme ve doğrulama

14 Ekim 2026 — Windows, Node v24.18.1.

Kalan bulgulardan F02, F05, F10, F11 ve F12'nin arayüzde web bekleme davranışı düzeltildi. Ürün değişiklikleri `src/search.ts`, `src/cache.ts`, `src/sayfa.ts` ve `public/app.js` dosyalarında. Bu tur yerelde tamamlandı; commit veya push yapılmadı.

## Değişiklikler

| Bulgu                             | Yeni davranış                                                                                                                                  | Doğrulama                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F02 — farklı eserlerin birleşmesi | Başlık/yıl eşleşmesi bilinen yazar veya DOI çelişkisini ezmez; aynı başlık altında farklı gruplar ve benzersiz anahtarlar tutulur              | Alice Smith ve Bob Jones kayıtları ayrılır; sonraki Smith/Jones kayıtları doğru gruplara eklenir; farklı DOI'ler ayrı, aynı DOI'nin URL/metin gösterimleri birlikte kalır |
| F05 — zorla yenileme              | Bellek ve disk okumaları atlanır; yeni değer başarılıysa iki katmana da yazılır                                                                | Üretici yeniden çalışır; yeni değer bellekte ve bellek süresi dolunca diskte görülür; üretici hata verirse hata bildirilir ve önceki iyi değer korunur                    |
| F10 — boş URL ile özet            | Özet çıkarma eylemi yalnızca geçerli HTTP(S) PDF veya tam metin URL'si varsa sunulur                                                           | Sadece açıklaması olan kartta boş URL'li düğme yok; mevcut açıklama görünür; tam metni olan kayıt doğru URL ile özet API'sini çağırır                                     |
| F11 — bölünmüş kaynak grupları    | Kartlar önce kaynak kovalarına ayrılır; her kaynak için tek başlık eklenir; gruplama kapanınca özgün puan sırası geri gelir                    | A/B/A/B sırası A/A/B/B olur; iki başlık da doğru kart sayısını gösterir; kapatıldığında ve süzgeç değiştiğinde sıra/başlıklar doğru kalır                                 |
| F12 — yavaş web aramasını bekleme | Ana ve web cevapları birbirinden bağımsız çizilir; ana cevap gelince yeni arama yapılabilir; eski aramanın geç cevabı yeni sonucu değiştiremez | Her iki tamamlanma sırası, ana/web hataları, eski cevap yarışı ve sonradan gelen web sonucunda açık özet/süzgeç korunması test edildi                                     |

F02 için arama önbelleği anahtarı `arama:v2:` oldu. Eski kuralla yanlış birleştirilmiş disk/bellek sonuçları yeni sürümde kullanılmaz; kullanıcı önbelleği silinmez. Sonuçlar yeni anahtarla normal biçimde yeniden önbelleğe alınır. Ayrı testte eski birleşik sonuç önceden yerleştirildi ve yeni aramanın iki doğru grubu üretmesi doğrulandı.

F12 için mevcut kart düğümleri korunur; web cevabı geldiğinde kullanıcının açtığı özet yeniden oluşturulup kaybedilmez. Kaynak filtresi ve gruplama devam eder. Yeni aramanın kimliği, önceki aramaya ait geç cevapların sonuçları ve düğme durumunu değiştirmesini engeller.

## Test sonuçları

21 yeni regresyon testi eklendi: `test/grupla.test.ts` içine 5; `test/cache-refresh.test.ts` içinde 4; `test/arayuz-regresyon.test.ts` içinde 11; `test/search-cache.test.ts` içinde 1.

Düzeltmeden önce ilk hedefli çalıştırmada **14 başarısız, 15 başarılı** test vardı. Düzeltmeden sonra aynı hedefli küme **29/29** geçti. Eski önbellek için ek entegrasyon testi de tüm test kümesinde başarılı oldu.

| Kontrol                                         | Sonuç                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run check`                                 | Lint + TypeScript + **14 dosyada 136/136 test** başarılı                                 |
| `npm run format:check`                          | Başarılı                                                                                 |
| `git diff --check`                              | Başarılı                                                                                 |
| `node scripts/dogrula-kurulum.mjs`              | **31/31** sunucu/kurulum kontrolü başarılı                                               |
| `node --import tsx reports/audit-reproduce.mjs` | Önceki beş ve yeni beş düzeltme birlikte doğrulandı; kalan sekiz gözlem yeniden üretildi |

Bağımsız ilk hata örneklerinde farklı yazarlı aynı başlıklı iki eser artık iki grupta; zorla sayfa yenilemede ağ çağrısı sayısı 1 yerine 2; açıklamalı kart boş URL ile özet istemiyor; A/B/A için iki kaynak başlığı var; ana kart web cevabından önce görünür. Önceki OpenAIRE, gövde zaman aşımı, kaynak/PDF koruma ve eşzamanlı indirme doğrulamaları da başarılı kaldı. Sentetik PDF sayımı ve yerel özet üretimi geçti.

## Sınırlar ve kalan kapsam

Arayüzün gerçek HTML/JS dosyaları jsdom içinde, kontrollü asenkron HTTP cevaplarıyla çalıştırıldı. Gerçek tarayıcı görsel kabulü ve dış servislerin canlı sorguları bu turda yapılmadı. Önbellek/indirme testleri izole geçici dizinlerde çalıştı; kullanıcı `.cache`, `.env` ve `downloads` içerikleri temizlenmedi.

F12'de sunucu `/api/search` içinde kaynakların tümünün tamamlanmasını beklemeye devam eder; bu turdaki düzeltme ayrı `/api/web-search` isteğinin ana aramayı bekletmesidir. Uzun kaynaklar için sunucuda toplam süre bütçesi eklenmedi. Eski istekler sonuç ekranını değiştiremez ama ağ üzerinde iptal edilmez.

F02 yazar uyumunda mevcut soyad normalizasyonunu kullanır. Aynı soyadı taşıyan farklı kişilerin kesin ayrımı veya tüm ISBN/baskı ilişkileri için yeni bibliyografik kimlik sistemi geliştirilmedi.

Başlangıçtaki 18 bulgudan kalanlar: F06 (PDF/diğer formatlar), F08 (künye türü/sayfa sayısı), F09 (uydurulan yazar/yıl), F13 (kaynak linki protokolü), F14 (özel ağ URL erişimi), F15 (Origin kontrolü), F16 (Node sürümü politikası), F18 (HAL belge adresi türetimi).

## Tekrar çalıştırma

```powershell
npm run check
npm run format:check
node scripts/dogrula-kurulum.mjs
node --import tsx reports/audit-reproduce.mjs
```

Doğrulama betiği dış API veya LLM çağrısı yapmaz; rapor çıktısı repo biçim ayarlarıyla `reports/audit-after-second-fixes.json` içine yazılır. Önceki `audit-evidence.json` ve `audit-after-fixes.json` sonuçları korunur.
