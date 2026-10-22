import {
  CreateUserRequestDTO,
  TokenAllocationInputDTO,
  UserRecordDTO,
  UserTokenAllocationDTO,
} from '../dtos/admin.dto';
import { deleteJson, getJson, patchJson, postJson } from './httpClient';

/**
 * Kullanıcı ve kota yönetimi servisi.
 */
export const userService = {
  /** Yeni bir SaaS kullanıcısı oluşturur. */
  async createUser(dto: CreateUserRequestDTO): Promise<UserRecordDTO> {
    return postJson<CreateUserRequestDTO, UserRecordDTO>('/admin/users', dto);
  },

  /** Kullanıcının durumunu (active <-> suspended) değiştirir. */
  async toggleStatus(userId: string): Promise<UserRecordDTO> {
    return patchJson<undefined, UserRecordDTO>(`/admin/users/${userId}/toggle-status`);
  },

  /** Kullanıcının tarih aralıklı token tanımlamalarını ve tarih bazlı kullanım kırılımlarını listeler. */
  async listUserTokens(userId: string): Promise<UserTokenAllocationDTO[]> {
    return getJson<UserTokenAllocationDTO[]>(`/admin/users/${encodeURIComponent(userId)}/tokens`);
  },

  /** Kullanıcıya yeni bir tarih aralıklı token tanımı ekler. */
  async createUserToken(
    userId: string,
    dto: TokenAllocationInputDTO
  ): Promise<{ allocation: UserTokenAllocationDTO; allocations: UserTokenAllocationDTO[] }> {
    return postJson<
      TokenAllocationInputDTO,
      { allocation: UserTokenAllocationDTO; allocations: UserTokenAllocationDTO[] }
    >(`/admin/users/${encodeURIComponent(userId)}/tokens`, dto);
  },

  /** Kullanıcının mevcut bir token tanımını günceller. */
  async updateUserToken(
    userId: string,
    allocationId: string,
    dto: Partial<TokenAllocationInputDTO>
  ): Promise<{ allocation: UserTokenAllocationDTO; allocations: UserTokenAllocationDTO[] }> {
    return patchJson<
      Partial<TokenAllocationInputDTO>,
      { allocation: UserTokenAllocationDTO; allocations: UserTokenAllocationDTO[] }
    >(
      `/admin/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(allocationId)}`,
      dto
    );
  },

  /** Kullanıcının mevcut bir token tanımını siler. */
  async deleteUserToken(
    userId: string,
    allocationId: string
  ): Promise<{ deleted: boolean; id: string; allocations: UserTokenAllocationDTO[] }> {
    return deleteJson<{ deleted: boolean; id: string; allocations: UserTokenAllocationDTO[] }>(
      `/admin/users/${encodeURIComponent(userId)}/tokens/${encodeURIComponent(allocationId)}`
    );
  },
};
