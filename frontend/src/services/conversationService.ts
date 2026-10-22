import {
  ChatMessageItemDTO,
  ConversationDetailDTO,
  ConversationMessageRecordDTO,
  ConversationSummaryDTO,
  CreateConversationRequestDTO,
  UpdateConversationRequestDTO,
} from '../dtos/chat.dto';
import { deleteJson, getJson, patchJson, postJson } from './httpClient';

export interface ConversationAuthOptions {
  requesterUserId?: string;
  apiKey?: string;
}

function buildAuthHeaders(auth?: ConversationAuthOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.requesterUserId?.trim()) {
    headers['X-User-Id'] = auth.requesterUserId.trim();
  }
  if (auth?.apiKey?.trim()) {
    headers.Authorization = `Bearer ${auth.apiKey.trim()}`;
  }
  return headers;
}

/**
 * SQLite üzerinde saklanan sohbet oturumları (chat_conversations), mesajlar (chat_messages)
 * ve ekli dosya kayıtları (chat_message_attachments) için önyüz servisi.
 */
export const conversationService = {
  /** Kayıtlı sohbet oturumlarını kullanıcının rolüne ve filtrelere göre listeler. */
  async listConversations(
    params?: {
      userId?: string;
      modelId?: string;
      source?: 'studio' | 'api' | 'all';
      search?: string;
      searchField?: string;
      isArchived?: boolean;
      sortField?: string;
      sortOrder?: 'asc' | 'desc';
      page?: number;
      pageSize?: number;
    },
    auth?: ConversationAuthOptions
  ): Promise<ConversationSummaryDTO[]> {
    const query = new URLSearchParams();
    if (params?.userId && params.userId !== 'all') query.set('user_id', params.userId);
    if (params?.modelId && params.modelId !== 'all') query.set('model_id', params.modelId);
    if (params?.source && params.source !== 'all') query.set('source', params.source);
    if (params?.search?.trim()) query.set('search', params.search.trim());
    if (params?.searchField) query.set('aramaTipi', params.searchField);
    if (params?.isArchived !== undefined) query.set('arsivdekiler', String(params.isArchived));
    if (params?.sortField) query.set('sortField', params.sortField);
    if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    const qs = query.toString();
    return getJson<ConversationSummaryDTO[]>(
      `/admin/conversations${qs ? `?${qs}` : ''}`,
      buildAuthHeaders(auth)
    );
  },

  /** Tekil sohbet oturumunu tüm mesaj ve ekli dosya kayıtlarıyla birlikte getirir. */
  async getConversationDetail(
    conversationId: string,
    auth?: ConversationAuthOptions
  ): Promise<ConversationDetailDTO> {
    return getJson<ConversationDetailDTO>(
      `/admin/conversations/${conversationId}`,
      buildAuthHeaders(auth)
    );
  },

  /** Yeni bir sohbet oturumu başlatır. */
  async createConversation(
    dto: CreateConversationRequestDTO,
    auth?: ConversationAuthOptions
  ): Promise<ConversationSummaryDTO> {
    return postJson<CreateConversationRequestDTO, ConversationSummaryDTO>(
      '/admin/conversations',
      dto,
      buildAuthHeaders(auth)
    );
  },

  /** Sohbet oturumu başlığını, modelini, sistem yönergesini veya sabitleme durumunu günceller. */
  async updateConversation(
    conversationId: string,
    dto: UpdateConversationRequestDTO,
    auth?: ConversationAuthOptions
  ): Promise<ConversationSummaryDTO> {
    return patchJson<UpdateConversationRequestDTO, ConversationSummaryDTO>(
      `/admin/conversations/${conversationId}`,
      dto,
      buildAuthHeaders(auth)
    );
  },

  /** Sohbet oturumunu ve altındaki tüm mesaj/dosya kayıtlarını veritabanından siler. */
  async deleteConversation(
    conversationId: string,
    auth?: ConversationAuthOptions
  ): Promise<{ status: string; id: string }> {
    return deleteJson<{ status: string; id: string }>(
      `/admin/conversations/${conversationId}`,
      buildAuthHeaders(auth)
    );
  },

  /** Bir sohbet turunu (kullanıcı mesajı, ekli dosya isimleri ve model cevabı) SQLite veritabanına kaydeder. */
  async recordTurn(
    payload: {
      conversation_id?: string | null;
      model: string;
      provider?: string;
      source?: 'studio' | 'api';
      messages: unknown[];
      assistant_content: string;
      latency_ms?: number;
      ttft_ms?: number;
    },
    auth?: ConversationAuthOptions
  ): Promise<{ conversation_id: string; status: string }> {
    return postJson<typeof payload, { conversation_id: string; status: string }>(
      '/admin/conversations/record-turn',
      payload,
      buildAuthHeaders(auth)
    );
  },

  /** Veritabanı mesaj kaydını (ConversationMessageRecordDTO) arayüz mesaj nesnesine (ChatMessageItemDTO) dönüştürür. */
  mapRecordToChatMessageItem(record: ConversationMessageRecordDTO): ChatMessageItemDTO {
    const timeLabel = record.created_at
      ? new Date(record.created_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '';

    const metaParts: string[] = [];
    if (record.role === 'assistant') {
      if (record.ttft_ms > 0) metaParts.push(`TTFT ${record.ttft_ms} ms`);
      if (record.latency_ms > 0) metaParts.push(`${record.latency_ms} ms`);
      if (record.total_tokens > 0) metaParts.push(`${record.total_tokens} token`);
    } else if (record.prompt_tokens > 0) {
      metaParts.push(`${record.prompt_tokens} token`);
    }

    return {
      id: record.id,
      role: record.role === 'assistant' ? 'assistant' : record.role === 'system' ? 'system' : 'user',
      content: record.content,
      userId: record.user_id,
      userEmail: record.user_email,
      userFullName: record.user_full_name,
      model: record.model_id,
      modelName: record.model_id,
      provider: record.provider,
      meta: metaParts.join(' · ') || timeLabel,
      timestamp: timeLabel,
      isError: record.status === 'error',
      attachments:
        record.attachments && record.attachments.length > 0
          ? record.attachments.map((att) => ({
              id: att.id,
              name: att.file_name,
              size: att.file_size,
              mimeType: att.mime_type,
              kind: att.file_kind,
              estimatedTokens: att.estimated_tokens,
            }))
          : undefined,
    };
  },
};
