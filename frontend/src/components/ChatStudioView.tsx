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
  BaseChatPage,
  BasePopup,
  type DataTableColumn,
  type ActionMenuItem,
  type ChatSession,
  type ChatMessage,
  type ChatAgent,
  type ChatAttachment,
  type PromptSuggestion,
} from '@akalin/ui';
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

function mapRecordToBaseChatMessage(record: ConversationMessageRecordDTO): ChatMessage {
  const mappedRole: ChatMessage['role'] =
    record.role === 'assistant'
      ? 'assistant'
      : record.role === 'system'
      ? 'system'
      : record.status === 'error'
      ? 'error'
      : 'user';

  return {
    id: record.id,
    role: mappedRole,
    content: record.content,
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
    attachments:
      record.attachments && record.attachments.length > 0
        ? record.attachments.map((att) => ({
            id: att.id,
            name: att.file_name,
            size: att.file_size,
            type: att.mime_type,
          }))
        : undefined,
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

  const currentUser = useMemo(
    () => users.find((u) => u.id === activeUserId) || users[0],
    [users, activeUserId]
  );

  const isAdmin = currentUser?.role === 'admin';

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

        const mappedMessages = (detail.messages || []).map(mapRecordToBaseChatMessage);
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
    [loadSidebarSessionsForChat, authOptions, selectedModelId, models, onSelectModel, onShowToast, navigate]
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
          attachment_count: 0,
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
        const mappedMessages = (detail.messages || []).map(mapRecordToBaseChatMessage);
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
    [authOptions, onSelectModel, onShowToast, navigate]
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
      session: ChatSession | null
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

      const optimisticUserMessage: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        attachments: (attachments || []).map((a, idx) => ({
          id: String(a.id || `att_${requestStartTime}_${idx}`),
          name: a.name,
          size: a.size || 0,
          type: a.type || 'application/octet-stream',
        })),
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
          parsedAttachments.push({
            id: String(att.id || `att_${Date.now()}`),
            name: att.name,
            size: att.size || 0,
            mimeType: att.type || 'application/octet-stream',
            kind: att.type?.startsWith('image/') ? 'image' : 'document',
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

        // 4. Geçmiş mesajları + yeni kullanıcı mesajını OpenAI API formatına hazırla
        const historyForApi: ChatMessageItemDTO[] = [
          ...existingMessages.map((m) => ({
            id: String(m.id),
            role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
            content: m.content,
            timestamp: String(m.timestamp || ''),
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

        // 5. SSE akışı ile yanıtı al ve mesaj balonunu canlı güncelle
        let streamedText = '';
        let serverPersistedTurn = false;
        let ttftMs = 0;

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
            const liveAssistantMessage: ChatMessage = {
              id: assistantMsgId,
              role: 'assistant',
              content: streamedText,
              timestamp: new Date().toISOString(),
              model: activeModel,
              provider: selectedModelObj?.provider || 'Web AI Gateway',
              agentName:
                selectedModelObj?.name.replace(/\s*\(Web Gateway\)\s*/i, '').trim() ||
                activeModel,
              ttftMs,
              latencyMs: Date.now() - requestStartTime,
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
          currentUser?.id || activeUserId
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

        // 6. Akış tamamlandığında SQLite'tan güncel oturum detayını çekerek ID, süre ve token bilgilerini kesinleştir
        if (dbConversationId) {
          setActiveChatSessionId(dbConversationId);
          const updatedDetail = await conversationService.getConversationDetail(
            dbConversationId,
            authOptions
          );
          const syncedMessages = (updatedDetail.messages || []).map((rec, idx, arr) => {
            const mapped = mapRecordToBaseChatMessage(rec);
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
          const activeSessionObj =
            chatSessions.find((s) => String(s.id) === String(activeChatSessionId)) ||
            null;
          await handleChatSendMessage(
            prevUserMsg.content,
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

  const handleFetchConversations = useCallback(
    async (paramsObj?: Record<string, any>) => {
      const qParams = paramsObj?.queryParams || {};
      const searchVal =
        qParams.aramaKelimesi || qParams.arama || paramsObj?.aramaData?.value || '';
      const searchFieldVal =
        qParams.aramaTipi || paramsObj?.aramaData?.type || 'Tumu';
      const isArchivedVal = Boolean(qParams.arsivdekiler);
      const sortFieldVal = qParams.sortField || paramsObj?.sortField || 'updated_at';
      const sortOrderVal = qParams.sortOrder || paramsObj?.sortOrder || 'desc';

      const items = await conversationService.listConversations(
        {
          userId: isAdmin ? adminSelectedUserFilter : currentUser?.id,
          source: 'all',
          search: searchVal,
          searchField: searchFieldVal,
          isArchived: isArchivedVal,
          sortField: sortFieldVal,
          sortOrder: sortOrderVal,
          page: paramsObj?.page || 1,
          pageSize: paramsObj?.pageSize || 50,
        },
        authOptions
      );

      return {
        data: items,
        totalCount: items.length,
      };
    },
    [isAdmin, adminSelectedUserFilter, currentUser, authOptions]
  );

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
        { is_archived: true },
        authOptions
      );
      setRefreshCounter((prev) => prev + 1);
    },
    [authOptions]
  );

  const handleUnarchiveConversation = useCallback(
    async (item: ConversationSummaryDTO) => {
      await conversationService.updateConversation(
        item.id,
        { is_archived: false },
        authOptions
      );
      setRefreshCounter((prev) => prev + 1);
    },
    [authOptions]
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
        onClick: handleOpenNewChatPage,
      },
      ...(isAdmin && users.length > 0
        ? [
            {
              type: 'custom',
              dividerAbove: true,
              content: (
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
            } as ActionMenuItem,
          ]
        : []),
      ...(users.length > 0
        ? [
            {
              type: 'custom',
              dividerAbove: true,
              content: (
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
                        {u.full_name} ({u.role === 'admin' ? 'Admin' : 'Kullanıcı'})
                      </option>
                    ))}
                  </select>
                </div>
              ),
            } as ActionMenuItem,
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

    return (
      <BaseChatPage
        title={activeSessionObj?.title || 'AI Sohbet Stüdyosu'}
        subtitle={`${currentUser?.full_name || 'Kullanıcı'} — SQLite Kayıtlı Yapay Zeka Oturumu`}
        subtitleLeft={`${currentUser?.full_name || 'Kullanıcı'}${currentUser?.email ? ` (${currentUser.email})` : ''} · ${cleanModelLabel}`}
        subtitleRight={
          activeChatMessages.length > 0
            ? `${activeChatMessages.length} Mesaj`
            : 'Yeni Oturum'
        }
        onTitleEdit={
          activeChatSessionId
            ? (newTitle) => handleChatRenameSession(activeChatSessionId, newTitle)
            : undefined
        }
        icon={<Sparkles size={22} />}
        showBackButton={true}
        onBack={handleBackToList}
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
        showHistorySidebar={true}
        defaultHistoryOpen={true}
        enableAttachments={true}
        enableThinkingDetails={true}
        enableResponseTimer={true}
        placeholder="Mesajınızı yazın veya dosya ekleyin... (Enter ile gönder, Shift+Enter yeni satır)"
        style={{ height: 'calc(100vh - 210px)', minHeight: '560px' }}
      />
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
        onArchive={handleArchiveConversation}
        onUnarchive={handleUnarchiveConversation}
        enableArchive={false}
        enableViewModeToggle={false}
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
              {selectedDetail.messages.map((msg) => {
                const isUser = msg.role === 'user';
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
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        marginBottom: '6px',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {isUser
                          ? `${msg.user_full_name} (${msg.user_email})`
                          : `Model Yanıtı: ${msg.model_id}${msg.provider ? ` · ${msg.provider}` : ''}`}
                      </span>
                      <span>
                        {msg.total_tokens > 0 ? `${msg.total_tokens} token` : ''}
                        {msg.latency_ms > 0 ? ` · ${msg.latency_ms} ms` : ''}
                      </span>
                    </div>

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '6px',
                          marginBottom: '8px',
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
                            {att.file_name}
                          </span>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: '13.5px',
                        lineHeight: 1.55,
                        color: 'var(--text-primary)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {msg.content}
                    </div>
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
