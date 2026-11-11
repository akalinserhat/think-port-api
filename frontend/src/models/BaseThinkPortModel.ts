/**
 * ThinkPort AI Gateway - Temel Yapay Zeka Model Sınıfı (BaseThinkPortModel.ts)
 *
 * IThinkPortModel arayüzünü uygulayan tüm model sınıfları için ortak metotları
 * (matchesAlias, toDTO) ve varsayılan özellikleri sağlar.
 */

import { AIModelDTO } from '../dtos';
import {
  IThinkPortModel,
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from './IThinkPortModel';

export abstract class BaseThinkPortModel implements IThinkPortModel {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly vendor: string;
  abstract readonly provider: string;
  abstract readonly protocolId: string;
  abstract readonly category: ThinkPortModelCategory;
  abstract readonly sourceType: ThinkPortModelSourceType;
  abstract readonly badge: string;
  abstract readonly description: string;
  abstract readonly sourceFile: string;

  readonly isLocal: boolean = false;
  readonly isImage: boolean = false;
  readonly available: boolean = true;
  readonly isSystemModel: boolean = true;
  readonly contextWindow: number = 128000;
  readonly maxOutputTokens: number = 16384;
  readonly fallbackLocal?: string;
  readonly webModel?: string;
  readonly imageModel?: string;
  readonly styleModifier?: string;
  readonly aliases: readonly string[] = [];

  get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: !this.isImage,
      vision: false,
      reasoning: false,
      functionCalling: !this.isImage,
      imageGeneration: this.isImage,
      jsonMode: !this.isImage,
    };
  }

  matchesAlias(requestedModelId: string): boolean {
    const clean = (requestedModelId || '').trim().toLowerCase();
    if (!clean) return false;
    if (clean === this.id.toLowerCase()) return true;
    return this.aliases.some((alias) => alias.toLowerCase() === clean);
  }

  toDTO(): AIModelDTO {
    return {
      id: this.id,
      name: this.name,
      vendor: this.vendor,
      provider: this.provider,
      badge: this.badge,
      description: this.description,
      is_local: this.isLocal,
      is_image: this.isImage,
      image_model: this.imageModel,
      web_model: this.webModel,
      fallback_local: this.fallbackLocal,
    };
  }
}

