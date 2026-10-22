import {
  ApiChatMessagePayloadDTO,
  ChatCompletionChunkDTO,
  ChatCompletionRequestDTO,
  ChatCompletionResponseDTO,
  ChatMessageItemDTO,
} from '../dtos/chat.dto';
import { extractHttpErrorMessage } from './httpClient';

/**
 * OpenAI uyumlu sohbet tamamlama (Chat Completions) ve SSE akış servisi.
 * Her metot yalnızca tek bir mesaj hazırlama veya akış işleme görevine sahiptir.
 */
export const chatService = {
  /** Tek bir mesajı OpenAI API (metin veya multimodal dizi) içerik formatına dönüştürür. */
  buildContentForMessage(
    msg: ChatMessageItemDTO,
    appendSizeTag?: string
  ): string | Record<string, unknown>[] {
    const baseText = appendSizeTag ? `${msg.content.trim()} [size:${appendSizeTag}]` : msg.content;
    if (!msg.attachments || msg.attachments.length === 0) {
      return baseText;
    }

    const parts: Record<string, unknown>[] = [];
    if (baseText.trim()) {
      parts.push({ type: 'text', text: baseText.trim() });
    }
    for (const att of msg.attachments) {
      if (att.kind === 'image' && att.dataUrl) {
        parts.push({
          type: 'image_url',
          file_name: att.name,
          mime_type: att.mimeType,
          file_size: att.size,
          estimated_tokens: att.estimatedTokens || 0,
          image_url: { url: att.dataUrl },
        });
      } else {
        parts.push({
          type: 'file',
          file_name: att.name,
          mime_type: att.mimeType,
          file_size: att.size,
          estimated_tokens: att.estimatedTokens || 0,
          content: att.extractedText || '',
        });
      }
    }
    return parts;
  },

  /** Sohbet geçmişini ve sistem yönergesini API istek dizisine dönüştürür. */
  buildApiMessages(
    history: ChatMessageItemDTO[],
    systemPrompt: string,
    isImageModel: boolean,
    imageSize: string
  ): ApiChatMessagePayloadDTO[] {
    const apiMessages: ApiChatMessagePayloadDTO[] = [];
    if (systemPrompt.trim() && !isImageModel) {
      apiMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    history.forEach((m, idx) => {
      if (m.role === 'user') {
        const isLatestUser = idx === history.length - 1;
        apiMessages.push({
          role: 'user',
          content: this.buildContentForMessage(
            m,
            isLatestUser && isImageModel ? imageSize : undefined
          ),
        });
      } else if (m.role === 'assistant' && m.content) {
        apiMessages.push({ role: 'assistant', content: m.content });
      }
    });
    return apiMessages;
  },

  /** Tek bir SSE 'data: ...' satırından delta metnini ve varsa conversation_id değerini ayrıştırır. */
  parseChunkFromSseLine(line: string): { delta: string | null; conversationId?: string } {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') {
      return { delta: null };
    }
    try {
      const parsed: ChatCompletionChunkDTO = JSON.parse(trimmed.slice(6));
      return {
        delta: parsed.choices?.[0]?.delta?.content || null,
        conversationId: parsed.conversation_id,
      };
    } catch {
      return { delta: null };
    }
  },

  /** Senkron (stream=false) sohbet tamamlama isteği gönderir. */
  async sendSyncCompletion(
    dto: ChatCompletionRequestDTO,
    apiKey: string,
    xUserId?: string
  ): Promise<ChatCompletionResponseDTO> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    };
    if (xUserId) {
      headers['X-User-Id'] = xUserId;
    }
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...dto, stream: false }),
    });
    if (!res.ok) {
      throw new Error(await extractHttpErrorMessage(res));
    }
    return res.json() as Promise<ChatCompletionResponseDTO>;
  },

  /** Büyük veya toplu gelen metin parçalarını daktilo akışı için kelime/parça dizisine böler. */
  splitIntoTypewriterPieces(text: string, maxPieceLen = 14): string[] {
    if (text.length <= maxPieceLen) {
      return [text];
    }
    const pieces: string[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      let end = Math.min(cursor + maxPieceLen, text.length);
      if (end < text.length) {
        const spaceIdx = text.lastIndexOf(' ', end);
        if (spaceIdx > cursor + 3) {
          end = spaceIdx + 1;
        }
      }
      pieces.push(text.slice(cursor, end));
      cursor = end;
    }
    return pieces;
  },

  /** SSE akışlı (stream=true) sohbet tamamlama isteği gönderir ve her delta parçasını callback'e iletir. */
  async streamCompletion(
    dto: ChatCompletionRequestDTO,
    apiKey: string,
    onDelta: (deltaText: string) => void,
    onConversationId?: (conversationId: string) => void,
    xUserId?: string
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Authorization: `Bearer ${apiKey.trim()}`,
    };
    if (xUserId) {
      headers['X-User-Id'] = xUserId;
    }
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...dto, stream: true }),
    });

    if (!res.ok) {
      throw new Error(await extractHttpErrorMessage(res));
    }

    const headerConvId = res.headers.get('X-Conversation-Id');
    if (headerConvId && onConversationId) {
      onConversationId(headerConvId);
    }

    if (!res.body) {
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '';
    let notifiedConvId = Boolean(headerConvId);

    const emitDeltaSmoothly = async (rawDelta: string, hasMultipleInBatch: boolean) => {
      const pieces = this.splitIntoTypewriterPieces(rawDelta);
      for (let i = 0; i < pieces.length; i++) {
        onDelta(pieces[i]);
        if (pieces.length > 1 || hasMultipleInBatch) {
          await new Promise<void>((resolve) => setTimeout(resolve, 12));
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';

      const deltasInRead: string[] = [];
      for (const line of lines) {
        const { delta, conversationId } = this.parseChunkFromSseLine(line);
        if (!notifiedConvId && conversationId && onConversationId) {
          notifiedConvId = true;
          onConversationId(conversationId);
        }
        if (delta) {
          deltasInRead.push(delta);
        }
      }

      for (let i = 0; i < deltasInRead.length; i++) {
        await emitDeltaSmoothly(deltasInRead[i], deltasInRead.length > 1);
      }
    }

    if (sseBuffer.trim()) {
      const { delta, conversationId } = this.parseChunkFromSseLine(sseBuffer);
      if (!notifiedConvId && conversationId && onConversationId) {
        onConversationId(conversationId);
      }
      if (delta) {
        await emitDeltaSmoothly(delta, false);
      }
    }
  },

  /** Seçili model ve API anahtarı için örnek cURL komut metni üretir. */
  buildCurlSnippet(
    modelId: string,
    apiKey: string,
    stream: boolean,
    promptText: string,
    conversationId?: string | null
  ): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8000';
    const convField = conversationId ? `\n    "conversation_id": "${conversationId}",` : '';
    return `curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey.trim()}" \\
  -d '{
    "model": "${modelId}",
    "stream": ${stream},${convField}
    "messages": [
      { "role": "user", "content": ${JSON.stringify(promptText)} }
    ]
  }'`;
  },
};
