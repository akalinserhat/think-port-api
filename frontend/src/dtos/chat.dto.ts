export interface ChatAttachmentDTO {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  kind: 'image' | 'document';
  dataUrl?: string;
  extractedText?: string;
  estimatedTokens?: number;
}

export interface ChatMessageItemDTO {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatAttachmentDTO[];
  userId?: string;
  userEmail?: string;
  userFullName?: string;
  model?: string;
  modelName?: string;
  provider?: string;
  meta?: string;
  timestamp: string;
  isError?: boolean;
}

export interface ApiChatMessagePayloadDTO {
  role: string;
  content: string | Record<string, unknown>[];
}

export interface ChatCompletionRequestDTO {
  model: string;
  stream: boolean;
  messages: ApiChatMessagePayloadDTO[];
  conversation_id?: string;
  source?: 'studio' | 'api';
}

export interface ChatCompletionResponseDTO {
  id: string;
  model: string;
  conversation_id?: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionChunkDTO {
  id: string;
  model: string;
  conversation_id?: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason?: string | null;
  }[];
}

export interface ParseFileRequestDTO {
  filename: string;
  mime_type: string;
  base64_data: string;
}

export interface ParseFileResponseDTO {
  filename: string;
  extracted_text: string;
  char_count: number;
  estimated_tokens: number;
}

export interface MessageAttachmentRecordDTO {
  id: string;
  message_id: string;
  conversation_id: string;
  user_id: string;
  file_name: string;
  file_kind: 'document' | 'image';
  mime_type: string;
  file_size: number;
  estimated_tokens: number;
  created_at: string;
}

export interface ConversationMessageRecordDTO {
  id: string;
  conversation_id: string;
  request_id?: string | null;
  user_id: string;
  user_email: string;
  user_full_name: string;
  role: 'system' | 'user' | 'assistant' | 'developer' | 'tool';
  model_id: string;
  provider: string;
  content: string;
  attachments: MessageAttachmentRecordDTO[];
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  ttft_ms: number;
  status: string;
  error_detail: string;
  created_at: string;
}

export interface ConversationSummaryDTO {
  id: string;
  user_id: string;
  user_email: string;
  user_full_name: string;
  title: string;
  model_id: string;
  system_prompt: string;
  source: 'studio' | 'api';
  is_pinned: boolean;
  is_archived: boolean;
  total_messages: number;
  total_tokens: number;
  attachment_names: string[];
  last_message_preview: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetailDTO extends ConversationSummaryDTO {
  messages: ConversationMessageRecordDTO[];
}

export interface CreateConversationRequestDTO {
  title?: string;
  model_id: string;
  system_prompt?: string;
  source?: 'studio' | 'api';
  user_id?: string;
}

export interface UpdateConversationRequestDTO {
  title?: string;
  model_id?: string;
  system_prompt?: string;
  is_pinned?: boolean;
  is_archived?: boolean;
}
