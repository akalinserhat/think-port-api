/**
 * @file ChatStudioView.tsx
 * @description ThinkPort AI Gateway - AI Sohbet Stüdyosu Liste ve Sohbet Ekranı.
 * Hem harici API (/v1/chat/completions) hem de Stüdyo üzerinden gerçekleştirilen tüm yapay zeka
 * sohbet oturumlarını BaseListPage üzerinde SSE ve akıllı fark kontrolüyle anlık (real-time) listeler,
 * hızlı önizleme (BasePopup) ve tam ekran sohbet (BaseChatPage) deneyimi sunar.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Plus,
  RefreshCw,
  Paperclip,
  Pin,
  Cpu,
  Terminal,
  User as UserIcon,
  ShieldCheck,
  MessageSquare,
  Eye,
  Code2,
  Zap,
  FileText,
  Layers,
} from 'lucide-react';
import {
  BaseListPage,
  BasePopup,
  type DataTableColumn,
  type ActionMenuItem,
} from '@akalin/ui';
import {
  BaseChatPage,
  type ChatSession,
  type ChatMessage,
  type ChatAgent,
  type ChatAttachment,
  type PromptSuggestion,
} from '@akalin/ai-assistants';
import {
  AIModelDTO,
  ApiKeyRecordDTO,
  BrowserSessionDTO,
  ChatAttachmentDTO,
  ChatMessageItemDTO,
  ConversationDetailDTO,
  ConversationMessageRecordDTO,
  ConversationSummaryDTO,
  UserRecordDTO,
} from '../dtos';
import { chatService, conversationService, fileParserService } from '../services';

interface ChatStudioViewProps {
  models: AIModelDTO[];
  sessions: BrowserSessionDTO[];
  users?: UserRecordDTO[];
  apiKeys?: ApiKeyRecordDTO[];
  initialConversations?: ConversationSummaryDTO[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  apiKey: string;
  onChangeApiKey: (key: string) => void;
  isGenerating: boolean;
  setIsGenerating: (val: boolean) => void;
  onRefreshState: () => Promise<void>;
  onShowToast: (msg: string) => void;
}

const STUDIO_PROMPT_SUGGESTIONS: PromptSuggestion[] = [
  {
    id: 'prompt-arch',
    title: 'Mikroservis Mimari Tasarımı',
    category: 'Mimari',
    description: 'Yüksek trafikli bir API Gateway ve önbellekleme mimarisi tasarla.',
    prompt:
      'Yüksek trafikli bir OpenAI uyumlu API Gateway için hız sınırlandırma (rate limiting), oturum havuzu ve önbellekleme stratejilerini içeren bir mimari öner.',
    icon: <Layers size={18} />,
  },
  {
    id: 'prompt-sql',
    title: 'SQL Performans Analizi',
    category: 'Veritabanı',
    description: 'Veritabanı indeksleme ve sorgu optimizasyonu önerileri al.',
    prompt:
      'Milyonlarca mesaj kaydı barındıran bir sohbet veritabanında (conversations, messages, attachments) en verimli indeksleme ve sayfalama stratejisi nasıl olmalıdır?',
    icon: <Code2 size={18} />,
  },
  {
    id: 'prompt-doc',
    title: 'Doküman & Kod Özeti',
    category: 'Analiz',
    description: 'Eklenen dosyaları veya teknik metinleri maddeler halinde özetle.',
    prompt:
      'Paylaştığım teknik içeriği inceleyip temel bulguları, olası riskleri ve aksiyon maddelerini yapılandırılmış şekilde özetler misin?',
    icon: <FileText size={18} />,
  },
  {
    id: 'prompt-debug',
    title: 'Hata Ayıklama Asistanı',
    category: 'Tanılama',
    description: 'Asenkron akış (SSE) ve bağlantı kopması sorunlarını teşhis et.',
    prompt:
      'SSE (Server-Sent Events) tabanlı bir LLM akışında istemci bağlantısı koptuğunda arka uçta kaynak sızıntısını önlemek için hangi önlemler alınmalıdır?',
    icon: <Zap size={18} />,
  },
];

function extractThinkBlocksFromText(rawText: string): {
  thinkingText: string;
  cleanText: string;
  hasUnclosedThink: boolean;
} {
  if (!rawText) {
    return { thinkingText: '', cleanText: '', hasUnclosedThink: false };
  }
  const closedRegex = /<think(?:ing)?[^>]*>([\s\S]*?)<\/think(?:ing)?>/gi;
  const thoughts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = closedRegex.exec(rawText)) !== null) {
    if (match[1] && match[1].trim()) {
      thoughts.push(match[1].trim());
    }
  }
  let remaining = rawText.replace(closedRegex, '').trim();
  let hasUnclosedThink = false;

  const unclosedMatch = remaining.match(/<think(?:ing)?[^>]*>([\s\S]*)$/i);
  if (unclosedMatch) {
    hasUnclosedThink = true;
    const partialThought = (unclosedMatch[1] || '').trim();
    if (partialThought) {
      thoughts.push(partialThought);
    }
    remaining = remaining.slice(0, unclosedMatch.index).trim();
  }

  return {
    thinkingText: thoughts.join('\n\n').trim(),
    cleanText: remaining,
    hasUnclosedThink,
  };
}

function safeParseJson<T = Record<string, any>>(jsonStr?: string | null): T | null {
  if (!jsonStr || !jsonStr.trim()) return null;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

function getUtf8ByteLength(str: string): number {
  try {
    return new TextEncoder().encode(str || '').length;
  } catch {
    return (str || '').length;
  }
}

function stripUiTraceBlocksFromText(text: string): string {
  if (!text) return '';
  let cleaned = text;
  if (cleaned.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
    cleaned = cleaned.split('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')[0].trimEnd();
  }
  cleaned = cleaned.replace(
    /^> 🧠 \*\*LLM Düşünce[^\n]*\n(?:```text\n[\s\S]*?\n```|> [^\n]*)\n\n/,
    ''
  );
  if (cleaned.includes('\n\n---\n📥 **Gelen LLM İletişim Raporu:**')) {
    cleaned = cleaned.split('\n\n---\n📥 **Gelen LLM İletişim Raporu:**')[0].trimEnd();
  }
  if (cleaned.includes('\n\n📥 **Gelen LLM İletişim Raporu:**')) {
    cleaned = cleaned.split('\n\n📥 **Gelen LLM İletişim Raporu:**')[0].trimEnd();
  }
  if (cleaned.includes('\n\n---\n📡 **Canlı LLM Akışı')) {
    cleaned = cleaned.split('\n\n---\n📡 **Canlı LLM Akışı')[0].trimEnd();
  }
  if (cleaned.includes('\n\n---\n📐 **Gönderilen Yanıt JSON Şeması')) {
    cleaned = cleaned.split('\n\n---\n📐 **Gönderilen Yanıt JSON Şeması')[0].trimEnd();
  }
  if (cleaned.includes('\n\n---\n🛠️ **LLM\'e Gönderilen MCP Araç & JSON Şemaları')) {
    cleaned = cleaned.split('\n\n---\n🛠️ **LLM\'e Gönderilen MCP Araç & JSON Şemaları')[0].trimEnd();
  }
  if (cleaned.includes('\n\n---\n📄 **LLM\'e Aktarılan Ekli Belge İçeriği')) {
    cleaned = cleaned.split('\n\n---\n📄 **LLM\'e Aktarılan Ekli Belge İçeriği')[0].trimEnd();
  }
  if (cleaned.includes('\n\n📄 **LLM\'e Aktarılan Ekli Belge İçeriği')) {
    cleaned = cleaned.split('\n\n📄 **LLM\'e Aktarılan Ekli Belge İçeriği')[0].trimEnd();
  }
  return cleaned;
}

function describeJsonShape(parsed: any): string {
  if (Array.isArray(parsed)) {
    return `${parsed.length} öğeli JSON Dizisi`;
  }
  if (parsed && typeof parsed === 'object') {
    const keys = Object.keys(parsed);
    const previewKeys = keys.slice(0, 3).join(', ');
    return keys.length > 0
      ? `${keys.length} alanlı JSON Nesnesi (${previewKeys}${keys.length > 3 ? ', …' : ''})`
      : 'Boş JSON Nesnesi';
  }
  return 'JSON Verisi';
}

function findBalancedJsonEnd(text: string, startIndex: number): number {
  const openChar = text[startIndex];
  const closeChar = openChar === '{' ? '}' : openChar === '[' ? ']' : '';
  if (!closeChar) return -1;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function formatUnfencedJsonInSegment(segment: string): {
  formatted: string;
  extractedCount: number;
} {
  if (!segment || !segment.trim()) {
    return { formatted: segment, extractedCount: 0 };
  }

  let result = '';
  let cursor = 0;
  let extractedCount = 0;

  while (cursor < segment.length) {
    let nextBrace = -1;
    for (let i = cursor; i < segment.length; i++) {
      if (segment[i] === '{' || segment[i] === '[') {
        nextBrace = i;
        break;
      }
    }

    if (nextBrace === -1) {
      result += segment.slice(cursor);
      break;
    }

    const endBrace = findBalancedJsonEnd(segment, nextBrace);
    if (endBrace === -1) {
      result += segment.slice(cursor, nextBrace + 1);
      cursor = nextBrace + 1;
      continue;
    }

    const candidate = segment.slice(nextBrace, endBrace + 1);
    const parsed = safeParseJson<any>(candidate);
    const beforeSlice = segment.slice(cursor, nextBrace);
    const labelMatch = beforeSlice.match(/(?:^|\n)\s*\[([^\][\n]{2,80})\]\s*:\s*$/);

    const isStructuredJson =
      parsed !== null &&
      typeof parsed === 'object' &&
      (Array.isArray(parsed)
        ? parsed.length > 0 || Boolean(labelMatch) || candidate.includes('\n')
        : Object.keys(parsed).length > 0 || Boolean(labelMatch));

    if (!isStructuredJson) {
      result += segment.slice(cursor, nextBrace + 1);
      cursor = nextBrace + 1;
      continue;
    }

    extractedCount++;
    const prettyJson = JSON.stringify(parsed, null, 2);
    const byteLen = getUtf8ByteLength(candidate);
    const shapeDesc = describeJsonShape(parsed);

    if (labelMatch && labelMatch.index !== undefined) {
      const cleanBefore = beforeSlice.slice(0, labelMatch.index).trimEnd();
      const labelTitle = labelMatch[1].trim();
      if (cleanBefore) {
        result += `${cleanBefore}\n\n`;
      }
      result += `📦 **Gönderilen JSON Verisi (${labelTitle} — ${shapeDesc} · ${byteLen} bayt):**\n\`\`\`json\n${prettyJson}\n\`\`\`\n\n`;
    } else {
      const trimmedBefore = beforeSlice.trimEnd();
      if (trimmedBefore) {
        result += `${trimmedBefore}\n\n`;
      }
      result += `📦 **Gönderilen JSON Verisi (${shapeDesc} · ${byteLen} bayt):**\n\`\`\`json\n${prettyJson}\n\`\`\`\n\n`;
    }

    cursor = endBrace + 1;
  }

  return {
    formatted: result.replace(/\n{3,}/g, '\n\n').trim(),
    extractedCount,
  };
}

function formatOutgoingJsonContent(rawText: string, role: string): {
  formattedMarkdown: string;
  hasJsonData: boolean;
} {
  if (!rawText) {
    return {
      formattedMarkdown:
        role === 'tool' ? '🔧 **[GÖNDERİLEN MCP ARAÇ YANITI]**' : '',
      hasJsonData: false,
    };
  }

  let workingText = rawText;
  let toolHeaderPrefix = '';

  if (role === 'tool') {
    const toolCallHeaderMatch = workingText.match(
      /^\[([^|\]]+?)(?:\s*\|\s*call_id=([^\]]+))?\]:\s*/
    );
    if (toolCallHeaderMatch) {
      const toolName = toolCallHeaderMatch[1].trim();
      const callId = (toolCallHeaderMatch[2] || '').trim();
      toolHeaderPrefix = `🔧 **Gönderilen MCP Araç Yanıtı (\`${toolName}\`${callId ? ` · \`${callId}\`` : ''}):**\n\n`;
      workingText = workingText.slice(toolCallHeaderMatch[0].length);
    } else if (!workingText.startsWith('🔧')) {
      toolHeaderPrefix = '🔧 **Gönderilen MCP Araç Yanıtı (Tool Execution Result):**\n\n';
    }
  }

  const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const parts: string[] = [];
  let lastIdx = 0;
  let hasJsonData = false;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(workingText)) !== null) {
    if (match.index > lastIdx) {
      const outside = workingText.slice(lastIdx, match.index);
      const { formatted, extractedCount } = formatUnfencedJsonInSegment(outside);
      if (extractedCount > 0) hasJsonData = true;
      if (formatted) parts.push(formatted);
    }

    const fenceLang = (match[1] || '').trim().toLowerCase();
    const fenceBody = (match[2] || '').trim();
    const parsedFenceJson =
      fenceLang === 'json' || fenceLang === ''
        ? safeParseJson<any>(fenceBody)
        : null;

    if (parsedFenceJson !== null && typeof parsedFenceJson === 'object') {
      hasJsonData = true;
      const pretty = JSON.stringify(parsedFenceJson, null, 2);
      const byteLen = getUtf8ByteLength(fenceBody);
      const shapeDesc = describeJsonShape(parsedFenceJson);
      const prevPart = parts.length > 0 ? parts[parts.length - 1] : '';
      const alreadyLabeled = prevPart.includes('📦 **Gönderilen JSON Verisi');
      parts.push(
        `${alreadyLabeled ? '' : `📦 **Gönderilen JSON Verisi (${shapeDesc} · ${byteLen} bayt):**\n`}\`\`\`json\n${pretty}\n\`\`\``
      );
    } else {
      parts.push(match[0]);
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < workingText.length) {
    const tail = workingText.slice(lastIdx);
    const { formatted, extractedCount } = formatUnfencedJsonInSegment(tail);
    if (extractedCount > 0) hasJsonData = true;
    if (formatted) parts.push(formatted);
  }

  const joined = parts.join('\n\n').trim();
  return {
    formattedMarkdown: `${toolHeaderPrefix}${joined}`.trim(),
    hasJsonData,
  };
}

function formatOutgoingMessageWithFullTrace(
  record: ConversationMessageRecordDTO,
  conversationSystemPrompt = '',
  showFullTrace = true
): {
  visibleContent: string;
  thinkingSummary: string;
} {
  const rawRecordContent = record.content || '';
  const baseText = stripUiTraceBlocksFromText(rawRecordContent);
  const { formattedMarkdown } = formatOutgoingJsonContent(baseText, record.role);

  const rawPayload = safeParseJson<Record<string, any>>(record.raw_payload_json);
  const effectiveSysPrompt =
    (rawPayload?.system_prompt as string) || conversationSystemPrompt || '';
  const toolsList: any[] = Array.isArray(rawPayload?.tools)
    ? rawPayload.tools
    : safeParseJson<any[]>(record.tool_calls_json) || [];
  const rawAttachments: any[] = Array.isArray(rawPayload?.attachments)
    ? rawPayload.attachments
    : [];
  const payloadAttachments: any[] =
    record.attachments && record.attachments.length > 0
      ? record.attachments.map((att, idx) => ({
        ...(rawAttachments[idx] || {}),
        ...att,
      }))
      : rawAttachments;
  const charLen = baseText.length;
  const byteLen = getUtf8ByteLength(baseText);

  const outgoingSections: string[] = [formattedMarkdown];

  if (showFullTrace) {
    const responseFormat = rawPayload?.response_format;
    if (
      responseFormat &&
      typeof responseFormat === 'object' &&
      responseFormat.type &&
      responseFormat.type !== 'text'
    ) {
      outgoingSections.push(
        `---\n📐 **Gönderilen Yanıt JSON Şeması (\`response_format\`):**\n\`\`\`json\n${JSON.stringify(responseFormat, null, 2)}\n\`\`\``
      );
    }

    if (toolsList && toolsList.length > 0 && record.role === 'user') {
      outgoingSections.push(
        `---\n🛠️ **LLM'e Gönderilen MCP Araç & JSON Şemaları (\`tools\` — ${toolsList.length} adet):**\n\`\`\`json\n${JSON.stringify(toolsList, null, 2)}\n\`\`\``
      );
    }
  }

  const visibleContent = outgoingSections.filter(Boolean).join('\n\n');

  const lines: string[] = [];
  lines.push(
    `📤 [LLM'E GİDEN TAM İLETİŞİM RAPORU | Rol: ${record.role.toUpperCase()} | Model: ${record.model_id}]`
  );
  lines.push(
    `• İstek ID: ${record.request_id || '—'} | Kaynak: ${(rawPayload?.source || 'studio').toUpperCase()} | Sağlayıcı: ${record.provider || rawPayload?.provider || 'gateway'}`
  );
  lines.push(
    `• Boyut & Token: ${charLen} karakter (${byteLen} bayt) | Girdi Token: ${record.prompt_tokens || rawPayload?.prompt_tokens || 0} tok`
  );

  if (rawPayload) {
    const rfStr = rawPayload.response_format
      ? JSON.stringify(rawPayload.response_format)
      : 'text';
    lines.push(
      `• İstek Parametreleri: stream=${String(rawPayload.stream ?? true)} | temperature=${String(rawPayload.temperature ?? 'varsayılan')} | max_tokens=${String(rawPayload.max_tokens ?? 'varsayılan')} | response_format=${rfStr}`
    );
  }

  if (effectiveSysPrompt) {
    lines.push(
      `• Sistem Yönergesi (System Prompt — ${effectiveSysPrompt.length} karakter):\n${effectiveSysPrompt}`
    );
  }

  if (payloadAttachments && payloadAttachments.length > 0) {
    lines.push(`• Ekli Dosyalar (${payloadAttachments.length} adet):`);
    payloadAttachments.forEach((att: any, idx: number) => {
      const fName = att.file_name || att.name || `dosya_${idx + 1}`;
      const fKind = att.file_kind || att.kind || 'document';
      const fSize = att.file_size || att.size || 0;
      const fTokens = att.estimated_tokens || att.estimatedTokens || 0;
      const extText = typeof att.extracted_text === 'string' ? att.extracted_text.trim() : '';
      const extChars = Number(att.extracted_chars || extText.length || 0);
      lines.push(
        `  ${idx + 1}) 📎 ${fName} (${fKind}, ${fSize} bayt, Çıkarılan Metin=${extChars} krk, ~${fTokens} token)`
      );
      if (showFullTrace && extText) {
        lines.push(`     [LLM'e Aktarılan Belge Metni (${extChars} krk)]:\n${extText}`);
      }
    });
  }

  if (toolsList && toolsList.length > 0) {
    lines.push(
      `• LLM'e Gönderilen Araç Tanımları (Tools — ${toolsList.length} adet | tool_choice=${JSON.stringify(rawPayload?.tool_choice ?? 'auto')}):`
    );
    toolsList.forEach((tObj: any, idx: number) => {
      const fn = tObj?.function || tObj || {};
      const fnName = fn.name || `tool_${idx + 1}`;
      const fnDesc = fn.description || '';
      const fnParams = fn.parameters ? JSON.stringify(fn.parameters, null, 2) : '{}';
      lines.push(`  ${idx + 1}) ${fnName}: ${fnDesc}\n     Şema:\n${fnParams}`);
    });
  }

  return {
    visibleContent,
    thinkingSummary: lines.join('\n'),
  };
}

function expandToolCallsForDisplay(toolCalls: any[] | null | undefined): any[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((tc) => {
    if (!tc || typeof tc !== 'object') return tc;
    const copy = { ...tc };
    if (copy.function && typeof copy.function === 'object') {
      const fnCopy = { ...copy.function };
      if (typeof fnCopy.arguments === 'string' && fnCopy.arguments.trim()) {
        const parsedArgs = safeParseJson<any>(fnCopy.arguments);
        if (parsedArgs !== null) {
          fnCopy.arguments = parsedArgs;
        }
      }
      copy.function = fnCopy;
    }
    return copy;
  });
}

function formatAssistantMessageWithFullTrace(
  record: ConversationMessageRecordDTO,
  showFullTrace = true
): {
  visibleContent: string;
  cleanContentForHistory: string;
  thinkingSummary: string;
} {
  const rawRecordContent = record.content || '';
  const rawContent = stripUiTraceBlocksFromText(rawRecordContent);
  const { thinkingText: tagThoughts, cleanText } = extractThinkBlocksFromText(rawContent);
  const rawPayload = safeParseJson<Record<string, any>>(record.raw_payload_json);

  // Düşünce metnini hem <think> etiketlerinden hem rawPayload.thinking_content'ten hem de record.thinking_content'ten topla
  let extractedThought = (rawPayload?.thinking_content as string) || '';
  if (!extractedThought && record.thinking_content) {
    const m = record.thinking_content.match(
      /🧠 \[LLM DÜŞÜNCE SÜRECİ[^\]]*\]\n([\s\S]*?)(?:\n---\n|$)/
    );
    if (m && m[1]) {
      extractedThought = m[1].trim();
    }
  }
  if (tagThoughts && !extractedThought.includes(tagThoughts)) {
    extractedThought = extractedThought
      ? `${extractedThought}\n\n${tagThoughts}`
      : tagThoughts;
  }

  const parsedToolCalls =
    safeParseJson<any[]>(record.tool_calls_json) ||
    (Array.isArray(rawPayload?.tool_calls) && rawPayload.tool_calls.length > 0
      ? rawPayload.tool_calls
      : null);
  const expandedToolCalls = expandToolCallsForDisplay(parsedToolCalls);

  let cleanAnswer =
    cleanText ||
    rawContent ||
    (typeof rawPayload?.normalized_output === 'string' ? rawPayload.normalized_output : '');

  if (
    expandedToolCalls.length > 0 &&
    cleanAnswer.trimStart().startsWith('[Araç Çağrısı:')
  ) {
    const callNames = expandedToolCalls
      .map((tc) => tc?.function?.name || 'tool')
      .join(', ');
    cleanAnswer = `🔧 **Tetiklenen Araç Çağrısı (\`${callNames}\`):**\n\`\`\`json\n${JSON.stringify(expandedToolCalls, null, 2)}\n\`\`\``;
  }

  const fullThinkingAccordion =
    record.thinking_content ||
    (extractedThought
      ? `🧠 [LLM DÜŞÜNCE SÜRECİ]\n${extractedThought}`
      : `📥 [GELEN LLM YANITI] Model: ${record.model_id} | Token: ${record.total_tokens} | Süre: ${record.latency_ms} ms`);

  if (!showFullTrace) {
    return {
      visibleContent: cleanAnswer,
      cleanContentForHistory: cleanAnswer,
      thinkingSummary: fullThinkingAccordion,
    };
  }

  if (rawRecordContent.includes('📥 **Gelen LLM İletişim Raporu:**')) {
    return {
      visibleContent: rawRecordContent,
      cleanContentForHistory: cleanAnswer,
      thinkingSummary: fullThinkingAccordion,
    };
  }

  const sections: string[] = [];

  // 1. LLM Düşünce & İçsel Muhakeme Bölümü (Ayrı ve görünür blok)
  if (extractedThought) {
    sections.push(
      `> 🧠 **LLM Düşünce & İçsel Muhakeme Süreci (Chain-of-Thought):**\n\`\`\`text\n${extractedThought}\n\`\`\``
    );
  } else {
    sections.push(
      `> 🧠 **LLM Düşünce & Karar Süreci:**\n> Model (\`${record.model_id}\` · \`${record.provider || 'gateway'}\`) gelen istemi değerlendirerek **${record.ttft_ms || record.latency_ms || 0} ms** içinde ilk token'ı üretti ve toplam **${record.latency_ms || 0} ms** sürede **${getUtf8ByteLength(cleanAnswer)} bayt (${cleanAnswer.length} karakter)** uzunluğunda yanıt döndürdü.`
    );
  }

  // 2. Asıl LLM Yanıtı (Tek bir nokta bile olsa tam gösterim)
  if (cleanAnswer) {
    sections.push(cleanAnswer);
  } else {
    sections.push('*(Boş metin yanıtı — 0 karakter)*');
  }

  // 3. Araç Çağrıları (tool_calls) varsa ve cleanAnswer içinde henüz kod bloğu olarak yoksa ekle
  if (
    expandedToolCalls.length > 0 &&
    !cleanAnswer.includes('```json')
  ) {
    sections.push(
      `🔧 **Tetiklenen Araç Çağrıları (\`tool_calls\` — ${expandedToolCalls.length} adet):**\n\`\`\`json\n${JSON.stringify(expandedToolCalls, null, 2)}\n\`\`\``
    );
  }

  // 4. Ham (Filtrelenmemiş) Çıktı farklıysa (ör. JSON normalize edilmişse) onu da raporla
  const rawUnfiltered = (rawPayload?.raw_unfiltered_output as string) || '';
  if (
    rawUnfiltered &&
    !rawUnfiltered.trimStart().startsWith('[Araç Çağrısı:') &&
    rawUnfiltered.trim() !== cleanAnswer.trim() &&
    rawUnfiltered.trim() !== rawContent.trim()
  ) {
    sections.push(
      `📦 **Modelin Ham (Filtrelenmemiş / Normalize Edilmemiş) Çıktısı (${rawUnfiltered.length} krk):**\n\`\`\`text\n${rawUnfiltered}\n\`\`\``
    );
  }

  // 5. Gelen İletişim & Telemetri Alt Raporu
  const charLen = cleanAnswer.length;
  const byteLen = getUtf8ByteLength(cleanAnswer);
  const sessionId = rawPayload?.session_id || '—';
  const reqId = record.request_id || rawPayload?.request_id || '—';
  const streamLabel =
    rawPayload?.is_stream === false ? 'Senkron JSON' : 'SSE Gerçek Zamanlı Akış';
  const responseTypeDesc =
    expandedToolCalls.length > 0
      ? `MCP Araç Çağrısı (\`${expandedToolCalls.map((tc) => tc?.function?.name || 'tool').join(', ')}\`)`
      : 'Metin / JSON Yanıtı';

  const incomingReportPayload: Record<string, any> = {
    request_id: reqId,
    model: record.model_id,
    provider: record.provider || rawPayload?.provider || 'gateway',
    session_id: sessionId,
    mode: streamLabel,
    status: record.status || 'success',
    metrics: {
      prompt_tokens: record.prompt_tokens,
      completion_tokens: record.completion_tokens,
      total_tokens: record.total_tokens,
      ttft_ms: record.ttft_ms || 0,
      latency_ms: record.latency_ms || 0,
      char_length: charLen,
      byte_length: byteLen,
    },
  };
  if (extractedThought) {
    incomingReportPayload.thinking_content = extractedThought;
  }
  if (rawUnfiltered && !rawUnfiltered.trimStart().startsWith('[Araç Çağrısı:')) {
    incomingReportPayload.raw_output = safeParseJson<any>(rawUnfiltered) ?? rawUnfiltered;
  } else if (
    cleanAnswer &&
    !cleanAnswer.trimStart().startsWith('🔧') &&
    !cleanAnswer.trimStart().startsWith('[Araç Çağrısı:')
  ) {
    incomingReportPayload.content = safeParseJson<any>(cleanAnswer) ?? cleanAnswer;
  }
  if (expandedToolCalls.length > 0) {
    incomingReportPayload.tool_calls = expandedToolCalls;
  }
  if (record.error_detail) {
    incomingReportPayload.error_detail = record.error_detail;
  }

  sections.push(
    `📥 **Gelen LLM İletişim Raporu:**\n` +
    `- **İstek & Oturum:** \`İstek ID: ${reqId}\` · \`Oturum: ${sessionId}\` · \`Sağlayıcı: ${record.provider || 'gateway'}\` · \`Mod: ${streamLabel}\`\n` +
    `- **Yanıt Türü & Boyut:** ${responseTypeDesc} · \`${charLen} krk (${byteLen} bayt)\` · \`Durum: ${record.status || 'success'}\`\n` +
    `- **Token & Performans:** \`Girdi: ${record.prompt_tokens} tok\` · \`Çıktı: ${record.completion_tokens} tok\` · \`Toplam: ${record.total_tokens} tok\` · \`TTFT: ${record.ttft_ms || 0} ms\` · \`Toplam Süre: ${record.latency_ms || 0} ms\`${record.error_detail ? `\n- **Hata Detayı:** \`${record.error_detail}\`` : ''}\n` +
    `\`\`\`json\n${JSON.stringify(incomingReportPayload, null, 2)}\n\`\`\``
  );

  return {
    visibleContent: sections.join('\n\n'),
    cleanContentForHistory: cleanAnswer,
    thinkingSummary: fullThinkingAccordion,
  };
}

function mapRecordToBaseChatMessage(
  record: ConversationMessageRecordDTO,
  conversationSystemPrompt = '',
  showFullTrace = true
): ChatMessage {
  const mappedRole: ChatMessage['role'] =
    record.role === 'assistant'
      ? 'assistant'
      : record.role === 'system'
        ? 'system'
        : record.status === 'error'
          ? 'error'
          : 'user';

  if (mappedRole === 'assistant') {
    const { visibleContent, cleanContentForHistory, thinkingSummary } =
      formatAssistantMessageWithFullTrace(record, showFullTrace);
    return {
      id: record.id,
      role: mappedRole,
      content: visibleContent,
      thinkingContent: thinkingSummary,
      timestamp: record.created_at || new Date().toISOString(),
      model: record.model_id,
      provider: record.provider || 'Web AI Gateway',
      agentName: record.model_id || 'AI Asistan',
      isError: record.status === 'error',
      promptTokens: record.prompt_tokens > 0 ? record.prompt_tokens : undefined,
      completionTokens: record.completion_tokens > 0 ? record.completion_tokens : undefined,
      totalTokens: record.total_tokens > 0 ? record.total_tokens : undefined,
      latencyMs: record.latency_ms > 0 ? record.latency_ms : undefined,
      ttftMs: record.ttft_ms > 0 ? record.ttft_ms : undefined,
      customData: {
        rawCleanContent: cleanContentForHistory,
        rawRecord: record,
      },
    };
  }

  const {
    visibleContent: formattedUserOrToolContent,
    thinkingSummary: outgoingThinkingSummary,
  } = formatOutgoingMessageWithFullTrace(record, conversationSystemPrompt, showFullTrace);

  const rawPayloadObj = safeParseJson<Record<string, any>>(record.raw_payload_json);
  const rawPayloadAttachments: any[] = Array.isArray(rawPayloadObj?.attachments)
    ? rawPayloadObj!.attachments
    : [];

  const mergedAttachments: ChatAttachmentDTO[] =
    record.attachments && record.attachments.length > 0
      ? record.attachments.map((att, idx) => {
        const rawAtt =
          rawPayloadAttachments.find((ra) => ra?.file_name === att.file_name) ||
          rawPayloadAttachments[idx] ||
          {};
        return {
          id: att.id,
          name: att.file_name,
          size: att.file_size,
          mimeType: att.mime_type || rawAtt.mime_type || 'application/octet-stream',
          kind:
            (att.file_kind || rawAtt.file_kind) === 'image' ||
            (att.mime_type || '').startsWith('image/')
              ? 'image'
              : 'document',
          extractedText:
            typeof rawAtt.extracted_text === 'string' ? rawAtt.extracted_text : undefined,
          estimatedTokens: Number(
            att.estimated_tokens || rawAtt.estimated_tokens || 0
          ),
        };
      })
      : rawPayloadAttachments.map((rawAtt, idx) => ({
        id: String(rawAtt.id || `att_${record.id}_${idx}`),
        name: String(rawAtt.file_name || rawAtt.name || `dosya_${idx + 1}`),
        size: Number(rawAtt.file_size || rawAtt.size || 0),
        mimeType: String(rawAtt.mime_type || 'application/octet-stream'),
        kind:
          rawAtt.file_kind === 'image' ||
          String(rawAtt.mime_type || '').startsWith('image/')
            ? 'image'
            : 'document',
        extractedText:
          typeof rawAtt.extracted_text === 'string' ? rawAtt.extracted_text : undefined,
        estimatedTokens: Number(rawAtt.estimated_tokens || 0),
      }));

  return {
    id: record.id,
    role: mappedRole,
    content: formattedUserOrToolContent,
    thinkingContent: outgoingThinkingSummary || record.thinking_content || undefined,
    timestamp: record.created_at || new Date().toISOString(),
    model: record.model_id,
    provider: record.provider || 'Web AI Gateway',
    agentName:
      record.role === 'tool'
        ? `Araç Yanıtı (${record.model_id})`
        : record.user_full_name || 'Kullanıcı',
    isError: record.status === 'error',
    promptTokens: record.prompt_tokens > 0 ? record.prompt_tokens : undefined,
    completionTokens: record.completion_tokens > 0 ? record.completion_tokens : undefined,
    totalTokens: record.total_tokens > 0 ? record.total_tokens : undefined,
    latencyMs: record.latency_ms > 0 ? record.latency_ms : undefined,
    ttftMs: record.ttft_ms > 0 ? record.ttft_ms : undefined,
    attachments:
      mergedAttachments.length > 0
        ? mergedAttachments.map((att) => ({
          id: att.id,
          name: att.name,
          size: att.size,
          type: att.mimeType,
          extractedText: att.extractedText,
          estimatedTokens: att.estimatedTokens,
        }))
        : undefined,
    customData: {
      rawCleanContent: stripUiTraceBlocksFromText(record.content || ''),
      rawRecord: record,
      parsedAttachments: mergedAttachments.length > 0 ? mergedAttachments : undefined,
    },
  };
}

function mapSummaryToChatSession(
  summary: ConversationSummaryDTO,
  messages: ChatMessage[] = []
): ChatSession {
  return {
    id: summary.id,
    title: summary.title || 'Yeni Sohbet',
    createdAt: summary.created_at,
    updatedAt: summary.updated_at,
    messages,
    agentId: summary.model_id,
    modelId: summary.model_id,
    pinned: summary.is_pinned,
  };
}

function computeConversationsSignature(items: ConversationSummaryDTO[]): string {
  return items
    .map(
      (i) =>
        `${i.id}:${i.updated_at}:${i.total_messages}:${i.total_tokens}:${i.is_pinned ? 1 : 0}:${i.is_archived ? 1 : 0}:${i.is_deleted ? 1 : 0}:${i.title}:${i.last_message_preview || ''}`
    )
    .join('|');
}

export const ChatStudioView: React.FC<ChatStudioViewProps> = ({
  models = [],
  users = [],
  apiKeys = [],
  selectedModelId,
  onSelectModel,
  apiKey,
  onChangeApiKey,
  isGenerating,
  setIsGenerating,
  onRefreshState,
  onShowToast,
}) => {
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'tr-TR';

  // Görünüm modu: 'list' (BaseListPage) veya 'chat' (BaseChatPage)
  const [viewMode, setViewMode] = useState<'list' | 'chat'>('list');
  const [listViewMode, setListViewMode] = useState<'active' | 'archive' | 'trash'>('active');

  // Aktif oturum açan kullanıcı (Varsayılan: API anahtarının sahibi veya sys_usr_01)
  const initialUserId = useMemo(() => {
    const matchedKey = apiKeys.find(
      (k) => k.raw_preview && k.raw_preview.trim() === apiKey.trim()
    );
    if (matchedKey) return matchedKey.user_id;
    return users[0]?.id || 'sys_usr_01';
  }, [apiKeys, apiKey, users]);

  const [activeUserId, setActiveUserId] = useState<string>(initialUserId);
  const [adminSelectedUserFilter, setAdminSelectedUserFilter] = useState<string>('all');
  const [refreshCounter, setRefreshCounter] = useState<number>(0);

  // BaseChatPage oturum, model ve sistem yönergesi durumu
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | number>('');
  const [chatModelId, setChatModelId] = useState<string>(
    selectedModelId || models[0]?.id || 'gpt-4o'
  );
  const [chatSystemPrompt, setChatSystemPrompt] = useState<string>('');
  const stopRequestedRef = useRef<boolean>(false);

  // Seçilen sohbetin mesaj detaylarını hızlı görmek için Popup durumu
  const [detailModalOpen, setDetailModalOpen] = useState<boolean>(false);
  const [selectedDetail, setSelectedDetail] = useState<ConversationDetailDTO | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);

  // Sohbet sayfasında tam LLM iletişim ve düşünce raporu görünürlüğü (Varsayılan: Açık)
  const [showFullTrace, setShowFullTrace] = useState<boolean>(true);
  const [rawInspectorOpen, setRawInspectorOpen] = useState<boolean>(false);
  const [activeDetailForInspector, setActiveDetailForInspector] =
    useState<ConversationDetailDTO | null>(null);

  const handleToggleFullTrace = useCallback(() => {
    setShowFullTrace((prev) => {
      const next = !prev;
      setChatSessions((sessions) =>
        sessions.map((s) => ({
          ...s,
          messages: s.messages.map((m) => {
            const rawRec = m.customData?.rawRecord as
              | ConversationMessageRecordDTO
              | undefined;
            if (!rawRec) return m;
            return mapRecordToBaseChatMessage(rawRec, chatSystemPrompt, next);
          }),
        }))
      );
      return next;
    });
  }, [chatSystemPrompt]);

  const currentUser = useMemo(
    () => users.find((u) => u.id === activeUserId) || users[0],
    [users, activeUserId]
  );

  const isAdmin =
    currentUser?.role === 'admin' ||
    currentUser?.role === 'Sistem Yöneticisi';

  const authOptions = useMemo(
    () => ({
      requesterUserId: currentUser?.id || activeUserId,
      apiKey,
    }),
    [currentUser, activeUserId, apiKey]
  );

  // Sistemdeki AI modellerini BaseChatPage'in ChatAgent formatına dönüştür
  const chatAgents: ChatAgent[] = useMemo(() => {
    if (!models || models.length === 0) {
      return [
        {
          id: 'gpt-4o',
          ad: 'GPT-4o',
          rol: 'OpenAI',
          modelAdi: 'gpt-4o',
          saglayiciTuruAdi: 'chatgpt-web',
          isLocal: false,
        },
      ];
    }
    return models.map((m) => ({
      id: m.id,
      ad: m.name.replace(/\s*\(Web Gateway\)\s*/i, '').trim(),
      rol: m.vendor,
      modelAdi: m.id,
      saglayiciTuruAdi: m.provider,
      aciklama: m.description,
      isLocal: Boolean(
        m.is_local ||
        m.provider?.toLowerCase().includes('local') ||
        m.provider?.toLowerCase().includes('ollama') ||
        m.vendor?.toLowerCase().includes('ollama')
      ),
    }));
  }, [models]);

  // Aktif sohbet oturumunun mesaj listesi
  const activeChatMessages = useMemo(() => {
    const found =
      chatSessions.find((s) => String(s.id) === String(activeChatSessionId)) ||
      chatSessions[0];
    return found?.messages || [];
  }, [chatSessions, activeChatSessionId]);

  // Aktif kullanıcı değiştiğinde ilgili kullanıcının API anahtarını da senkronize et ve listeyi yenile
  const handleSwitchActiveUser = useCallback(
    (newUserId: string) => {
      setActiveUserId(newUserId);
      setAdminSelectedUserFilter('all');
      const userKey = apiKeys.find((k) => k.user_id === newUserId && k.raw_preview);
      if (userKey?.raw_preview) {
        onChangeApiKey(userKey.raw_preview);
      }
      setRefreshCounter((prev) => prev + 1);
    },
    [apiKeys, onChangeApiKey]
  );

  // Kullanıcının mevcut sohbet listesini BaseChatPage yan menüsü için yükler
  const loadSidebarSessionsForChat = useCallback(async (): Promise<ChatSession[]> => {
    try {
      const summaries = await conversationService.listConversations(
        {
          userId: isAdmin ? adminSelectedUserFilter : currentUser?.id,
          source: 'all',
          page: 1,
          pageSize: 50,
        },
        authOptions
      );
      return summaries.map((s) => mapSummaryToChatSession(s, []));
    } catch {
      return [];
    }
  }, [isAdmin, adminSelectedUserFilter, currentUser, authOptions]);

  // "Ekle" (Yeni Sohbet) düğmesine tıklandığında BaseChatPage ekranını yeni bir oturumla açar
  const handleOpenNewChatPage = useCallback(async () => {
    const defaultModel = selectedModelId || models[0]?.id || 'gpt-4o';
    setChatModelId(defaultModel);
    setChatSystemPrompt('');

    const newTempId = `new_${Date.now()}`;
    const freshSession: ChatSession = {
      id: newTempId,
      title: 'Yeni Sohbet',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      agentId: defaultModel,
      modelId: defaultModel,
    };

    setChatSessions((prev) => [
      freshSession,
      ...prev.filter((s) => !String(s.id).startsWith('new_')),
    ]);
    setActiveChatSessionId(newTempId);
    setViewMode('chat');
    navigate('/chat/new');

    const existingSessions = await loadSidebarSessionsForChat();
    setChatSessions((prev) => {
      const existingFiltered = existingSessions.filter(
        (es) => !prev.some((ps) => String(ps.id) === String(es.id))
      );
      return prev.length > 0
        ? [...prev, ...existingFiltered]
        : [freshSession, ...existingFiltered];
    });
  }, [selectedModelId, models, loadSidebarSessionsForChat, navigate]);

  // "Düzenle" seçeneğine tıklandığında seçili sohbeti mesaj geçmişiyle birlikte BaseChatPage'de açar
  const handleOpenEditChatPage = useCallback(
    async (conv: ConversationSummaryDTO) => {
      try {
        const [existingSessions, detail] = await Promise.all([
          loadSidebarSessionsForChat(),
          conversationService.getConversationDetail(conv.id, authOptions),
        ]);

        setActiveDetailForInspector(detail);
        const mappedMessages = (detail.messages || []).map((rec) =>
          mapRecordToBaseChatMessage(rec, detail.system_prompt, showFullTrace)
        );
        const targetModel = detail.model_id || selectedModelId || models[0]?.id || 'gpt-4o';
        setChatModelId(targetModel);
        setChatSystemPrompt(detail.system_prompt || '');
        onSelectModel(targetModel);

        const detailedSession: ChatSession = mapSummaryToChatSession(detail, mappedMessages);

        const mergedSessions = existingSessions.some((s) => String(s.id) === String(detail.id))
          ? existingSessions.map((s) =>
            String(s.id) === String(detail.id) ? detailedSession : s
          )
          : [detailedSession, ...existingSessions];

        setChatSessions(mergedSessions);
        setActiveChatSessionId(detail.id);
        setViewMode('chat');
        navigate(`/chat/${detail.id}`);
      } catch (err) {
        onShowToast(
          err instanceof Error ? err.message : 'Sohbet oturumu yüklenirken hata oluştu.'
        );
      }
    },
    [loadSidebarSessionsForChat, authOptions, selectedModelId, models, onSelectModel, onShowToast, navigate, showFullTrace]
  );

  // BaseChatPage içerisinden listeye geri dönüş
  const handleBackToList = useCallback(async () => {
    setViewMode('list');
    navigate('/chat');
    setRefreshCounter((prev) => prev + 1);
    await onRefreshState();
  }, [onRefreshState, navigate]);

  // Sol menüden "/chat" adresine tıklandığında veya tarayıcı geri tuşuna basıldığında görünümü senkronize et
  useEffect(() => {
    if (location.pathname === '/chat' && viewMode === 'chat') {
      setViewMode('list');
    } else if (location.pathname === '/chat/new' && viewMode === 'list') {
      handleOpenNewChatPage();
    } else if (location.pathname.startsWith('/chat/') && location.pathname !== '/chat/new' && viewMode === 'list') {
      const targetConvId = decodeURIComponent(location.pathname.slice('/chat/'.length));
      if (targetConvId) {
        handleOpenEditChatPage({
          id: targetConvId,
          user_id: currentUser?.id || activeUserId,
          user_email: currentUser?.email || '',
          user_full_name: currentUser?.full_name || '',
          title: 'Sohbet',
          model_id: selectedModelId || models[0]?.id || 'gpt-4o',
          source: 'studio',
          is_pinned: false,
          is_archived: false,
          total_messages: 0,
          total_tokens: 0,
          system_prompt: '',
          attachment_names: [],
          last_message_preview: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // BaseChatPage yan menüsünden farklı bir sohbet oturumu seçildiğinde mesajlarını yükle
  const handleChatSessionChange = useCallback(
    async (session: ChatSession) => {
      setActiveChatSessionId(session.id);
      if (session.agentId) {
        setChatModelId(String(session.agentId));
        onSelectModel(String(session.agentId));
      }

      if (String(session.id).startsWith('new_')) {
        setChatSystemPrompt('');
        navigate('/chat/new');
        return;
      }

      navigate(`/chat/${session.id}`);

      try {
        const detail = await conversationService.getConversationDetail(
          String(session.id),
          authOptions
        );
        setActiveDetailForInspector(detail);
        const mappedMessages = (detail.messages || []).map((rec) =>
          mapRecordToBaseChatMessage(rec, detail.system_prompt, showFullTrace)
        );
        setChatSystemPrompt(detail.system_prompt || '');
        if (detail.model_id) {
          setChatModelId(detail.model_id);
          onSelectModel(detail.model_id);
        }
        setChatSessions((prev) =>
          prev.map((s) =>
            String(s.id) === String(detail.id)
              ? mapSummaryToChatSession(detail, mappedMessages)
              : s
          )
        );
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Sohbet geçmişi yüklenemedi.');
      }
    },
    [authOptions, onSelectModel, onShowToast, navigate, showFullTrace]
  );

  // BaseChatPage içindeki "Yeni" butonuna basıldığında yeni taslak oturum oluştur
  const handleChatNewSession = useCallback(() => {
    const existingNew = chatSessions.find(
      (s) => String(s.id).startsWith('new_') && s.messages.length === 0
    );
    if (existingNew) {
      setActiveChatSessionId(existingNew.id);
      setChatSystemPrompt('');
      navigate('/chat/new');
      return;
    }

    const newTempId = `new_${Date.now()}`;
    const freshSession: ChatSession = {
      id: newTempId,
      title: 'Yeni Sohbet',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      agentId: chatModelId,
      modelId: chatModelId,
    };
    setChatSessions((prev) => [freshSession, ...prev]);
    setActiveChatSessionId(newTempId);
    setChatSystemPrompt('');
    navigate('/chat/new');
  }, [chatSessions, chatModelId, navigate]);

  // BaseChatPage içinden oturum başlığı değiştirildiğinde SQLite'ı güncelle
  const handleChatRenameSession = useCallback(
    async (sessionId: string | number, newTitle: string) => {
      setChatSessions((prev) =>
        prev.map((s) =>
          String(s.id) === String(sessionId)
            ? { ...s, title: newTitle, updatedAt: new Date().toISOString() }
            : s
        )
      );

      if (!String(sessionId).startsWith('new_')) {
        try {
          await conversationService.updateConversation(
            String(sessionId),
            { title: newTitle },
            authOptions
          );
        } catch (err) {
          onShowToast(err instanceof Error ? err.message : 'Başlık güncellenemedi.');
        }
      }
    },
    [authOptions, onShowToast]
  );

  // BaseChatPage yan menüsünden oturum sabitleme (Pin) durumu değiştirildiğinde SQLite'ı güncelle
  const handleChatPinSession = useCallback(
    async (sessionId: string | number, pinned: boolean) => {
      setChatSessions((prev) =>
        prev.map((s) =>
          String(s.id) === String(sessionId)
            ? { ...s, pinned, updatedAt: new Date().toISOString() }
            : s
        )
      );

      if (!String(sessionId).startsWith('new_')) {
        try {
          await conversationService.updateConversation(
            String(sessionId),
            { is_pinned: pinned },
            authOptions
          );
        } catch (err) {
          onShowToast(err instanceof Error ? err.message : 'Sabitleme durumu güncellenemedi.');
        }
      }
    },
    [authOptions, onShowToast]
  );

  // BaseChatPage içinden oturum silindiğinde SQLite'tan sil
  const handleChatDeleteSession = useCallback(
    async (sessionId: string | number) => {
      if (!String(sessionId).startsWith('new_')) {
        try {
          await conversationService.deleteConversation(String(sessionId), authOptions);
          await onRefreshState();
        } catch (err) {
          onShowToast(err instanceof Error ? err.message : 'Sohbet silinemedi.');
          return;
        }
      }

      setChatSessions((prev) => {
        const remaining = prev.filter((s) => String(s.id) !== String(sessionId));
        if (remaining.length === 0) {
          const fallbackId = `new_${Date.now()}`;
          const fresh: ChatSession = {
            id: fallbackId,
            title: 'Yeni Sohbet',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            agentId: chatModelId,
            modelId: chatModelId,
          };
          setActiveChatSessionId(fallbackId);
          return [fresh];
        }
        if (String(activeChatSessionId) === String(sessionId)) {
          setActiveChatSessionId(remaining[0].id);
        }
        return remaining;
      });
    },
    [authOptions, onRefreshState, onShowToast, chatModelId, activeChatSessionId]
  );

  // BaseChatPage içinde "Sohbeti Temizle" seçildiğinde
  const handleChatClearMessages = useCallback(
    async (sessionId: string | number) => {
      if (!String(sessionId).startsWith('new_')) {
        try {
          await conversationService.deleteConversation(String(sessionId), authOptions);
          await onRefreshState();
        } catch {
          // Sessizce geç
        }
      }

      const freshTempId = `new_${Date.now()}`;
      setChatSessions((prev) =>
        prev.map((s) =>
          String(s.id) === String(sessionId)
            ? {
              ...s,
              id: freshTempId,
              title: 'Yeni Sohbet',
              messages: [],
              updatedAt: new Date().toISOString(),
            }
            : s
        )
      );
      setActiveChatSessionId(freshTempId);
    },
    [authOptions, onRefreshState]
  );

  // BaseChatPage üst barından model (agent) değiştirildiğinde
  const handleChatAgentChange = useCallback(
    async (agent: ChatAgent) => {
      const nextModelId = String(agent.id);
      setChatModelId(nextModelId);
      onSelectModel(nextModelId);

      if (activeChatSessionId && !String(activeChatSessionId).startsWith('new_')) {
        try {
          await conversationService.updateConversation(
            String(activeChatSessionId),
            { model_id: nextModelId },
            authOptions
          );
        } catch {
          // Sessizce geç
        }
      }
    },
    [activeChatSessionId, authOptions, onSelectModel]
  );

  // BaseChatPage içinden System Prompt değiştirildiğinde
  const handleChatSystemPromptChange = useCallback(
    async (nextPrompt: string) => {
      setChatSystemPrompt(nextPrompt);
      if (activeChatSessionId && !String(activeChatSessionId).startsWith('new_')) {
        try {
          await conversationService.updateConversation(
            String(activeChatSessionId),
            { system_prompt: nextPrompt },
            authOptions
          );
        } catch {
          // Sessizce geç
        }
      }
    },
    [activeChatSessionId, authOptions]
  );

  // Mesaj beğen/beğenme geri bildirimi
  const handleChatMessageFeedback = useCallback(
    (messageId: string | number, feedback: 'like' | 'dislike' | null) => {
      setChatSessions((prev) =>
        prev.map((s) =>
          String(s.id) === String(activeChatSessionId)
            ? {
              ...s,
              messages: s.messages.map((m) =>
                String(m.id) === String(messageId) ? { ...m, feedback } : m
              ),
            }
            : s
        )
      );
    },
    [activeChatSessionId]
  );

  // BaseChatPage üzerinden mesaj ve dosya gönderildiğinde çalıştırılacak ana fonksiyon
  const handleChatSendMessage = useCallback(
    async (
      content: string,
      attachments: ChatAttachment[],
      session?: ChatSession | null
    ) => {
      const requestStartTime = Date.now();
      const rawSessionId = session?.id ?? activeChatSessionId;
      const targetSessionId = rawSessionId || `new_${requestStartTime}`;
      const isNewSession = !rawSessionId || String(targetSessionId).startsWith('new_');
      const activeModel = chatModelId || selectedModelId || models[0]?.id || 'gpt-4o';
      const selectedModelObj = models.find((m) => m.id === activeModel);

      stopRequestedRef.current = false;

      // 1. Kullanıcı mesajını beklemeden (senkron olarak) hemen ekrana aktar ve bekleme durumunu başlat
      const userMsgId = `usr_msg_${requestStartTime}`;
      const assistantMsgId = `ast_msg_${requestStartTime + 1}`;
      const autoTitle =
        content.trim().slice(0, 48) ||
        attachments?.[0]?.name ||
        'Yeni Sohbet';

      const optimisticUserThinking = [
        `📤 [LLM'E GİDEN İSTEK HAZIRLANIYOR | Model: ${activeModel}]`,
        `• Boyut: ${content.length} karakter (${getUtf8ByteLength(content)} bayt)`,
        ...(chatSystemPrompt
          ? [`• Sistem Yönergesi (${chatSystemPrompt.length} krk):\n${chatSystemPrompt}`]
          : []),
        ...(attachments && attachments.length > 0
          ? [
            `• Ekli Dosyalar (${attachments.length} adet): ${attachments.map((a) => `📎 ${a.name}`).join(', ')}`,
          ]
          : []),
      ].join('\n');

      const { formattedMarkdown: optimisticFormattedContent } =
        formatOutgoingJsonContent(content, 'user');

      const optimisticUserMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: optimisticFormattedContent || content,
        thinkingContent: optimisticUserThinking,
        timestamp: new Date().toISOString(),
        attachments: (attachments || []).map((a, idx) => ({
          id: String(a.id || `att_${requestStartTime}_${idx}`),
          name: a.name,
          size: a.size || 0,
          type: a.type || 'application/octet-stream',
        })),
        customData: {
          rawCleanContent: content,
        },
      };

      const existingMessages = session?.messages || activeChatMessages;

      if (!activeChatSessionId) {
        setActiveChatSessionId(targetSessionId);
      }

      setChatSessions((prev) => {
        const hasSession = prev.some((s) => String(s.id) === String(targetSessionId));
        if (!hasSession) {
          const createdSession: ChatSession = {
            id: targetSessionId,
            title: autoTitle,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [...existingMessages, optimisticUserMessage],
            agentId: activeModel,
            modelId: activeModel,
          };
          return [createdSession, ...prev];
        }
        return prev.map((s) => {
          if (String(s.id) === String(targetSessionId)) {
            return {
              ...s,
              title: s.messages.length === 0 ? autoTitle : s.title,
              updatedAt: new Date().toISOString(),
              messages: [...s.messages, optimisticUserMessage],
            };
          }
          return s;
        });
      });

      setIsGenerating(true);

      // 2. Eklenen dosyaları (File) ChatAttachmentDTO formatına dönüştür
      const parsedAttachments: ChatAttachmentDTO[] = [];
      for (const att of attachments || []) {
        if (att.file instanceof File) {
          const dto = await fileParserService.createAttachmentFromFile(att.file);
          parsedAttachments.push(dto);
        } else {
          const anyAtt = att as any;
          parsedAttachments.push({
            id: String(att.id || `att_${Date.now()}`),
            name: att.name,
            size: att.size || 0,
            mimeType: att.type || anyAtt.mimeType || 'application/octet-stream',
            kind:
              anyAtt.kind === 'image' || (att.type || anyAtt.mimeType || '').startsWith('image/')
                ? 'image'
                : 'document',
            base64Data: typeof anyAtt.base64Data === 'string' ? anyAtt.base64Data : undefined,
            extractedText: typeof anyAtt.extractedText === 'string' ? anyAtt.extractedText : undefined,
            estimatedTokens:
              typeof anyAtt.estimatedTokens === 'number' ? anyAtt.estimatedTokens : undefined,
          });
        }
      }

      let dbConversationId = isNewSession ? '' : String(targetSessionId);
      try {
        // 3. Eğer oturum henüz veritabanında yoksa önce ilgili kullanıcı adına oluştur
        if (isNewSession) {
          const createdConv = await conversationService.createConversation(
            {
              title: autoTitle,
              model_id: activeModel,
              system_prompt: chatSystemPrompt,
              source: 'studio',
              user_id: currentUser?.id || activeUserId,
            },
            authOptions
          );
          dbConversationId = createdConv.id;
          // Oturum ID'sini akış başlamadan hemen önce eşitle ki gelen her delta ekranda canlı görünsün
          setActiveChatSessionId(dbConversationId);
          setChatSessions((prev) =>
            prev.map((s) =>
              String(s.id) === String(targetSessionId)
                ? { ...s, id: dbConversationId }
                : s
            )
          );
          navigate(`/chat/${dbConversationId}`, { replace: true });
        }

        // 4. Geçmiş mesajları + yeni kullanıcı mesajını OpenAI API formatına hazırla (customData.rawCleanContent kullanarak temiz içerik gönder)
        const historyForApi: ChatMessageItemDTO[] = [
          ...existingMessages.map((m) => ({
            id: String(m.id),
            role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
            content: String((m.customData?.rawCleanContent as string) ?? m.content ?? ''),
            timestamp: String(m.timestamp || ''),
            attachments: (m.customData?.parsedAttachments as ChatAttachmentDTO[] | undefined),
          })),
          {
            id: userMsgId,
            role: 'user',
            content,
            timestamp: new Date().toISOString(),
            attachments: parsedAttachments,
          },
        ];

        const apiMessages = chatService.buildApiMessages(
          historyForApi,
          chatSystemPrompt,
          false,
          '1024x1024'
        );

        // 5. SSE akışı ile yanıtı, düşünceleri (reasoning) ve araç çağrılarını (tool_calls) canlı al ve mesaj balonunu anlık güncelle
        let streamedText = '';
        let streamedReasoning = '';
        let streamedToolCalls: Record<string, unknown>[] = [];
        let streamedRequestId = '';
        let serverPersistedTurn = false;
        let ttftMs = 0;

        const updateLiveAssistantBubble = () => {
          const {
            thinkingText: tagThoughts,
            cleanText,
            hasUnclosedThink,
          } = extractThinkBlocksFromText(streamedText);

          const sReason = streamedReasoning.trim();
          const tReason = tagThoughts.trim();
          const combinedLiveThoughts =
            sReason && tReason
              ? sReason.includes(tReason)
                ? sReason
                : tReason.includes(sReason)
                  ? tReason
                  : `${sReason}\n\n${tReason}`
              : sReason || tReason;

          let visibleLiveContent = '';
          if (showFullTrace) {
            const liveSections: string[] = [];
            if (combinedLiveThoughts) {
              liveSections.push(
                `> 🧠 **LLM Düşünce & İçsel Muhakeme Süreci ${hasUnclosedThink ? '(Canlı Düşünüyor...)' : '(Chain-of-Thought)'}:**\n\`\`\`text\n${combinedLiveThoughts}\n\`\`\``
              );
            }
            if (cleanText) {
              liveSections.push(cleanText);
            } else if (hasUnclosedThink) {
              liveSections.push('*(Model düşünce adımlarını tamamlıyor, nihai yanıt hazırlanıyor...)*');
            }
            if (streamedToolCalls.length > 0) {
              liveSections.push(
                `---\n🔧 **Tetiklenen Araç Çağrıları (\`tool_calls\`):**\n\`\`\`json\n${JSON.stringify(streamedToolCalls, null, 2)}\n\`\`\``
              );
            }
            const rawLen = streamedText.length + streamedReasoning.length;
            const rawBytes = getUtf8ByteLength(streamedText + streamedReasoning);
            liveSections.push(
              `---\n📡 **Canlı LLM Akışı (SSE Stream):** \`İstek ID: ${streamedRequestId || 'akışta...'}\` · \`Model: ${activeModel}\` · \`Alınan: ${rawLen} krk (${rawBytes} bayt)\` · \`TTFT: ${ttftMs} ms\` · \`Süre: ${Date.now() - requestStartTime} ms\``
            );
            visibleLiveContent = liveSections.join('\n\n');
          } else {
            visibleLiveContent = cleanText || streamedText;
          }

          const liveAssistantMessage: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: visibleLiveContent,
            thinkingContent:
              combinedLiveThoughts ||
              `📡 Canlı Akış | Model: ${activeModel} | Alınan: ${streamedText.length} krk | TTFT: ${ttftMs} ms`,
            timestamp: new Date().toISOString(),
            model: activeModel,
            provider: selectedModelObj?.provider || 'Web AI Gateway',
            agentName:
              selectedModelObj?.name.replace(/\s*\(Web Gateway\)\s*/i, '').trim() ||
              activeModel,
            ttftMs,
            latencyMs: Date.now() - requestStartTime,
            customData: {
              rawCleanContent: cleanText || streamedText,
            },
          };

          setChatSessions((prev) =>
            prev.map((s) => {
              if (
                String(s.id) === String(targetSessionId) ||
                String(s.id) === String(dbConversationId)
              ) {
                const withoutLive = s.messages.filter(
                  (m) => String(m.id) !== assistantMsgId
                );
                return {
                  ...s,
                  id: dbConversationId || s.id,
                  updatedAt: new Date().toISOString(),
                  messages: [...withoutLive, liveAssistantMessage],
                };
              }
              return s;
            })
          );
        };

        await chatService.streamCompletion(
          {
            model: activeModel,
            stream: true,
            conversation_id: dbConversationId,
            source: 'studio',
            messages: apiMessages,
          },
          apiKey,
          (delta) => {
            if (stopRequestedRef.current) return;
            if (!ttftMs) {
              ttftMs = Date.now() - requestStartTime;
            }
            streamedText += delta;
            updateLiveAssistantBubble();
          },
          (resolvedConvId) => {
            if (resolvedConvId) {
              dbConversationId = resolvedConvId;
              serverPersistedTurn = true;
              setActiveChatSessionId(resolvedConvId);
              setChatSessions((prev) =>
                prev.map((s) =>
                  String(s.id) === String(targetSessionId)
                    ? { ...s, id: resolvedConvId }
                    : s
                )
              );
            }
          },
          currentUser?.id || activeUserId,
          (reasoningPiece) => {
            if (stopRequestedRef.current) return;
            if (!ttftMs) {
              ttftMs = Date.now() - requestStartTime;
            }
            streamedReasoning += reasoningPiece;
            updateLiveAssistantBubble();
          },
          (toolCallsPiece) => {
            if (stopRequestedRef.current) return;
            if (!ttftMs) {
              ttftMs = Date.now() - requestStartTime;
            }
            streamedToolCalls = [...streamedToolCalls, ...toolCallsPiece];
            updateLiveAssistantBubble();
          },
          (reqId) => {
            streamedRequestId = reqId;
          }
        );

        const latencyMs = Math.max(100, Date.now() - requestStartTime);

        // Eğer arka uç /v1/chat/completions süreci yanıtı SQLite'a kaydetmediyse recordTurn ile kaydet
        if (!serverPersistedTurn) {
          const recResult = await conversationService.recordTurn(
            {
              conversation_id: dbConversationId || undefined,
              model: activeModel,
              provider: selectedModelObj?.provider || 'gateway',
              source: 'studio',
              messages: apiMessages,
              assistant_content: streamedText,
              latency_ms: latencyMs,
              ttft_ms: ttftMs || latencyMs,
            },
            authOptions
          );
          if (recResult?.conversation_id) {
            dbConversationId = recResult.conversation_id;
          }
        }

        // 6. Akış tamamlandığında SQLite'tan güncel oturum detayını çekerek ID, süre, düşünce, tool_calls ve ham paket bilgilerini kesinleştir
        if (dbConversationId) {
          setActiveChatSessionId(dbConversationId);
          const updatedDetail = await conversationService.getConversationDetail(
            dbConversationId,
            authOptions
          );
          setActiveDetailForInspector(updatedDetail);
          const syncedMessages = (updatedDetail.messages || []).map((rec, idx, arr) => {
            const mapped = mapRecordToBaseChatMessage(
              rec,
              updatedDetail.system_prompt,
              showFullTrace
            );
            if (idx === arr.length - 1 && mapped.role === 'assistant' && !mapped.latencyMs) {
              mapped.latencyMs = latencyMs;
            }
            return mapped;
          });
          setChatSessions((prev) =>
            prev.map((s) =>
              String(s.id) === String(targetSessionId) ||
                String(s.id) === String(dbConversationId)
                ? mapSummaryToChatSession(updatedDetail, syncedMessages)
                : s
            )
          );
        }

        await onRefreshState();
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : 'Model yanıtı alınırken hata oluştu.';
        onShowToast(errMsg);
        const errorAssistantMsg: ChatMessage = {
          id: assistantMsgId,
          role: 'error',
          content: `⚠️ ${errMsg}`,
          timestamp: new Date().toISOString(),
          isError: true,
        };
        setChatSessions((prev) =>
          prev.map((s) =>
            String(s.id) === String(targetSessionId) ||
              (dbConversationId && String(s.id) === String(dbConversationId)) ||
              String(s.id) === String(activeChatSessionId)
              ? { ...s, messages: [...s.messages, errorAssistantMsg] }
              : s
          )
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [
      activeChatSessionId,
      chatModelId,
      selectedModelId,
      models,
      activeChatMessages,
      setIsGenerating,
      chatSystemPrompt,
      currentUser,
      activeUserId,
      authOptions,
      apiKey,
      onRefreshState,
      onShowToast,
      navigate,
      showFullTrace,
    ]
  );

  // Asistan yanıtını yeniden üretme (onRegenerateMessage)
  const handleChatRegenerateMessage = useCallback(
    async (messageId: string | number) => {
      const msgIdx = activeChatMessages.findIndex(
        (m) => String(m.id) === String(messageId)
      );
      if (msgIdx === -1) return;

      for (let i = msgIdx - 1; i >= 0; i--) {
        if (activeChatMessages[i].role === 'user') {
          const prevUserMsg = activeChatMessages[i];
          const cleanPrompt = String(
            (prevUserMsg.customData?.rawCleanContent as string) ?? prevUserMsg.content ?? ''
          );
          const activeSessionObj =
            chatSessions.find((s) => String(s.id) === String(activeChatSessionId)) ||
            null;
          await handleChatSendMessage(
            cleanPrompt,
            prevUserMsg.attachments || [],
            activeSessionObj
          );
          break;
        }
      }
    },
    [activeChatMessages, chatSessions, activeChatSessionId, handleChatSendMessage]
  );

  const handleOpenConversationDetail = useCallback(
    async (conv: ConversationSummaryDTO) => {
      setLoadingDetail(true);
      setDetailModalOpen(true);
      try {
        const detail = await conversationService.getConversationDetail(conv.id, authOptions);
        setSelectedDetail(detail);
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'Sohbet detayı yüklenemedi.');
        setDetailModalOpen(false);
      } finally {
        setLoadingDetail(false);
      }
    },
    [authOptions, onShowToast]
  );

  const handleTogglePin = useCallback(
    async (conv: ConversationSummaryDTO) => {
      try {
        await conversationService.updateConversation(
          conv.id,
          { is_pinned: !conv.is_pinned },
          authOptions
        );
        onShowToast(conv.is_pinned ? 'Sabitleme kaldırıldı.' : 'Sohbet sabitlendi.');
        setRefreshCounter((prev) => prev + 1);
      } catch (err) {
        onShowToast(err instanceof Error ? err.message : 'İşlem başarısız.');
      }
    },
    [authOptions, onShowToast]
  );

  const lastQueryParamsRef = useRef<{
    userId?: string;
    source?: 'studio' | 'api' | 'all';
    search?: string;
    searchField?: string;
    isArchived?: boolean;
    isDeleted?: boolean;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  }>({
    userId: 'all',
    source: 'all',
    search: '',
    searchField: 'Tumu',
    isArchived: false,
    isDeleted: false,
    sortField: 'updated_at',
    sortOrder: 'desc',
    page: 1,
    pageSize: 50,
  });
  const lastSignatureRef = useRef<string>('');
  const prefetchedListRef = useRef<{
    queryKey: string;
    items: ConversationSummaryDTO[];
    ts: number;
  } | null>(null);
  const isSyncInFlightRef = useRef<boolean>(false);
  const hasQueuedSyncRef = useRef<{ force: boolean; convId?: string } | null>(null);
  const syncDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSseConnectedRef = useRef<boolean>(false);
  const lastStateRefreshTsRef = useRef<number>(0);
  const pendingDeferredRefreshRef = useRef<boolean>(false);

  // Kullanıcının tablo üzerinde aktif bir etkileşimi (açık menü, arama yazımı, alt sayfa/kaydırma) olup olmadığını kontrol eder
  const isUserInteractingWithList = useCallback((): boolean => {
    if (typeof document === 'undefined') return false;
    if ((lastQueryParamsRef.current.page || 1) > 1) return true;
    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.tagName === 'TEXTAREA')
    ) {
      return true;
    }
    const openMenu = document.querySelector(
      '.action-menu-dropdown, .base-menu-dropdown, [role="menu"]'
    );
    if (openMenu) return true;
    const tableScroll = document.querySelector('.data-table-container > div');
    if (tableScroll && tableScroll.scrollTop > 60) {
      return true;
    }
    return false;
  }, []);

  const handleFetchConversations = useCallback(
    async (paramsObj?: Record<string, any>) => {
      const qParams = paramsObj?.queryParams || {};
      const searchVal =
        qParams.aramaKelimesi || qParams.arama || paramsObj?.aramaData?.value || '';
      const searchFieldVal =
        qParams.aramaTipi || paramsObj?.aramaData?.type || 'Tumu';
      const isArchivedVal = Boolean(qParams.arsivdekiler);
      const isDeletedVal = Boolean(qParams.silinmisleriGetir || qParams.silinenler);
      const sortFieldVal = qParams.sortField || paramsObj?.sortField || 'updated_at';
      const sortOrderVal = (qParams.sortOrder || paramsObj?.sortOrder || 'desc') as
        | 'asc'
        | 'desc';

      const queryPayload = {
        userId: isAdmin ? adminSelectedUserFilter : currentUser?.id,
        source: 'all' as const,
        search: searchVal,
        searchField: searchFieldVal,
        isArchived: isArchivedVal,
        isDeleted: isDeletedVal,
        sortField: sortFieldVal,
        sortOrder: sortOrderVal,
        page: paramsObj?.page || 1,
        pageSize: paramsObj?.pageSize || 50,
      };
      lastQueryParamsRef.current = queryPayload;
      const queryKey = JSON.stringify(queryPayload);

      const prefetched = prefetchedListRef.current;
      if (
        prefetched &&
        prefetched.queryKey === queryKey &&
        Date.now() - prefetched.ts < 3000
      ) {
        prefetchedListRef.current = null;
        lastSignatureRef.current = computeConversationsSignature(prefetched.items);
        return {
          data: prefetched.items,
          totalCount: prefetched.items.length,
        };
      }

      const items = await conversationService.listConversations(
        queryPayload,
        authOptions
      );
      lastSignatureRef.current = computeConversationsSignature(items);

      return {
        data: items,
        totalCount: items.length,
      };
    },
    [isAdmin, adminSelectedUserFilter, currentUser, authOptions]
  );

  // SSE ve tek-uçuş kilitli (single-flight + debounced) fark kontrolü ile AI Sohbet Stüdyosu listesini anlık senkronize eder
  const syncConversationsRealtime = useCallback(
    async (forceRefresh = false, changedConversationId?: string) => {
      if (isSyncInFlightRef.current) {
        hasQueuedSyncRef.current = {
          force: forceRefresh || Boolean(hasQueuedSyncRef.current?.force),
          convId: changedConversationId || hasQueuedSyncRef.current?.convId,
        };
        return;
      }
      isSyncInFlightRef.current = true;
      try {
        if (viewMode === 'list') {
          const queryPayload = {
            ...lastQueryParamsRef.current,
            userId: isAdmin ? adminSelectedUserFilter : currentUser?.id,
          };
          const items = await conversationService.listConversations(
            queryPayload,
            authOptions
          );
          const nextSig = computeConversationsSignature(items);
          if (forceRefresh || nextSig !== lastSignatureRef.current) {
            prefetchedListRef.current = {
              queryKey: JSON.stringify(queryPayload),
              items,
              ts: Date.now(),
            };
            lastSignatureRef.current = nextSig;

            if (isUserInteractingWithList()) {
              pendingDeferredRefreshRef.current = true;
            } else {
              pendingDeferredRefreshRef.current = false;
              setRefreshCounter((prev) => prev + 1);
            }

            const now = Date.now();
            if (now - lastStateRefreshTsRef.current > 5000) {
              lastStateRefreshTsRef.current = now;
              onRefreshState();
            }
          }
        } else if (viewMode === 'chat' && !isGenerating) {
          const sidebarSessions = await loadSidebarSessionsForChat();
          if (
            activeChatSessionId &&
            !String(activeChatSessionId).startsWith('new_') &&
            (!changedConversationId ||
              String(activeChatSessionId) === String(changedConversationId))
          ) {
            const detail = await conversationService.getConversationDetail(
              String(activeChatSessionId),
              authOptions
            );
            setActiveDetailForInspector(detail);
            const mappedMessages = (detail.messages || []).map((rec) =>
              mapRecordToBaseChatMessage(rec, detail.system_prompt, showFullTrace)
            );
            const detailedSession = mapSummaryToChatSession(
              detail,
              mappedMessages
            );
            setChatSessions((prev) => {
              const newDrafts = prev.filter((s) =>
                String(s.id).startsWith('new_')
              );
              const merged = sidebarSessions.some(
                (s) => String(s.id) === String(detail.id)
              )
                ? sidebarSessions.map((s) =>
                  String(s.id) === String(detail.id) ? detailedSession : s
                )
                : [detailedSession, ...sidebarSessions];
              return [...newDrafts, ...merged];
            });
          } else {
            setChatSessions((prev) => {
              const byId = new Map(prev.map((s) => [String(s.id), s]));
              const newDrafts = prev.filter((s) =>
                String(s.id).startsWith('new_')
              );
              const merged = sidebarSessions.map((ss) => {
                const existing = byId.get(String(ss.id));
                return existing && existing.messages.length > 0
                  ? { ...ss, messages: existing.messages }
                  : ss;
              });
              return [...newDrafts, ...merged];
            });
          }
        }

        if (
          detailModalOpen &&
          selectedDetail &&
          (!changedConversationId || changedConversationId === selectedDetail.id)
        ) {
          const updatedDetail = await conversationService.getConversationDetail(
            selectedDetail.id,
            authOptions
          );
          setSelectedDetail(updatedDetail);
        }
      } catch {
        // Arka plan senkronizasyon hatalarını sessizce geç
      } finally {
        isSyncInFlightRef.current = false;
        if (hasQueuedSyncRef.current) {
          const next = hasQueuedSyncRef.current;
          hasQueuedSyncRef.current = null;
          if (syncDebounceTimerRef.current) {
            clearTimeout(syncDebounceTimerRef.current);
          }
          syncDebounceTimerRef.current = setTimeout(() => {
            syncDebounceTimerRef.current = null;
            syncConversationsRealtimeRef.current(next.force, next.convId);
          }, 350);
        }
      }
    },
    [
      viewMode,
      isAdmin,
      adminSelectedUserFilter,
      currentUser,
      authOptions,
      isUserInteractingWithList,
      onRefreshState,
      isGenerating,
      loadSidebarSessionsForChat,
      activeChatSessionId,
      detailModalOpen,
      selectedDetail,
    ]
  );

  const syncConversationsRealtimeRef = useRef(syncConversationsRealtime);
  useEffect(() => {
    syncConversationsRealtimeRef.current = syncConversationsRealtime;
  }, [syncConversationsRealtime]);

  const scheduleDebouncedSync = useCallback(
    (forceRefresh: boolean, convId?: string) => {
      if (syncDebounceTimerRef.current) {
        clearTimeout(syncDebounceTimerRef.current);
      }
      syncDebounceTimerRef.current = setTimeout(() => {
        syncDebounceTimerRef.current = null;
        syncConversationsRealtimeRef.current(forceRefresh, convId);
      }, 300);
    },
    []
  );

  useEffect(() => {
    const unsubscribeSse = conversationService.subscribeToConversationEvents(
      (evt) => {
        scheduleDebouncedSync(true, evt.conversation_id);
      },
      (connected) => {
        isSseConnectedRef.current = connected;
      }
    );

    // Periyodik kontrol: SSE bağlıyken sadece ertelenmiş (deferred) arayüz yenilemesini kontrol eder;
    // yalnızca SSE bağlantısı kopmuşsa 10 saniyede bir yedek (fallback) sorgu atar.
    let tickCount = 0;
    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (pendingDeferredRefreshRef.current && !isUserInteractingWithList()) {
        pendingDeferredRefreshRef.current = false;
        syncConversationsRealtimeRef.current(true);
        return;
      }
      tickCount += 1;
      if (!isSseConnectedRef.current && tickCount % 5 === 0) {
        syncConversationsRealtimeRef.current(false);
      }
    }, 2000);

    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        scheduleDebouncedSync(false);
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      unsubscribeSse();
      clearInterval(intervalId);
      if (syncDebounceTimerRef.current) {
        clearTimeout(syncDebounceTimerRef.current);
      }
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [scheduleDebouncedSync, isUserInteractingWithList]);

  const handleDeleteConversation = useCallback(
    async (id: string | number) => {
      await conversationService.deleteConversation(String(id), authOptions);
      await onRefreshState();
    },
    [authOptions, onRefreshState]
  );

  const handleArchiveConversation = useCallback(
    async (item: ConversationSummaryDTO) => {
      await conversationService.updateConversation(
        item.id,
        { is_archived: true, is_deleted: false },
        authOptions
      );
      setRefreshCounter((prev) => prev + 1);
      await onRefreshState();
    },
    [authOptions, onRefreshState]
  );

  const handleUnarchiveConversation = useCallback(
    async (item: ConversationSummaryDTO) => {
      await conversationService.updateConversation(
        item.id,
        { is_archived: false, is_deleted: false },
        authOptions
      );
      setRefreshCounter((prev) => prev + 1);
      await onRefreshState();
    },
    [authOptions, onRefreshState]
  );

  const handleRestoreConversation = useCallback(
    async (idOrItem: string | number | ConversationSummaryDTO) => {
      const targetId =
        typeof idOrItem === 'object' && idOrItem !== null
          ? idOrItem.id
          : String(idOrItem);
      await conversationService.restoreConversation(String(targetId), authOptions);
      setRefreshCounter((prev) => prev + 1);
      await onRefreshState();
    },
    [authOptions, onRefreshState]
  );

  const conversationListService = useMemo(
    () => ({
      restore: handleRestoreConversation,
    }),
    [handleRestoreConversation]
  );

  const searchableFields = useMemo(() => {
    const fields = [
      { id: 'title', label: 'Sohbet Başlığı' },
      { id: 'model_id', label: 'Model' },
      { id: 'attachment', label: 'Dosya Adı' },
    ];
    if (isAdmin) {
      fields.push({ id: 'user', label: 'Kullanıcı' });
    }
    return fields;
  }, [isAdmin]);

  const columns: DataTableColumn<ConversationSummaryDTO>[] = useMemo(() => {
    const cols: DataTableColumn<ConversationSummaryDTO>[] = [
      {
        id: 'title',
        header: 'Sohbet Başlığı',
        accessor: 'title',
        sortable: true,
        render: (row) => {
          const cleanPreview = (row.last_message_preview || '')
            .replace(/```[\s\S]*?```/g, '[Kod Bloğu] ')
            .replace(/[*_`#]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxWidth: '260px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                {row.is_pinned && (
                  <Pin
                    size={13}
                    style={{
                      color: 'var(--accent-primary)',
                      transform: 'rotate(45deg)',
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={row.title}
                >
                  {row.title}
                </span>
              </div>
              {cleanPreview && (
                <div
                  style={{
                    fontSize: '11.5px',
                    color: 'var(--text-secondary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={cleanPreview}
                >
                  {cleanPreview}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: 'user_full_name',
        header: 'Kullanıcı',
        accessor: 'user_full_name',
        sortable: true,
        render: (row) => {
          const isSelf = row.user_id === currentUser?.id;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>
                  {row.user_full_name}
                </span>
                {isSelf && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '1px 6px',
                      borderRadius: '999px',
                      background: 'var(--accent-light)',
                      color: 'var(--accent-primary)',
                    }}
                  >
                    Siz
                  </span>
                )}
              </div>
              <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                {row.user_email}
              </span>
            </div>
          );
        },
      },
      {
        id: 'model_id',
        header: 'Model',
        accessor: 'model_id',
        sortable: true,
        render: (row) => {
          const isApi = row.source === 'api';
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: 'monospace',
                  background: 'var(--surface-secondary)',
                  border: '1px solid var(--glass-border)',
                  color: 'var(--text-primary)',
                }}
              >
                <Cpu size={12} />
                {row.model_id}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 7px',
                  borderRadius: '999px',
                  fontSize: '10.5px',
                  fontWeight: 600,
                  background: isApi ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                  color: isApi ? '#d97706' : 'var(--success, #10b981)',
                }}
              >
                {isApi ? <Terminal size={10} /> : <Sparkles size={10} />}
                {isApi ? 'API' : 'Stüdyo'}
              </span>
            </div>
          );
        },
      },
      {
        id: 'attachment_names',
        header: 'Dosyalar',
        sortable: false,
        render: (row) => {
          if (!row.attachment_names || row.attachment_names.length === 0) {
            return <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>—</span>;
          }
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '180px' }}>
              {row.attachment_names.map((fname, idx) => (
                <span
                  key={`${row.id}-att-${idx}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 7px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: 'var(--accent-light)',
                    color: 'var(--accent-primary)',
                  }}
                  title={fname}
                >
                  <Paperclip size={11} />
                  <span
                    style={{
                      maxWidth: '135px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {fname}
                  </span>
                </span>
              ))}
            </div>
          );
        },
      },
      {
        id: 'total_messages',
        header: 'Mesaj / Token',
        accessor: 'total_messages',
        sortable: true,
        render: (row) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--text-primary)' }}>
              {row.total_messages} Mesaj
            </span>
            <span
              style={{
                fontSize: '11px',
                fontFamily: 'monospace',
                color: 'var(--text-secondary)',
              }}
            >
              {row.total_tokens.toLocaleString(locale)} token
            </span>
          </div>
        ),
      },
      {
        id: 'updated_at',
        header: 'Son İşlem',
        accessor: 'updated_at',
        sortable: true,
        render: (row) => {
          const dt = row.updated_at ? new Date(row.updated_at) : null;
          return (
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {dt
                ? dt.toLocaleString(locale, {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
                : '—'}
            </span>
          );
        },
      },
    ];

    return cols;
  }, [currentUser, locale]);

  const customRowActions = useCallback(
    (row: ConversationSummaryDTO): ActionMenuItem[] => [
      {
        label: 'Hızlı Önizleme',
        icon: <Eye size={16} />,
        onClick: () => handleOpenConversationDetail(row),
      },
      {
        label: row.is_pinned ? 'Sabitlemeyi Kaldır' : 'Sohbeti Sabitle',
        icon: <Pin size={16} />,
        onClick: () => handleTogglePin(row),
      },
    ],
    [handleOpenConversationDetail, handleTogglePin]
  );

  const headerDropdownActions = useMemo<ActionMenuItem[]>(
    () => [
      {
        label: 'Yeni Sohbet',
        icon: <Plus size={15} />,
        isDefault: true,
        variant: 'primary',
        hidden: listViewMode !== 'active',
        onClick: handleOpenNewChatPage,
      },
      ...(isAdmin && users.length > 0
        ? [
          {
            dividerAbove: true,
            custom: (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '6px 10px',
                  minWidth: '220px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}
                >
                  Kullanıcıya Göre Filtrele (Admin)
                </span>
                <select
                  value={adminSelectedUserFilter}
                  onChange={(e) => {
                    setAdminSelectedUserFilter(e.target.value);
                    setRefreshCounter((prev) => prev + 1);
                  }}
                  style={{
                    height: '32px',
                    padding: '0 8px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 500,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    outline: 'none',
                    width: '100%',
                  }}
                >
                  <option value="all">Tüm Kullanıcılar ({users.length})</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name}
                    </option>
                  ))}
                </select>
              </div>
            ),
          },
        ]
        : []),
      ...(users.length > 0
        ? [
          {
            dividerAbove: true,
            custom: (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  padding: '6px 10px',
                  minWidth: '220px',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                  }}
                >
                  {isAdmin ? (
                    <ShieldCheck size={13} style={{ color: 'var(--accent-primary)' }} />
                  ) : (
                    <UserIcon size={13} style={{ color: 'var(--text-secondary)' }} />
                  )}
                  <span>Aktif Kullanıcı Oturumu</span>
                </span>
                <select
                  value={activeUserId}
                  onChange={(e) => handleSwitchActiveUser(e.target.value)}
                  style={{
                    height: '32px',
                    padding: '0 8px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-secondary)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    outline: 'none',
                    width: '100%',
                  }}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.role === 'admin' || u.role === 'Sistem Yöneticisi' ? 'Admin' : 'Kullanıcı'})
                    </option>
                  ))}
                </select>
              </div>
            ),
          },
        ]
        : []),
      {
        label: 'Listeyi Yenile',
        icon: <RefreshCw size={15} />,
        dividerAbove: true,
        onClick: () => setRefreshCounter((prev) => prev + 1),
      },
    ],
    [
      listViewMode,
      handleOpenNewChatPage,
      isAdmin,
      users,
      adminSelectedUserFilter,
      activeUserId,
      handleSwitchActiveUser,
    ]
  );

  // ─── "Ekle" veya "Düzenle" Seçildiğinde Açılan BaseChatPage Ekranı ─────────
  if (viewMode === 'chat') {
    const activeSessionObj = chatSessions.find(
      (s) => String(s.id) === String(activeChatSessionId)
    );
    const activeModelObj = models.find((m) => m.id === chatModelId);
    const cleanModelLabel = activeModelObj
      ? activeModelObj.name.replace(/\s*\(Web Gateway\)\s*/i, '').trim()
      : chatModelId;

    const inspectorMessages: ConversationMessageRecordDTO[] =
      activeDetailForInspector &&
        String(activeDetailForInspector.id) === String(activeChatSessionId)
        ? activeDetailForInspector.messages
        : activeChatMessages
          .map((m) => m.customData?.rawRecord as ConversationMessageRecordDTO | undefined)
          .filter((r): r is ConversationMessageRecordDTO => Boolean(r));

    return (
      <>
        <BaseChatPage
          title={activeSessionObj?.title || 'AI Sohbet Stüdyosu'}
          subtitle={`${currentUser?.full_name || 'Kullanıcı'} — SQLite Kayıtlı Yapay Zeka Oturumu (Tam İletişim & Düşünce İzleme)`}
          subtitleLeft={`${currentUser?.full_name || 'Kullanıcı'}${currentUser?.email ? ` (${currentUser.email})` : ''} · ${cleanModelLabel}`}
          subtitleRight={
            activeChatMessages.length > 0
              ? `${activeChatMessages.length} Mesaj · ${showFullTrace ? 'Tam İletişim & Düşünce Raporu Açık' : 'Öz Görünüm'}`
              : 'Yeni Oturum'
          }
          onTitleEdit={
            activeChatSessionId
              ? async (newTitle?: string) => {
                const titleToSet =
                  typeof newTitle === 'string' && newTitle.trim()
                    ? newTitle.trim()
                    : window.prompt('Oturum başlığını düzenleyin:', activeSessionObj?.title || '');
                if (titleToSet && titleToSet.trim()) {
                  await handleChatRenameSession(activeChatSessionId, titleToSet.trim());
                }
              }
              : undefined
          }
          icon={<Sparkles size={22} />}
          showBackButton={true}
          onBack={handleBackToList}
          headerActions={
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleToggleFullTrace}
                title="LLM ile gidip gelen tüm sistem yönergelerini, araç şemalarını, dosya metinlerini, telemetriyi ve düşünce süreçlerini mesaj içinde göster/gizle"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: showFullTrace
                    ? '1px solid var(--accent-primary, #6366f1)'
                    : '1px solid var(--border-color, rgba(148,163,184,0.3))',
                  background: showFullTrace
                    ? 'rgba(99, 102, 241, 0.14)'
                    : 'var(--surface-secondary, rgba(148,163,184,0.1))',
                  color: showFullTrace
                    ? 'var(--accent-primary, #6366f1)'
                    : 'var(--text-secondary)',
                }}
              >
                <Zap size={13} />
                <span>{showFullTrace ? 'Tam İletişim & Düşünce: Açık' : 'Tam İletişim & Düşünce: Öz'}</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (
                    activeChatSessionId &&
                    !String(activeChatSessionId).startsWith('new_')
                  ) {
                    try {
                      const latest = await conversationService.getConversationDetail(
                        String(activeChatSessionId),
                        authOptions
                      );
                      setActiveDetailForInspector(latest);
                    } catch {
                      // Mevcut veriyi kullan
                    }
                  }
                  setRawInspectorOpen(true);
                }}
                title="LLM ile yapılan tüm ham JSON istek/yanıt paketlerini, karakter/bayt dökümlerini ve düşünce kayıtlarını incele"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '32px',
                  padding: '0 10px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid var(--border-color, rgba(148,163,184,0.3))',
                  background: 'var(--surface-secondary, rgba(148,163,184,0.1))',
                  color: 'var(--text-primary)',
                }}
              >
                <Terminal size={13} />
                <span>Ham LLM İletişim Kaydı ({inspectorMessages.length})</span>
              </button>
            </div>
          }
          sessions={chatSessions}
          activeSessionId={activeChatSessionId}
          messages={activeChatMessages}
          onSessionChange={handleChatSessionChange}
          onNewSession={handleChatNewSession}
          onRenameSession={handleChatRenameSession}
          onPinSession={handleChatPinSession}
          onDeleteSession={handleChatDeleteSession}
          onClearMessages={handleChatClearMessages}
          onSendMessage={handleChatSendMessage}
          onRegenerateMessage={handleChatRegenerateMessage}
          onMessageFeedback={handleChatMessageFeedback}
          isGenerating={isGenerating}
          onStopGeneration={() => {
            stopRequestedRef.current = true;
            setIsGenerating(false);
          }}
          systemPrompt={chatSystemPrompt}
          onSystemPromptChange={handleChatSystemPromptChange}
          agents={chatAgents}
          selectedAgentId={chatModelId}
          onAgentChange={handleChatAgentChange}
          defaultModel={chatModelId}
          suggestions={STUDIO_PROMPT_SUGGESTIONS}
          showHistorySidebar={true}
          defaultHistoryOpen={true}
          enableAttachments={true}
          enableThinkingDetails={true}
          enableResponseTimer={true}
          placeholder="Mesajınızı yazın veya dosya ekleyin... (Enter ile gönder, Shift+Enter yeni satır)"
          style={{ height: 'calc(100vh - 210px)', minHeight: '560px' }}
        />

        {/* Ham LLM İletişim & Düşünce Denetçisi (Raw Payload & Thought Inspector Popup) */}
        <BasePopup
          isOpen={rawInspectorOpen}
          onClose={() => setRawInspectorOpen(false)}
          title={`Ham LLM İletişim & Düşünce Günlüğü — ${activeSessionObj?.title || 'Oturum'}`}
          modalSize="lg"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '6px 0' }}>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'var(--bg-secondary, rgba(148, 163, 184, 0.1))',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
                <span>
                  <strong>Oturum ID:</strong> <code>{String(activeChatSessionId)}</code>
                </span>
                <span>
                  <strong>Aktif Model:</strong> <code>{chatModelId}</code>
                </span>
                <span>
                  <strong>Toplam İletişim Adımı:</strong> {inspectorMessages.length} kayıt
                </span>
              </div>
              {(chatSystemPrompt || activeDetailForInspector?.system_prompt) && (
                <div
                  style={{
                    marginTop: '4px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'rgba(99, 102, 241, 0.08)',
                    border: '1px solid rgba(99, 102, 241, 0.25)',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    fontSize: '11.5px',
                  }}
                >
                  <strong>Aktif Sistem Yönergesi (System Prompt):</strong>
                  {'\n'}
                  {chatSystemPrompt || activeDetailForInspector?.system_prompt}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxHeight: '65vh',
                overflowY: 'auto',
                paddingRight: '4px',
              }}
            >
              {inspectorMessages.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Bu oturumda henüz kaydedilmiş ham LLM iletişim paketi bulunmuyor.
                </div>
              ) : (
                inspectorMessages.map((rec, idx) => {
                  const isOutgoing = rec.role !== 'assistant';
                  const parsedRaw = safeParseJson<Record<string, any>>(rec.raw_payload_json);
                  return (
                    <div
                      key={rec.id}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color, rgba(148, 163, 184, 0.28))',
                        background: isOutgoing
                          ? 'rgba(59, 130, 246, 0.05)'
                          : 'rgba(16, 185, 129, 0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          fontSize: '12px',
                        }}
                      >
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                          #{idx + 1}{' '}
                          {isOutgoing
                            ? `📤 GİDEN İSTEK (${rec.role.toUpperCase()})`
                            : `📥 GELEN LLM YANITI (${rec.model_id} · ${rec.provider || 'gateway'})`}
                        </span>
                        <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                          ID: {rec.id} | Req: {rec.request_id || '—'} | {rec.content.length} krk (
                          {getUtf8ByteLength(rec.content)} bayt) | Girdi: {rec.prompt_tokens} tok |
                          Çıktı: {rec.completion_tokens} tok | TTFT: {rec.ttft_ms} ms | Süre:{' '}
                          {rec.latency_ms} ms
                        </span>
                      </div>

                      {rec.attachments && rec.attachments.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {rec.attachments.map((att) => (
                            <span
                              key={att.id}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '3px 9px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                background: 'rgba(59, 130, 246, 0.12)',
                                color: 'var(--primary)',
                              }}
                            >
                              <Paperclip size={12} />
                              {att.file_name} ({att.file_size} bayt, ~{att.estimated_tokens} tok)
                            </span>
                          ))}
                        </div>
                      )}

                      {rec.thinking_content && (
                        <div
                          style={{
                            padding: '8px 10px',
                            borderRadius: '8px',
                            background: 'rgba(139, 92, 246, 0.08)',
                            border: '1px solid rgba(139, 92, 246, 0.25)',
                            fontSize: '12px',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'monospace',
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: '4px', color: '#7c3aed' }}>
                            🧠 Düşünce Süreci & Teknik İletişim Özeti (thinking_content):
                          </div>
                          {rec.thinking_content}
                        </div>
                      )}

                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: 'var(--bg-primary, #ffffff)',
                          border: '1px solid var(--border-color, rgba(148, 163, 184, 0.2))',
                          fontSize: '12.5px',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                          💬 {isOutgoing ? 'Gönderilen Mesaj & JSON İçeriği' : 'Ham Mesaj İçeriği'} (content — {rec.content.length} karakter):
                        </div>
                        {isOutgoing
                          ? formatOutgoingJsonContent(
                            stripUiTraceBlocksFromText(rec.content || ''),
                            rec.role
                          ).formattedMarkdown || '(Boş — 0 karakter)'
                          : rec.content || '(Boş — 0 karakter)'}
                      </div>

                      {rec.tool_calls_json && (
                        <div
                          style={{
                            padding: '8px 10px',
                            borderRadius: '8px',
                            background: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.28)',
                            fontSize: '11.5px',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'monospace',
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: '4px', color: '#d97706' }}>
                            🔧 {isOutgoing ? 'Gönderilen MCP Araç & JSON Şemaları (tools):' : 'Tetiklenen Araç Çağrıları (tool_calls_json):'}
                          </div>
                          <pre
                            style={{
                              margin: 0,
                              padding: '8px 10px',
                              borderRadius: '6px',
                              background: 'rgba(15, 23, 42, 0.92)',
                              color: '#e2e8f0',
                              overflowX: 'auto',
                              fontSize: '11px',
                              lineHeight: 1.45,
                            }}
                          >
                            {(() => {
                              const parsedTc = safeParseJson<any[]>(rec.tool_calls_json);
                              return parsedTc
                                ? JSON.stringify(expandToolCallsForDisplay(parsedTc), null, 2)
                                : rec.tool_calls_json;
                            })()}
                          </pre>
                        </div>
                      )}

                      {parsedRaw && (
                        <details style={{ fontSize: '11.5px' }}>
                          <summary
                            style={{
                              cursor: 'pointer',
                              fontWeight: 600,
                              color: 'var(--accent-primary, #6366f1)',
                            }}
                          >
                            📦 Tam Ham JSON İletişim Paketi (raw_payload_json —{' '}
                            {(rec.raw_payload_json || '').length} bayt)
                          </summary>
                          <pre
                            style={{
                              marginTop: '6px',
                              padding: '8px 10px',
                              borderRadius: '8px',
                              background: 'rgba(15, 23, 42, 0.92)',
                              color: '#e2e8f0',
                              overflowX: 'auto',
                              fontSize: '11px',
                              lineHeight: 1.45,
                            }}
                          >
                            {JSON.stringify(
                              Array.isArray(parsedRaw.tool_calls)
                                ? {
                                  ...parsedRaw,
                                  tool_calls: expandToolCallsForDisplay(parsedRaw.tool_calls),
                                }
                                : parsedRaw,
                              null,
                              2
                            )}
                          </pre>
                        </details>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </BasePopup>
      </>
    );
  }

  return (
    <>
      <BaseListPage<ConversationSummaryDTO>
        title="AI Sohbet Stüdyosu"
        subtitle={
          isAdmin
            ? 'Yönetici Görünümü — Tüm kullanıcıların ve kendinizin yapay zeka sohbet geçmişi'
            : `${currentUser?.full_name || 'Kullanıcı'} — Kişisel yapay zeka sohbet geçmişiniz`
        }
        icon={<Sparkles size={22} />}
        columns={columns}
        searchableFields={searchableFields}
        customFetchData={handleFetchConversations}
        customDeleteData={handleDeleteConversation}
        service={conversationListService}
        onArchive={handleArchiveConversation}
        onUnarchive={handleUnarchiveConversation}
        enableArchive={true}
        enableViewModeToggle={true}
        onViewModeChange={(mode) => setListViewMode(mode)}
        enableAi={false}
        disableEdit={false}
        stickyActionColumn={true}
        customRowActions={customRowActions}
        extraDropdownActions={headerDropdownActions}
        itemNameResolver={(item) => item.title}
        addNewText="Yeni Sohbet"
        emptyMessage={
          isAdmin
            ? 'Veritabanında henüz kayıtlı bir sohbet oturumu bulunamadı.'
            : 'Henüz size ait kayıtlı bir sohbet oturumu bulunmuyor.'
        }
        refreshKey={refreshCounter}
        defaultSortField="updated_at"
        defaultSortOrder="desc"
        onAddNew={handleOpenNewChatPage}
        onEdit={(item) => handleOpenEditChatPage(item)}
      />

      {/* Sohbet Mesaj Geçmişi Hızlı Önizleme Popup */}
      <BasePopup
        isOpen={detailModalOpen}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedDetail(null);
        }}
        title={selectedDetail ? selectedDetail.title : 'Sohbet Detayı'}
        modalSize="lg"
      >
        {loadingDetail || !selectedDetail ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Sohbet mesajları yükleniyor...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '8px 0' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'var(--bg-secondary, rgba(148, 163, 184, 0.1))',
                fontSize: '12.5px',
              }}
            >
              <div>
                <strong>Kullanıcı:</strong> {selectedDetail.user_full_name} (
                {selectedDetail.user_email})
              </div>
              <div>
                <strong>Model:</strong> <code>{selectedDetail.model_id}</code>
              </div>
              <div>
                <strong>Kaynak:</strong>{' '}
                {selectedDetail.source === 'api' ? 'API İstemci' : 'AI Sohbet Stüdyosu'}
              </div>
              <div>
                <strong>Toplam:</strong> {selectedDetail.total_messages} mesaj ·{' '}
                {selectedDetail.total_tokens.toLocaleString(locale)} token
              </div>
            </div>

            {selectedDetail.system_prompt && (
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  fontSize: '12px',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                }}
              >
                <strong>📜 Sistem Yönergesi (System Prompt — {selectedDetail.system_prompt.length} karakter):</strong>
                {'\n'}
                {selectedDetail.system_prompt}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxHeight: '60vh',
                overflowY: 'auto',
                paddingRight: '4px',
              }}
            >
              {selectedDetail.messages.map((msg, msgIdx) => {
                const isUser = msg.role !== 'assistant';
                const parsedRaw = safeParseJson<Record<string, any>>(msg.raw_payload_json);
                return (
                  <div
                    key={msg.id}
                    style={{
                      padding: '12px 16px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color, rgba(148, 163, 184, 0.25))',
                      background: isUser
                        ? 'rgba(59, 130, 246, 0.06)'
                        : 'var(--bg-primary, #ffffff)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        #{msgIdx + 1}{' '}
                        {isUser
                          ? `📤 ${msg.role.toUpperCase()} — ${msg.user_full_name} (${msg.user_email})`
                          : `📥 Model Yanıtı: ${msg.model_id}${msg.provider ? ` · ${msg.provider}` : ''}`}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: '11.5px' }}>
                        {msg.request_id ? `Req: ${msg.request_id} · ` : ''}
                        {msg.content.length} krk ({getUtf8ByteLength(msg.content)} bayt)
                        {msg.prompt_tokens > 0 ? ` · Girdi: ${msg.prompt_tokens} tok` : ''}
                        {msg.completion_tokens > 0 ? ` · Çıktı: ${msg.completion_tokens} tok` : ''}
                        {msg.total_tokens > 0 ? ` · Toplam: ${msg.total_tokens} tok` : ''}
                        {msg.ttft_ms > 0 ? ` · TTFT: ${msg.ttft_ms} ms` : ''}
                        {msg.latency_ms > 0 ? ` · Süre: ${msg.latency_ms} ms` : ''}
                      </span>
                    </div>

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '6px',
                        }}
                      >
                        {msg.attachments.map((att) => (
                          <span
                            key={att.id}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '3px 9px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 600,
                              background: 'rgba(59, 130, 246, 0.12)',
                              color: 'var(--primary)',
                            }}
                          >
                            <Paperclip size={12} />
                            {att.file_name} ({att.file_size} bayt, ~{att.estimated_tokens} tok)
                          </span>
                        ))}
                      </div>
                    )}

                    {msg.thinking_content && (
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: 'rgba(139, 92, 246, 0.08)',
                          border: '1px solid rgba(139, 92, 246, 0.25)',
                          fontSize: '12px',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: '4px', color: '#7c3aed' }}>
                          🧠 LLM Düşünce Süreci & Teknik İletişim Raporu:
                        </div>
                        {msg.thinking_content}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: '13.5px',
                        lineHeight: 1.55,
                        color: 'var(--text-primary)',
                        whiteSpace: 'pre-wrap',
                        fontFamily: isUser && msg.content.includes('{') ? 'monospace' : 'inherit',
                      }}
                    >
                      {isUser
                        ? formatOutgoingJsonContent(
                          stripUiTraceBlocksFromText(msg.content || ''),
                          msg.role
                        ).formattedMarkdown || msg.content
                        : msg.content}
                    </div>

                    {msg.tool_calls_json && (
                      <div
                        style={{
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: 'rgba(245, 158, 11, 0.08)',
                          border: '1px solid rgba(245, 158, 11, 0.28)',
                          fontSize: '11.5px',
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: '4px', color: '#d97706' }}>
                          🔧 {isUser ? 'Gönderilen MCP Araç & JSON Şemaları (tools):' : 'Araç Çağrıları / Şemaları (tool_calls):'}
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            padding: '8px 10px',
                            borderRadius: '6px',
                            background: 'rgba(15, 23, 42, 0.92)',
                            color: '#e2e8f0',
                            overflowX: 'auto',
                            fontSize: '11px',
                            lineHeight: 1.45,
                          }}
                        >
                          {(() => {
                            const parsedTc = safeParseJson<any[]>(msg.tool_calls_json);
                            return parsedTc
                              ? JSON.stringify(expandToolCallsForDisplay(parsedTc), null, 2)
                              : msg.tool_calls_json;
                          })()}
                        </pre>
                      </div>
                    )}

                    {parsedRaw && (
                      <details style={{ fontSize: '11.5px' }}>
                        <summary
                          style={{
                            cursor: 'pointer',
                            fontWeight: 600,
                            color: 'var(--accent-primary, #6366f1)',
                          }}
                        >
                          📦 Ham JSON İletişim Paketi (raw_payload_json)
                        </summary>
                        <pre
                          style={{
                            marginTop: '6px',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            background: 'rgba(15, 23, 42, 0.92)',
                            color: '#e2e8f0',
                            overflowX: 'auto',
                            fontSize: '11px',
                            lineHeight: 1.45,
                          }}
                        >
                          {JSON.stringify(
                            Array.isArray(parsedRaw.tool_calls)
                              ? {
                                ...parsedRaw,
                                tool_calls: expandToolCallsForDisplay(parsedRaw.tool_calls),
                              }
                              : parsedRaw,
                            null,
                            2
                          )}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}

              {selectedDetail.messages.length === 0 && (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <MessageSquare size={24} />
                  <span>Bu sohbet oturumunda henüz mesaj kaydı bulunmuyor.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </BasePopup>
    </>
  );
};
