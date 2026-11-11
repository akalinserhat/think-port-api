/**
 * ThinkPort AI Gateway - Genişletilebilir Yapay Zeka Model Arayüzü (IThinkPortModel.ts)
 *
 * Başlıca Sorumlulukları ve Görevleri:
 * - Sistemde kullanılan tüm yapay zeka modellerinin (Web AI, Yerel Ollama, Görsel Üretim, Harici API)
 *   uyması gereken ortak sözleşmeyi (IThinkPortModel) tanımlamak
 * - Yeni bir model eklenmek istendiğinde yalnızca bu arayüzü uygulayan tekil bir dosya oluşturup
 *   ModelRegistry'ye kaydetmeyi mümkün kılmak
 * - AIModelDTO ve OpenAI /v1/models şemalarıyla çift yönlü uyumluluk sağlamak
 */

import { AIModelDTO } from '../dtos';

export type ThinkPortModelCategory = 'chat' | 'image' | 'embedding';

export type ThinkPortModelSourceType = 'web' | 'local' | 'image' | 'external';

export interface IThinkPortModelCapabilities {
  /** SSE (Server-Sent Events) canlı akış desteği */
  streaming: boolean;
  /** Görsel / çok modlu (Multimodal Vision) girdi desteği */
  vision: boolean;
  /** Düşünce zinciri (Chain-of-Thought / <think>) desteği */
  reasoning: boolean;
  /** Araç / Fonksiyon çağırma (Tool / Function Calling) desteği */
  functionCalling: boolean;
  /** Metinden görsel üretimi (Text-to-Image) desteği */
  imageGeneration: boolean;
  /** Yapılandırılmış JSON çıktı (JSON Schema / response_format) desteği */
  jsonMode: boolean;
}

/**
 * ThinkPort AI Gateway üzerindeki her bir yapay zeka modelinin uyguladığı temel arayüz (Interface).
 * Her model kendi bağımsız kod dosyasında (`src/models/definitions/[ModelAdi].ts`) bu arayüzü uygular.
 */
export interface IThinkPortModel {
  /** Benzersiz model kimliği (Örn: 'gpt-4o', 'claude-3-5-sonnet', 'flux', 'qwen2.5:7b') */
  readonly id: string;
  /** Kullanıcı arayüzünde gösterilen model adı */
  readonly name: string;
  /** Model üreticisi / sağlayıcı firma (Örn: 'OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Black Forest Labs') */
  readonly vendor: string;
  /** Gateway yönlendirme sağlayıcı kodu (Örn: 'chatgpt-web', 'claude-web', 'local-engine', 'pollinations-image') */
  readonly provider: string;
  /** Bağlı olduğu API Protokol kimliği (Örn: 'proto_openai', 'proto_anthropic', 'proto_gemini', 'proto_ollama') */
  readonly protocolId: string;
  /** Model çalışma kategorisi ('chat' | 'image' | 'embedding') */
  readonly category: ThinkPortModelCategory;
  /** Model kaynak türü ('web' | 'local' | 'image' | 'external') */
  readonly sourceType: ThinkPortModelSourceType;
  /** Kartlarda ve listelerde gösterilen kısa rozet etiketi (Örn: 'Web AI', 'Reasoning', 'Görsel · HD') */
  readonly badge: string;
  /** Modelin görev ve yetenek açıklaması */
  readonly description: string;
  /** Modelin tanımlandığı kaynak kod dosyası yolu */
  readonly sourceFile: string;
  /** Yerel Ollama motorunda mı çalışıyor? */
  readonly isLocal: boolean;
  /** Görsel üretim modeli mi? */
  readonly isImage: boolean;
  /** Model şu anda aktif ve kullanılabilir durumda mı? */
  readonly available: boolean;
  /**Sistem çekirdek modeli mi yoksa kullanıcı tarafından sonradan mı eklendi? */
  readonly isSystemModel: boolean;
  /** Maksimum bağlam penceresi (Token cinsinden, örn: 128000) */
  readonly contextWindow: number;
  /** Maksimum çıktı token sınırı (Örn: 16384) */
  readonly maxOutputTokens: number;
  /** Web oturumu kullanılamadığında devreye girecek yerel yedek model ID'si */
  readonly fallbackLocal?: string;
  /** Web AI köprü motor adı */
  readonly webModel?: string;
  /** Görsel üretim alt motor adı */
  readonly imageModel?: string;
  /** Görsel üretim stil zenginleştirici (Prompt modifier) */
  readonly styleModifier?: string;
  /** Bu modele yönlendirilen tüm OpenAI/API takma adları (Aliases) */
  readonly aliases: readonly string[];
  /** Modelin teknik yetenek matrisi */
  readonly capabilities: IThinkPortModelCapabilities;

  /** Verilen model adının veya takma adın (alias) bu modele ait olup olmadığını kontrol eder */
  matchesAlias(requestedModelId: string): boolean;

  /** Modeli Gateway AIModelDTO formatına dönüştürür */
  toDTO(): AIModelDTO;
}

/**
 * Yeni model oluşturma veya mevcut modeli özelleştirme form verisi arayüzü.
 */
export interface CreateThinkPortModelInput {
  id: string;
  name: string;
  vendor: string;
  provider: string;
  protocolId: string;
  category: ThinkPortModelCategory;
  sourceType: ThinkPortModelSourceType;
  badge: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  fallbackLocal?: string;
  aliases: string[];
  capabilities: IThinkPortModelCapabilities;
  available?: boolean;
}

