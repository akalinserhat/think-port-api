/**
 * ThinkPort AI Gateway - Genişletilebilir Yapay Zeka Modelleri Yönetimi (AiModelsView.tsx)
 *
 * Başlıca Sorumlulukları ve Görevleri:
 * - Sistem Ayarları -> Yapay Zeka -> Modeller (/settings/ai/models) altında IThinkPortModel arayüzünü
 *   uygulayan tüm Web AI, Yerel Ollama ve Görsel Üretim modellerini BaseSystemPage ve BaseSystemCard ile listelemek
 * - Her modelin kendi bağımsız sınıf dosyasını (sourceFile), bağlı API protokolünü, bağlam penceresini,
 *   takma adlarını (aliases) ve teknik yeteneklerini (capabilities) sergilemek
 * - Yeni bir model eklenmek istendiğinde 3 sekmeli BaseCardPage formu ile zahmetsizce ModelRegistry'ye
 *   kaydetmek ve IThinkPortModel TypeScript sınıf kodunu otomatik üretmek
 * - Sıfır inline CSS, sıfır inline validasyon ve %100 çok dilli (i18n) kurallarına uymak
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Cpu,
  Sparkles,
  Image as ImageIcon,
  Code2,
  Edit3,
  Trash2,
  MessageSquare,
  FileCode2,
  Copy,
  Layers,
  Zap,
  Eye,
  Brain,
  Wrench,
  FileJson,
  ShieldCheck,
} from 'lucide-react';
import {
  BaseSystemPage,
  BaseSystemCard,
  BaseCardPage,
  type BaseTabItem,
  BasitInput,
  TamsayiInput,
  BaseDropdownSecici,
  PolicySettingCard,
  BaseSwitch,
  BaseButton,
  FieldError,
  AlertDialog,
  useAdminValidation,
  useBaseSystemPage,
} from '@akalin/ui';
import { AIModelDTO, ApiProtocolDTO } from '../dtos';
import {
  CreateThinkPortModelInput,
  CustomModelAdapter,
  IThinkPortModel,
  ModelRegistry,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../models';
import { protocolService } from '../services';
import {
  validateAiModelField,
  validateAiModelForm,
  type AiModelFormData,
} from '../validators/aiModelValidation';

export interface AiModelsViewProps {
  runtimeModels?: AIModelDTO[];
  onSelectModelForChat?: (modelId: string) => void;
  onShowToast?: (msg: string) => void;
  onModelsChanged?: (count: number) => void;
}

const DEFAULT_CREATE_INPUT: CreateThinkPortModelInput = {
  id: '',
  name: '',
  vendor: 'OpenAI',
  provider: 'chatgpt-web',
  protocolId: 'proto_openai',
  category: 'chat',
  sourceType: 'web',
  badge: 'Web AI',
  description: '',
  contextWindow: 128000,
  maxOutputTokens: 16384,
  fallbackLocal: 'qwen2.5:7b',
  aliases: [],
  capabilities: {
    streaming: true,
    vision: false,
    reasoning: false,
    functionCalling: true,
    imageGeneration: false,
    jsonMode: true,
  },
  available: true,
};

export const AiModelsView: React.FC<AiModelsViewProps> = ({
  runtimeModels,
  onSelectModelForChat,
  onShowToast,
  onModelsChanged,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { filterItems } = useBaseSystemPage();

  const [registryVersion, setRegistryVersion] = useState<number>(0);
  const [protocols, setProtocols] = useState<ApiProtocolDTO[]>([]);
  const [activeFilterTab, setActiveFilterTab] = useState<string>('all');
  const [deleteModelId, setDeleteModelId] = useState<string | null>(null);

  // Card editor state (null = list view, 'new' = create, model.id = inspect/edit)
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [activeFormTab, setActiveFormTab] = useState<string>('genel');
  const [formState, setFormState] = useState<CreateThinkPortModelInput>(DEFAULT_CREATE_INPUT);
  const [aliasesInput, setAliasesInput] = useState<string>('');

  const { errors, clearError, setFieldError, setErrors, clearErrors } = useAdminValidation();

  useEffect(() => {
    protocolService
      .listProtocols()
      .then((list) => {
        if (Array.isArray(list)) {
          setProtocols(list);
        }
      })
      .catch(() => {
        // Keep default protocol fallback
      });
  }, []);

  const allModels = useMemo<IThinkPortModel[]>(() => {
    const list = ModelRegistry.getMergedModels(runtimeModels);
    return list;
  }, [runtimeModels, registryVersion]);

  useEffect(() => {
    onModelsChanged?.(allModels.length);
  }, [allModels.length, onModelsChanged]);

  const protocolNameMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {
      proto_openai: 'OpenAI REST API Uyumluluğu',
      proto_anthropic: 'Anthropic Claude REST API',
      proto_gemini: 'Google Gemini REST API',
      proto_ollama: 'Ollama Yerel Motor API',
    };
    for (const p of protocols) {
      map[p.id] = p.ad;
    }
    return map;
  }, [protocols]);

  const protocolOptions = useMemo(() => {
    if (protocols.length > 0) {
      return protocols.map((p) => ({ id: p.id, label: p.ad }));
    }
    return [
      { id: 'proto_openai', label: 'OpenAI REST API Uyumluluğu' },
      { id: 'proto_anthropic', label: 'Anthropic Claude REST API' },
      { id: 'proto_gemini', label: 'Google Gemini REST API' },
      { id: 'proto_ollama', label: 'Ollama Yerel Motor API' },
    ];
  }, [protocols]);

  const categoryOptions = useMemo(
    () => [
      { id: 'chat', label: 'Chat / Sohbet & Muhakeme' },
      { id: 'image', label: 'Image / Görsel Üretim' },
      { id: 'embedding', label: 'Embedding / Vektör' },
    ],
    []
  );

  const sourceTypeOptions = useMemo(
    () => [
      { id: 'web', label: t('models.tabWeb', 'Web AI & Bulut') },
      { id: 'local', label: t('models.tabLocal', 'Yerel Motor (Ollama)') },
      { id: 'image', label: t('models.tabImage', 'Görsel Üretim') },
      { id: 'external', label: 'External REST API' },
    ],
    [t]
  );

  const handleOpenCreate = useCallback(() => {
    clearErrors();
    setFormState(DEFAULT_CREATE_INPUT);
    setAliasesInput('');
    setActiveFormTab('genel');
    setEditingModelId('new');
  }, [clearErrors]);

  const handleOpenInspect = useCallback(
    (model: IThinkPortModel, initialTab: string = 'genel') => {
      clearErrors();
      setFormState({
        id: model.id,
        name: model.name,
        vendor: model.vendor,
        provider: model.provider,
        protocolId: model.protocolId,
        category: model.category,
        sourceType: model.sourceType,
        badge: model.badge,
        description: model.description,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        fallbackLocal: model.fallbackLocal || '',
        aliases: [...model.aliases],
        capabilities: { ...model.capabilities },
        available: model.available,
      });
      setAliasesInput(model.aliases.join(', '));
      setActiveFormTab(initialTab);
      setEditingModelId(model.id);
    },
    [clearErrors]
  );

  const handleCloseEditor = useCallback(() => {
    clearErrors();
    setEditingModelId(null);
  }, [clearErrors]);

  const handleFieldChange = useCallback(
    (field: keyof CreateThinkPortModelInput, value: unknown) => {
      setFormState((prev) => ({ ...prev, [field]: value }));
      clearError(field as string);
    },
    [clearError]
  );

  const handleFieldBlur = useCallback(
    (field: keyof AiModelFormData) => {
      const err = validateAiModelField(field, formState[field], t);
      if (err) {
        setFieldError(field as string, err);
      } else {
        clearError(field as string);
      }
    },
    [clearError, formState, setFieldError, t]
  );

  const handleSaveModel = useCallback(
    (e?: React.FormEvent | React.MouseEvent) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      const validationErrors = validateAiModelForm(formState, t);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        onShowToast?.(
          t('models.fillRequiredToast', 'Lütfen zorunlu model alanlarını doldurun.')
        );
        return;
      }

      const parsedAliases = aliasesInput
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      ModelRegistry.registerCustom({
        ...formState,
        aliases: parsedAliases.length > 0 ? parsedAliases : [formState.id],
      });
      setRegistryVersion((v) => v + 1);
      onShowToast?.(
        t('models.savedToast', 'Model tanımı başarıyla kaydedildi ve aktif kataloğa eklendi.')
      );
      handleCloseEditor();
    },
    [aliasesInput, formState, handleCloseEditor, onShowToast, setErrors, t]
  );

  const handleConfirmDelete = useCallback(() => {
    if (!deleteModelId) return;
    ModelRegistry.unregister(deleteModelId);
    setRegistryVersion((v) => v + 1);
    setDeleteModelId(null);
    onShowToast?.(t('models.deletedToast', 'Özel model tanımı kaldırıldı.'));
  }, [deleteModelId, onShowToast, t]);

  const previewModelInstance = useMemo<IThinkPortModel>(() => {
    const parsedAliases = aliasesInput
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    const existing = editingModelId && editingModelId !== 'new'
      ? ModelRegistry.getById(editingModelId)
      : undefined;
    return new CustomModelAdapter(
      {
        ...formState,
        id: formState.id || 'yeni-model',
        name: formState.name || 'Yeni Yapay Zeka Modeli',
        aliases: parsedAliases.length > 0 ? parsedAliases : [formState.id || 'yeni-model'],
      },
      existing?.sourceFile
    );
  }, [aliasesInput, editingModelId, formState]);

  const generatedClassCode = useMemo(
    () => ModelRegistry.generateModelClassCode(previewModelInstance),
    [previewModelInstance]
  );

  const handleCopyClassCode = useCallback(() => {
    navigator.clipboard.writeText(generatedClassCode);
    onShowToast?.(
      t('models.codeCopiedToast', 'IThinkPortModel sınıf kodu panoya kopyalandı.')
    );
  }, [generatedClassCode, onShowToast, t]);

  const renderModelCards = useCallback(
    (sourceFilter: 'all' | ThinkPortModelSourceType | 'embedding') => {
      const baseList =
        sourceFilter === 'all'
          ? allModels
          : sourceFilter === 'embedding'
            ? allModels.filter((m) => m.category === 'embedding')
            : allModels.filter((m) =>
                sourceFilter === 'web'
                  ? (m.sourceType === 'web' || m.sourceType === 'external') &&
                    m.category !== 'embedding'
                  : m.sourceType === sourceFilter && m.category !== 'embedding'
              );

      const filtered = filterItems(baseList, (m) => [
        m.id,
        m.name,
        m.vendor,
        m.provider,
        m.badge,
        m.description,
        m.sourceFile,
        ...m.aliases,
      ]);

      return (
        <div className="ai-saglayicilar-grid py-12">
          {filtered.map((model) => {
            const cardIcon = model.isImage ? (
              <ImageIcon size={22} />
            ) : model.isLocal ? (
              <Cpu size={22} />
            ) : (
              <Sparkles size={22} />
            );

            return (
              <BaseSystemCard
                key={model.id}
                title={model.name}
                subtitle={model.description}
                icon={cardIcon}
                badge={
                  <div className="flex-row items-center gap-6 flex-wrap">
                    <span className="chip-primary">{model.badge}</span>
                    {model.isSystemModel ? (
                      <span className="chip-success">
                        {t('models.systemBadge', 'Çekirdek Sınıf')}
                      </span>
                    ) : (
                      <span className="chip-warning">
                        {t('models.customBadge', 'Özel Tanım')}
                      </span>
                    )}
                  </div>
                }
                onClick={() => handleOpenInspect(model, 'genel')}
                actions={[
                  {
                    label: t('models.inspectAction', 'İncele & Düzenle'),
                    icon: <Edit3 size={16} />,
                    onClick: () => handleOpenInspect(model, 'genel'),
                  },
                  {
                    label: t('models.viewCodeAction', 'Sınıf Kodunu Gör (.ts)'),
                    icon: <FileCode2 size={16} />,
                    onClick: () => handleOpenInspect(model, 'code'),
                  },
                  ...(model.category !== 'embedding'
                    ? [
                        {
                          label: t('models.testInStudioAction', 'Sohbet Stüdyosunda Dene'),
                          icon: <MessageSquare size={16} />,
                          onClick: () => {
                            onSelectModelForChat?.(model.id);
                            navigate('/chat');
                          },
                        },
                      ]
                    : []),
                  ...(!model.isSystemModel
                    ? [
                        {
                          label: t('models.deleteAction', 'Sil / Varsayılana Dön'),
                          icon: <Trash2 size={16} />,
                          danger: true,
                          onClick: () => setDeleteModelId(model.id),
                        },
                      ]
                    : []),
                ]}
                details={[
                  {
                    label: (
                      <span className="flex items-center gap-6">
                        <Layers size={14} />
                        <span>{t('models.vendorLabel', 'Üretici / Sağlayıcı')}</span>
                      </span>
                    ),
                    value: (
                      <span className="font-semibold text-primary">
                        {model.vendor} · {model.provider}
                      </span>
                    ),
                  },
                  {
                    label: (
                      <span className="flex items-center gap-6">
                        <Code2 size={14} />
                        <span>{t('models.protocolLabel', 'API Protokolü')}</span>
                      </span>
                    ),
                    value: (
                      <span className="chip-primary text-xs">
                        {protocolNameMap[model.protocolId] || model.protocolId}
                      </span>
                    ),
                  },
                  {
                    label: (
                      <span className="flex items-center gap-6">
                        <Zap size={14} />
                        <span>{t('models.contextWindowLabel', 'Bağlam Penceresi')}</span>
                      </span>
                    ),
                    value: (
                      <span className="font-semibold text-primary">
                        {Math.round(model.contextWindow / 1000)}K ·{' '}
                        {t('models.aliasesCountLabel', '{{count}} Takma Ad', {
                          count: model.aliases.length,
                        })}
                      </span>
                    ),
                  },
                  {
                    label: (
                      <span className="flex items-center gap-6">
                        <FileCode2 size={14} />
                        <span>{t('models.sourceFileLabel', 'Kod Dosyası')}</span>
                      </span>
                    ),
                    value: (
                      <span className="font-mono text-xs text-secondary">
                        {model.sourceFile.split('/').pop()}
                      </span>
                    ),
                  },
                ]}
              />
            );
          })}
        </div>
      );
    },
    [
      allModels,
      filterItems,
      handleOpenInspect,
      navigate,
      onSelectModelForChat,
      protocolNameMap,
      t,
    ]
  );

  const listTabs: BaseTabItem[] = useMemo(
    () => [
      {
        id: 'all',
        label: `${t('models.tabAll', 'Tüm Modeller')} (${allModels.length})`,
        icon: <Layers size={16} />,
        content: renderModelCards('all'),
      },
      {
        id: 'web',
        label: t('models.tabWeb', 'Web AI & Bulut'),
        icon: <Sparkles size={16} />,
        content: renderModelCards('web'),
      },
      {
        id: 'local',
        label: t('models.tabLocal', 'Yerel Motor (Ollama)'),
        icon: <Cpu size={16} />,
        content: renderModelCards('local'),
      },
      {
        id: 'image',
        label: t('models.tabImage', 'Görsel Üretim'),
        icon: <ImageIcon size={16} />,
        content: renderModelCards('image'),
      },
      {
        id: 'embedding',
        label: t('models.tabEmbedding', 'Embedding & Vektör (RAG)'),
        icon: <Brain size={16} />,
        content: renderModelCards('embedding'),
      },
    ],
    [allModels.length, renderModelCards, t]
  );

  const formTabs: BaseTabItem[] = useMemo(
    () => [
      {
        id: 'genel',
        label: t('models.formTabGeneral', '1. Genel & Sağlayıcı Bilgileri'),
        icon: <Cpu size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-20">
            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">{t('models.fieldId', 'Model Kimliği (id)')}</label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.id}
                  disabled={editingModelId !== 'new'}
                  onChange={(e) => handleFieldChange('id', e.target.value)}
                  onBlur={() => handleFieldBlur('id')}
                  placeholder={t(
                    'models.fieldIdPlaceholder',
                    'Örn: llama-3.3-70b veya mistral-large'
                  )}
                  className={errors.id ? 'is-invalid' : ''}
                />
                <FieldError error={errors.id} />
              </div>

              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldName', 'Görünen Model Adı (name)')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.name}
                  onChange={(e) => handleFieldChange('name', e.target.value)}
                  onBlur={() => handleFieldBlur('name')}
                  placeholder={t(
                    'models.fieldNamePlaceholder',
                    'Örn: Llama 3.3 70B (Web Gateway)'
                  )}
                  className={errors.name ? 'is-invalid' : ''}
                />
                <FieldError error={errors.name} />
              </div>
            </div>

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldVendor', 'Üretici Firma (vendor)')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.vendor}
                  onChange={(e) => handleFieldChange('vendor', e.target.value)}
                  onBlur={() => handleFieldBlur('vendor')}
                  placeholder={t(
                    'models.fieldVendorPlaceholder',
                    'Örn: Meta AI, Mistral, OpenAI, Local (Ollama)'
                  )}
                  className={errors.vendor ? 'is-invalid' : ''}
                />
                <FieldError error={errors.vendor} />
              </div>

              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldProvider', 'Gateway Yönlendirme Sağlayıcısı (provider)')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.provider}
                  onChange={(e) => handleFieldChange('provider', e.target.value)}
                  onBlur={() => handleFieldBlur('provider')}
                  placeholder={t(
                    'models.fieldProviderPlaceholder',
                    'Örn: chatgpt-web, local-engine, pollinations-image, external-api'
                  )}
                  className={errors.provider ? 'is-invalid' : ''}
                />
                <FieldError error={errors.provider} />
              </div>
            </div>

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldProtocol', 'Bağlı API Protokolü (protocolId)')}
                </label>
                <BaseDropdownSecici
                  options={protocolOptions}
                  value={formState.protocolId}
                  onChange={(val) => handleFieldChange('protocolId', String(val || 'proto_openai'))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldSourceType', 'Çalışma Kaynağı (sourceType)')}
                </label>
                <BaseDropdownSecici
                  options={sourceTypeOptions}
                  value={formState.sourceType}
                  onChange={(val) =>
                    handleFieldChange(
                      'sourceType',
                      (val || 'web') as ThinkPortModelSourceType
                    )
                  }
                />
              </div>
            </div>

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldCategory', 'Model Kategorisi (category)')}
                </label>
                <BaseDropdownSecici
                  options={categoryOptions}
                  value={formState.category}
                  onChange={(val) =>
                    handleFieldChange('category', (val || 'chat') as ThinkPortModelCategory)
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldBadge', 'Kart Rozet Etiketi (badge)')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.badge}
                  onChange={(e) => handleFieldChange('badge', e.target.value)}
                  placeholder={t(
                    'models.fieldBadgePlaceholder',
                    'Örn: Web AI, Reasoning, 7B · 4.7GB'
                  )}
                />
              </div>
            </div>

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldContextWindow', 'Bağlam Penceresi (contextWindow - Token)')}
                </label>
                <TamsayiInput
                  value={formState.contextWindow}
                  onChange={(e) =>
                    handleFieldChange('contextWindow', Number(e.target.value) || 128000)
                  }
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldMaxOutput', 'Maksimum Çıktı Token (maxOutputTokens)')}
                </label>
                <TamsayiInput
                  value={formState.maxOutputTokens}
                  onChange={(e) =>
                    handleFieldChange('maxOutputTokens', Number(e.target.value) || 8192)
                  }
                />
              </div>
            </div>

            <div className="grid-2-col gap-16">
              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldFallbackLocal', 'Yerel Yedek Model (fallbackLocal - Opsiyonel)')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.fallbackLocal || ''}
                  onChange={(e) => handleFieldChange('fallbackLocal', e.target.value)}
                  placeholder={t('models.fieldFallbackLocalPlaceholder', 'Örn: qwen2.5:7b')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  {t('models.fieldDescription', 'Model Açıklaması (description)')}
                </label>
                <BasitInput
                  type="text"
                  textTransform="none"
                  value={formState.description}
                  onChange={(e) => handleFieldChange('description', e.target.value)}
                  placeholder={t(
                    'models.fieldDescriptionPlaceholder',
                    'Modelin kullanım alanı ve teknik özellikleri...'
                  )}
                />
              </div>
            </div>
          </div>
        ),
      },
      {
        id: 'capabilities',
        label: t('models.formTabCapabilities', '2. Yetenekler & Takma Adlar (Aliases)'),
        icon: <ShieldCheck size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-20">
            <div className="form-group">
              <label className="form-label">
                {t('models.fieldAliases', 'Desteklenen Takma Adlar (aliases - Virgülle ayırın)')}
              </label>
              <BasitInput
                type="text"
                textTransform="none"
                value={aliasesInput}
                onChange={(e) => setAliasesInput(e.target.value)}
                placeholder={t(
                  'models.fieldAliasesPlaceholder',
                  'Örn: llama-3.3, llama3-70b, meta-llama'
                )}
              />
            </div>

            <div className="flex-col gap-12">
              <PolicySettingCard
                icon={<Zap size={20} />}
                iconActive={formState.capabilities.streaming}
                title={t('models.capStreamingTitle', 'Canlı Akış (SSE Streaming)')}
                description={t(
                  'models.capStreamingDesc',
                  'Yanıtların Server-Sent Events (SSE) ile kelime kelime akıtılmasını destekler.'
                )}
                action={
                  <BaseSwitch
                    checked={formState.capabilities.streaming}
                    onChange={(e) =>
                      handleFieldChange('capabilities', {
                        ...formState.capabilities,
                        streaming: e.target.checked,
                      })
                    }
                  />
                }
              />

              <PolicySettingCard
                icon={<Eye size={20} />}
                iconActive={formState.capabilities.vision}
                title={t('models.capVisionTitle', 'Görsel Algılama (Multimodal Vision)')}
                description={t(
                  'models.capVisionDesc',
                  'Görsel ve belge ekran görüntüsü girdilerini analiz edebilir.'
                )}
                action={
                  <BaseSwitch
                    checked={formState.capabilities.vision}
                    onChange={(e) =>
                      handleFieldChange('capabilities', {
                        ...formState.capabilities,
                        vision: e.target.checked,
                      })
                    }
                  />
                }
              />

              <PolicySettingCard
                icon={<Brain size={20} />}
                iconActive={formState.capabilities.reasoning}
                title={t('models.capReasoningTitle', 'Düşünce Zinciri (Reasoning / <think>)')}
                description={t(
                  'models.capReasoningDesc',
                  'Yanıt üretmeden önce adım adım muhakeme (Chain-of-Thought) yürütür.'
                )}
                action={
                  <BaseSwitch
                    checked={formState.capabilities.reasoning}
                    onChange={(e) =>
                      handleFieldChange('capabilities', {
                        ...formState.capabilities,
                        reasoning: e.target.checked,
                      })
                    }
                  />
                }
              />

              <PolicySettingCard
                icon={<Wrench size={20} />}
                iconActive={formState.capabilities.functionCalling}
                title={t(
                  'models.capFunctionCallingTitle',
                  'Araç & Fonksiyon Çağırma (Tool Calling)'
                )}
                description={t(
                  'models.capFunctionCallingDesc',
                  'OpenAI tools / function_call şeması ile yapılandırılmış araç çağrısı yapabilir.'
                )}
                action={
                  <BaseSwitch
                    checked={formState.capabilities.functionCalling}
                    onChange={(e) =>
                      handleFieldChange('capabilities', {
                        ...formState.capabilities,
                        functionCalling: e.target.checked,
                      })
                    }
                  />
                }
              />

              <PolicySettingCard
                icon={<ImageIcon size={20} />}
                iconActive={formState.capabilities.imageGeneration}
                title={t('models.capImageGenTitle', 'Görsel Üretimi (Text-to-Image)')}
                description={t(
                  'models.capImageGenDesc',
                  'Metin istemlerinden yüksek çözünürlüklü görsel üretir.'
                )}
                action={
                  <BaseSwitch
                    checked={formState.capabilities.imageGeneration}
                    onChange={(e) =>
                      handleFieldChange('capabilities', {
                        ...formState.capabilities,
                        imageGeneration: e.target.checked,
                      })
                    }
                  />
                }
              />

              <PolicySettingCard
                icon={<FileJson size={20} />}
                iconActive={formState.capabilities.jsonMode}
                title={t('models.capJsonModeTitle', 'Yapılandırılmış JSON Çıktısı (JSON Mode)')}
                description={t(
                  'models.capJsonModeDesc',
                  'response_format: { type: "json_object" } şemasını garanti eder.'
                )}
                action={
                  <BaseSwitch
                    checked={formState.capabilities.jsonMode}
                    onChange={(e) =>
                      handleFieldChange('capabilities', {
                        ...formState.capabilities,
                        jsonMode: e.target.checked,
                      })
                    }
                  />
                }
              />
            </div>
          </div>
        ),
      },
      {
        id: 'code',
        label: t('models.formTabCode', '3. Sınıf Kodu (IThinkPortModel)'),
        icon: <FileCode2 size={16} />,
        content: (
          <div className="py-20 flex flex-col gap-16">
            <div className="ai-script-editor-container">
              <div className="ai-script-editor-label">
                <span>{previewModelInstance.sourceFile}</span>
                <BaseButton
                  type="button"
                  variant="secondary"
                  icon={<Copy size={14} />}
                  onClick={handleCopyClassCode}
                >
                  {t('models.copyCodeBtn', 'Sınıf Kodunu Kopyala')}
                </BaseButton>
              </div>
              <textarea
                className="ai-script-textarea"
                value={generatedClassCode}
                readOnly
                rows={22}
              />
              <div className="ai-script-help">
                {t(
                  'models.codeHelpText',
                  'Yeni bir modeli kalıcı kod dosyası olarak eklemek için aşağıdaki IThinkPortModel sınıfını src/models/definitions/ klasörüne kaydedip BUILTIN_THINKPORT_MODELS listesine ekleyebilirsiniz.'
                )}
              </div>
            </div>
          </div>
        ),
      },
    ],
    [
      aliasesInput,
      categoryOptions,
      editingModelId,
      errors.id,
      errors.name,
      errors.provider,
      errors.vendor,
      formState,
      generatedClassCode,
      handleCopyClassCode,
      handleFieldBlur,
      handleFieldChange,
      previewModelInstance.sourceFile,
      protocolOptions,
      sourceTypeOptions,
      t,
    ]
  );

  if (editingModelId !== null) {
    const isNew = editingModelId === 'new';
    const cardTitle = isNew
      ? t('models.newTitle', 'Yeni Yapay Zeka Modeli Tanımla')
      : formState.name || t('models.editTitle', 'Model Yapılandırması & Kod Arayüzü');

    return (
      <BaseCardPage
        id="think-port-ai-model-form"
        asForm
        onSubmit={handleSaveModel}
        onSave={handleSaveModel}
        saveButtonText={t('models.saveBtn', 'Kaydet')}
        title={cardTitle}
        pageTitle={cardTitle}
        icon={<Cpu size={24} />}
        subtitleLeft={t(
          'models.formSubtitle',
          'IThinkPortModel arayüz sözleşmesine uygun olarak model kimliğini, bağlı API protokolünü, yeteneklerini ve takma adlarını yönetin.'
        )}
        showBackButton={true}
        enableAiAssistant={false}
        onClose={handleCloseEditor}
        onBack={handleCloseEditor}
        tabs={formTabs}
        activeTabId={activeFormTab}
        onTabChange={(tabId) => setActiveFormTab(String(tabId))}
        className="fade-in-animation"
      />
    );
  }

  return (
    <BaseSystemPage
      title={t('models.title', 'Yapay Zeka Modelleri (IThinkPortModel)')}
      subtitle={t(
        'models.subtitle',
        'ThinkPort API Gateway içinde kullanılan ve her biri kendi sınıf dosyasında IThinkPortModel arayüzünü uygulayan genişletilebilir model kataloğu.'
      )}
      icon={<Cpu size={26} />}
      baseRoute="/settings/ai/models"
      showBackButton={false}
      headerSync={false}
      tabs={listTabs}
      activeTabId={activeFilterTab}
      onTabChange={(id) => setActiveFilterTab(String(id))}
      onAdd={handleOpenCreate}
      addButtonTitle={t('models.addBtn', 'Yeni Model Tanımla')}
    >
      {deleteModelId && (
        <AlertDialog
          isOpen={true}
          onClose={() => setDeleteModelId(null)}
          onConfirm={handleConfirmDelete}
          title={t('models.deleteConfirmTitle', 'Model Tanımını Kaldır')}
          message={t(
            'models.deleteConfirmMessage',
            'Bu özel model tanımını kaldırmak istediğinize emin misiniz?'
          )}
          type="warning"
          confirmText={t('models.deleteAction', 'Sil / Varsayılana Dön')}
          cancelText={t('models.cancelAction', 'Vazgeç')}
        />
      )}
    </BaseSystemPage>
  );
};

export default AiModelsView;

