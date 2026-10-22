/**
 * Akalin UI - Profesyonel HTML & Zengin Metin Editörü (HtmlEditor.tsx)
 * 
 * Görsel WYSIWYG düzenleme, ham HTML kaynak kod modu, canlı bölünmüş önizleme (Split View),
 * hazır şablonlar, eylem butonu (CTA) ve rozet ekleyiciler ile dinamik değişken enjeksiyonu sunar.
 * Bağımsız bir popup pencere (isModal={true}) veya satır içi (inline) bileşen olarak çalışabilir.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Code,
  Eye,
  Columns,
  RotateCcw,
  RotateCw,
  Sparkles,
  Maximize2,
  Minimize2,
  Tag,
  MousePointerClick,
  Info,
  Layers,
  Check,
  Eraser,
  Copy,
  Table as TableIcon,
  X,
  XCircle,
  Save,
  FileCode
} from 'lucide-react';
import toast from 'react-hot-toast';

export interface HtmlEditorTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  html: string;
}

export interface HtmlEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  height?: number | string;
  readOnly?: boolean;
  className?: string;
  title?: string;
  subtitle?: string;
  modulKodu?: string;
  modulAdi?: string;
  templates?: HtmlEditorTemplate[];
  /** Popup / Modal modunda tam ekran veya serbest pencere olarak açılsın mı? */
  isModal?: boolean;
  /** Popup pencerenin açık/kapalı durumu */
  isOpen?: boolean;
  /** Popup pencere kapatma fonksiyonu */
  onClose?: () => void;
  /** Kaydetme fonksiyonu (HTML içeriği parametre olarak alır) */
  onSave?: (htmlContent: string) => void;
  /** Kaydetme butonu metni */
  saveButtonText?: string;
  /** Kaydediliyor durumu */
  isSaving?: boolean;
}

const DEFAULT_TEMPLATES: HtmlEditorTemplate[] = [
  {
    id: 'kampanya-hero',
    name: '🚀 Kampanya & Tanıtım Şablonu',
    description: 'Modern gradient banner, indirim rozeti, avantajlar listesi ve satın alma butonu',
    html: `<div class="modul-eksiklik-container" style="padding: 6px; font-family: inherit;">
  <div class="modul-eksiklik-hero">
    <span class="modul-eksiklik-badge">%30 İNDİRİM FIRSATI</span>
    <h2 class="modul-eksiklik-title">{{ModulAdi}}</h2>
    <p class="modul-eksiklik-subtitle">İşletmenizin dijital dönüşümünü hızlandırın ve kurumsal iş süreçlerinizi hatasız yönetin.</p>
  </div>

  <div class="modul-eksiklik-box">
    <p style="margin: 0;">Bu modülü kullanarak belgeler arası tam entegrasyon sağlayabilir, manuel veri girişlerinden kaynaklanan hataları sıfırlayabilirsiniz.</p>
  </div>

  <div style="margin-bottom: 24px;">
    <h4 class="modul-eksiklik-adv-title">Öne Çıkan Modül Avantajları</h4>
    <ul class="modul-eksiklik-list">
      <li class="modul-eksiklik-item"><span style="color: #10b981; font-weight: bold; font-size: 15px;">✓</span> Tek tıkla otomatik sorgulama ve anlık doğrulama</li>
      <li class="modul-eksiklik-item"><span style="color: #10b981; font-weight: bold; font-size: 15px;">✓</span> Tüm sistem modülleri ve mobil terminallerle tam uyum</li>
      <li class="modul-eksiklik-item"><span style="color: #10b981; font-weight: bold; font-size: 15px;">✓</span> Öncelikli VIP teknik destek ve düzenli otomatik güncellemeler</li>
    </ul>
  </div>

  <div style="text-align: right; padding-top: 14px; border-top: 1px solid var(--glass-border);">
    <a href="{{SatinAlmaUrl}}" class="btn-satin-al">Modülü Hemen Satın Al &rarr;</a>
  </div>
</div>`
  },
  {
    id: 'ozellik-karsilastirma',
    name: '💎 Özellik & Kart Şablonu',
    description: '3 kolonlu özellik kartları ve doğrudan aktivasyon bağlantısı',
    html: `<div class="modul-eksiklik-container" style="padding: 6px; font-family: inherit;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h2 class="modul-eksiklik-title" style="margin-bottom: 6px;">{{ModulAdi}} ile Fark Yaratın</h2>
    <p class="modul-eksiklik-subtitle" style="max-width: 500px; margin: 0 auto;">İşletmeniz için özel olarak geliştirilmiş güçlü fonksiyonlar.</p>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px;">
    <div class="modul-eksiklik-box" style="margin-bottom: 0;">
      <div style="font-size: 20px; margin-bottom: 8px;">⚡</div>
      <h3 style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">Hızlı Entegrasyon</h3>
      <p style="font-size: 12px; color: var(--text-secondary); margin: 0; line-height: 1.4;">Ek kuruluma gerek kalmadan tek tıkla kullanıma hazır.</p>
    </div>
    <div class="modul-eksiklik-box" style="margin-bottom: 0;">
      <div style="font-size: 20px; margin-bottom: 8px;">🔒</div>
      <h3 style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">Tam Güvenlik</h3>
      <p style="font-size: 12px; color: var(--text-secondary); margin: 0; line-height: 1.4;">Yüksek şifreleme ve kurumsal veri güvenliği standartları.</p>
    </div>
    <div class="modul-eksiklik-box" style="margin-bottom: 0;">
      <div style="font-size: 20px; margin-bottom: 8px;">📈</div>
      <h3 style="font-size: 14px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">Verimlilik Artışı</h3>
      <p style="font-size: 12px; color: var(--text-secondary); margin: 0; line-height: 1.4;">İşlem sürelerinde %40'a varan zaman tasarrufu.</p>
    </div>
  </div>

  <div style="text-align: center;">
    <a href="{{SatinAlmaUrl}}" class="btn-satin-al">Hemen Başla &rarr;</a>
  </div>
</div>`
  },
  {
    id: 'sade-bilgi',
    name: 'ℹ️ Sade Bilgilendirme Şablonu',
    description: 'Minimalist bilgi kutusu ve satın alma yönlendirmesi',
    html: `<div class="modul-eksiklik-container" style="padding: 10px; font-family: inherit;">
  <div class="modul-eksiklik-box" style="display: flex; gap: 16px; align-items: flex-start; margin-bottom: 20px;">
    <div style="font-size: 28px;">💡</div>
    <div>
      <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin: 0 0 6px 0;">{{ModulAdi}} Modülü Lisansınızda Bulunmuyor</h3>
      <p style="font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5;">Bu özelliği kullanabilmek için modülü aktif etmeniz veya paketinize dahil etmeniz gerekmektedir.</p>
    </div>
  </div>

  <div style="text-align: right;">
    <a href="{{SatinAlmaUrl}}" class="btn-satin-al">Modül Bilgisi ve Satın Alma &rarr;</a>
  </div>
</div>`
  }
];

export default function HtmlEditor({
  value = '',
  onChange,
  placeholder = 'HTML içeriğinizi buraya yazabilir veya yukarıdaki araçları kullanabilirsiniz...',
  height = 460,
  readOnly = false,
  className = '',
  title,
  subtitle,
  modulKodu = '',
  modulAdi = '',
  templates = DEFAULT_TEMPLATES,
  isModal = false,
  isOpen = true,
  onClose,
  onSave,
  saveButtonText = 'Kaydet',
  isSaving = false
}: HtmlEditorProps) {
  const [activeTab, setActiveTab] = useState<'visual' | 'code' | 'split'>('visual');
  const [htmlContent, setHtmlContent] = useState(value || '');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const codeEditorRef = useRef<HTMLTextAreaElement>(null);
  const lastHtmlRef = useRef<string>(value || '');

  // DOM ile State arasındaki bağımsız ref callback
  const setVisualEditorRef = (el: HTMLDivElement | null) => {
    visualEditorRef.current = el;
    if (el && el.innerHTML !== lastHtmlRef.current) {
      el.innerHTML = lastHtmlRef.current;
    }
  };

  useEffect(() => {
    const newVal = value || '';
    if (newVal !== lastHtmlRef.current) {
      lastHtmlRef.current = newVal;
      setHtmlContent(newVal);
      if (visualEditorRef.current && visualEditorRef.current.innerHTML !== newVal) {
        visualEditorRef.current.innerHTML = newVal;
      }
    }
  }, [value]);

  if (isModal && !isOpen) return null;

  const handleVisualInput = () => {
    if (visualEditorRef.current) {
      const newHtml = visualEditorRef.current.innerHTML;
      lastHtmlRef.current = newHtml;
      setHtmlContent(newHtml);
      if (onChange) {
        onChange(newHtml);
      }
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newHtml = e.target.value;
    lastHtmlRef.current = newHtml;
    setHtmlContent(newHtml);
    if (onChange) {
      onChange(newHtml);
    }
    if (visualEditorRef.current && (activeTab === 'split')) {
      visualEditorRef.current.innerHTML = newHtml;
    }
  };

  const handleTabSwitch = (tab: 'visual' | 'code' | 'split') => {
    setActiveTab(tab);
    if ((tab === 'visual' || tab === 'split') && visualEditorRef.current) {
      if (visualEditorRef.current.innerHTML !== lastHtmlRef.current) {
        visualEditorRef.current.innerHTML = lastHtmlRef.current;
      }
    }
  };

  const executeCommand = (command: string, arg?: string) => {
    if (readOnly) return;
    if (visualEditorRef.current) {
      visualEditorRef.current.focus();
    }
    document.execCommand(command, false, arg);
    if (visualEditorRef.current) {
      const newHtml = visualEditorRef.current.innerHTML;
      lastHtmlRef.current = newHtml;
      setHtmlContent(newHtml);
      if (onChange) {
        onChange(newHtml);
      }
    }
  };

  const insertHtmlAtCursor = (htmlToInsert: string) => {
    if (readOnly) return;

    if (activeTab === 'code' && codeEditorRef.current) {
      const textarea = codeEditorRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const current = textarea.value;
      const updated = current.substring(0, start) + htmlToInsert + current.substring(end);
      lastHtmlRef.current = updated;
      setHtmlContent(updated);
      if (onChange) onChange(updated);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + htmlToInsert.length;
        textarea.focus();
      }, 0);
      return;
    }

    if (visualEditorRef.current) {
      visualEditorRef.current.focus();
      document.execCommand('insertHTML', false, htmlToInsert);
      const newHtml = visualEditorRef.current.innerHTML;
      lastHtmlRef.current = newHtml;
      setHtmlContent(newHtml);
      if (onChange) onChange(newHtml);
    }
  };

  const handleInsertLink = () => {
    const url = prompt('Bağlantı URL adresini giriniz (Örn: https://... veya /abonelik):', 'https://');
    if (url) {
      const text = prompt('Bağlantı metnini giriniz:', 'Buraya Tıklayın');
      insertHtmlAtCursor(`<a href="${url}" style="color: #6366f1; text-decoration: underline;" target="_blank">${text || url}</a>`);
    }
  };

  const handleInsertButton = () => {
    const text = prompt('Buton üzerinde yazacak metin:', 'Hemen Satın Al');
    if (!text) return;
    const url = prompt('Butonun yönleneceği link (veya pencereyi kapatmak için #close yazabilirsiniz):', `/abonelik/moduller/${modulKodu || 'MOD_ORNEK'}`);
    if (url === '#close' || url === 'close' || url === 'kapat') {
      insertHtmlAtCursor(`\n<button type="button" data-action="close" class="btn-modal-close" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: transparent; color: var(--text-secondary); border: 1px solid var(--glass-border); padding: 8px 18px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer;">${text}</button>\n`);
    } else {
      insertHtmlAtCursor(`\n<a href="${url || '#'}" class="btn-satin-al" style="display: inline-flex; align-items: center; gap: 8px; background: #6366f1; color: #ffffff; padding: 12px 24px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 13.5px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">${text} &rarr;</a>\n`);
    }
  };

  const handleInsertCloseButton = () => {
    const text = prompt('Kapat düğmesi üzerinde yazacak metin:', '✕ Şimdilik Kapat');
    if (text) {
      insertHtmlAtCursor(`\n<button type="button" data-action="close" class="btn-modal-close" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: transparent; color: var(--text-secondary); border: 1px solid var(--glass-border); padding: 8px 18px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer;">${text}</button>\n`);
    }
  };

  const handleInsertBadge = () => {
    const badgeText = prompt('Rozet metnini giriniz (Örn: %30 İndirim Fırsatı):', '%30 İndirim Fırsatı');
    if (badgeText) {
      insertHtmlAtCursor(`<span style="background: rgba(99, 102, 241, 0.2); color: #818cf8; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid rgba(99, 102, 241, 0.3); text-transform: uppercase;">${badgeText}</span> `);
    }
  };

  const handleInsertAlert = () => {
    const msg = prompt('Bilgilendirme kutusu mesajı:', 'Bu modül ile işlemlerinizi %50 daha hızlı tamamlayabilirsiniz.');
    if (msg) {
      insertHtmlAtCursor(`\n<div style="background: rgba(99, 102, 241, 0.08); border-left: 4px solid #6366f1; padding: 12px 16px; border-radius: 6px; margin: 12px 0; color: #cbd5e1; font-size: 13px;">${msg}</div>\n`);
    }
  };

  const handleInsertVariable = (varTag: string) => {
    insertHtmlAtCursor(varTag);
    toast.success(`'${varTag}' değişkeni eklendi`);
  };

  const handleApplyTemplate = (tmpl: HtmlEditorTemplate) => {
    let populatedHtml = tmpl.html;
    if (modulAdi) {
      populatedHtml = populatedHtml.replace(/\{\{ModulAdi\}\}/g, modulAdi);
    }
    if (modulKodu) {
      populatedHtml = populatedHtml.replace(/\{\{ModulKodu\}\}/g, modulKodu);
      populatedHtml = populatedHtml.replace(/\{\{SatinAlmaUrl\}\}/g, `/abonelik/moduller/${modulKodu}`);
    }
    lastHtmlRef.current = populatedHtml;
    setHtmlContent(populatedHtml);
    if (onChange) {
      onChange(populatedHtml);
    }
    if (visualEditorRef.current) {
      visualEditorRef.current.innerHTML = populatedHtml;
    }
    setShowTemplateModal(false);
    toast.success(`'${tmpl.name}' şablonu uygulandı!`);
  };

  // Dinamik değişkenleri çözümleyerek önizleme üret
  const getRenderedPreviewHtml = () => {
    let result = htmlContent || '';
    if (modulAdi) {
      result = result.replace(/\{\{ModulAdi\}\}/g, modulAdi);
    }
    if (modulKodu) {
      result = result.replace(/\{\{ModulKodu\}\}/g, modulKodu);
      result = result.replace(/\{\{SatinAlmaUrl\}\}/g, `/abonelik/moduller/${modulKodu}`);
    }
    return result;
  };

  const getLiveHtmlContent = () => {
    if ((activeTab === 'visual' || activeTab === 'split') && visualEditorRef.current) {
      return visualEditorRef.current.innerHTML;
    }
    if (activeTab === 'code' && codeEditorRef.current) {
      return codeEditorRef.current.value;
    }
    return htmlContent || '';
  };

  const handleSaveClick = () => {
    const liveHtml = getLiveHtmlContent();
    lastHtmlRef.current = liveHtml;
    setHtmlContent(liveHtml);
    if (onChange) {
      onChange(liveHtml);
    }
    if (onSave) {
      onSave(liveHtml);
    }
  };

  const editorContent = (
    <div className={`html-editor-wrapper ${isModal ? 'html-editor-popup-dialog' : ''} ${isFullscreen ? 'html-editor-fullscreen' : ''} ${className}`}>
      {/* ─── Editör Üst Başlık & Sekme Barı ───────────────────────────────── */}
      <div className="html-editor-header">
        <div className="flex items-center gap-10">
          <FileCode size={18} className="text-accent flex-shrink-0" />
          <div className="flex flex-col">
            <div className="flex items-center gap-8">
              <span className="html-editor-title">{title || 'HTML Şablon & Arayüz Editörü'}</span>
              {modulAdi && (
                <span className="html-editor-module-tag">
                  {modulAdi} ({modulKodu})
                </span>
              )}
            </div>
            {subtitle && (
              <span className="text-xs text-secondary mt-1">{subtitle}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-8">
          {/* Mod Değiştirici Butonlar */}
          <div className="html-editor-mode-switch">
            <button
              type="button"
              className={`mode-btn ${activeTab === 'visual' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('visual')}
              title="Görsel WYSIWYG Modu"
            >
              <Eye size={14} />
              <span>Görsel</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${activeTab === 'code' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('code')}
              title="HTML Kaynak Kodu Modu"
            >
              <Code size={14} />
              <span>HTML</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${activeTab === 'split' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('split')}
              title="Bölünmüş / Canlı Önizleme Modu"
            >
              <Columns size={14} />
              <span>Canlı Bölünmüş</span>
            </button>
          </div>

          {/* Tam Ekran Toggle */}
          <button
            type="button"
            className="html-editor-tool-btn"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran Yap'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          {/* Kapat Butonu (Eğer Modal Modundaysa) */}
          {isModal && onClose && (
            <button
              type="button"
              className="html-editor-tool-btn text-danger"
              onClick={onClose}
              title="Kapat"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* ─── Zengin Araç Çubuğu (Toolbar) ─────────────────────────────────── */}
      <div className="html-editor-toolbar">
        {/* Şablon Seçici */}
        <button
          type="button"
          className="html-editor-toolbar-pill highlight"
          onClick={() => setShowTemplateModal(true)}
          title="Hazır Profesyonel Şablon Yükle"
        >
          <Sparkles size={14} />
          <span>Hazır Şablonlar</span>
        </button>

        <div className="toolbar-divider" />

        {/* Metin Stilleri */}
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('bold')}
          title="Kalın (Bold)"
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('italic')}
          title="İtalik (Italic)"
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('underline')}
          title="Altı Çizili (Underline)"
        >
          <Underline size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('strikeThrough')}
          title="Üstü Çizili (Strikethrough)"
        >
          <Strikethrough size={15} />
        </button>

        <div className="toolbar-divider" />

        {/* Başlıklar */}
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('formatBlock', '<h1>')}
          title="Başlık 1 (H1)"
        >
          <Heading1 size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('formatBlock', '<h2>')}
          title="Başlık 2 (H2)"
        >
          <Heading2 size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('formatBlock', '<h3>')}
          title="Başlık 3 (H3)"
        >
          <Heading3 size={15} />
        </button>

        <div className="toolbar-divider" />

        {/* Hizalama */}
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('justifyLeft')}
          title="Sola Hizala"
        >
          <AlignLeft size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('justifyCenter')}
          title="Ortala"
        >
          <AlignCenter size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('justifyRight')}
          title="Sağa Hizala"
        >
          <AlignRight size={15} />
        </button>

        <div className="toolbar-divider" />

        {/* Listeler */}
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('insertUnorderedList')}
          title="Madde İmli Liste"
        >
          <List size={15} />
        </button>
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('insertOrderedList')}
          title="Numaralı Liste"
        >
          <ListOrdered size={15} />
        </button>

        <div className="toolbar-divider" />

        {/* Hızlı Ekleme Butonları */}
        <button
          type="button"
          className="html-editor-toolbar-pill"
          onClick={handleInsertLink}
          title="Bağlantı (Link) Ekle"
        >
          <LinkIcon size={13} />
          <span>Link</span>
        </button>
        <button
          type="button"
          className="html-editor-toolbar-pill"
          onClick={handleInsertButton}
          title="CTA Satın Alma / Eylem Butonu Ekle"
        >
          <MousePointerClick size={13} />
          <span>Eylem Butonu</span>
        </button>
        <button
          type="button"
          className="html-editor-toolbar-pill"
          onClick={handleInsertCloseButton}
          title="Tıklanınca Açılan Pencereyi / Modalı Kapatan Düğme Ekle"
        >
          <XCircle size={13} className="text-danger" />
          <span>Kapat Düğmesi</span>
        </button>
        <button
          type="button"
          className="html-editor-toolbar-pill"
          onClick={handleInsertBadge}
          title="Kampanya Rozeti Ekle"
        >
          <Tag size={13} />
          <span>Rozet</span>
        </button>
        <button
          type="button"
          className="html-editor-toolbar-pill"
          onClick={handleInsertAlert}
          title="Vurgu / Bilgi Kutusu Ekle"
        >
          <Info size={13} />
          <span>Bilgi Kutusu</span>
        </button>

        <div className="toolbar-divider" />

        {/* Dinamik Değişkenler */}
        <div className="flex items-center gap-4">
          <span className="text-xs text-secondary mr-2">Değişken:</span>
          <button
            type="button"
            className="html-editor-tag-btn"
            onClick={() => handleInsertVariable('{{ModulAdi}}')}
            title="Dinamik Modül Adı"
          >
            {'{'}{'{'}ModulAdi{'}'}{'}'}
          </button>
          <button
            type="button"
            className="html-editor-tag-btn"
            onClick={() => handleInsertVariable('{{SatinAlmaUrl}}')}
            title="Dinamik Satın Alma Linki"
          >
            {'{'}{'{'}SatinAlmaUrl{'}'}{'}'}
          </button>
        </div>

        <div className="flex-1" />

        {/* Temizle */}
        <button
          type="button"
          className="html-editor-tool-btn"
          onClick={() => executeCommand('removeFormat')}
          title="Biçimlendirmeyi Temizle"
        >
          <Eraser size={15} />
        </button>
      </div>

      {/* ─── Ana Editör Gövdesi ────────────────────────────────────────────── */}
      <div 
        className="html-editor-body" 
        style={{ 
          height: isFullscreen ? 'calc(100vh - 130px)' : (isModal ? 'calc(80vh - 120px)' : height),
          minHeight: '360px'
        }}
      >
        {/* Görsel WYSIWYG Düzenleyici */}
        {(activeTab === 'visual' || activeTab === 'split') && (
          <div className={`editor-pane visual-pane ${activeTab === 'split' ? 'split-pane' : 'full-pane'}`}>
            <div className="pane-header">
              <Eye size={13} /> Görsel Düzenleyici (WYSIWYG)
            </div>
            <div
              ref={setVisualEditorRef}
              className="visual-editable-area modul-tanitim-custom-html"
              contentEditable={!readOnly}
              suppressContentEditableWarning={true}
              onInput={handleVisualInput}
              data-placeholder={placeholder}
            />
          </div>
        )}

        {/* HTML Kaynak Kod Düzenleyici */}
        {activeTab === 'code' && (
          <div className="editor-pane code-pane full-pane">
            <div className="pane-header">
              <Code size={13} /> Ham HTML Kaynak Kodu
            </div>
            <textarea
              ref={codeEditorRef}
              className="code-textarea"
              value={htmlContent}
              onChange={handleCodeChange}
              placeholder={placeholder}
              spellCheck={false}
            />
          </div>
        )}

        {/* Split View Canlı Önizleme */}
        {activeTab === 'split' && (
          <div className="editor-pane preview-pane split-pane">
            <div className="pane-header">
              <Sparkles size={13} className="text-accent" /> Canlı Müşteri Önizlemesi
            </div>
            <div
              className="preview-rendered-area"
              dangerouslySetInnerHTML={{ __html: getRenderedPreviewHtml() }}
            />
          </div>
        )}
      </div>

      {/* ─── Alt Aksiyon Barı (Modal Modundaysa) ──────────────────────────── */}
      {isModal && (
        <div className="html-editor-popup-footer">
          <div className="flex items-center gap-8 text-xs text-secondary">
            <Info size={14} className="text-accent" />
            <span>Hazırladığınız HTML şablonu, modül eksikliğinde müşteriye doğrudan gösterilecektir.</span>
          </div>

          <div className="flex items-center gap-12">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="btn btn-secondary px-18 py-8"
              >
                İptal
              </button>
            )}

            {onSave && (
              <button
                type="button"
                onClick={handleSaveClick}
                disabled={isSaving}
                className="btn btn-primary px-22 py-8 flex items-center gap-8 shadow-accent-glow font-bold text-13"
              >
                <Save size={15} />
                <span>{isSaving ? 'Kaydediliyor...' : saveButtonText}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Hazır Şablonlar Modalı ───────────────────────────────────────── */}
      {showTemplateModal && (
        <div className="template-modal-overlay">
          <div className="template-modal-card glass-card">
            <div className="template-modal-header">
              <div className="flex items-center gap-8">
                <Sparkles size={20} className="text-accent" />
                <h3 className="template-modal-title">Profesyonel Modül Eksiklik & Tanıtım Şablonları</h3>
              </div>
              <button
                type="button"
                className="template-modal-close-btn"
                onClick={() => setShowTemplateModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="template-modal-body">
              <p className="text-secondary text-sm mb-16">
                İhtiyacınıza uygun bir şablon seçerek editöre aktarın ve içeriklerini dilediğiniz gibi özelleştirin:
              </p>
              <div className="template-grid">
                {templates.map((tmpl) => (
                  <div key={tmpl.id} className="template-item-card">
                    <div className="template-item-header">
                      <h4 className="template-item-title">{tmpl.name}</h4>
                    </div>
                    <p className="template-item-desc">{tmpl.description}</p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm w-full mt-12 flex items-center justify-center gap-6"
                      onClick={() => handleApplyTemplate(tmpl)}
                    >
                      <Check size={14} /> Şablonu Editöre Yükle
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="html-editor-popup-backdrop">
        {editorContent}
      </div>
    );
  }

  return editorContent;
}
