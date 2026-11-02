import {
  ChatAttachmentDTO,
  ParseFileRequestDTO,
  ParseFileResponseDTO,
} from '../dtos/chat.dto';
import { postJson } from './httpClient';

/**
 * Dosya okuma, boyut biçimlendirme ve sunucu taraflı belge çözümleme servisi.
 */
export const fileParserService = {
  /** Bayt cinsinden dosya boyutunu okunabilir dizgeye (B, KB, MB) dönüştürür. */
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  },

  /** Metin uzunluğundan yaklaşık token sayısını hesaplar. */
  estimateTokens(text: string): number {
    if (!text.trim()) return 0;
    return Math.max(1, Math.round((text.split(/\s+/).length * 4) / 3));
  },

  /** Tarayıcı File nesnesini Data URL (Base64) olarak okur. */
  readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsDataURL(file);
    });
  },

  /** Tarayıcı File nesnesini düz metin olarak okur. */
  readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Text read error'));
      reader.readAsText(file);
    });
  },

  /** Belgeyi sunucudaki /admin/parse-file uç noktasında çözümler. */
  async parseDocumentOnServer(dto: ParseFileRequestDTO): Promise<ParseFileResponseDTO> {
    return postJson<ParseFileRequestDTO, ParseFileResponseDTO>('/admin/parse-file', dto);
  },

  /** Tek bir File nesnesini ön-parse işlemine sokmadan doğrudan ham ek (Data URL / Base64) olarak ChatAttachmentDTO nesnesine dönüştürür. */
  async createAttachmentFromFile(file: File): Promise<ChatAttachmentDTO> {
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const dataUrl = await this.readFileAsDataUrl(file);
    if (file.type.startsWith('image/')) {
      return {
        id,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'image/png',
        kind: 'image',
        dataUrl,
      };
    }

    return {
      id,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      kind: 'document',
      dataUrl,
    };
  },
};
