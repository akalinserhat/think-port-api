# ThinkPort API & `@akalin/ui` Mimari Kuralları (Agent Rules)

## 1. `BaseListPage` Header Bölümü ve `ActionMenu` Standart Kuralı

`@akalin/ui` kütüphanesindeki `BaseListPage` temel sınıfından türeyen tüm liste sayfalarında (`ApiKeysView`, `UsersView`, `ChatStudioView`, `RolesPermissionsView`, `SystemUsersView` ve yeni oluşturulacak tüm liste ekranlarında):

1. **Header'da Bağımsız Düğme Yasağı:**
   - Sayfa başlığı (`BaseCardPageHeader`) alanında kesinlikle harici/bağımsız düğmeler (`<BaseButton>`, `<button>`, `<select>` vb. `customHeaderActions` üzerinden) **KULLANILMAMALIDIR**.
2. **`BaseListPage` Yerleşik `ActionMenu` Kullanımı:**
   - Başlık (Header) bölümündeki tüm birincil ve ikincil işlemler için `BaseListPage` bileşeninin kendi bünyesinde bulunan `ActionMenu` altyapısı (`extraDropdownActions`, `actionMenuTrigger`, `actionMenuDropdownHeader`, `onActionMenuTriggerClick`) **KULLANILMALIDIR**.
3. **Varsayılan Split-Button ve Dropdown Yapısı:**
   - `BaseListPage`, başlıkta `ActionMenu` bileşenini `showDefaultActionAsButton={true}` özelliği ile render eder.
   - Birincil işlem (ör. `Yeni Ekle`, `Yeni Anahtar Üret`, `Yeni Kullanıcı`, `Yeni Sohbet` vb.) `extraDropdownActions` içinde `isDefault: true, variant: 'primary'` olarak tanımlanır (veya `onAddNew` / `addNewText` üzerinden `BaseListPage` tarafından otomatik eklenir) ve başlıkta split-button olarak görünür.
   - Filtreleme seçenekleri, liste yenileme, dışa aktarma veya özel kontroller (`type: 'custom', content: <... />`) aynı `ActionMenu` bileşeninin açılır menüsü (dropdown) içerisine `extraDropdownActions` dizisiyle yerleştirilir.

### Doğru Kullanım Örneği

```tsx
const headerDropdownActions = useMemo<ActionMenuItem[]>(
  () => [
    {
      label: 'Yeni Kayıt Ekle',
      icon: <Plus size={15} />,
      isDefault: true,
      variant: 'primary',
      onClick: handleOpenAddModal,
    },
    {
      label: 'Listeyi Yenile',
      icon: <RefreshCw size={15} />,
      dividerAbove: true,
      onClick: handleRefresh,
    },
  ],
  [handleOpenAddModal, handleRefresh]
);

return (
  <BaseListPage<MyRecordDTO>
    title="Kayıt Listesi"
    subtitle="Sistem kayıtlarını görüntüleyin ve yönetin."
    icon={<Layers size={22} />}
    columns={columns}
    searchableFields={searchableFields}
    customFetchData={handleFetchData}
    customRowActions={customRowActions}
    extraDropdownActions={headerDropdownActions}
    onAddNew={handleOpenAddModal}
  />
);
```

### Yanlış Kullanım (YASAK)

```tsx
// ❌ YANLIŞ: Header'da customHeaderActions ile BaseButton veya <button>/<select> kullanmak yasaktır!
<BaseListPage
  title="Kayıt Listesi"
  customHeaderActions={
    <BaseButton variant="primary" text="Yeni Ekle" onClick={handleOpenAddModal} />
  }
/>
```

---

## 2. `BaseCardPage` Header `ActionMenu` ve Standart "Kaydet" Düğmesi Kuralı

`@akalin/ui` kütüphanesindeki `BaseCardPage` (ve `BaseFormPage` / `BaseDocumentPage`) temel sınıfından türeyen tüm kart ve form sayfalarında (`ApiKeyCardPage` ve yeni oluşturulacak tüm kart ekranlarında):

1. **Birincil Kaydet Düğmesi Metni Her Zaman `"Kaydet"` Olmalıdır:**
   - `BaseCardPage` bileşeni, başlıkta (`BaseCardPageHeader`) yer alan `ActionMenu` split-button'unun varsayılan birincil işlemini otomatik olarak **`"Kaydet"`** (`t('Kaydet', 'Kaydet')`) etiketi ve `⌘S` / `Ctrl+S` kısayolu ile oluşturur.
   - `saveButtonText` prop'u ile `"Yeni Anahtar Oluştur"`, `"Kullanıcı Ekle"`, `"Kaydı Oluştur"` gibi varlığa özel metinler **VERİLMEMELİDİR** (`saveButtonText` prop'u boş bırakılmalı veya her zaman `"Kaydet"` olarak kalmalıdır).
2. **Header veya Form Altında Harici Kaydet Düğmesi Yasağı:**
   - Kart sayfalarının başlığında (`headerActions`) veya formun alt kısmında bağımsız `<BaseButton text="Kaydet" />` / `<SaveButton />` **KULLANILMAMALIDIR**; kaydetme işlemi yalnızca `BaseCardPage`'in kendi `ActionMenu` split-button'u (`onSave` / `onSubmit`) üzerinden yürütülmelidir.

### Doğru Kullanım Örneği (`BaseCardPage`)

```tsx
return (
  <BaseCardPage
    id="my-record-card-form"
    asForm={true}
    onSubmit={handleSubmit}
    onSave={isViewMode ? undefined : handleSubmit}
    hideSaveButton={isViewMode}
    isSaving={submitting}
    showBackButton={true}
    onBack={onBack}
    tabs={cardTabs}
    activeTabId={activeTabId}
    onTabChange={(tabId) => setActiveTabId(String(tabId))}
    extraDropdownActions={extraDropdownActions}
    title="Yeni Kayıt Kartı"
  />
);
```

### Yanlış Kullanım (YASAK)

```tsx
// ❌ YANLIŞ: saveButtonText ile "Kaydet" yerine "Yeni Anahtar Oluştur" vb. metin vermek yasaktır!
<BaseCardPage
  onSave={handleSubmit}
  saveButtonText="Yeni Anahtar Oluştur"
/>
```

---

## 3. Sayfa Odaklılığı ve Tek Sorumluluk İlkesi (Single Responsibility & Domain Focus)

Tüm liste (`BaseListPage`) ve kart (`BaseCardPage`) sayfaları tasarlanırken ve kodlanırken **Tek Sorumluluk İlkesi (Single Responsibility Principle)** esas alınmalıdır:

1. **Sadece Hizmet Edilen Konuya Odaklanma:**
   - Bir sayfa yalnızca kendi varlığının (entity/domain) ihtiyaç duyduğu veri giriş ve görüntüleme alanlarını içermelidir.
   - Örneğin `ApiKeyCardPage` (API Anahtarı Kartı) yalnızca API anahtarının oluşturulması ve görüntülenmesi için gereken alanları (`Kullanıcı Seçimi`, `Anahtar Adı`, `Geçerlilik Süresi Şablonu`, `Son Geçerlilik Tarihi`) barındırmalıdır; seçilen kullanıcının **Kota Bilgileri**, **Hız Sınırları (RPM)** veya başka bir ekranın (`UsersView`) sorumluluğunda olan özet kartlar bu sayfaya **EKLENMEMELİDİR**.
2. **Gereksiz Bilgi ve Görev Karmaşası Yasağı:**
   - Backend'de karşılığı olmayan süsleme amaçlı form alanları, sahte önizleme kutuları, gereksiz sekmeler veya başka modüllerin görev alanına giren istatistik/kota panelleri sayfaya dahil edilmemelidir.
   - Her ekran sade, amaca yönelik ve yalnızca kendi işlevini yerine getirecek şekilde tasarlanmalıdır.

---

## 4. Base Sınıfların Soyut Kalması İlkesi (Keep Base Classes Abstract)

`@akalin/ui` kütüphanesindeki temel (base) sınıflar (`BaseDropdownSecici`, `BaseInput`, `BaseListPage`, `BaseCardPage` vb.) **her zaman olabildiğince soyut (abstract), sade ve genel amaçlı** kalmalıdır:

1. **İş Mantığını Base Sınıfa Taşımama Kuralı:**
   - Bir sayfanın veya iş kuralının özel ihtiyacı (ör. "Geçerlilik Süresi Şablonu" açılır listesinde en altta `"Diğer"` seçeneğinin yer alması ve seçildiğinde gün bazında `TamsayiInput` alanının gösterilmesi), mevcut `BaseDropdownSecici` (`options`) ve `TamsayiInput` bileşenlerinin standart kompozisyonu ile türeyen sayfada (`ApiKeyCardPage`) çözülmelidir.
   - Bu tür senaryolar için `BaseDropdownSecici` gibi temel bileşenlerin içine özel prop'lar, satır içi input panelleri veya senaryoya özgü mantıklar **EKLENMEMELİDİR**.
2. **Ne Zaman `@akalin/ui` Değişikliği Gerekir?**
   - Mevcut `@akalin/ui` bileşenlerinin standart prop'ları ve kompozisyonu ile ihtiyaç doğrudan karşılanabiliyorsa `@akalin/ui` kütüphanesinde değişiklik yapılmaz ve gereksiz prompt üretilmez.

---

## 5. `@akalin/ui` Bileşen Araştırması ve Eksik Bileşen İçin Prompt Hazırlama Kuralı

Projede herhangi bir veri giriş alanı, seçici, kart veya görünüm bileşenine ihtiyaç duyulduğunda aşağıdaki iş akışı **istisnasız** uygulanmalıdır:

1. **Önce `@akalin/ui` Kütüphanesini Araştır:**
   - Herhangi bir bileşen kullanmadan veya kodlamadan önce mutlaka `@akalin/ui` kütüphanesi (`frontend/vendor/akalin-ui/src/index.ts`, `frontend/node_modules/@akalin/ui/src/index.ts` ve alt klasörleri) detaylıca incelenmelidir.
   - İhtiyacı karşılayan bileşen `@akalin/ui` kütüphanesinde mevcutsa (ör. tarih aralığı için `TarihAraligiSecici` / `DateRangeInput`, e-posta seçimi için `EpostaSeciciInput` vb.) doğrudan o bileşen kullanılmalı ve gerekli CSS sınıflarının `frontend/src/styles/components.css` içinde eksiksiz tanımlı olduğundan emin olunmalıdır.
2. **Bileşen Bulunamazsa Prompt Hazırla ve Bekle (Base Sınıf Mirası İlkesi):**
   - İhtiyaç duyulan genel amaçlı bileşen `@akalin/ui` kütüphanesinde **bulunamazsa**, proje içinde yerel/geçici bileşen yazılmaz.
   - Bunun yerine, `@akalin/ui` kütüphanesinde bu bileşenin oluşturulması için bir **Prompt** hazırlanıp kullanıcıya sunulur ve işlem duraklatılır.
   - **Prompt Hazırlarken Görsel Detay Yerine Base Sınıf Kullanımı:** Hazırlanan prompt'ta renk, kenarlık, yükseklik, gölge gibi detaylı görsel unsurlar tarif **EDİLMEMELİDİR**. Yeni bileşenin hangi **Base sınıftan** (`BaseInput`, `BaseSeciciInput`, `BaseButton`, `BaseCard`, `BaseListPage`, `BaseCardPage` vb.) türeyeceği belirtilmeli ve tüm görsel/davranışsal özellikleri doğrudan Base sınıftan miras alması sağlanmalıdır.
3. **Kullanıcı Onayı Sonrası Devam Et:**
   - Kullanıcı `@akalin/ui` tarafındaki geliştirmeyi tamamlayıp *"yapmamı istediğin görevleri tamamladım, devam edebilirsin"* bilgisini verdikten sonra projedeki `@akalin/ui` kütüphanesi güncellenir ve yarım kalan ekran/özellik geliştirmesi kaldığı yerden tamamlanır.
