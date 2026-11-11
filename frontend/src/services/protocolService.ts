/**
 * ThinkPort AI Gateway - Dinamik API Protokolleri Yönetim Servisi (protocolService.ts).
 * OpenAI, Anthropic Claude, Google Gemini, Ollama ve özel LLM sağlayıcı protokollerinin
 * istek (buildRequest), yanıt (parseResponse) ve model keşif (parseModels) scriptlerini yönetir.
 */

import {
  ApiProtocolDTO,
  ApiProtocolTestRequestDTO,
  ApiProtocolTestResponseDTO,
} from '../dtos/admin.dto';
import { deleteJson, getJson, patchJson, postJson } from './httpClient';

const STORAGE_PROTOCOLS_KEY = 'gateway_api_protocols_v1';

export const DEFAULT_API_PROTOCOLS: ApiProtocolDTO[] = [
  {
    id: 'proto_openai',
    ad: 'OpenAI REST API Uyumluluğu',
    aciklama:
      'OpenAI, DeepSeek, Groq, Ollama ve vLLM gibi standart /v1/chat/completions uç noktası kullanan sistemler için evrensel adaptör.',
    sistemProtokoluMu: true,
    bagliSaglayiciSayisi: 2,
    requestScript: `function buildRequest(context) {
    var endpoint = context.endpoint || '/chat/completions';
    var headers = {
        'Content-Type': 'application/json'
    };
    if (context.apiKey) {
        headers['Authorization'] = 'Bearer ' + context.apiKey;
    }
    var body = {
        model: context.model,
        messages: context.messages,
        temperature: context.temperature !== undefined ? context.temperature : 0.7,
        max_tokens: context.maxTokens || 2048
    };
    return {
        url: context.baseUrl + endpoint,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}`,
    responseScript: `function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = '';
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        content = data.choices[0].message.content || '';
    }
    var promptTokens = 0;
    var completionTokens = 0;
    if (data.usage) {
        promptTokens = data.usage.prompt_tokens || 0;
        completionTokens = data.usage.completion_tokens || 0;
    }
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}`,
    modelsScript: `function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var models = [];
    if (data && data.data && Array.isArray(data.data)) {
        for (var i = 0; i < data.data.length; i++) {
            if (data.data[i] && data.data[i].id) {
                models.push(data.data[i].id);
            }
        }
    }
    return models;
}`,
  },
  {
    id: 'proto_anthropic',
    ad: 'Anthropic Claude REST API',
    aciklama:
      'Anthropic Claude modelleri için /v1/messages formatı ve x-api-key başlığı kullanan resmi protokol adaptörü.',
    sistemProtokoluMu: true,
    bagliSaglayiciSayisi: 1,
    requestScript: `function buildRequest(context) {
    var endpoint = context.endpoint || '/messages';
    var headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
    };
    if (context.apiKey) {
        headers['x-api-key'] = context.apiKey;
    }
    var systemPrompt = '';
    var filteredMessages = [];
    if (context.messages && Array.isArray(context.messages)) {
        for (var i = 0; i < context.messages.length; i++) {
            var msg = context.messages[i];
            if (msg.role === 'system') {
                systemPrompt = (systemPrompt ? systemPrompt + '\\n' : '') + msg.content;
            } else {
                filteredMessages.push(msg);
            }
        }
    }
    var body = {
        model: context.model,
        messages: filteredMessages,
        max_tokens: context.maxTokens || 2048,
        temperature: context.temperature !== undefined ? context.temperature : 0.7
    };
    if (systemPrompt) {
        body.system = systemPrompt;
    }
    return {
        url: context.baseUrl + endpoint,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}`,
    responseScript: `function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = '';
    if (data.content && Array.isArray(data.content)) {
        for (var i = 0; i < data.content.length; i++) {
            if (data.content[i].type === 'text') {
                content += data.content[i].text || '';
            }
        }
    }
    var promptTokens = 0;
    var completionTokens = 0;
    if (data.usage) {
        promptTokens = data.usage.input_tokens || 0;
        completionTokens = data.usage.output_tokens || 0;
    }
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}`,
    modelsScript: `function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    if (data && data.data && Array.isArray(data.data)) {
        return data.data.map(function(m) { return m.id; });
    }
    return ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'];
}`,
  },
  {
    id: 'proto_gemini',
    ad: 'Google Gemini REST API',
    aciklama: 'Google Gemini v1beta REST API (models:generateContent) JSON şema adaptörü.',
    sistemProtokoluMu: true,
    bagliSaglayiciSayisi: 1,
    requestScript: `function buildRequest(context) {
    var endpoint = '/models/' + encodeURIComponent(context.model) + ':generateContent';
    var url = context.baseUrl + endpoint + '?key=' + (context.apiKey || '');
    var headers = {
        'Content-Type': 'application/json'
    };
    var contents = [];
    var systemInstruction = null;
    if (context.messages && Array.isArray(context.messages)) {
        for (var i = 0; i < context.messages.length; i++) {
            var msg = context.messages[i];
            if (msg.role === 'system') {
                systemInstruction = { parts: [{ text: msg.content }] };
            } else {
                var role = msg.role === 'assistant' ? 'model' : 'user';
                contents.push({ role: role, parts: [{ text: msg.content }] });
            }
        }
    }
    var body = {
        contents: contents,
        generationConfig: {
            temperature: context.temperature !== undefined ? context.temperature : 0.7,
            maxOutputTokens: context.maxTokens || 2048
        }
    };
    if (systemInstruction) {
        body.systemInstruction = systemInstruction;
    }
    return {
        url: url,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}`,
    responseScript: `function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = '';
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts) {
        var parts = data.candidates[0].content.parts;
        for (var i = 0; i < parts.length; i++) {
            content += parts[i].text || '';
        }
    }
    var promptTokens = 0;
    var completionTokens = 0;
    if (data.usageMetadata) {
        promptTokens = data.usageMetadata.promptTokenCount || 0;
        completionTokens = data.usageMetadata.candidatesTokenCount || 0;
    }
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}`,
    modelsScript: `function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    if (data && data.models && Array.isArray(data.models)) {
        return data.models.map(function(m) { return (m.name || '').replace('models/', ''); });
    }
    return ['gemini-2.5-pro', 'gemini-2.0-flash'];
}`,
  },
  {
    id: 'proto_ollama',
    ad: 'Ollama Yerel Motor API',
    aciklama:
      'Yerel sunucuda çalışan Ollama (/api/chat ve /api/tags) açık kaynaklı LLM modelleri için doğrudan protokol adaptörü.',
    sistemProtokoluMu: true,
    bagliSaglayiciSayisi: 1,
    requestScript: `function buildRequest(context) {
    var endpoint = context.endpoint || '/api/chat';
    var headers = {
        'Content-Type': 'application/json'
    };
    var body = {
        model: context.model,
        messages: context.messages,
        stream: false,
        options: {
            temperature: context.temperature !== undefined ? context.temperature : 0.7,
            num_predict: context.maxTokens || 2048
        }
    };
    return {
        url: context.baseUrl + endpoint,
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
    };
}`,
    responseScript: `function parseResponse(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    var content = (data.message && data.message.content) ? data.message.content : (data.response || '');
    var promptTokens = data.prompt_eval_count || 0;
    var completionTokens = data.eval_count || 0;
    return {
        content: content,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens
    };
}`,
    modelsScript: `function parseModels(rawResponse) {
    var data = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    if (data && data.models && Array.isArray(data.models)) {
        return data.models.map(function(m) { return m.name; });
    }
    return [];
}`,
  },
];

function readLocalProtocols(): ApiProtocolDTO[] {
  try {
    const raw = localStorage.getItem(STORAGE_PROTOCOLS_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_PROTOCOLS_KEY, JSON.stringify(DEFAULT_API_PROTOCOLS));
      return DEFAULT_API_PROTOCOLS;
    }
    const parsed = JSON.parse(raw) as ApiProtocolDTO[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_API_PROTOCOLS;
  } catch {
    return DEFAULT_API_PROTOCOLS;
  }
}

function writeLocalProtocols(list: ApiProtocolDTO[]): void {
  try {
    localStorage.setItem(STORAGE_PROTOCOLS_KEY, JSON.stringify(list));
  } catch {}
}

export const protocolService = {
  async listProtocols(): Promise<ApiProtocolDTO[]> {
    try {
      const list = await getJson<ApiProtocolDTO[]>('/admin/protocols');
      if (Array.isArray(list) && list.length > 0) {
        writeLocalProtocols(list);
        return list;
      }
    } catch {}
    return readLocalProtocols();
  },

  async getProtocol(id: string): Promise<ApiProtocolDTO> {
    try {
      const proto = await getJson<ApiProtocolDTO>(`/admin/protocols/${encodeURIComponent(id)}`);
      if (proto && proto.id) {
        return proto;
      }
    } catch {}
    const found = readLocalProtocols().find((p) => p.id === id);
    if (!found) {
      throw new Error('İstenen protokol kaydı bulunamadı.');
    }
    return found;
  },

  async createProtocol(data: Partial<ApiProtocolDTO>): Promise<ApiProtocolDTO> {
    try {
      const created = await postJson<Partial<ApiProtocolDTO>, ApiProtocolDTO>(
        '/admin/protocols',
        data
      );
      const current = readLocalProtocols().filter((p) => p.id !== created.id);
      writeLocalProtocols([...current, created]);
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('zaten mevcut') || msg.includes('zorunlu')) {
        throw err;
      }
      const current = readLocalProtocols();
      const created: ApiProtocolDTO = {
        id: `proto_${Math.random().toString(16).slice(2, 10)}`,
        ad: (data.ad || '').trim(),
        aciklama: (data.aciklama || '').trim(),
        requestScript: data.requestScript || '',
        responseScript: data.responseScript || '',
        modelsScript: data.modelsScript || '',
        sistemProtokoluMu: false,
        bagliSaglayiciSayisi: 0,
      };
      writeLocalProtocols([...current, created]);
      return created;
    }
  },

  async updateProtocol(id: string, data: Partial<ApiProtocolDTO>): Promise<ApiProtocolDTO> {
    try {
      const updated = await patchJson<Partial<ApiProtocolDTO>, ApiProtocolDTO>(
        `/admin/protocols/${encodeURIComponent(id)}`,
        data
      );
      const current = readLocalProtocols().map((p) => (p.id === id ? updated : p));
      writeLocalProtocols(current);
      return updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('zaten mevcut') || msg.includes('zorunlu')) {
        throw err;
      }
      const current = readLocalProtocols();
      const idx = current.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new Error('Protokol bulunamadı.');
      }
      const updated: ApiProtocolDTO = {
        ...current[idx],
        ...data,
        id,
      };
      current[idx] = updated;
      writeLocalProtocols(current);
      return updated;
    }
  },

  async deleteProtocol(id: string): Promise<void> {
    try {
      await deleteJson(`/admin/protocols/${encodeURIComponent(id)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('silinemez') || msg.includes('bağlı')) {
        throw err;
      }
    }
    const current = readLocalProtocols().filter((p) => p.id !== id);
    writeLocalProtocols(current);
  },

  async testProtocol(dto: ApiProtocolTestRequestDTO): Promise<ApiProtocolTestResponseDTO> {
    return postJson<ApiProtocolTestRequestDTO, ApiProtocolTestResponseDTO>(
      '/admin/protocols/test',
      dto
    );
  },
};

