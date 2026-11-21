/**
 * ThinkPort AI Gateway - OpenAI GPT-OSS 20B Model Tanımı (GptOss20BModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız GPT-OSS 20B açık kaynak model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class GptOss20BModel extends BaseThinkPortModel {
  readonly id = 'gpt-oss:20b';
  readonly name = 'GPT-OSS 20B';
  readonly vendor = 'Open Source (OpenAI OSS)';
  readonly provider = 'web-ai';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'web';
  readonly badge = 'Web AI';
  readonly description = 'GPT-OSS 20B açık kaynak büyük dil modeli (Web AI ağ geçidi üzerinden yüksek hızlı akış).';
  readonly sourceFile = 'src/models/definitions/GptOss20BModel.ts';
  readonly contextWindow = 128000;
  readonly maxOutputTokens = 16384;
  readonly webModel = 'openai-fast';
  readonly fallbackLocal = 'qwen2.5:7b';

  readonly aliases: readonly string[] = [
    'gpt-oss:20b',
    'gpt-oss-20b',
    'gpt-oss',
    'openai-fast',
    'gpt-4o',
    'gpt-4o-mini',
    'chatgpt',
    'claude-3-5-sonnet',
    'gemini-2.5-pro',
    'deepseek-r1',
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

export const gptOss20BModel = new GptOss20BModel();
