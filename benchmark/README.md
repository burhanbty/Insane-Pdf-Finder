# PDF arama değerlendirmesi v1

`pdf-search-v1.json`, resmî kaynaklardan kaydedilmiş **100 farklı eser ve beşer sorgu
çeşidinden oluşan 500 sorgu** içerir. 500 bağımsız eserin elle incelendiği bir küme
değildir. Eser kimliği etiketleri kaynak üstverisinden gelir; PDF erişilebilirliği,
dosyanın baskısı veya içeriği için insan doğrulaması yapıldığı anlamına gelmez.

| Kategori          | Farklı eser | Sorgu | Kanıt kaynağı                 |
| ----------------- | ----------: | ----: | ----------------------------- |
| Türkçe kitap      |          40 |   200 | Open Library, `language:tur`  |
| Yabancı dil kitap |          20 |   100 | DOAB, OAI-PMH kitap kayıtları |
| Makale            |          20 |   100 | Crossref                      |
| Tez/rapor         |          10 |    50 | HAL `THESE`                   |
| Sunum/ders        |          10 |    50 | HAL `LECTURE`                 |

Sorgular: başlık; başlık ve yazar; başlık/yazar/yıl; ASCII başlık ve yıl; bir harfi
eksik başlık ve yazar. Tezler mevcut ürünün `makale`, ders notları `slayt` türüne
eşlenir; bu sınıfların ürün kapsamındaki eksikleri canlı ölçümde görünür kalır.
Open Library kayıtları eser düzeyindedir; bu kümeden doğru PDF baskısı oranı çıkarılamaz.

`evidence/` altındaki cevaplar ve `.provenance.json` dosyaları URL, alınma zamanı
ve SHA-256 kanıtını saklar. Veri derleyici doğrulanmış bu anlık görüntüleri yeniden
kullanır; `--refresh` açıkça verilirse uzak kaynakları tekrar okur. Yenileme farklı
kayıtlar getirebilir; eski raporlarla yeni veri kümesinin oranlarını karıştırmayın.

## Sabit aday sıralaması

```bash
npm run benchmark:pdf -- --out reports/pdf-replay.json
```

Her sorgu aynı 100 gerçek adayın arasında sıralanır ve gruplanır. Beklenen kayıt
aday havuzunda bulunduğundan bu test **internette bulma/recall veya indirme başarısı
ölçmez**. Başlıklar büyük ölçüde ayırt edicidir; doygun %100 sonuç genel ürün
başarısı değildir. Yanlış baskı, birleşme, erişim, süre aşımı ve kaynak hatalarının
regresyonları ayrıca `test/` altındaki testlerde denetlenir.

Oracle, sıralama puanını kullanmaz: gözlenmiş DOI/ISBN/kayıt URL'sini karşılaştırır.
Aynı eserin bütün çeşitleri SHA-256 tabanlı aynı geliştirme/test bölümünde kalır.
Bu küme üzerinde eşikler ayarlanmadı. Test bölümü, eser sayısının sınırlılığını veya
üstveri etiketlerinin insan incelemesi eksiğini ortadan kaldırmaz.

## Canlı kaynak araması

```bash
npm run benchmark:pdf -- --mode live --limit 20 --out reports/pdf-live.json
# Tüm 100 eser için birer başlık+yazar sorgusu:
npm run benchmark:pdf -- --mode live --limit 100 --out reports/pdf-live-100.json
```

Canlı mod beş kategoriyi dönüşümlü örnekler. Her çalıştırma yeni ve ayrı bir
`.cache/benchmark-*` diziniyle başlar; aynı çalıştırma içindeki olağan önbellek
kullanımı devam eder. Kullanıcının normal önbelleği silinmez. Her sorgu sonunda
ilerleme raporu kaydedilir. Ağ/kota hataları kaynak durumlarında korunur; başarısız
kapsam, eserin bulunmadığını ispatlamaz. Kaynak hataları `hata` sayacından ayrıca
incelenmelidir: bu sayaç yalnızca bütün sorgunun fırlattığı hataları sayar.

Bu mod şu an her eser için bir canlı sorgu seçer; `--limit 500` yazmak 500 canlı
sorgu çalıştırmaz. Beş çeşit sorgunun tamamı sabit aday değerlendirmesinde kullanılır.
20 sorgu küçük bir örneklemdir. Farklı zamanların ağ, kota ve kaynak yanıtları
değişebilir; küçük oran/süre farkları tek başına nedensel iyileşme kanıtı değildir.

`pdfAdayi` alanı yalnızca kaynakta PDF adresi gözlendiğini belirtir; gerçek indirme
oranı değildir. Yeni kaynakların örnek dosya kontrolü ayrı yapılır:

```bash
npx tsx scripts/validate-pdf-sources.ts
```

Bu kontrol dosyayı indirir, SHA-256 hesaplar, PDF okuyucuyla açar ve ilk sekiz
sayfada beklenen başlığı arar. Dosyalar `.data/pdf-validation/` içinde tutulur.
Sunucunun 403/429 engeli açıkça raporlanır; bu durumda komut sıfır olmayan kodla biter.

## Veri kümesini yeniden oluşturma

```bash
npm run benchmark:build
# Yeni resmî anlık görüntüler almak için:
npm run benchmark:build -- --refresh
```

Ürün düzeyinde sonraki ölçüm: daha fazla bağımsız Türkçe eser, zor/belirsiz
başlıklar, gerçek baskı karşı örnekleri, erişilebilir PDF için bağımsız kanıt ve
elle gözden geçirilmiş etiketler. Böyle bir küme kurulmadan sektör liderliği veya
mutlak PDF bulma oranı raporlanmamalı.
