/**
 * ThinkPort AI Gateway - Dinamik Yerel / Harici Model Adaptörü (DynamicOllamaModelAdapter.ts)
 *
 * Çalışma zamanında (runtime) Ollama /api/tags veya /v1/models üzerinden keşfedilen
 * ancak statik sınıfı henüz oluşturulmamış modelleri IThinkPortModel arayüzüne uyarlar.
 */

import { AIModelDTO } from '../../dtos';
import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class DynamicOllamaModelAdapter extends BaseThinkPortModel {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly provider: string;
  readonly protocolId: string;
  readonly category: ThinkPortModelCategory;
  readonly sourceType: ThinkPortModelSourceType;
  readonly badge: string;
  readonly description: string;
  readonly sourceFile = 'src/models/definitions/DynamicOllamaModelAdapter.ts';
  override readonly isLocal: boolean;
  override readonly isImage: boolean;
  override readonly available: boolean;
  override readonly isSystemModel: boolean = true;
  override readonly contextWindow: number;
  override readonly maxOutputTokens: number;
  override readonly aliases: readonly string[];

  constructor(dto: AIModelDTO & { available?: boolean; type?: string }) {
    super();
    this.id = dto.id;
    this.name = dto.name || dto.id;
    this.vendor = dto.vendor || (dto.is_local ? 'Local (Ollama)' : 'External API');
    this.provider = dto.provider || (dto.is_local ? 'local-engine' : 'external-api');
    this.isLocal = Boolean(dto.is_local || dto.provider === 'local-engine');
    this.isImage = Boolean(dto.is_image || dto.type === 'image');
    this.available = dto.available !== undefined ? Boolean(dto.available) : true;
    this.protocolId = this.isLocal ? 'proto_ollama' : 'proto_openai';

    const lowerId = this.id.toLowerCase();
    const isEmbed = lowerId.includes('embed') || lowerId.includes('bge-');
    this.category = isEmbed ? 'embedding' : this.isImage ? 'image' : 'chat';
    this.sourceType = this.isImage ? 'image' : this.isLocal ? 'local' : 'web';
    this.badge = dto.badge || (this.isLocal ? 'Yerel Motor' : 'Web AI');
    this.description =
      dto.description ||
      `Dinamik olarak keşfedilen ${this.vendor} yapay zeka modeli (${this.id}).`;
    this.contextWindow = this.isImage ? 4096 : this.isLocal ? 32768 : 128000;
    this.maxOutputTokens = this.isImage ? 1024 : 8192;

    const baseAlias = this.id.includes(':') ? this.id.split(':')[0] : this.id;
    this.aliases = baseAlias !== this.id ? [this.id, baseAlias] : [this.id];
  }

  override get capabilities(): IThinkPortModelCapabilities {
    const lower = this.id.toLowerCase();
    return {
      streaming: !this.isImage && this.category !== 'embedding',
      vision: lower.includes('vl') || lower.includes('vision') || lower.includes('gemma'),
      reasoning: lower.includes('r1') || lower.includes('qwq') || lower.includes('think'),
      functionCalling: !this.isImage && this.category !== 'embedding',
      imageGeneration: this.isImage,
      jsonMode: !this.isImage && this.category !== 'embedding',
    };
  }
}

