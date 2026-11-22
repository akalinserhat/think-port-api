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
  readonly name = 'GPT-OSS 20B (Sanal Tarayıcı)';
  readonly vendor = 'Open Source (OpenAI OSS)';
  readonly provider = 'browser-gateway';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'web';
  readonly badge = 'Sanal Tarayıcı';
  readonly description = 'GPT-OSS 20B açık kaynak büyük dil modeli (@akalin/browser_module Docker Playwright ve @akalin/proxy_module üzerinden erişim).';
  readonly sourceFile = 'src/models/definitions/GptOss20BModel.ts';
  override readonly hostingApp = '@akalin/browser_module (Docker Playwright)';
  override readonly accessType = 'Sanal Tarayıcı (Web AI Hybrid)';
  override readonly targetUrl = 'https://chatgpt.com/';
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
