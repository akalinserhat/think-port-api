/**
 * ThinkPort AI Gateway - BAAI/bge-m3 Çok Dilli RAG Embedding Model Tanımı (BgeM3EmbeddingModel.ts)
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class BgeM3EmbeddingModel extends BaseThinkPortModel {
  readonly id = 'BAAI/bge-m3';
  readonly name = 'BAAI/bge-m3 (Online RAG Embedding · 1024d)';
  readonly vendor = 'BAAI';
  readonly provider = 'bge-m3-gateway';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'embedding';
  readonly sourceType: ThinkPortModelSourceType = 'external';
  readonly badge = 'Embedding · 1024d';
  readonly description =
    'Çok dilli (Türkçe dahil 100+ dil), 8192 token bağlam pencereli ve 1024 boyutlu sağlayıcı bağımsız standart RAG vektör ve semantik parçalama (chunking) modeli.';
  readonly sourceFile = 'src/models/definitions/BgeM3EmbeddingModel.ts';
  override readonly isLocal = false;
  override readonly isImage = false;
  override readonly contextWindow = 8192;
  override readonly maxOutputTokens = 1024;
  override readonly fallbackLocal = 'bge-m3:latest';

  override readonly aliases: readonly string[] = [
    'BAAI/bge-m3',
    'baai/bge-m3',
    'bge-m3',
    'bge-m3:latest',
    '@cf/baai/bge-m3',
    'Pro/BAAI/bge-m3',
    'text-embedding-3-small',
    'text-embedding-3-large',
    'text-embedding-ada-002',
  ];

  override get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: false,
      vision: false,
      reasoning: false,
      functionCalling: false,
      imageGeneration: false,
      jsonMode: true,
    };
  }
}

export const bgeM3EmbeddingModel = new BgeM3EmbeddingModel();
