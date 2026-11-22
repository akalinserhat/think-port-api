/**
 * ThinkPort AI Gateway - DeepSeek R1 Model Tanımı (DeepSeekR1Model.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız DeepSeek R1 model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class DeepSeekR1Model extends BaseThinkPortModel {
  readonly id = 'deepseek-r1';
  readonly name = 'DeepSeek R1 (DeepSeek API)';
  readonly vendor = 'DeepSeek';
  readonly provider = 'deepseek-api';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'external';
  readonly badge = 'Direct REST API';
  readonly description = 'DeepSeek R1 resmi REST API uç noktası (Düşünce zinciri muhakeme motoru).';
  readonly sourceFile = 'src/models/definitions/DeepSeekR1Model.ts';
  override readonly hostingApp = 'DeepSeek Cloud REST API';
  override readonly accessType = 'Doğrudan REST API';
  readonly contextWindow = 128000;
  readonly maxOutputTokens = 16384;
  readonly fallbackLocal = 'qwen2.5:7b';

  readonly aliases: readonly string[] = [
    'deepseek-r1',
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-coder',
    'deepseek-v3',
    'deepseek-v2.5',
    'deepseek',
  ];

  override get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: true,
      vision: false,
      reasoning: true,
      functionCalling: true,
      imageGeneration: false,
      jsonMode: true,
    };
  }
}

export const deepSeekR1Model = new DeepSeekR1Model();

