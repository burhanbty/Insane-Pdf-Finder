# PDF indirme incelemesi — 18 Ekim 2026

Kullanıcının örneği: “Deli Kadın Mektupları” aramasında ilk sonuçların PDF
düğmelerinin pasif olması.

## Doğrulanan nedenler

1. Açık olan 3319 ekranı, önceki tasarım çalışmasından kalan kontrollü veri
   önizlemesiydi. Sorguya göre gerçek katalogları taramıyordu. Ekranda bu ayrım
   belirtilmediği için gerçek uygulama sanılabiliyordu. Önizlemeye belirgin uyarı ve
   gerçek uygulama bağlantısı eklendi; gerçek uygulama 3000 portunda açıldı.
2. Doğrudan `pdf` alanı yoksa kart pasif bir “PDF indir” düğmesi gösteriyordu.
   Kaynak sayfasındaki `citation_pdf_url` ve PDF alternatif bağlantıları çözülmüyordu.
3. İndirme dosyayı yalnızca sunucunun `downloads/` klasörüne yazıyordu. Tarayıcının
   İndirilenler klasöründe dosya oluşması için ikinci bir bağlantıya tıklamak gerekiyordu.
4. Internet Archive modülü yalnızca `format === "pdf"` kabul ediyor, yaygın
   “Text PDF” ve “Image PDF” dosyalarını atlıyordu. Birden fazla kaynağı bulunan
   kartta ilk PDF başarısız olursa diğer adaylar denenmiyordu.
5. Hata yalnızca düğmenin başlığında gösterilip birkaç saniyede kayboluyordu.

## Düzeltilen davranış

- Gerçek PDF varsa tek tıkla önce uygulamaya kaydedilir, ardından yerel dosya
  bağlantısıyla tarayıcı indirmesi başlar. Kartta tekrar indirme bağlantısı kalır.
- PDF bilinmiyorsa “PDF bağlantısını bul” sayfanın bildirdiği dosyayı arar. Sayfa
  meta verileri, `alternate` PDF bağlantısı veya tek ve açık PDF indirme bağlantısı
  desteklenir. Kaynakçadaki rastgele PDF'ler seçilmez; JavaScript çalıştırılmaz.
- Aynı karta ait en fazla beş ek adres ve toplam sekiz çözümleme isteği denenir.
  Her dosyanın PDF imzası denetlenir. HTML en fazla 2 MB okunur; PDF 300 MB sınırında
  akışla yazılır. İstek süresi 90 saniye, işlem süresi 120 saniyedir.
- Özel IP/DNS/yönlendirme denetimleri korunur. Oturum, CAPTCHA veya erişim kısıtı
  aşılmaz. PDF olmayan yanıt dosya diye kaydedilmez. Hata kartta görünür kalır.
- IA Text/Image PDF desteği eklendi. Özel dosyalar, kısıtlı/kapalı kayıtlar ve ödünç
  koleksiyonları doğrudan dosya olarak sunulmaz. Eski IA arama önbelleği yeni
  sürümle karışmasın diye ilgili kaynak ve birleşik arama anahtarları yenilendi.

## Kanıt

- **297 test** geçti (24 dosya, tek worker). Lint ve TypeScript geçti.
- W3C doğrudan PDF: **13.264 bayt**, `%PDF-` imzası.
- arXiv doğrudan PDF ve kayıt sayfasından çözümleme: ikisi de **2.215.244 bayt**,
  aynı SHA-256: `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
- Gerçek uygulamada “Attention Is All You Need” araması yapıldı. arXiv içeren
  ilk kartın PDF düğmesine bir kez tıklanınca tarayıcı indirmesi tamamlandı.
  `attention_is_all_you_need_2.pdf` aynı bayt sayısı ve SHA-256 ile doğrulandı.
  Önceden bulunan dosyanın üzerine yazılmadı.
- Kanıt dosyaları: `pdf-live-2026-10-18.json`, `pdf-browser-2026-10-18.json`,
  `pdf-gercek-indirme-2026-10-18.png`. Canlı betik anahtar, iletişim e-postası veya
  LLM kullanmaz; geçici indirme/önbelleğini temizler.

“Deli Kadın Mektupları” sorgusunun gerçek aramasında 12 kaynak durumu alındı;
çıkan beş sonuç bu başlıkla tam eşleşmiyordu. Bazı sağlayıcılar hata verdi.
Bu yüzden bu kitap için açık PDF bulunduğu veya hiçbir yerde bulunmadığı sonucu
çıkarılamaz. Kesin eseri ayırmak için yazar/ISBN bilgisi yararlı olacaktır.

Bu geliştirme her kitabın PDF'ini garanti etmez. JavaScript/oturum gerektiren
sayfalar otomatik çözülemeyebilir. Farklı dil/baskı aynı kitap sayılmamalıdır.
Commit veya GitHub push yapılmadı.

## Başvurular

- [Internet Archive metadata API](https://archive.org/developers/md-read.html)
- [arXiv API belgeleri](https://info.arxiv.org/help/api/index.html)
