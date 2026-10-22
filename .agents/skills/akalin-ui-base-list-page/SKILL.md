---
name: akalin-ui-base-list-page
description: >-
  Standard architecture and usage rules for @akalin/ui BaseListPage, BaseCardPage, and header ActionMenu.
  Activate whenever creating, refactoring, or modifying list or card pages derived from BaseListPage or BaseCardPage.
---

# `@akalin/ui` `BaseListPage`, `BaseCardPage` ve Header `ActionMenu` Standart Kılavuzu

Bu yetenek (skill), `@akalin/ui` kütüphanesindeki `BaseListPage` ve `BaseCardPage` bileşenlerinden türeyen tüm ekranların standart mimarisini tanımlar.

## 1. `BaseListPage` Temel Kuralları

1. **Header'da Düğme Yerine `ActionMenu` Kullanımı (Zorunlu Standart):**
   - `BaseListPage` sınıfından türeyen sayfaların header (`BaseCardPageHeader`) bölümünde bağımsız `BaseButton`, `<button>` veya `customHeaderActions` **kullanılmaz**.
   - Bunun yerine `BaseListPage` içerisinde yerleşik bulunan `ActionMenu` bileşeni (`extraDropdownActions` prop'u) kullanılır.

2. **Birincil Eylem (Split-Button) ve Ek Menü Öğeleri:**
   - `BaseListPage` içindeki `ActionMenu` varsayılan olarak `showDefaultActionAsButton={true}` ile çalışır.
   - Sayfanın birincil eylemi `onAddNew` verildiğinde `BaseListPage` tarafından otomatik olarak `"Ekle"` split-button eylemi yapılır.

3. **Satır İçi İşlemler (`customRowActions`):**
   - Tablo satırlarındaki işlemler için `DataTable` içine manuel buton sütunu eklemek yerine `BaseListPage`'in `customRowActions` prop'u (`ActionMenuItem[]`) kullanılır.

## 2. `BaseCardPage` Temel Kuralları

1. **Standart `"Kaydet"` Düğmesi Zorunluluğu:**
   - `BaseCardPage` sınıfından türeyen tüm kart ve form sayfalarında, başlıktaki `ActionMenu` birincil kaydet düğmesinin metni **her zaman `"Kaydet"`** olmalıdır.
   - `saveButtonText` prop'u ile `"Yeni Anahtar Oluştur"`, `"Kullanıcı Oluştur"`, `"Ekle"` gibi özel metinler **kesinlikle verilmemelidir** (`BaseCardPage` varsayılan olarak `"Kaydet"` metnini kullanır).
2. **Harici Kaydet Düğmesi Yasağı:**
   - Formun altında veya `headerActions` alanında bağımsız `<BaseButton>` / `<SaveButton>` kullanılmaz; kaydetme işlemi yalnızca `BaseCardPage`'in kendi `ActionMenu` split-button'u (`onSave` / `onSubmit`) üzerinden gerçekleştirilir.

## 3. Sayfa Odaklılığı ve Tek Sorumluluk İlkesi (Single Responsibility)

1. **Sade ve Amaca Yönelik Tasarım:**
   - Her sayfa yalnızca hizmet ettiği konuya (domain/entity) odaklanmalıdır.
   - Farklı sayfaların görev alanına giren bilgiler (örneğin API Anahtarı kartında kullanıcının Kota/Hız Limiti profilini göstermek gibi), gereksiz istatistik kartları veya backend karşılığı olmayan fazladan alanlar sayfaya **eklenmemelidir**.

## 4. Base Sınıfların Soyut Kalması İlkesi (Keep Base Classes Abstract)

1. **Soyutluk ve Bileşen Kompozisyonu:**
   - `@akalin/ui` içindeki base bileşenler (`BaseDropdownSecici`, `BaseInput`, `BaseListPage`, `BaseCardPage` vb.) olabildiğince soyut tutulmalıdır.
   - Sayfaya özgü ihtiyaçlar (ör. `BaseDropdownSecici` içinde `"Diğer"` seçeneği seçildiğinde `TamsayiInput` ile gün bilgisi alınması) base sınıfı değiştirmeden, türeyen sayfada standart `options` ve bileşen kompozisyonu kullanılarak gerçekleştirilmelidir.

## 5. `@akalin/ui` Bileşen Araştırması ve Eksik Bileşen İçin Prompt Hazırlama İş Akışı

1. **Önce `@akalin/ui` Kütüphanesini Araştır:**
   - Bir bileşene ihtiyaç duyulduğunda mutlaka önce `@akalin/ui` (`vendor/akalin-ui/src/index.ts` ve alt dizinleri) taranır.
   - Bileşen kütüphanede mevcutsa (ör. `TarihAraligiSecici` / `DateRangeInput`, `EpostaSeciciInput` vb.) doğrudan kullanılır ve bileşenin CSS sınıflarının `frontend/src/styles/components.css` içinde tam olduğundan emin olunur.
2. **Bulunamazsa Prompt Hazırla ve Bekle (Base Sınıf Mirası):**
   - İhtiyaç duyulan bileşen `@akalin/ui` kütüphanesinde yoksa, yerel/geçici çözüm üretmek yerine `@akalin/ui` kütüphanesinde bu soyut bileşeni oluşturmak için bir prompt hazırlanıp kullanıcıya bildirilir.
   - Prompt içinde manuel görsel/CSS detayları vermek yerine, bileşenin hangi **Base sınıftan** (`BaseInput`, `BaseSeciciInput`, `BaseButton` vb.) türeyeceği belirtilir; böylece tüm görsel standartlar Base sınıftan miras alınır.
   - Kullanıcı görevleri tamamladığını ve devam edilebileceğini bildirdikten sonra kütüphane güncellenerek kaldığı yerden devam edilir.
