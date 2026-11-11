/**
 * ThinkPort AI Gateway - OpenAI GPT-4o Model Tanımı (Gpt4oModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız GPT-4o model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class Gpt4oModel extends BaseThinkPortModel {
  readonly id = 'gpt-4o';
  readonly name = 'GPT-4o (Web Gateway)';
  readonly vendor = 'OpenAI';
  readonly provider = 'chatgpt-web';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'web';
  readonly badge = 'Web AI';
  readonly description = 'OpenAI GPT-4o web oturumu (yüksek hızlı Web AI köprüsü).';
  readonly sourceFile = 'src/models/definitions/Gpt4oModel.ts';
  readonly contextWindow = 128000;
  readonly maxOutputTokens = 16384;
  readonly webModel = 'openai-fast';
  readonly fallbackLocal = 'qwen2.5:7b';

  readonly aliases: readonly string[] = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini-2024-07-18',
    'chatgpt-4o-latest',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o3',
    'o3-mini',
    'o4-mini',
    'openai',
    'chatgpt',
  ];

  override get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: true,
      vision: true,
      reasoning: false,
      functionCalling: true,
      imageGeneration: false,
      jsonMode: true,
    };
  }
}

export const gpt4oModel = new Gpt4oModel();

