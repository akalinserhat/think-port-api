/**
 * @file ChatStudioViewDefaultValue.tsx
 * @description ThinkPort AI Gateway - ChatStudioView Varsayılan Başlangıç Değerleri ve ActionMenu Durum Yöneticisi.
 *
 * Başlıca Sorumlulukları:
 * - Form Default Values & Initial State Architecture kurallarına uygun olarak ChatStudioView başlangıç durumlarını üretir.
 * - "Yeni Sohbet" ekranı ilk açıldığında (henüz mesaj gönderilmemişken / sohbet başlamamışken)
 *   ActionMenu'de "Model Seçimi (Model Tercihi)" seçeneğinin varsayılan (isDefault: true) olmasını sağlar.
 * - Sohbet başladıktan sonra (en az bir mesaj mevcut olduğunda) ActionMenu'de
 *   "Yeni Sohbet Başlat" seçeneğinin varsayılan (isDefault: true) olmasını sağlar.
 */

import React from 'react';
import { Zap, Terminal } from 'lucide-react';
import { BaseSwitch, type ActionMenuItem } from '@akalin/ui';
import type { ChatMessage } from '@akalin/ai-assistants';
import type { AIModelDTO, ApiKeyRecordDTO, UserRecordDTO } from '../dtos';

export type ChatStudioActionMenuDefaultMode = 'model-select' | 'new-chat';

export interface ChatStudioDefaultValues {
  viewMode: 'list' | 'chat';
  listViewMode: 'active' | 'archive' | 'trash';
  activeUserId: string;
  adminSelectedUserFilter: string;
  chatModelId: string;
  chatSystemPrompt: string;
  showFullTrace: boolean;
  actionMenuDefaultMode: ChatStudioActionMenuDefaultMode;
}

export interface ChatStudioDefaultValuesOptions {
  models?: AIModelDTO[];
  users?: UserRecordDTO[];
  apiKeys?: ApiKeyRecordDTO[];
  selectedModelId?: string;
  apiKey?: string;
  messages?: ChatMessage[];
}

/**
 * Sohbetin başlayıp başlamadığını kontrol eder.
 * Mesaj listesinde en az 1 mesaj varsa sohbet başlamış kabul edilir.
 */
export const isChatStudioConversationStarted = (
  messages?: ChatMessage[] | null
): boolean => {
  return Array.isArray(messages) && messages.length > 0;
};

/**
 * "Yeni Sohbet" ekranında ActionMenu varsayılan seçeneğini çözümler:
 * - "Yeni Sohbet" ekranı ilk açıldığında (messages.length === 0): 'model-select' (Model Seçimi varsayılan)
 * - Sohbet başladıktan sonra (messages.length > 0): 'new-chat' ("Yeni Sohbet Başlat" varsayılan)
 */
export const resolveChatStudioActionMenuDefaultMode = (options: {
  messages?: ChatMessage[] | null;
  modelsCount?: number;
}): ChatStudioActionMenuDefaultMode => {
  const hasStarted = isChatStudioConversationStarted(options.messages);
  const hasModels = (options.modelsCount ?? 0) > 0;

  if (!hasStarted && hasModels) {
    return 'model-select';
  }
  return 'new-chat';
};

/**
 * ChatStudioView ilk açılış varsayılan değerlerini üretir.
 */
export const getChatStudioDefaultValues = (
  options: ChatStudioDefaultValuesOptions = {}
): ChatStudioDefaultValues => {
  const {
    models = [],
    users = [],
    apiKeys = [],
    selectedModelId,
    apiKey = '',
    messages = [],
  } = options;

  const matchedKey = apiKeys.find(
    (k) => k.raw_preview && k.raw_preview.trim() === apiKey.trim()
  );
  const initialUserId = matchedKey ? matchedKey.user_id : users[0]?.id || 'sys_usr_01';
  const defaultModelId = selectedModelId || models[0]?.id || 'gpt-4o';

  return {
    viewMode: 'list',
    listViewMode: 'active',
    activeUserId: initialUserId,
    adminSelectedUserFilter: 'all',
    chatModelId: defaultModelId,
    chatSystemPrompt: '',
    showFullTrace: true,
    actionMenuDefaultMode: resolveChatStudioActionMenuDefaultMode({
      messages,
      modelsCount: models.length,
    }),
  };
};

export interface BuildChatStudioPageDropdownActionsParams {
  showFullTrace: boolean;
  onSetFullTrace: (nextValue: boolean) => void;
  inspectorMessagesCount: number;
  onOpenRawInspector: () => void | Promise<void>;
}

/**
 * ChatStudioView (BaseChatPage görünümü) için ActionMenu ek seçeneklerini oluşturur:
 * - Düşünce -> Açık / Kapalı (BaseSwitch ile)
 * - Ham İletişim Kayıt
 */
export const buildChatStudioPageDropdownActions = ({
  showFullTrace,
  onSetFullTrace,
  inspectorMessagesCount,
  onOpenRawInspector,
}: BuildChatStudioPageDropdownActionsParams): ActionMenuItem[] => [
  {
    dividerAbove: true,
    custom: (
      <BaseSwitch
        className="action-menu-switch-item"
        checked={showFullTrace}
        onChange={(e) => onSetFullTrace(e.target.checked)}
        label={
          <>
            <Zap size={15} />
            <span>Düşünce: {showFullTrace ? 'Açık' : 'Kapalı'}</span>
          </>
        }
      />
    ),
  },
  {
    label: `Ham İletişim Kayıt (${inspectorMessagesCount})`,
    icon: <Terminal size={15} />,
    dividerAbove: true,
    onClick: () => {
      void onOpenRawInspector();
    },
  },
];

