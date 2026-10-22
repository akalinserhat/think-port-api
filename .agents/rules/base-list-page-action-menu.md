# `@akalin/ui` — `BaseListPage` ve `BaseCardPage` Header `ActionMenu` Standartları

## 1. `BaseListPage` Standardı
`BaseListPage` temel sınıfından türeyen tüm sayfalarda:
1. Sayfa başlığında (`Header` / `BaseCardPageHeader`) `customHeaderActions` ile harici `BaseButton`, `<button>` veya bağımsız form elemanları **kullanılmamalıdır**.
2. Başlık aksiyonları her zaman `BaseListPage` bünyesindeki `ActionMenu` bileşeni (`extraDropdownActions`, `actionMenuTrigger`, `actionMenuDropdownHeader`, `onActionMenuTriggerClick`) üzerinden tanımlanmalıdır.
3. Birincil eylem (`isDefault: true, variant: 'primary'`) `ActionMenu` split-button'u olarak sunulmalı; filtreleme, yenileme ve ek kontroller (`type: 'custom'`) `ActionMenu` açılır menüsü içinde yer almalıdır.

## 2. `BaseCardPage` Standart `"Kaydet"` Düğmesi Kuralı
`BaseCardPage` (ve `BaseFormPage` / `BaseDocumentPage`) temel sınıfından türeyen tüm kart ve form sayfalarında:
1. Başlıktaki `ActionMenu` birincil kaydet düğmesinin metni **her zaman `"Kaydet"`** olmalıdır (`BaseCardPage`'in varsayılan `t('Kaydet', 'Kaydet')` değeri).
2. `saveButtonText` prop'una `"Yeni Anahtar Oluştur"`, `"Kullanıcı Ekle"`, `"Kaydı Oluştur"` gibi varlığa özel metinler **kesinlikle verilmemelidir**.
3. Formun altında veya `headerActions` alanında harici kaydet düğmesi kullanılmamalı; kaydetme işlemi yalnızca `BaseCardPage`'in kendi `ActionMenu` split-button'u (`onSave` / `onSubmit`) üzerinden yapılmalıdır.

## 3. Sayfa Odaklılığı ve Tek Sorumluluk İlkesi (Single Responsibility)
1. Sayfalar hangi konuya hizmet ediyorsa **sadece ve sade bir şekilde o konu üzerine** çalışmalıdır.
2. Başka sayfaların sorumluluğunda olan bilgiler (ör. API Anahtarı sayfasında kullanıcının Kota/Limit bilgilerini göstermek gibi) veya gereksiz/karşılıksız alanlar sayfaya **kesinlikle eklenmemelidir**.

## 4. Base Sınıfların Soyut Kalması İlkesi (Keep Base Classes Abstract)
1. `@akalin/ui` içerisindeki temel sınıflar (`BaseDropdownSecici`, `BaseInput`, `BaseListPage`, `BaseCardPage` vb.) olabildiğince **soyut (abstract)** kalmalıdır.
2. Sayfaya özgü akışlar (ör. açılır listede `"Diğer"` seçildiğinde `TamsayiInput` gösterilmesi) base sınıfa özel prop/UI eklenerek değil, türeyen sayfada mevcut soyut bileşenlerin kompozisyonu ile çözülmelidir.
