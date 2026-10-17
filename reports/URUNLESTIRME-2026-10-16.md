# Öğrenci odaklı ürünleştirme — 16 Ekim 2026

## Hedef ve analiz

Kullanıcının belirlediği hedef: **hocasının verdiği kitapları bulmak isteyen öğrenci**.
Başlangıç sürümü güçlü bir kaynak tarayıcısıydı; ders listesi, ISBN'den künye doldurma
ve aramalar arasında korunan bir kitaplık yoktu. Bu nedenle bu turda odak,
“istenen kitabı tanı → kaynaklarda ara → derse göre sakla → çalışmaya devam et” akışı oldu.

Bu önceliklendirme mevcut kod ve kullanıcının açıklamasından çıkarımdır;
gerçek öğrenci kullanım araştırması veya pazar talebi ölçümü yapılmadı.

| Öncelik | Öğrencinin ihtiyacı                            | Uygulanan karşılık                                                                     |
| ------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| P0      | Aynı adlı farklı kitap/baskıları karıştırmamak | ISBN-10/13 kontrolü, ISBN'den Open Library künyesi, yıl/yazar bilgisi ve ISBN görünümü |
| P0      | Hocanın listesini tekrar tekrar yazmamak       | Ders adıyla toplu liste önizleme/kaydetme; kayıtlı sorgudan forma dönüş                |
| P0      | Bulunan kitabı kaybetmemek                     | Sunucuda kalıcı kitaplık, doğrudan kaynak ve dosya bağlantıları                        |
| P1      | Dersleri ve çalışma ilerlemesini düzenlemek    | Koleksiyon, okunacak/okunuyor/okundu, not, metin/derse göre filtre                     |
| P1      | Yanlışlıkla kaldırılan kaydı geri almak        | Silme yerine arşivleme ve geri alma                                                    |
| P1      | Bilgisayar değişince verisini taşımak          | JSON yedeği, önizleme, mevcut notları koruyan birleştirme                              |
| P1      | Ödev kaynakçasını hazırlamak                   | Görünür kitaplar için RIS/BibTeX; kişisel notlar dahil edilmez                         |

## Uygulama ve veri güvenilirliği

- `src/workspace.ts`: sürümlü ve sınırlandırılmış veri modeli; tek sunucu sürecinde sıralı yazma, geçici dosyayı flush edip atomik değiştirme, hata halinde önceki dosyayı koruma.
- Kalıcı kimlikte sayılar/baskı numaraları korunur. Aynı DOI tekilleştirilir; diğer kayıtlar başlık/yazar/yıl/ISBN ile muhafazakâr karşılaştırılır. Farklı yazar yazımları bazı yinelenen kayıtlara yol açabilir; belirsiz kayıtlar tahminle birleştirilmez.
- `.data/workspace.json` kitaplığı, notları ve kayıtlı aramaları tutar; `.data/` Git dışında bırakıldı. Ham kaynak yanıtları/anahtarlar saklanmaz.
- Yerel Origin/Host/JSON korumaları yeni API'lerde sürer; kitaplık API'si ayrıca doğrudan uzak istemci bağlantısını reddeder. Bu bir hesap sistemi değildir; yerel makinedeki diğer süreçlere karşı izolasyon sağlamaz.
- Geçersiz yedek, yinelenen kayıt veya sınır aşımı kısmi yazma oluşturmaz. İçe aktarım mevcut kayıtların notlarını değiştirmez. Veri okunamazsa otomatik boş kitaplıkla üzerine yazılmaz.
- Ders listesi ve kayıtlı arama düğmeleri kendiliğinden dış arama başlatmaz. ISBN kontrolü yalnızca seçilen kitabın genel katalog bilgisini alır. Mevcut kaynakların indirme ve ağ korumaları korunur.
- Ekranlarda notlar/başlıklar HTML olarak yorumlanmaz. Diyalog etiketleri, canlı durum mesajları, klavye odak görünümü ve koyu temayla uyumlu alanlar eklendi.

## Doğrulama

- Başlangıç: 18 dosyada **217 test** geçti; yeni sürüm: 22 dosyada **268 test**. Lint, TypeScript ve Prettier kontrolü de başarılı.
- Yeni 51 test; eşzamanlı 20 kayıt, yeniden açılan store'da kalıcılık, yazma hatasında geri koruma, bozuk dosya/yedek, DOI tekilleştirme, farklı ISBN baskıları, arşiv/geri alma, not güncelleme, toplu ders listesi, yedek birleştirme ve UI hatalarını kapsar.
- Gerçek HTTP API testleri; ISBN girdi doğrulaması, kitaplık yazma/okuma, yedek, yabancı Origin/Host, yanlış Content-Type, bilinmeyen kayıt ve özel verinin statik yoldan açılmamasını doğrular.
- Kurulum kontrolü **31/31**; geçici veri/indirme/önbellek klasörleriyle sunucu smoke testi geçti.
- Canlı ISBN denemesi: **9780131103627 → The C Programming Language / Brian W. Kernighan, Dennis MacAlistair Ritchie / 1988**. Anahtar/e-posta alanları boşaltıldı; kişisel not veya indirme gönderilmedi. Kanıt: `isbn-live-2026-10-16.json`.
- Gerçek tarayıcıda kontrollü verilerle ISBN'den form doldurma, kitaplığa kayıt, koleksiyon/not/okuma durumu, sayfa yenilemesi sonrası kalıcılık, toplu ders listesi, kayıtlı sorgu ve arama kartından kayıt doğrulandı.
- Tarayıcıdan JSON yedeği ve BibTeX indirildi; dosyalar okunarak iki kitabın/iki sorgunun ve notun yedekte bulunduğu, notun kaynakçada bulunmadığı, ISBN'nin kaynakçada bulunduğu doğrulandı.
- `urunlestirme-2026-10-16.jpg` ve `ogrenci-kitapligi-2026-10-16.jpg` kontrollü test verileri gösterir; gerçek kullanıcı kitaplığı değildir. Tarayıcı konsolunda hata/uyarı görülmedi.

## Sonraki ürün aşamaları

1. **Gerçek öğrenci denemesi:** hocanın verdiği listeyle doğru baskıya ulaşma, kaydetme ve tekrar bulma akışını gözlemlemek; başarısız sorguları kullanıcı izniyle değerlendirmek.
2. **Baskı karşılaştırması:** aynı eserin farklı ISBN/dil/yayınevi kayıtlarını açık bir karşılaştırma ekranında göstermek. Mevcut ISBN kutusu künye bulur; farklı baskıların içerik eşdeğerliğini doğrulamaz.
3. **Kurulum ve dağıtım:** hedef işletim sistemi için paketleme, imzalama ve güncelleme planı; yayın öncesinde proje lisansı ve sağlayıcı koşullarını değerlendirmek. Bu tur kurulum paketi yayımlanmadı.
4. **Ders belgesinden liste çıkarma:** kullanıcı tarafından seçilen belgelerde yerel metin çıkarımı ve düzeltilmeden kaydedilmeyen kitap listesi önizlemesi.
5. **Çok cihaz/ekip:** hesap, yetkilendirme, veritabanı ve çakışma yönetimi tasarlandıktan sonra senkronizasyon. Mevcut dosya deposu tek sunucu süreci ve yerel tek kullanıcı içindir.

## Sınırlar

ISBN kontrol basamağı numaranın yapısını doğrular; katalogda kayıt veya açık PDF
bulunacağını garanti etmez. Bu tur tüm dış kaynaklar yeniden canlı taranmadı.
Node 24.18.1 üzerinde doğrulandı; Node 22/26 ve gerçek telefon cihazında çalışma
denemesi yapılmadı. Zotero/LaTeX içinde fiilî içe aktarım/derleme yapılmadı.
Yedekler PDF/EPUB dosyalarını kapsamaz. Notlar düz metin olarak yerelde saklanır;
disk şifreleme ve bulut yedekleme eklenmedi. Aynı veriye birden fazla sunucu süreciyle
yazma desteklenmez. GitHub'a commit/push veya yayın yapılmadı.

## Başvurulan birincil belgeler

- [Open Library Books API](https://openlibrary.org/dev/docs/api/books): ISBN ile bibliyografik kayıt sorgulama.
- [International ISBN Agency](https://www.isbn-international.org/index.php/node/10): ISBN kontrol basamağı ve 13 haneli yapı.
- [Zotero standart biçim aktarımı](https://www.zotero.org/support/kb/importing_standardized_formats): RIS/BibTeX veri aktarımı.
- [W3C diyalog örüntüsü](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): adlandırma, klavye ve odak davranışı.
