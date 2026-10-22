import {
  CreateApiKeyRequestDTO,
  CreateApiKeyResponseDTO,
} from '../dtos/admin.dto';
import { deleteJson, postJson } from './httpClient';

/**
 * API anahtarı (Bearer Token) yönetim servisi.
 */
export const apiKeyService = {
  /** Belirtilen kullanıcı için yeni bir API anahtarı oluşturur. */
  async createKey(dto: CreateApiKeyRequestDTO): Promise<CreateApiKeyResponseDTO> {
    return postJson<CreateApiKeyRequestDTO, CreateApiKeyResponseDTO>('/admin/api-keys', dto);
  },

  /** Belirtilen API anahtarını iptal eder. */
  async revokeKey(keyId: string): Promise<{ revoked: boolean; id: string }> {
    return deleteJson<{ revoked: boolean; id: string }>(`/admin/api-keys/${keyId}`);
  },
};
