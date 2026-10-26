# Kaynak Bul — Silmarillion ve PDF görünümü

26 Ekim 2026 · PDF odaklı kitap görünümü ve doğrulama raporu.

**Bulgu:** Kullanıcının gördüğü durum tekrarlandı. `Silmarillion / kitap / limit 20` canlı aramasında 20 gruptan yalnız birinde PDF alanı vardı; kitapla eşleşen PDF grubu yoktu. PDF bulunan sonuç **Morgoth : The Archetype of Evil in The Silmarillion** adlı ilgili çalışmaydı, romanın kendisi değildi. İlk koşuda 140, ikinci koşuda 180 ham kayıt geldi; kaynak erişimi değişse de ilk 20 karttaki PDF sayısı aynı kaldı. Bu sonuç bütün internette kitabın PDF'sinin bulunmadığı iddiası değildir.

## Neden

- Kaynak Bul bibliyografik/katalog, önizleme ve ödünç kayıtlarını da gösteriyordu. Kaynakta kitabın bulunması `Work.pdf` alanının bulunması demek değil.
- `İndirilebilir` filtresi PDF yanında EPUB ve metin bağlantılarını da kapsıyor. Açık erişim rozeti de dosya formatı garantisi değil; Wikipedia örneğinde kayıt açık olsa da PDF yok.
- İlgili makale/incelemeler eşleşme etiketiyle ayrılsa da tek PDF'li kart kitabın kendisi sanılabiliyordu.
- LibGen ve Anna bağlayıcıları mevcut sürümde doğrudan dosya URL’si üretmeyip kayıt/detay sayfası döndürüyor. Bu kayıtlarda PDF düğmesi olmaması, sitenin hiçbir şekilde PDF sunmadığını kanıtlamaz; uygulamada çözülmüş bir PDF bağlantısı olmadığı anlamına gelir. Bu değişiklik o kaynaklara yeni otomatik indirme desteği eklemez.
- Open Library ve Google Books'un erişim bilgisi/katalog ile dosya bağlantısı ayrımı resmî API sözleşmelerinde de vardır: [Open Library erişim türleri](https://openlibrary.org/search/howto/more), [Google Books accessInfo/pdf](https://developers.google.com/books/docs/v1/reference/volumes). Kaynakları bütünüyle kapatmak yerine kayıt bazında filtrelemek, başka bir eserde PDF sağlayan kaynağı kaybetmemeyi sağlar.

## Uygulanan davranış

- Kitap aramasında **Kitaplarda yalnız PDF bağlantısı olanlar** varsayılan açık.
- PDF alanı güvenli HTTP(S) adresi olmayan katalog, önizleme, ödünç, yalnız EPUB/metin ve yalnız kayıt-sayfası adayı sonuçları gizlenir.
- **Katalog kayıtlarını da göster** veya kutunun kapatılması aynı sonuçları yeniden görünür yapar; kaynak adaptörleri/kitaplık/API silinmez.
- Gizlenen kayıt sayısı ve görünür sonuç sayısı seçili kaynak/diğer filtrelerle birlikte güncellenir.
- PDF gelmediyse “kitap bulunamadı” yerine mevcut sonuçlarda PDF bağlantısı bulunamadığı açıklanır. Yalnız ilgili çalışmalarda PDF varsa ayrıca uyarı gösterilir.
- Arama akışında önce katalog olarak gelen kayda sonradan PDF eklenirse kart görünür olur. Makale/slayt araması bu ek kitap filtresinden etkilenmez.
- PDF bağlantısı dosyanın erişilebilir veya doğru eser olduğunun önceden doğrulandığı anlamına gelmez. Mevcut biçim, alternatif aday, SSRF ve dosya–eser denetimleri değiştirilmedi.

## Doğrulama

- Yeni 6 davranış testi: PDF/EPUB/metin ayrımı ve güvensiz URL reddi; birleştirilmiş kaynakta PDF; PDF bulunamadı açıklaması/katalog geri açma; ilgili çalışma uyarısı; makale aramasının korunması; NDJSON'da sonradan gelen PDF.
- İlgili 4 test dosyasında **53/53** geçti.
- Tam regresyon: **37 test dosyası / 418 test**, tamamı geçti.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run smoke`, `git diff --check`: geçti.
- Canlı arama metadata kanıtı: `reports/silmarillion-pdf-2026-10-26.json`. İkinci koşuda kapalı kaynaklar `benim-sitem`, `google-books`; hazır olup hata bildirenler Anna's Archive, Gutenberg ve Internet Archive. Bunlar ayrı kaynak erişim sınırlarıdır; sonuçların katalog/PDF ayrımını değiştirmez.
- Genel indiriciyi ayırmak için açık erişimli arXiv `1706.03762` ayrı çıktı klasörüne gerçek indirildi: **2.215.244 bayt PDF**, yaklaşık **2,1 sn**. Dosya–eser kimliği sonucu **belirsiz** kaldı; doğrulanmış eser diye sunulmadı. Kaynak: `reports/pdf-download-probe-2026-10-26.json`. Kullanıcının mevcut `downloads/` klasörüne yazılmadı, özet/AI çağrısı yapılmadı ve Silmarillion dosyası indirilmedi.

## Sınır ve kullanım

Bu değişiklik mevcut sonuçları PDF odaklı sunar; yeni bir PDF kaynağı eklemez, erişim engelini aşmaz ve arama limitinin dışında kalan bütün interneti taramaz. API sonuçları korunur. Yeni alanların tarayıcıya yüklenmesi için sayfayı **Ctrl+F5** ile yenilemek yeterlidir; frontend build adımı yoktur.

Değişen ürün dosyaları: `public/app.js`, `public/index.html`, `README.md`. Testler: `test/pdf-availability-ui.test.ts`; mevcut katalog araçları testi tüm kayıtlar görünür modda, kaynak gruplama testi kendi makale sorgusuyla uyumlu hale getirildi. Kullanıcıya ait ilgisiz raporlar, `.env`, `.data/` ve mevcut indirilmiş dosyalar yayın kapsamına alınmadı. Canlı arama normal arama önbelleği/kurum gözlem indeksini güncelleyebilir; kişisel kitaplık içeriği okunmadı veya değiştirilmedi.
