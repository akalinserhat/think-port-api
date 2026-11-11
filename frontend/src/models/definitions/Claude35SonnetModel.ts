/**
 * ThinkPort AI Gateway - Anthropic Claude 3.5 Sonnet Model Tanımı (Claude35SonnetModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız Claude 3.5 Sonnet model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class Claude35SonnetModel extends BaseThinkPortModel {
  readonly id = 'claude-3-5-sonnet';
  readonly name = 'Claude 3.5 Sonnet (Web Gateway)';
  readonly vendor = 'Anthropic';
  readonly provider = 'claude-web';
  readonly protocolId = 'proto_anthropic';
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'web';
  readonly badge = 'Web AI';
  readonly description = 'Anthropic Claude 3.5 Sonnet web oturumu köprüsü.';
  readonly sourceFile = 'src/models/definitions/Claude35SonnetModel.ts';
  readonly contextWindow = 200000;
  readonly maxOutputTokens = 8192;
  readonly webModel = 'openai-fast';
  readonly fallbackLocal = 'qwen2.5:14b';

  readonly aliases: readonly string[] = [
    'claude-3-5-sonnet',
    'claude-3-5-sonnet-latest',
    'claude-3-5-sonnet-20241022',
    'claude-3.5-sonnet',
    'claude-3-7-sonnet',
    'claude-3.7-sonnet',
    'claude-3-5-haiku',
    'claude-3-opus',
    'claude-sonnet-4',
    'claude-opus-4',
    'claude',
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

export const claude35SonnetModel = new Claude35SonnetModel();

