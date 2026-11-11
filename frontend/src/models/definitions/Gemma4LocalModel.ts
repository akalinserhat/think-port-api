/**
 * ThinkPort AI Gateway - Gemma 4 (Yerel Ollama) Model Tanımı (Gemma4LocalModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız Google Gemma 4 yerel motor model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class Gemma4LocalModel extends BaseThinkPortModel {
  readonly id = 'gemma4:e4b';
  readonly name = 'Gemma 4 E4B (Yerel Motor)';
  readonly vendor = 'Local (GEMMA4)';
  readonly provider = 'local-engine';
  readonly protocolId = 'proto_ollama';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'local';
  readonly badge = '8.0B · 9.0GB';
  readonly description =
    'Sisteminizde kurulu gerçek yerel yapay zeka modeli (GEMMA4, 9.0 GB). Çok modlu (Vision) ve Türkçe muhakeme desteği.';
  readonly sourceFile = 'src/models/definitions/Gemma4LocalModel.ts';
  override readonly isLocal = true;
  override readonly contextWindow = 128000;
  override readonly maxOutputTokens = 8192;

  override readonly aliases: readonly string[] = ['gemma4:e4b', 'gemma4', 'gemma'];

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

export const gemma4LocalModel = new Gemma4LocalModel();

