/**
 * ThinkPort AI Gateway - Merkezi Genişletilebilir Model Kayıt Defteri (ModelRegistry.ts)
 *
 * Başlıca Sorumlulukları ve Görevleri:
 * - IThinkPortModel arayüzünü uygulayan tüm statik (kod tabanlı) ve dinamik (Ollama / Özel) modelleri tek merkezden yönetmek
 * - Yeni bir model eklendiğinde sadece `ModelRegistry.register(newModel)` veya `definitions/index.ts` kaydı ile
 *   hem AI Sohbet Stüdyosunda hem de Sistem Ayarları -> Yapay Zeka -> Modeller ekranında anında görünmesini sağlamak
 * - Çalışma zamanında (runtime) `/v1/models` veya `/admin/state` üzerinden gelen yerel Ollama modellerini
 *   otomatik olarak `IThinkPortModel` örneklerine dönüştürüp birleştirmek
 */

import { AIModelDTO } from '../dtos';
import {
  CreateThinkPortModelInput,
  IThinkPortModel,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from './IThinkPortModel';
import {
  BUILTIN_THINKPORT_MODELS,
  CustomModelAdapter,
  DynamicOllamaModelAdapter,
} from './definitions';

const CUSTOM_MODELS_STORAGE_KEY = 'thinkport_custom_models_v1';

export class ThinkPortModelRegistry {
  private readonly _models = new Map<string, IThinkPortModel>();
  private readonly _customInputs = new Map<string, CreateThinkPortModelInput>();

  constructor(initialModels: readonly IThinkPortModel[] = BUILTIN_THINKPORT_MODELS) {
    for (const model of initialModels) {
      this._models.set(model.id, model);
    }
    this._loadStoredCustomModels();
  }

  private _loadStoredCustomModels(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(CUSTOM_MODELS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as CreateThinkPortModelInput[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (item && item.id) {
          this._customInputs.set(item.id, item);
          const existing = this._models.get(item.id);
          const adapter = new CustomModelAdapter(item, existing?.sourceFile);
          this._models.set(item.id, adapter);
        }
      }
    } catch {
      // Ignore storage parse errors
    }
  }

  private _persistCustomModels(): void {
    if (typeof window === 'undefined') return;
    try {
      const list = Array.from(this._customInputs.values());
      window.localStorage.setItem(CUSTOM_MODELS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage quota errors
    }
  }

  /**
   * IThinkPortModel arayüzünü uygulayan bir model sınıfı örneğini kayıt defterine ekler.
   */
  register(model: IThinkPortModel): void {
    this._models.set(model.id, model);
  }

  /**
   * Kullanıcı veya yönetici tarafından form üzerinden tanımlanan yeni modeli kaydeder.
   */
  registerCustom(input: CreateThinkPortModelInput): IThinkPortModel {
    const existing = this._models.get(input.id);
    const adapter = new CustomModelAdapter(input, existing?.sourceFile);
    this._customInputs.set(adapter.id, input);
    this._models.set(adapter.id, adapter);
    this._persistCustomModels();
    return adapter;
  }

  /**
   * Özel tanımlanmış bir modeli siler; eğer yerleşik model üzerine yazılmışsa varsayılan haline döndürür.
   */
  unregister(modelId: string): boolean {
    const builtin = BUILTIN_THINKPORT_MODELS.find((m) => m.id === modelId);
    this._customInputs.delete(modelId);
    this._persistCustomModels();
    if (builtin) {
      this._models.set(modelId, builtin);
      return true;
    }
    return this._models.delete(modelId);
  }

  /**
   * Model ID'si ile kayıtlı IThinkPortModel örneğini döner.
   */
  getById(modelId: string): IThinkPortModel | undefined {
    return this._models.get(modelId);
  }

  /**
   * Kayıtlı tüm IThinkPortModel örneklerini döner.
   */
  getAll(): IThinkPortModel[] {
    return Array.from(this._models.values());
  }

  /**
   * Sunucudan (`/v1/models` veya `/admin/state`) gelen çalışma zamanı modellerini
   * (ör. o an kurulu yerel Ollama modelleri) kayıt defteriyle birleştirerek tam listeyi döner.
   */
  getMergedModels(runtimeModels?: AIModelDTO[]): IThinkPortModel[] {
    const merged = new Map<string, IThinkPortModel>();

    // 1. Önce kayıtlı IThinkPortModel sınıflarını ekle
    for (const [id, model] of this._models.entries()) {
      merged.set(id, model);
    }

    // 2. Runtime'da keşfedilen (örn. Ollama /api/tags) modelleri IThinkPortModel'e uyarlayarak ekle
    if (Array.isArray(runtimeModels)) {
      for (const dto of runtimeModels) {
        if (!dto || !dto.id) continue;
        if (!merged.has(dto.id)) {
          merged.set(dto.id, new DynamicOllamaModelAdapter(dto));
        }
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Kaynak türüne göre ('web' | 'local' | 'image' | 'external') modelleri filtreler.
   */
  getBySourceType(
    sourceType: ThinkPortModelSourceType,
    runtimeModels?: AIModelDTO[]
  ): IThinkPortModel[] {
    return this.getMergedModels(runtimeModels).filter((m) => m.sourceType === sourceType);
  }

  /**
   * Kategoriye göre ('chat' | 'image' | 'embedding') modelleri filtreler.
   */
  getByCategory(
    category: ThinkPortModelCategory,
    runtimeModels?: AIModelDTO[]
  ): IThinkPortModel[] {
    return this.getMergedModels(runtimeModels).filter((m) => m.category === category);
  }

  /**
   * İstenen model adını veya takma adı (alias) eşleşen IThinkPortModel örneğine çözümler.
   */
  resolveAlias(requestedModelId: string, runtimeModels?: AIModelDTO[]): IThinkPortModel | undefined {
    const all = this.getMergedModels(runtimeModels);
    return all.find((m) => m.matchesAlias(requestedModelId));
  }

  /**
   * Kayıtlı tüm modelleri Gateway AIModelDTO dizisi olarak döner.
   */
  toDTOList(runtimeModels?: AIModelDTO[]): AIModelDTO[] {
    return this.getMergedModels(runtimeModels).map((m) => m.toDTO());
  }

  /**
   * Verilen bir IThinkPortModel için standart TypeScript sınıf kodu şablonunu üretir.
   */
  generateModelClassCode(model: IThinkPortModel): string {
    const className =
      model.id
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('') + 'Model';

    const instanceName = className.charAt(0).toLowerCase() + className.slice(1);
    const caps = model.capabilities;

    return `import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class ${className} extends BaseThinkPortModel {
  readonly id = '${model.id}';
  readonly name = '${model.name.replace(/'/g, "\\'")}';
  readonly vendor = '${model.vendor.replace(/'/g, "\\'")}';
  readonly provider = '${model.provider}';
  readonly protocolId = '${model.protocolId}';
  readonly category: ThinkPortModelCategory = '${model.category}';
  readonly sourceType: ThinkPortModelSourceType = '${model.sourceType}';
  readonly badge = '${model.badge.replace(/'/g, "\\'")}';
  readonly description = '${model.description.replace(/'/g, "\\'")}';
  readonly sourceFile = '${model.sourceFile}';
  override readonly isLocal = ${model.isLocal};
  override readonly isImage = ${model.isImage};
  override readonly contextWindow = ${model.contextWindow};
  override readonly maxOutputTokens = ${model.maxOutputTokens};${
    model.fallbackLocal ? `\n  override readonly fallbackLocal = '${model.fallbackLocal}';` : ''
  }

  override readonly aliases: readonly string[] = ${JSON.stringify(model.aliases)};

  override get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: ${caps.streaming},
      vision: ${caps.vision},
      reasoning: ${caps.reasoning},
      functionCalling: ${caps.functionCalling},
      imageGeneration: ${caps.imageGeneration},
      jsonMode: ${caps.jsonMode},
    };
  }
}

export const ${instanceName} = new ${className}();`;
  }
}

export const ModelRegistry = new ThinkPortModelRegistry();

