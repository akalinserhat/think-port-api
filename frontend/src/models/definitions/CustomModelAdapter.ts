/**
 * ThinkPort AI Gateway - Özel Tanımlı Model Sınıfı (CustomModelAdapter.ts)
 *
 * Sistem Ayarları -> Yapay Zeka -> Modeller ekranından veya kod üzerinden
 * dinamik olarak eklenen modelleri IThinkPortModel arayüzüne uyarlar.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  CreateThinkPortModelInput,
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class CustomModelAdapter extends BaseThinkPortModel {
  readonly id: string;
  readonly name: string;
  readonly vendor: string;
  readonly provider: string;
  readonly protocolId: string;
  readonly category: ThinkPortModelCategory;
  readonly sourceType: ThinkPortModelSourceType;
  readonly badge: string;
  readonly description: string;
  readonly sourceFile: string;
  override readonly isLocal: boolean;
  override readonly isImage: boolean;
  override readonly available: boolean;
  override readonly isSystemModel: boolean = false;
  override readonly contextWindow: number;
  override readonly maxOutputTokens: number;
  override readonly fallbackLocal?: string;
  override readonly aliases: readonly string[];
  private readonly _capabilities: IThinkPortModelCapabilities;

  constructor(input: CreateThinkPortModelInput, sourceFile?: string) {
    super();
    this.id = input.id.trim();
    this.name = input.name.trim() || this.id;
    this.vendor = input.vendor.trim() || 'Custom Vendor';
    this.provider = input.provider.trim() || 'external-api';
    this.protocolId = input.protocolId || 'proto_openai';
    this.category = input.category || 'chat';
    this.sourceType = input.sourceType || 'external';
    this.badge = input.badge.trim() || 'Özel Model';
    this.description = input.description.trim();
    this.sourceFile =
      sourceFile ||
      `src/models/definitions/${this.id.replace(/[^a-zA-Z0-9]/g, '_')}Model.ts`;
    this.isLocal = this.sourceType === 'local' || this.provider === 'local-engine';
    this.isImage = this.category === 'image' || this.sourceType === 'image';
    this.available = input.available !== undefined ? input.available : true;
    this.contextWindow = Number(input.contextWindow) || 128000;
    this.maxOutputTokens = Number(input.maxOutputTokens) || 8192;
    this.fallbackLocal = input.fallbackLocal?.trim() || undefined;
    this.aliases = Array.from(
      new Set([this.id, ...(input.aliases || []).map((a) => a.trim()).filter(Boolean)])
    );
    this._capabilities = input.capabilities || {
      streaming: !this.isImage,
      vision: false,
      reasoning: false,
      functionCalling: !this.isImage,
      imageGeneration: this.isImage,
      jsonMode: !this.isImage,
    };
  }

  override get capabilities(): IThinkPortModelCapabilities {
    return this._capabilities;
  }
}

