# Geliştirme ve doğrulama — 14 Ekim 2026

Önceki iki düzeltme turu korundu. İlk incelemedeki kalan sekiz bulgu düzeltildi;
indirme biçimleri, kaynak dayanıklılığı, güvenlik ve kaynakça araçları geliştirildi.

## Uygulanan değişiklikler

1. **Gerçek dosya biçimleri (F06, F18):** Gutenberg EPUB'u ayrı alan/düğmeyle sunar. Zenodo CSV, Europe PMC HTML ve Sci-Hub yönlendirmeleri PDF değildir. HAL dosyasız kayıttan PDF adresi üretmez.
2. **Doğru künye (F08, F09):** Crossref, HAL ve OpenAIRE türü kayıttan okur. Crossref yayın ortamı alanı düzeltildi; elektronik makale numarası/başlangıç sayfası toplam sayfa sayısı değildir. Wikipedia, web araması ve Gutenberg eksik yazar/yılı sorgudan doldurmaz.
3. **Güvenli bağlantılar (F13, F14):** Arayüz yalnızca HTTP(S) kaynak bağlantılarını tıklanabilir yapar. Kullanıcı içerik isteklerinde özel/ayrılmış IPv4/IPv6, kimlik bilgili URL ve standart dışı port engellenir. DNS cevabı sokete sabitlenir; her yönlendirme ve kapak izin listesi yeniden denetlenir.
4. **Yerel API koruması (F15):** Yabancı Origin/Host ve cross-site istekler reddedilir. POST JSON gerektirir; bozuk JSON ve geçersiz limit/tür anlaşılır JSON hatası verir. Güvenlik başlıkları eklendi.
5. **Kurulum uyumluluğu (F16):** Paket/lock dosyası, başlatıcı, sunucu ve CI ortak Node politikasını uygular: 22.22.2+ (22.x), 24.15.0+ (24.x), 26+.
6. **Kaynak hatalarının izolasyonu:** 20 saniye kaynak süresi; ortak HTTP ve ayna isteklerinde iptal. Hazırlık hatası ve yanlış sonuç biçimi diğer kaynakları düşürmez. Tekrarlı/geçersiz kaynak kimlikleri yüklenmez. Eşzamanlı ilk yükleme paylaşılır. Birden fazla esere uyan yazarsız kayıt tahminle ilk esere bağlanmaz.
7. **Daha verimli önbellek:** Başarılı kaynaklar ayrı önbelleğe alınır. Eksik toplu yanıt kalıcılaştırılmaz; tekrar aramada başarılı kaynaklar korunur, hatalı kaynaklar yeniden denenir. Eski sonuçlar yeni sürümlü anahtarla kullanılmaz.
8. **Dosya/bellek denetimi:** PDF başlangıç imzası ve EPUB mimetype başlangıç kaydı doğrulanır; sahte içerik ve geçici dosya temizlenir. İndirme 300 MB, özet 40 MB, sayfa sayımı 120 MB, kapak 5 MB. Bellek sınırı Content-Length bulunmasa/yanlış olsa da akışta uygulanır. PDF yükleme görevleri serbest bırakılır.
9. **Araştırma araçları:** Puan/yıl/başlık sıralaması, künye kopyalama, pano başarısızlığında seçilebilir metin, filtredeki sonuçları RIS kaynakça dosyasına aktarma.
10. **İndirilenlere erişim:** Liste öğeleri indirilebilir bağlantıdır; API yalnızca downloads içindeki tamamlanmış PDF/TXT/EPUB dosyalarını sunar. Yol gezintisi, sembolik bağlantı ve geçici dosyalar reddedilir.
11. **Test araçları:** Smoke testi gerçek kullanıcı önbelleğini silmez; geçici dizinler kullanır ve başarısızlıkta sıfırdan farklı kod döndürür. Varsayılan smoke dış arama yapmaz; canlı arama `--live` ile açılır.

## Doğrulama

- Windows / Node **24.18.1**: lint ve TypeScript geçti; **18 dosyada 217 test** geçti. Önceki 136 teste 81 test eklendi.
- İlk incelemenin **18/18 bulgusu** çevrimdışı yeniden üretim kontrollerinden geçti. Tek sayfalık sentetik PDF ile sayfa sayımı/metin özeti de geçti. Kanıt: `audit-after-improvements.json`.
- Sunucu başlangıcı, kaynak yükleme, arayüz ve API kurulum kontrolleri: **31/31**.
- `npm run smoke`: statik dosya, kaynak/indirme listesi ve girdi doğrulaması gerçek HTTP üzerinden geçti; geçici dizinler kullanıldı.
- Güvenli HTTP yoluyla W3C test PDF'i: **HTTP 200, 13.264 bayt**, PDF imzası doğrulandı; diske kaydedilmedi. İlk canlı deneme Undici 8 / yerleşik fetch uyumsuzluğunu ortaya çıkardı; Undici 7'ye geçilerek doğrulandı.
- Bağımlılık kurulumunun npm güvenlik denetimi **0 açık** bildirdi.
- Gerçek tarayıcıda kontrollü örneklerle arama, en yeni sıralaması, gruplama, kaynak filtresi, künye kopyalama ve RIS indirme denendi. İndirilen RIS okundu: filtredeki iki örnek kayıt var; gizli kayıt yok. `arayuz-dogrulama.ris` ve `arayuz-gelistirme-dogrulama.jpg` kanıttır; kayıtlar açıkça etiketlenmiş test verileridir.

## Canlı kaynak sonuçları ve sınırlar

Anahtar, kullanıcı e-postası, indirme veya LLM çağrısı olmadan 17 adaptör,
36 HTTP denemesiyle kontrol edildi. 13 kaynak kayıt verdi; web araması boş döndü.
Semantic Scholar **429**, Anna's Archive **403**, Library Genesis **zaman aşımı** verdi.
Kanıt: `audit-live-after-improvements.json`. Bu bir anlık sorgu örneğidir; kota/erişim
sorunlarının çözüldüğü veya tüm kitapların bulunabildiği anlamına gelmez. Sci-Hub
tür seçimi bu denemeden sonra ayrıca düzeltilip birim testiyle doğrulandı.

Node 22/26 çalışma testleri burada yapılmadı; CI matrisi güncellendi. PDF/EPUB
başlangıç doğrulaması bütün belgenin sağlamlığını veya zararsızlığını kanıtlamaz.
Özet çıkarımı taranmış PDF için OCR yapmaz. İptal sinyalini izlemeyen özel kaynak
modüllerinin arka plan işi zorla durdurulmaz. Güvenlik kontrolleri kullanıcı içerik
URL'leri içindir; kapsamlı bir penetrasyon testi yapılmadı. Özel kaynak kodu güvenilir olmalıdır.

Uzak GitHub deposunda bu turda değişiklik yapılmadı.

Güvenlik yaklaşımında [OWASP SSRF rehberi](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
ve [Undici Agent belgesi](https://github.com/nodejs/undici/blob/main/docs/docs/api/Agent.md)
esas alındı; DNS kontrolü bağlantıya bağlandı ve yönlendirmeler denetlendi.
