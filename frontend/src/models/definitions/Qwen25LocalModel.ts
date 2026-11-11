/**
 * ThinkPort AI Gateway - Qwen 2.5 (Yerel Ollama) Model Tanımı (Qwen25LocalModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız Qwen 2.5 yerel motor model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class Qwen25LocalModel extends BaseThinkPortModel {
  readonly id = 'qwen2.5:7b';
  readonly name = 'Qwen 2.5 7B (Yerel Motor)';
  readonly vendor = 'Local (QWEN2)';
  readonly provider = 'local-engine';
  readonly protocolId = 'proto_ollama';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'local';
  readonly badge = '7.6B · 4.7GB';
  readonly description =
    'Sisteminizde kurulu gerçek yerel yapay zeka modeli (QWEN2, 4.7 GB). Yüksek hızlı Türkçe ve kodlama desteği.';
  readonly sourceFile = 'src/models/definitions/Qwen25LocalModel.ts';
  override readonly isLocal = true;
  override readonly contextWindow = 32768;
  override readonly maxOutputTokens = 8192;

  override readonly aliases: readonly string[] = ['qwen2.5:7b', 'qwen2.5', 'qwen'];

  override get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: true,
      vision: false,
      reasoning: false,
      functionCalling: true,
      imageGeneration: false,
      jsonMode: true,
    };
  }
}

export const qwen25LocalModel = new Qwen25LocalModel();

