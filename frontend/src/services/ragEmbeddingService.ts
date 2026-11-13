/**
 * @file ragEmbeddingService.ts
 * @description ThinkPort API Gateway - BAAI/bge-m3 (1024d) Online/Yerel RAG Embedding
 * durum sorgulama, canlı sağlayıcı testi ve mevcut dökümanları yeniden vektörleştirme servisi.
 */

import {
  RagEmbeddingStatusDTO,
  RagEmbeddingTestResponseDTO,
  RagReindexResponseDTO,
} from '../dtos/admin.dto';
import { getJson, postJson } from './httpClient';

export const ragEmbeddingService = {
  /** Aktif BAAI/bge-m3 (1024d) online ve yerel sağlayıcı durum özetini çeker. */
  async getStatus(): Promise<RagEmbeddingStatusDTO> {
    return getJson<RagEmbeddingStatusDTO>('/v1/rag/embedding-status');
  },

  /** Seçilen veya otomatik öncelikli BAAI/bge-m3 sağlayıcısını canlı örnek metinle test eder. */
  async testConnection(provider?: string): Promise<RagEmbeddingTestResponseDTO> {
    const cleanProvider =
      provider && provider !== 'auto' ? provider : undefined;
    return postJson<{ provider?: string }, RagEmbeddingTestResponseDTO>(
      '/v1/rag/embedding-test',
      { provider: cleanProvider }
    );
  },

  /** PostgreSQL pgvector içindeki mevcut RAG chunk kayıtlarını 1024d BAAI/bge-m3 ile yeniden vektörleştirir. */
  async reindexDocuments(onlyFallback: boolean = false): Promise<RagReindexResponseDTO> {
    return postJson<{ only_fallback: boolean }, RagReindexResponseDTO>(
      '/v1/rag/documents/reindex',
      { only_fallback: onlyFallback }
    );
  },
};
