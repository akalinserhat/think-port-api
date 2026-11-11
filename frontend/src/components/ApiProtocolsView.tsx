/**
 * ThinkPort AI Gateway - Dinamik Yapay Zeka (AI) API Protokol Yönetimi (ApiProtocolsView.tsx)
 *
 * Başlıca Sorumlulukları ve Görevleri:
 * - Sistem Ayarları (/settings/protocols) altında BaseSystemPage ve BaseSystemCard mimarisi ile API protokollerini listelemek
 * - Yeni protokol ekleme ve düzenleme işlemlerini 5 sekmeli BaseCardPage formunda yönetmek
 * - Dinamik API istek dönüştürücü (buildRequest), yanıt ayrıştırıcı (parseResponse) ve model listeleme (parseModels) scriptlerini düzenlemek
 * - Canlı Test Konsolu sekmesi ile VM sandbox ortamında HTTP çağrısını ve token ayrıştırmasını doğrulamak
 * - Sistem tanımlı ve özel protokollerin ayrımını sunmak, özel protokolleri AlertDialog ile güvenli biçimde silmek
 * - Sıfır inline CSS, sıfır inline validasyon ve %100 çok dilli (i18n) kurallarına uymak
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Code2,
  Terminal,
  Edit3,
  Trash2,
  Zap,
  RefreshCw,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Play,
  FileText,
  Info,
} from 'lucide-react';
import {
  BaseSystemPage,
  BaseSystemCard,
  BaseCardPage,
  type BaseTabItem,
  BasitInput,
  BaseButton,
  FieldError,
  AlertDialog,
  useAdminValidation,
  useBaseSystemPage,
} from '@akalin/ui';
import {
  ApiProtocolDTO,
  ApiProtocolTestRequestDTO,
  ApiProtocolTestResponseDTO,
} from '../dtos';
import { protocolService } from '../services';
import {
  validateApiProtocolField,
  validateApiProtocolForm,
  type ApiProtocolFormData,
} from '../validators/apiProtocolValidation';

export interface ApiProtocolsViewProps {
  onShowToast?: (msg: string) => void;
  onProtocolsChanged?: (count: number) => void;
}

const DEFAULT_REQUEST_SCRIPT = `function buildRequest(context) {\n  return {\n    url: context.baseUrl + '/chat/completions',\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ model: context.model, messages: context.messages })\n  };\n}`;

const DEFAULT_RESPONSE_SCRIPT = `function parseResponse(rawResponse) {\n  var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;\n  return {\n    content: data.choices ? data.choices[0].message.content : '',\n    promptTokens: data.usage ? data.usage.prompt_tokens : 0,\n    completionTokens: data.usage ? data.usage.completion_tokens : 0,\n    totalTokens: data.usage ? data.usage.total_tokens : 0\n  };\n}`;

const DEFAULT_MODELS_SCRIPT = `function parseModels(rawResponse) {\n  var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;\n  if (data && data.data && Array.isArray(data.data)) {\n    return data.data.map(function(m) { return m.id; });\n  }\n  return [];\n}`;

export const ApiProtocolsView: React.FC<ApiProtocolsViewProps> = ({
  onShowToast,
  onProtocolsChanged,
}) => {
  const { t } = useTranslation();
  const { filterItems } = useBaseSystemPage();

  const [protocols, setProtocols] = useState<ApiProtocolDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Card editor state (null = list view, 'new' = create, protocol.id = edit)
  const [editingMode, setEditingMode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('genel');
  const [saving, setSaving] = useState<boolean>(false);

  const [formData, setFormData] = useState<Partial<ApiProtocolDTO>>({
    ad: '',
    aciklama: '',
    requestScript: DEFAULT_REQUEST_SCRIPT,
    responseScript: DEFAULT_RESPONSE_SCRIPT,
    modelsScript: DEFAULT_MODELS_SCRIPT,
    sistemProtokoluMu: false,
  });

  const { errors, clearError, setFieldError, setErrors, clearErrors } = useAdminValidation();

  // Live Test Console state
  const [testDto, setTestDto] = useState<ApiProtocolTestRequestDTO>({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    testMessage: t('protocols.testDefaultMessage', 'Merhaba, API protokol bağlantı testi.'),
    requestScript: '',
    responseScript: '',
    modelsScript: '',
  });
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<ApiProtocolTestResponseDTO | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const loadProtocols = useCallback(async () => {
    try {
      setLoading(true);
      const data = await protocolService.listProtocols();
      setProtocols(data);
      onProtocolsChanged?.(data.length);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t('protocols.loadErrorToast', 'API Protokolleri yüklenirken hata oluştu.');
      onShowToast?.(message);
    } finally {
      setLoading(false);
    }
  }, [onProtocolsChanged, onShowToast, t]);

  useEffect(() => {
    loadProtocols();
  }, [loadProtocols]);

  const handleOpenCreate = useCallback(() => {
    clearErrors();
    setTestResult(null);
    setTestError(null);
    setFormData({
      ad: '',
      aciklama: '',
      requestScript: DEFAULT_REQUEST_SCRIPT,
      responseScript: DEFAULT_RESPONSE_SCRIPT,
      modelsScript: DEFAULT_MODELS_SCRIPT,
      sistemProtokoluMu: false,
    });
    setTestDto({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      testMessage: t('protocols.testDefaultMessage', 'Merhaba, API protokol bağlantı testi.'),
      requestScript: DEFAULT_REQUEST_SCRIPT,
      responseScript: DEFAULT_RESPONSE_SCRIPT,
      modelsScript: DEFAULT_MODELS_SCRIPT,
    });
    setActiveTab('genel');
    setEditingMode('new');
  }, [clearErrors, t]);

  const handleOpenEdit = useCallback(
    (protocol: ApiProtocolDTO, initialTab: string = 'genel') => {
      clearErrors();
      setTestResult(null);
      setTestError(null);
      setFormData({
        ...protocol,
      });
      setTestDto((prev) => ({
        ...prev,
        protokolId: protocol.id,
        requestScript: protocol.requestScript || '',
        responseScript: protocol.responseScript || '',
        modelsScript: protocol.modelsScript || '',
      }));
      setActiveTab(initialTab);
      setEditingMode(protocol.id);
    },
    [clearErrors]
  );

  const handleCloseEditor = useCallback(() => {
    clearErrors();
    setTestResult(null);
    setTestError(null);
    setEditingMode(null);
  }, [clearErrors]);

  const handleDelete = useCallback(async () => {
    if (!deleteId) return;
    try {
      await protocolService.deleteProtocol(deleteId);
      onShowToast?.(t('protocols.deletedToast', 'Protokol başarıyla silindi.'));
      setDeleteId(null);
      await loadProtocols();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t('protocols.deleteErrorToast', 'Silme işlemi başarısız oldu.');
      onShowToast?.(message);
    }
  }, [deleteId, loadProtocols, onShowToast, t]);

  const handleFieldChange = useCallback(
    (field: keyof ApiProtocolFormData, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      clearError(field as string);
    },
    [clearError]
  );

  const handleFieldBlur = useCallback(
    (field: keyof ApiProtocolFormData) => {
      const errorMsg = validateApiProtocolField(field, formData[field], t);
      if (errorMsg) {
        setFieldError(field as string, errorMsg);
      } else {
        clearError(field as string);
      }
    },
    [clearError, formData, setFieldError, t]
  );

  const handleSave = useCallback(
    async (e?: React.FormEvent | React.MouseEvent) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      const formErrors = validateApiProtocolForm(formData as ApiProtocolFormData, t);
      if (Object.keys(formErrors).length > 0) {
        setErrors(formErrors);
        onShowToast?.(t('protocols.fillRequiredToast', 'Lütfen zorunlu alanları doldurun.'));
        return;
      }

      try {
        setSaving(true);
        if (editingMode && editingMode !== 'new') {
          await protocolService.updateProtocol(editingMode, formData);
          onShowToast?.(
            t('protocols.updatedToast', 'Protokol scriptleri başarıyla güncellendi.')
          );
        } else {
          await protocolService.createProtocol(formData);
          onShowToast?.(t('protocols.createdToast', 'Yeni protokol başarıyla oluşturuldu.'));
        }
        await loadProtocols();
        handleCloseEditor();
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : t('protocols.saveErrorToast', 'Kayıt sırasında hata oluştu.');
        onShowToast?.(message);
      } finally {
        setSaving(false);
      }
    },
    [editingMode, formData, handleCloseEditor, loadProtocols, onShowToast, setErrors, t]
  );

  const handleRunTest = useCallback(async () => {
    if (!testDto.baseUrl || !testDto.model) {
      onShowToast?.(t('protocols.testRequiredToast', 'Base URL ve Model alanları zorunludur.'));
      return;
    }

    try {
      setTesting(true);
      setTestResult(null);
      setTestError(null);

      const payload: ApiProtocolTestRequestDTO = {
        ...testDto,
        requestScript: formData.requestScript || testDto.requestScript,
        responseScript: formData.responseScript || testDto.responseScript,
        modelsScript: formData.modelsScript || testDto.modelsScript,
      };

      const result = await protocolService.testProtocol(payload);
      setTestResult(result);
      onShowToast?.(
        t('protocols.testSuccessToast', 'Protokol scripti başarıyla doğrulandı ve yanıt ayrıştırıldı!')
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : t('protocols.testErrorToast', 'Test başarısız oldu.');
      setTestError(msg);
      onShowToast?.(msg);
    } finally {
      setTesting(false);
    }
  }, [formData.modelsScript, formData.requestScript, formData.responseScript, onShowToast, t, testDto]);

  const visibleProtocols = useMemo(
    () =>
      filterItems(protocols, (p) => [
        p.ad,
        p.aciklama || '',
        p.sistemProtokoluMu
          ? t('protocols.systemBadge', 'Sistem')
          : t('protocols.customBadge', 'Özel'),
      ]),
    [filterItems, protocols, t]
  );

  const tabs: BaseTabItem[] = useMemo(
    () => [
      {
        id: 'genel',
        label: t('protocols.tabGeneral', 'Genel Bilgiler'),
        icon: <FileText size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-20">
            <div className="form-group">
              <label className="form-label">{t('protocols.fieldName', 'Protokol Adı')}</label>
              <BasitInput
                type="text"
                textTransform="none"
                value={formData.ad || ''}
                onChange={(e) => handleFieldChange('ad', e.target.value)}
                onBlur={() => handleFieldBlur('ad')}
                placeholder={t(
                  'protocols.fieldNamePlaceholder',
                  'Örn: OpenAI REST API Uyumluluğu'
                )}
                className={errors.ad ? 'is-invalid' : ''}
              />
              <FieldError error={errors.ad} />
            </div>

            <div className="form-group">
              <label className="form-label">{t('protocols.fieldDescription', 'Açıklama')}</label>
              <BasitInput
                type="text"
                textTransform="none"
                value={formData.aciklama || ''}
                onChange={(e) => handleFieldChange('aciklama', e.target.value)}
                placeholder={t(
                  'protocols.fieldDescriptionPlaceholder',
                  'Desteklenen sağlayıcılar ve API formatı hakkında notlar...'
                )}
              />
            </div>

            {formData.sistemProtokoluMu && (
              <div className="ai-test-alert success flex items-center gap-10">
                <Info size={18} />
                <span>
                  {t(
                    'protocols.systemProtocolInfo',
                    'Bu protokol sistem çekirdeği tarafından tanımlanmıştır. İstek ve yanıt scriptleri kurumunuza özel güncellenebilir.'
                  )}
                </span>
              </div>
            )}
          </div>
        ),
      },
      {
        id: 'request',
        label: t('protocols.tabRequest', '1. İstek Scripti (buildRequest)'),
        icon: <Code2 size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-16">
            <div className="ai-script-editor-container">
              <div className="ai-script-editor-label">
                <span>
                  {t(
                    'protocols.requestFuncSignature',
                    'function buildRequest(context) { return { url, method, headers, body }; }'
                  )}
                </span>
                <span className="text-secondary font-mono text-xs">
                  {t('protocols.sandboxBadge', 'VM Sandbox ECMAScript')}
                </span>
              </div>
              <textarea
                className="ai-script-textarea"
                value={formData.requestScript || ''}
                onChange={(e) => handleFieldChange('requestScript', e.target.value)}
                onBlur={() => handleFieldBlur('requestScript')}
                placeholder={t(
                  'protocols.requestScriptPlaceholder',
                  '// buildRequest fonksiyonu context nesnesini alır...'
                )}
                rows={14}
              />
              <FieldError error={errors.requestScript} />
              <div className="ai-script-help">
                {t(
                  'protocols.requestHelp',
                  'Parametreler: context.baseUrl, context.apiKey, context.model, context.messages, context.temperature, context.maxTokens. Dönüş: { url, method, headers, body }'
                )}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'response',
        label: t('protocols.tabResponse', '2. Yanıt & Token Scripti (parseResponse)'),
        icon: <Zap size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-16">
            <div className="ai-script-editor-container">
              <div className="ai-script-editor-label">
                <span>
                  {t(
                    'protocols.responseFuncSignature',
                    'function parseResponse(rawResponse) { return { content, promptTokens, completionTokens, totalTokens }; }'
                  )}
                </span>
                <span className="text-secondary font-mono text-xs">
                  {t('protocols.sandboxBadge', 'VM Sandbox ECMAScript')}
                </span>
              </div>
              <textarea
                className="ai-script-textarea"
                value={formData.responseScript || ''}
                onChange={(e) => handleFieldChange('responseScript', e.target.value)}
                onBlur={() => handleFieldBlur('responseScript')}
                placeholder={t(
                  'protocols.responseScriptPlaceholder',
                  '// parseResponse fonksiyonu ham JSON yanıtını alır...'
                )}
                rows={14}
              />
              <FieldError error={errors.responseScript} />
              <div className="ai-script-help">
                {t(
                  'protocols.responseHelp',
                  'Zorunlu alanlar: content (string), promptTokens (int), completionTokens (int), totalTokens (int). Token sayaçları ve kota düşümü bu değerlere göre yapılır.'
                )}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'models',
        label: t('protocols.tabModels', '3. Modeller Scripti (parseModels)'),
        icon: <Cpu size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-16">
            <div className="ai-script-editor-container">
              <div className="ai-script-editor-label">
                <span>
                  {t(
                    'protocols.modelsFuncSignature',
                    'function parseModels(rawResponse) { return string[]; }'
                  )}
                </span>
                <span className="chip-primary font-mono text-xs">
                  {t('protocols.optionalBadge', 'Opsiyonel')}
                </span>
              </div>
              <textarea
                className="ai-script-textarea"
                value={formData.modelsScript || ''}
                onChange={(e) => handleFieldChange('modelsScript', e.target.value)}
                placeholder={t(
                  'protocols.modelsScriptPlaceholder',
                  '// parseModels fonksiyonu sağlayıcının /models uç noktasından dönen listeden model id dizisini çıkarır...'
                )}
                rows={14}
              />
              <div className="ai-script-help">
                {t(
                  'protocols.modelsHelp',
                  'Sağlayıcının /models veya benzeri model listeleme uç noktasından model ID dizisini (Array of strings) ayıklar.'
                )}
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'test',
        label: t('protocols.tabTest', '4. Canlı Test Konsolu'),
        icon: <Terminal size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-20">
            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">
                  {t('protocols.testBaseUrlLabel', 'Test Base URL')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={testDto.baseUrl}
                  onChange={(e) => setTestDto({ ...testDto, baseUrl: e.target.value })}
                  placeholder={t('protocols.testBaseUrlPlaceholder', 'https://api.openai.com/v1')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  {t('protocols.testModelLabel', 'Test Model Adı')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={testDto.model}
                  onChange={(e) => setTestDto({ ...testDto, model: e.target.value })}
                  placeholder={t('protocols.testModelPlaceholder', 'gpt-4o-mini')}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                {t('protocols.testApiKeyLabel', 'API Key (İsteğe Bağlı / Test İçin)')}
              </label>
              <BasitInput
                type="password"
                textTransform="none"
                value={testDto.apiKey || ''}
                onChange={(e) => setTestDto({ ...testDto, apiKey: e.target.value })}
                placeholder={t('protocols.testApiKeyPlaceholder', 'sk-...')}
                className="font-mono"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                {t('protocols.testMessageLabel', 'Test Mesajı')}
              </label>
              <div className="flex-row gap-8">
                <BasitInput
                  type="text"
                  textTransform="none"
                  className="flex-1"
                  value={testDto.testMessage}
                  onChange={(e) => setTestDto({ ...testDto, testMessage: e.target.value })}
                />
                <BaseButton
                  type="button"
                  variant="primary"
                  onClick={handleRunTest}
                  disabled={testing}
                  icon={
                    testing ? (
                      <RefreshCw size={16} className="spin-icon" />
                    ) : (
                      <Play size={16} />
                    )
                  }
                >
                  {t('protocols.runTestBtn', 'İsteği Gönder & Test Et')}
                </BaseButton>
              </div>
            </div>

            {testResult && (
              <div className="ai-test-alert success flex-col items-start gap-12">
                <div className="flex-row items-center justify-between w-full flex-wrap gap-8">
                  <div className="flex-row items-center gap-6 font-bold">
                    <CheckCircle2 size={16} />
                    <span>
                      {t(
                        'protocols.testSuccessHeader',
                        'Script Başarıyla Çalıştı & Yanıt Ayrıştırıldı'
                      )}
                    </span>
                  </div>
                  <div className="flex-row gap-8 flex-wrap">
                    <span className="chip-primary">
                      {t('protocols.promptTokensChip', 'Prompt: {{count}} tkn', {
                        count: testResult.promptTokens,
                      })}
                    </span>
                    <span className="chip-primary">
                      {t('protocols.completionTokensChip', 'Completion: {{count}} tkn', {
                        count: testResult.completionTokens,
                      })}
                    </span>
                    <span className="chip-success">
                      {t('protocols.totalTokensChip', 'Toplam: {{count}} tkn', {
                        count: testResult.totalTokens,
                      })}
                    </span>
                  </div>
                </div>
                <div className="p-12 bg-primary rounded border-glass w-full text-sm">
                  <div className="font-semibold text-secondary mb-4">
                    {t('protocols.parsedContentLabel', 'Ayrıştırılan Model Yanıtı:')}
                  </div>
                  <div className="whitespace-pre-wrap">{testResult.content}</div>
                </div>
              </div>
            )}

            {testError && (
              <div className="ai-test-alert danger flex items-center gap-8">
                <AlertCircle size={16} />
                <span>{testError}</span>
              </div>
            )}
          </div>
        ),
      },
    ],
    [
      errors.ad,
      errors.requestScript,
      errors.responseScript,
      formData.aciklama,
      formData.ad,
      formData.modelsScript,
      formData.requestScript,
      formData.responseScript,
      formData.sistemProtokoluMu,
      handleFieldBlur,
      handleFieldChange,
      handleRunTest,
      t,
      testDto,
      testError,
      testResult,
      testing,
    ]
  );

  if (editingMode !== null) {
    const isNew = editingMode === 'new';
    const cardTitle = isNew
      ? t('protocols.newTitle', 'Yeni AI Protokolü')
      : formData.ad || t('protocols.editTitle', 'Protokol Düzenle');

    return (
      <BaseCardPage
        id="think-port-api-protocol-form"
        asForm
        onSubmit={handleSave}
        onSave={handleSave}
        isSaving={saving}
        saveButtonText={t('protocols.saveBtn', 'Kaydet')}
        title={cardTitle}
        pageTitle={cardTitle}
        icon={<Code2 size={24} />}
        subtitleLeft={t(
          'protocols.formSubtitle',
          'JavaScript scriptleri ile API istek şemalarını ve token sayaç yanıtlarını özelleştirin.'
        )}
        showBackButton={true}
        enableAiAssistant={false}
        onClose={handleCloseEditor}
        onBack={handleCloseEditor}
        tabs={tabs}
        activeTabId={activeTab}
        onTabChange={(tabId) => setActiveTab(String(tabId))}
        className="fade-in-animation"
      />
    );
  }

  return (
    <BaseSystemPage
      title={t('protocols.title', 'Yapay Zeka API Protokol Yönetimi')}
      subtitle={t(
        'protocols.subtitle',
        "ThinkPort API Gateway'i yeniden derlemeden JavaScript scriptleri ile yeni LLM sağlayıcı protokolleri ekleyin ve canlı test edin."
      )}
      icon={<Code2 size={26} />}
      baseRoute="/settings/protocols"
      showBackButton={false}
      headerSync={false}
      onRefresh={loadProtocols}
      refreshLoading={loading}
      onAdd={handleOpenCreate}
      addButtonTitle={t('protocols.addBtn', 'Yeni Protokol Ekle')}
    >
      {loading ? (
        <div className="flex-center py-40">
          <RefreshCw size={24} className="spin-icon text-secondary" />
        </div>
      ) : (
        <div className="ai-saglayicilar-grid">
          {visibleProtocols.map((p) => (
            <BaseSystemCard
              key={p.id}
              title={p.ad}
              subtitle={p.aciklama || t('protocols.noDescription', 'Açıklama belirtilmemiş.')}
              icon={<Code2 size={22} />}
              badge={
                <div className="flex-row items-center gap-8">
                  {p.sistemProtokoluMu ? (
                    <span className="chip-primary">
                      {t('protocols.systemBadge', 'Sistem')}
                    </span>
                  ) : (
                    <span className="chip-warning">
                      <Zap size={12} /> {t('protocols.customBadge', 'Özel')}
                    </span>
                  )}
                </div>
              }
              onClick={() => handleOpenEdit(p, 'genel')}
              actions={[
                {
                  label: t('protocols.editScriptsAction', 'Scriptleri Düzenle'),
                  icon: <Edit3 size={16} />,
                  onClick: () => handleOpenEdit(p, 'genel'),
                },
                {
                  label: t('protocols.liveTestAction', 'Canlı Test Konsolu'),
                  icon: <Terminal size={16} />,
                  onClick: () => handleOpenEdit(p, 'test'),
                },
                ...(!p.sistemProtokoluMu
                  ? [
                      {
                        label: t('protocols.deleteAction', 'Sil'),
                        icon: <Trash2 size={16} />,
                        onClick: () => setDeleteId(p.id),
                        danger: true,
                      },
                    ]
                  : []),
              ]}
              details={[
                {
                  label: (
                    <span className="flex items-center gap-6">
                      <Code2 size={14} />
                      <span>{t('protocols.requestConverterLabel', 'İstek Dönüştürücü')}</span>
                    </span>
                  ),
                  value: (
                    <span className="chip-success font-semibold text-xs">
                      {t('protocols.activeJsBadge', 'Aktif JS')}
                    </span>
                  ),
                },
                {
                  label: (
                    <span className="flex items-center gap-6">
                      <Zap size={14} />
                      <span>{t('protocols.responseParserLabel', 'Yanıt Ayrıştırıcı')}</span>
                    </span>
                  ),
                  value: (
                    <span className="chip-success font-semibold text-xs">
                      {t('protocols.activeJsBadge', 'Aktif JS')}
                    </span>
                  ),
                },
                {
                  label: (
                    <span className="flex items-center gap-6">
                      <Cpu size={14} />
                      <span>{t('protocols.linkedProvidersLabel', 'Bağlı Sağlayıcı')}</span>
                    </span>
                  ),
                  value: (
                    <span className="font-semibold text-primary">
                      {p.bagliSaglayiciSayisi > 0
                        ? t('protocols.linkedProvidersCount', '{{count}} Sağlayıcı', {
                            count: p.bagliSaglayiciSayisi,
                          })
                        : t('protocols.noLinkedProviders', 'Yok')}
                    </span>
                  ),
                },
              ]}
            />
          ))}
        </div>
      )}

      {deleteId && (
        <AlertDialog
          isOpen={true}
          onClose={() => setDeleteId(null)}
          onConfirm={handleDelete}
          title={t('protocols.deleteConfirmTitle', 'Protokolü Sil')}
          message={t(
            'protocols.deleteConfirmMessage',
            'Bu özel protokolü silmek istediğinize emin misiniz?'
          )}
          type="warning"
          confirmText={t('protocols.deleteAction', 'Sil')}
          cancelText={t('protocols.cancelAction', 'Vazgeç')}
        />
      )}
    </BaseSystemPage>
  );
};

export default ApiProtocolsView;

