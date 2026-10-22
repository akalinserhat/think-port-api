# @akalin/ui

**Akalin UI**, kurumsal web uygulamaları, yönetim panelleri (Admin UI), SaaS platformları ve yapay zeka (AI) arayüzleri için geliştirilmiş; **Material Design 3 (MD3)** ve **Glassmorphism** tasarım ilkelerini temel alan, TypeScript tabanlı, bağımsız bir React UI bileşen kütüphanesidir.

---

## ✨ Öne Çıkan Özellikler

- **Katmanlı Sayfa İskeletleri (`Base*Page`):** Liste, Kart, Belge (Header-Detail-Footer), Sihirbaz (Wizard), Sistem Ayarları ve CRUD Modal sayfaları için hazır mimari şablonlar.
- **Gelişmiş Veri Izgaraları:** Sıralama, sayfalama, sütun yönetimi (Drag & Drop), klavye navigasyonu ve duyarlı (responsive) mobil kart görünümü destekli `DataTable` ve Excel benzeri `SpreadsheetGrid`.
- **Zengin Form & Giriş Bileşenleri:** Türkçe karakter duyarlı otomatik harf dönüşümü (`HarfDonusumu`), para birimi, IBAN, telefon, tarih aralığı ve barkod okuyucu destekli form elemanları.
- **Hazır Yapay Zeka (AI & LLM) Bileşenleri:** `LLMSeciciInput`, `YZModelSecici`, `AiTypingIndicator`, `AiResponseTimer`, `AiThinkingDetails` ve `BaseAiAssistantModal`.
- **Tema & Çoklu Dil (i18n) Uyumu:** CSS değişkenleri (`--bg-primary`, `--surface-card`, `--accent-primary` vb.) üzerinden Light/Dark tema ve `react-i18next` desteği.

---

## 📦 Kurulum

Projeye GitHub üzerinden doğrudan bağımlılık olarak ekleyebilirsiniz:

```bash
npm install github:akalinserhat/akalin-ui#main
```

veya `package.json` dosyanıza ekleyip `npm install` çalıştırabilirsiniz:

```json
{
  "dependencies": {
    "@akalin/ui": "github:akalinserhat/akalin-ui#main"
  }
}
```

### Peer Dependencies (Gerekli Bağımlılıklar)

Kütüphanenin çalışması için ana projede aşağıdaki paketlerin kurulu olması gerekir:

```json
{
  "react": "^18.2.0 || ^19.0.0",
  "react-dom": "^18.2.0 || ^19.0.0",
  "react-router-dom": "^6.0.0 || ^7.0.0",
  "react-i18next": "^17.0.8"
}
```

---

## ⚙️ Vite Yapılandırması (`vite.config.ts`)

`@akalin/ui` doğrudan TypeScript (`.ts` / `.tsx`) kaynak dosyalarını dışa aktardığı için Vite projelerinde tekil React instance'ı korunması ve hızlı derleme için şu yapılandırma önerilir:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom', 'react-i18next'],
  },
  optimizeDeps: {
    exclude: ['@akalin/ui'],
  },
});
```

---

## 🚀 Hızlı Başlangıç

### 1. Uygulama Kökünde Provider Kurulumu (`main.tsx` / `App.tsx`)

Sayfa başlıklarının, bildirim pencerelerinin (`useAlertDialog`) ve form harf dönüşümü ayarlarının çalışması için uygulamanızı temel sağlayıcılarla sarmalayın:

```tsx
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AlertDialogProvider, HeaderProvider, InputSettingsProvider } from '@akalin/ui';
import App from './App';

export function Root() {
  return (
    <BrowserRouter>
      <AlertDialogProvider>
        <HeaderProvider>
          <InputSettingsProvider>
            <App />
          </InputSettingsProvider>
        </HeaderProvider>
      </AlertDialogProvider>
    </BrowserRouter>
  );
}
```

### 2. Bileşen Kullanım Örneği

```tsx
import React, { useState } from 'react';
import {
  BaseSystemPage,
  BaseSystemCard,
  BasePopup,
  BaseInput,
  BaseButton,
  useAlertDialog,
} from '@akalin/ui';
import { Cpu, Plus } from 'lucide-react';

export default function ProvidersPage() {
  const { showAlert } = useAlertDialog();
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');

  return (
    <BaseSystemPage
      title="Model Sağlayıcıları"
      subtitle="Sistemdeki aktif yapay zeka sağlayıcılarını yönetin"
      headerActions={
        <BaseButton
          variant="primary"
          icon={<Plus size={16} />}
          text="Yeni Sağlayıcı"
          onClick={() => setModalOpen(true)}
        />
      }
    >
      <div className="system-cards-grid">
        <BaseSystemCard
          icon={<Cpu size={22} />}
          iconBoxVariant="primary"
          title="OpenAI Gateway"
          subtitle="https://api.openai.com/v1"
          isDefault={true}
          status={{ active: true, activeText: 'Aktif' }}
          details={[
            { label: 'Varsayılan Model', value: 'gpt-4o' },
            { label: 'Durum', value: 'Bağlı' },
          ]}
          onClick={() => showAlert('info', 'Bilgi', 'Sağlayıcı detayları açılıyor.')}
        />
      </div>

      <BasePopup
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Yeni Sağlayıcı Ekle"
      >
        <BaseInput
          label="Sağlayıcı Adı"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Örn: OpenAI, Gemini, Anthropic..."
          harfDonusumu="basHarflerBuyuk"
        />
      </BasePopup>
    </BaseSystemPage>
  );
}
```

---

## 🧩 Bileşen Kataloğu

### 1. Temel Sayfa İskeletleri & Modallar (`pages/base`)
| Bileşen | Açıklama |
| :--- | :--- |
| `BasePage` | Başlık, geri butonu, sekme (`TabLayout`), kaydet/iptal aksiyonları ve kısayol (`Ctrl+S`) destekli temel sayfa kapsayıcısı. |
| `BaseSystemPage` | Sistem ayarları ve modül yönetim ekranları için kart ızgarası + alt detay sayfası + arama filtreleme iskeleti. |
| `BaseListPage` | `DataTable`, arama, sayfalama, silme onayı ve yeni kayıt yönlendirmesini otomatikleştiren tam sayfa liste şablonu. |
| `BaseCardPage` | Sekmeli kart tanımlama ekranları için `ActionMenu` ve AI asistan entegrasyonlu temel kart sayfası. |
| `BaseFormPage` | URL `id` parametresine göre veri çekme, dirty-state kontrolü ve kaydetme işlemlerini yöneten form şablonu. |
| `BaseDocumentPage` | Header (Üst Bilgi) - Detail (`SpreadsheetGrid`) - Footer (Dip Toplam) yapısına sahip belge formu iskeleti. |
| `BaseWizardPage` | Çok adımlı (`WizardStep`) kurulum ve işlem sihirbazı şablonu. |
| `BaseSelectionList` | Tekli ve çoklu seçim listeleri için klavye ve çift tıklama destekli şablon. |
| `BasePopup` / `Modal` | Boyutlandırılabilir, klavye (`ESC`) ve overlay kontrollü standart modal/popup bileşenleri. |
| `BaseModalCrud` / `BaseCrudPopup` | Sayfa değiştirmeden modal üzerinden Ekle/Düzenle/Sil işlemleri yapan CRUD şablonları. |
| `BaseSeciciModal` | Arama ve tablo navigasyonu içeren jenerik kayıt seçici modal. |

### 2. Temel Bileşenler (`components/base`)
- **Giriş Alanları:** `BaseInput` (`HarfDonusumu` destekli), `BaseNumericInput`, `BaseListInput`, `BaseSeciciInput`, `BaseTreeDropdownSecici`
- **Buton & Menüler:** `BaseButton`, `BaseFloatCircleButton`, `BaseMenuButton`
- **Görünüm & Kontroller:** `BaseCard`, `BaseDashboardView`, `BaseProgressBar`, `BaseSwitch`, `BaseTreeView`, `BaseTreeTableView`, `BaseDropdownSecici`, `BaseObjectList`, `BaseBarkodOkuyucu`

### 3. Kart Bileşenleri (`components/card`)
- `BaseSystemCard` (`SystemModuleCard`, `SystemCard`), `Card`, `BaseCardPageHeader` (`CardPageHeader`), `PolicySettingCard` (`AyarCard`), `SistemKart`, `UserCard`, `NotificationCard`, `AdminNotificationCard`, `EmailTemplateCard`, `BulutDepolamaCard`, `MigrationFieldCard`

### 4. Tablo, Liste, Sekme, Menü & Sidebar (`components/grid`, `tab`, `menu`, `sidebar`, `treeview`)
- `DataTable`, `SpreadsheetGrid`, `CardList`, `TabLayout`, `Breadcrumb`, `ActionMenu`, `DrawerMenu`, `Sidebar`, `TreeTableView`, `CloudDirectoryView`

### 5. Özelleşmiş Input & Butonlar (`components/input`, `button`)
- **Inputlar:** `BasitInput`, `AramaInput`, `TamsayiInput`, `YuzdelikInput`, `NotInput`, `DateInput`, `DateRangeInput` (`TarihAraligiSecici`), `PhoneInput`, `EmailInput`, `CurrencyInput`, `IbanInput`, `BarcodeScannerInput`
- **Butonlar:** `SaveButton`, `DocumentSaveButton`, `CancelButton`, `BackButton`, `OkButton`, `NextButton`, `PrevButton`, `FinishButton`, `UploadButton`, `EkleMenuButton`, `EkleFloatCircleButton`, `TumunuOkunduIsaretleButton`, `TumunuTemizleButton`

### 6. Yapay Zeka (AI), İlerleme Çubukları & Editörler
- **AI & LLM:** `LLMSeciciInput`, `YZModelSecici`, `BaseAiAssistantModal`, `BaseListAiModal`, `AiTypingIndicator`, `AiResponseTimer`, `AiThinkingDetails`
- **Progress & Durum:** `FileUploadProgressBar`, `StorageQuotaBar`, `SyncProgressModal`, `PageLoader`, `ErrorBoundary`, `FieldError`, `UndoDeleteBar`
- **Editör & Görünüm:** `HtmlEditor`, `TemplateBuilder`, `TutarView`, `PhoneView`, `IbanView`, `ParaBirimiView`, `CurrencyIcon`, `FilesOnClouds`, `UploadToCloud`, `BarcodeScannerModal`

### 7. Context, Alert & Yardımcı Araçlar (`alerts`, `context`, `utils`)
- **Alert Sistemi:** `AlertDialogProvider`, `useAlertDialog`, `AlertDialog`, `BasePromptDialog`
- **Header Yönetimi:** `HeaderProvider`, `useHeader`, `useHeaderApi`, `useDocumentDirty`
- **Yardımcılar:** `formatCurrency`, `extractTextFromNode`, `updateDocumentTitle`, `autoFocusFirstInput`, `isNativePlatform`, `isMobileBrowser`, `isMobileDevice`

---

## 🔄 Güncelleme

Kütüphanede yapılan güncellemeleri bağlı projelerinize çekmek için:

```bash
npm update @akalin/ui
```

---

## 📄 Lisans

Private / Proprietary © Serhat Akalın