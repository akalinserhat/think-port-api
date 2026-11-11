/**
 * ThinkPort AI Gateway - Google Gemini 2.5 Pro Model Tanımı (Gemini25ProModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız Gemini 2.5 Pro model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class Gemini25ProModel extends BaseThinkPortModel {
  readonly id = 'gemini-2.5-pro';
  readonly name = 'Gemini 2.5 Pro (Web Gateway)';
  readonly vendor = 'Google';
  readonly provider = 'gemini-web';
  readonly protocolId = 'proto_gemini';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'web';
  readonly badge = 'Web AI';
  readonly description = 'Google Gemini 2.5 Pro web oturumu köprüsü.';
  readonly sourceFile = 'src/models/definitions/Gemini25ProModel.ts';
  readonly contextWindow = 1000000;
  readonly maxOutputTokens = 16384;
  readonly webModel = 'openai-fast';
  readonly fallbackLocal = 'gemma4:e4b';

  readonly aliases: readonly string[] = [
    'gemini-2.5-pro',
    'gemini-2.5-pro-preview',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-pro',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-pro',
    'gemini-ultra',
    'gemini',
  ];

  override get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: true,
      vision: true,
      reasoning: true,
      functionCalling: true,
      imageGeneration: false,
      jsonMode: true,
    };
  }
}

export const gemini25ProModel = new Gemini25ProModel();

