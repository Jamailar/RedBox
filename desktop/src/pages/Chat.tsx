import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Terminal, Loader2, StopCircle, Trash2, Plus, MessageSquare, X, PanelLeftClose, PanelLeft, Sparkles, Edit, Users, Paperclip, FileX } from 'lucide-react';
import { clsx } from 'clsx';
import { ToolConfirmDialog } from '../components/ToolConfirmDialog';
import { MessageItem, Message, ToolEvent, SkillEvent } from '../components/MessageItem';
import type { ProcessItem, ProcessItemType } from '../components/ProcessTimeline';
import type { PendingChatMessage } from '../App';
import { ErrorBoundary } from '../components/ErrorBoundary';

interface Session {
  id: string;
  title: string;
  updatedAt: string;
}

// 群聊接口
interface ChatRoom {
  id: string;
  name: string;
  advisorIds: string[];
  createdAt: string;
}

// 选中文字菜单状态
interface SelectionMenu {
  visible: boolean;
  x: number;
  y: number;
  text: string;
}

interface ChatProps {
  defaultCollapsed?: boolean;
  pendingMessage?: PendingChatMessage | null;
  onMessageConsumed?: () => void;
  fixedSessionId?: string | null;
  showClearButton?: boolean;
  fixedSessionBannerText?: string;
  shortcuts?: Array<{ label: string; text: string }>;
  welcomeShortcuts?: Array<{ label: string; text: string }>;
  showWelcomeShortcuts?: boolean;
  showComposerShortcuts?: boolean;
  fixedSessionContextIndicatorMode?: 'top' | 'corner-ring' | 'none';
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  contentLayout?: 'default' | 'center-2-3' | 'wide';
  allowFileUpload?: boolean;
}

interface UploadedFileAttachment {
  type: 'uploaded-file';
  name: string;
  ext?: string;
  size?: number;
  absolutePath?: string;
  localUrl?: string;
  kind?: 'text' | 'image' | 'audio' | 'video' | 'binary' | string;
  summary?: string;
  requiresMultimodal?: boolean;
}

interface ChatContextUsage {
  success: boolean;
  contextType?: string;
  estimatedTotalTokens?: number;
  compactThreshold?: number;
  compactRatio?: number;
  compactRounds?: number;
  compactUpdatedAt?: string | null;
}

interface ChatRuntimeState {
  success: boolean;
  error?: string;
  sessionId?: string;
  isProcessing: boolean;
  partialResponse: string;
  updatedAt: number;
}

interface ChatErrorEventPayload {
  message?: string;
  raw?: string;
  hint?: string;
  statusCode?: number;
  errorCode?: string;
  category?: string;
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 80;
const STREAM_CHUNK_DEDUPE_WINDOW_MS = 120;
const STREAM_UPDATE_INTERVAL_MS = 48;

function consumeBufferedChunk(buffer: string, chunk: string): string {
  if (!buffer || !chunk) return buffer;
  if (buffer.startsWith(chunk)) {
    return buffer.slice(chunk.length);
  }

  const index = buffer.indexOf(chunk);
  if (index === -1) {
    return buffer;
  }
  return `${buffer.slice(0, index)}${buffer.slice(index + chunk.length)}`;
}

function mergeAssistantContent(currentContent: string, incomingContent: string): string {
  const current = String(currentContent || '');
  const incoming = String(incomingContent || '');
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;
  return `${current}${incoming}`;
}

function deriveChatErrorPresentation(payload: ChatErrorEventPayload | string | null | undefined): { formatted: string; notice: string } {
  const data = typeof payload === 'string' ? { message: payload } : (payload || {});
  const title = String(data.message || 'AI 请求失败').trim();
  const detail = String(data.raw || '').trim();
  const lower = `${title}\n${detail}`.toLowerCase();
  const detectedInsufficientBalance =
    lower.includes('insufficient balance') ||
    lower.includes('insufficient_balance') ||
    lower.includes('insufficient_quota') ||
    /\b1008\b/.test(lower);
  const detectedInvalidKey =
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication_error') ||
    lower.includes('unauthorized');
  const detectedRateLimit =
    Number(data.statusCode) === 429 ||
    lower.includes('rate limit') ||
    lower.includes('too many requests');

  const category = detectedInsufficientBalance
    ? 'quota'
    : detectedInvalidKey
      ? 'auth'
      : detectedRateLimit
        ? 'rate_limit'
        : String(data.category || '').trim();

  const hint = detectedInsufficientBalance
    ? '账号余额/额度不足。请充值、升级套餐或切换到有余额的 AI 源。'
    : detectedInvalidKey
      ? '请检查 API Key 是否正确、是否过期，以及该模型是否有调用权限。'
      : detectedRateLimit
        ? '请求频率过高。请稍后重试，或降低并发与调用频率。'
        : String(data.hint || '').trim() || '请检查 AI 源配置后重试。';
  const metaParts = [
    data.statusCode ? `HTTP ${data.statusCode}` : '',
    data.errorCode ? String(data.errorCode) : '',
    category || '',
  ].filter(Boolean);

  const userFacingTitle = detectedInsufficientBalance
    ? 'AI 账号余额不足（供应商返回）'
    : detectedInvalidKey
      ? 'AI API Key 无效或无权限（供应商返回）'
      : detectedRateLimit
        ? 'AI 请求被限流（供应商返回）'
        : title;

  const lines: string[] = [`❌ ${userFacingTitle}`];
  lines.push('说明：这是 AI 源接口返回的错误，不是 App 崩溃。');
  if (hint) lines.push(`处理建议：${hint}`);
  if (metaParts.length > 0) lines.push(`标识：${metaParts.join(' · ')}`);
  if (detail) {
    lines.push('');
    lines.push('错误详情（用于反馈）：');
    lines.push('```text');
    lines.push(detail.slice(0, 3000));
    lines.push('```');
  }

  const notice = detectedInsufficientBalance
    ? 'AI 源余额不足，请充值或切换有余额的 AI 源。'
    : detectedInvalidKey
      ? 'AI 源鉴权失败，请检查 API Key。'
      : detectedRateLimit
        ? 'AI 请求被限流，请稍后重试。'
        : `AI 请求失败：${userFacingTitle}`;

  return {
    formatted: lines.join('\n'),
    notice,
  };
}

export function Chat({
  pendingMessage,
  onMessageConsumed,
  defaultCollapsed = true,
  fixedSessionId,
  showClearButton = true,
  fixedSessionBannerText = '当前对话已关联到文档',
  shortcuts: shortcutsProp,
  welcomeShortcuts: welcomeShortcutsProp,
  showWelcomeShortcuts = true,
  showComposerShortcuts = true,
  fixedSessionContextIndicatorMode = 'top',
  welcomeTitle = '有什么可以帮您？',
  welcomeSubtitle = '我可以帮您阅读和编辑稿件、分析内容、提供创作建议',
  contentLayout = 'default',
  allowFileUpload = false,
}: ChatProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ToolConfirmRequest | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem("chat:sidebarCollapsed");
    return saved ? JSON.parse(saved) : defaultCollapsed;
  });

  useEffect(() => {
    localStorage.setItem("chat:sidebarCollapsed", JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu>({ visible: false, x: 0, y: 0, text: '' });
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [showRoomPicker, setShowRoomPicker] = useState(false);
  const [isRoomPickerLoading, setIsRoomPickerLoading] = useState(false);
  const [contextUsage, setContextUsage] = useState<ChatContextUsage | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<UploadedFileAttachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Throttle buffer for streaming updates
  const pendingUpdateRef = useRef<{ content: string } | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStreamChunkRef = useRef<{ content: string; at: number }>({ content: '', at: 0 });
  
  // 缓冲未处理的 chunk，用于解决页面加载期间的数据丢失问题
  const missedChunksRef = useRef<string>('');
  const shouldAutoScrollRef = useRef(true);
  const centeredContent = contentLayout === 'center-2-3';
  const wideContent = contentLayout === 'wide';
  const contentWidthClass = 'w-full';
  const contentMaxWidthClass = wideContent ? 'max-w-[1180px]' : 'max-w-[900px]';
  const contentOuterPaddingClass = wideContent ? 'px-6 md:px-10 lg:px-14 xl:px-20 2xl:px-24' : 'px-6 md:px-8 lg:px-10 xl:px-12';
  const emptySessionWidthClass = centeredContent
    ? 'w-2/3 mx-auto'
    : wideContent
      ? 'max-w-4xl w-full'
      : 'max-w-2xl w-full';

  const isNearBottom = useCallback((element: HTMLDivElement): boolean => {
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    return distance <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    shouldAutoScrollRef.current = isNearBottom(container);
  }, [isNearBottom]);

  const loadContextUsage = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const usage = await window.ipcRenderer.chat.getContextUsage(sessionId);
      if (usage?.success) {
        setContextUsage(usage as ChatContextUsage);
      }
    } catch (error) {
      console.error('Failed to load context usage:', error);
    }
  }, []);

  const loadChatRooms = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setIsRoomPickerLoading(true);
    }
    try {
      const rooms = await window.ipcRenderer.invoke('chatrooms:list') as ChatRoom[];
      setChatRooms(Array.isArray(rooms) ? rooms : []);
    } catch (error) {
      console.error('Failed to load chat rooms:', error);
      setChatRooms([]);
    } finally {
      if (!silent) {
        setIsRoomPickerLoading(false);
      }
    }
  }, []);

  // 判断是否是空会话（新建或无消息）
  const isEmptySession = messages.length === 0;

  // 标记是否已处理过 pendingMessage，避免重复处理
  const pendingMessageHandledRef = useRef(false);

  // 当 pendingMessage 变为 null 时重置标记
  useEffect(() => {
    if (!pendingMessage) {
      pendingMessageHandledRef.current = false;
    }
  }, [pendingMessage]);

  useEffect(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container && shouldAutoScrollRef.current) {
        container.scrollTop = container.scrollHeight;
      } else if (!container && shouldAutoScrollRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
    });
  }, [messages, currentSessionId]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [currentSessionId]);

  useEffect(() => {
    if (!fixedSessionId || !currentSessionId) return;
    void loadContextUsage(currentSessionId);
  }, [fixedSessionId, currentSessionId, messages.length, isProcessing, loadContextUsage]);

  // Load sessions on mount
  useEffect(() => {
    void loadChatRooms({ silent: true });

    // Handle fixed session (File-Bound Mode)
    if (fixedSessionId) {
       setSidebarCollapsed(true);
       selectSession(fixedSessionId);
       return;
    }

    // 只有没有 pendingMessage 时才自动选择会话
    if (!pendingMessage) {
      loadSessions();
    } else {
      // 有 pendingMessage 时只加载列表，不选择
      window.ipcRenderer.chat.getSessions().then((list: Session[]) => {
        setSessions(list);
      }).catch(console.error);
    }
  }, [fixedSessionId, loadChatRooms]); // Add fixedSessionId dependency

  useEffect(() => {
    const handleRunnerMessage = (_: unknown, payload?: { sessionId?: string }) => {
      const sid = payload?.sessionId;
      if (!sid || !currentSessionId) return;
      if (sid !== currentSessionId) return;
      void selectSession(sid);
    };

    window.ipcRenderer.on('redclaw:runner-message', handleRunnerMessage);
    return () => {
      window.ipcRenderer.off('redclaw:runner-message', handleRunnerMessage);
    };
  }, [currentSessionId]);

  // 处理从其他页面传来的待发送消息（如知识库的"AI脑爆"）
  useEffect(() => {
    // 已处理过或正在处理中，跳过
    if (!pendingMessage || isProcessing || pendingMessageHandledRef.current) {
      return;
    }

    if (fixedSessionId && currentSessionId !== fixedSessionId) {
      return;
    }

    // 标记为已处理
    pendingMessageHandledRef.current = true;

    const sendPendingMessage = async () => {
      let sessionId: string;
      const shouldAppendToCurrentSession = Boolean(fixedSessionId);

      if (fixedSessionId) {
        sessionId = fixedSessionId;
      } else {
        try {
          // 使用视频标题作为会话标题
          const sessionTitle = pendingMessage.attachment?.title
            ? `AI 脑爆: ${pendingMessage.attachment.title.substring(0, 30)}${pendingMessage.attachment.title.length > 30 ? '...' : ''}`
            : 'AI 脑爆';
          const session = await window.ipcRenderer.chat.createSession(sessionTitle);

          // 更新会话列表并选中新会话
          setSessions(prev => [session, ...prev]);
          setCurrentSessionId(session.id);
          sessionId = session.id;

          console.log('[Chat] Created new session for AI 脑爆:', session.id, sessionTitle);
        } catch (error) {
          console.error('Failed to create session:', error);
          pendingMessageHandledRef.current = false; // 重置，允许重试
          onMessageConsumed?.();
          return;
        }
      }

      // 构建用户消息 - 注意：attachment 和 displayContent 用于 UI 显示
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: pendingMessage.content,
        displayContent: pendingMessage.displayContent,
        attachment: pendingMessage.attachment,
        tools: [],
        timeline: []
      };

      const aiPlaceholder: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: '',
        tools: [],
        timeline: [],
        isStreaming: true
      };

      if (shouldAppendToCurrentSession) {
        setMessages(prev => [...prev, userMsg, aiPlaceholder]);
      } else {
        // 新会话直接设置消息
        setMessages([userMsg, aiPlaceholder]);
      }
      setIsProcessing(true);
      shouldAutoScrollRef.current = true;

      // 发送给后端 - 传递 displayContent 和 attachment 用于持久化
      window.ipcRenderer.chat.send({
        sessionId: sessionId,
        message: pendingMessage.content,
        displayContent: pendingMessage.displayContent,
        attachment: pendingMessage.attachment
      });

      // 标记消息已消费
      onMessageConsumed?.();
    };

    sendPendingMessage();
  }, [pendingMessage, isProcessing, onMessageConsumed, fixedSessionId, currentSessionId]);

  const loadSessions = async () => {
    try {
      const list = await window.ipcRenderer.chat.getSessions();
      setSessions(list);
      if (list.length > 0 && !currentSessionId) {
        selectSession(list[0].id);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const selectSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    try {
      const [history, runtimeStateRaw] = await Promise.all([
        window.ipcRenderer.chat.getMessages(sessionId),
        window.ipcRenderer.chat.getRuntimeState(sessionId),
      ]);
      const runtimeState = runtimeStateRaw as ChatRuntimeState;

      // Convert DB messages to UI messages
      const uiMessages: Message[] = history.map((msg: any) => {
        // 解析 attachment（数据库中存储为 JSON 字符串）
        let attachment = undefined;
        if (msg.attachment) {
          try {
            attachment = typeof msg.attachment === 'string' ? JSON.parse(msg.attachment) : msg.attachment;
          } catch (e) {
            console.error('Failed to parse attachment:', e);
          }
        }

        return {
          id: msg.id,
          role: msg.role === 'user' ? 'user' : 'ai', // Simplified mapping
          content: msg.content,
          displayContent: msg.display_content || undefined,
          attachment: attachment,
          tools: [], // History tools not fully reconstructed in this simple view yet
          timeline: [], // History timeline not fully reconstructed
          isStreaming: false
        };
      });

      const runtimeProcessing = Boolean(runtimeState?.success && runtimeState?.isProcessing);
      const runtimePartial = runtimeState?.partialResponse || '';
      let shouldSetProcessing = false;

      // 优先恢复后端“仍在运行”的会话状态，避免切 tab 后看起来像任务中断
      if (runtimeProcessing) {
        const restoredContent = `${runtimePartial}${missedChunksRef.current || ''}`;
        missedChunksRef.current = '';
        const lastMsg = uiMessages[uiMessages.length - 1];
        if (lastMsg && lastMsg.role === 'ai' && lastMsg.isStreaming) {
          uiMessages[uiMessages.length - 1] = {
            ...lastMsg,
            content: restoredContent || lastMsg.content || '',
            isStreaming: true,
          };
        } else {
          uiMessages.push({
            id: `streaming_${Date.now()}`,
            role: 'ai',
            content: restoredContent,
            tools: [],
            timeline: [],
            isStreaming: true,
          });
        }
        shouldSetProcessing = true;
      }

      // 检查是否有缓冲的 missedChunks（仅在后端当前不处于 processing 时回放）
      if (!runtimeProcessing && missedChunksRef.current) {
        const chunk = missedChunksRef.current;
        missedChunksRef.current = ''; // 清空缓冲

        // 检查最后一条是否是 AI 消息
        const lastMsg = uiMessages[uiMessages.length - 1];
        if (lastMsg && lastMsg.role === 'ai') {
          // 追加内容并标记为 streaming
          uiMessages[uiMessages.length - 1] = {
            ...lastMsg,
            content: lastMsg.content + chunk,
            isStreaming: true
          };
          shouldSetProcessing = true; // 恢复 processing 状态
        } else {
          // 如果没有 AI 消息，创建一个新的
          uiMessages.push({
            id: Date.now().toString(),
            role: 'ai',
            content: chunk,
            tools: [],
            timeline: [],
            isStreaming: true
          });
          shouldSetProcessing = true;
        }
      }

      setMessages(uiMessages);
      setIsProcessing(shouldSetProcessing);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const createNewSession = async () => {
    try {
      const session = await window.ipcRenderer.chat.createSession('New Chat');
      setSessions(prev => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const clearSession = async () => {
    if (!currentSessionId) return;
    try {
      await window.ipcRenderer.chat.clearMessages(currentSessionId);
      setMessages([]);
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发选择会话
    if (!confirm('确定要删除这个对话吗？')) return;

    try {
      await window.ipcRenderer.chat.deleteSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));

      // 如果删除的是当前会话，切换到其他会话或清空
      if (currentSessionId === sessionId) {
        const remaining = sessions.filter(s => s.id !== sessionId);
        if (remaining.length > 0) {
          selectSession(remaining[0].id);
        } else {
          setCurrentSessionId(null);
          setMessages([]);
        }
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleConfirmTool = useCallback((callId: string) => {
    window.ipcRenderer.chat.confirmTool(callId, true);
    setConfirmRequest(null);
  }, []);

  const handleCancelTool = useCallback((callId: string) => {
    window.ipcRenderer.chat.confirmTool(callId, false);
    setConfirmRequest(null);
  }, []);

  // 复制消息内容
  const handleCopyMessage = useCallback((messageId: string, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    });
  }, []);

  const appendAssistantChunk = useCallback((chunk: string) => {
    if (!chunk) return;
    setMessages(prev => {
      if (prev.length === 0) {
        return prev;
      }

      const lastMsg = prev[prev.length - 1];
      if (!lastMsg || lastMsg.role !== 'ai') {
        return prev;
      }

      missedChunksRef.current = consumeBufferedChunk(missedChunksRef.current, chunk);
      return [...prev.slice(0, -1), {
        ...lastMsg,
        content: lastMsg.content + chunk,
        isStreaming: true,
      }];
    });
  }, []);

  const flushPendingAssistantChunk = useCallback(() => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }

    const chunk = pendingUpdateRef.current?.content || '';
    pendingUpdateRef.current = null;
    if (chunk) {
      appendAssistantChunk(chunk);
    }
  }, [appendAssistantChunk]);

  // 处理文字选中
  const handleTextSelection = useCallback((event?: MouseEvent) => {
    const target = event?.target as HTMLElement | null;
    if (target?.closest('[data-selection-menu]')) {
      return;
    }

    // 延迟执行，确保选中完成
    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        const range = selection?.getRangeAt(0);
        const rect = range?.getBoundingClientRect();

        if (rect) {
          setSelectionMenu({
            visible: true,
            x: rect.left + rect.width / 2,
            y: rect.top - 10,
            text: selectedText
          });
          setShowRoomPicker(false);
        }
      }
    }, 10);
  }, []);

  // 点击其他地方隐藏菜单
  const handleClickOutside = useCallback((e: MouseEvent) => {
    // 检查点击是否在菜单内部
    const target = e.target as HTMLElement;
    if (target.closest('[data-selection-menu]')) {
      return;
    }
    setSelectionMenu(prev => ({ ...prev, visible: false }));
    setShowRoomPicker(false);
  }, []);

  const handleOpenRoomPicker = useCallback(async () => {
    setShowRoomPicker(true);
    await loadChatRooms();
  }, [loadChatRooms]);

  // 发送到群聊
  const handleSendToRoom = useCallback(async (roomId: string) => {
    if (!selectionMenu.text) return;

    try {
      // 发送消息到群聊 - 注意参数名是 message 而不是 content
      await window.ipcRenderer.invoke('chatrooms:send', {
        roomId,
        message: selectionMenu.text
      });

      // 隐藏菜单
      setSelectionMenu(prev => ({ ...prev, visible: false }));
      setShowRoomPicker(false);

      // 可以显示一个提示
      console.log('Message sent to room:', roomId);
    } catch (error) {
      console.error('Failed to send to room:', error);
    }
  }, [selectionMenu.text]);

  useEffect(() => {
    if (!selectionMenu.visible) {
      return;
    }
    void loadChatRooms({ silent: true });
  }, [selectionMenu.visible, loadChatRooms]);

  useEffect(() => {
    const handleSpaceChanged = () => {
      setShowRoomPicker(false);
      void loadChatRooms({ silent: true });
    };
    window.ipcRenderer.on('space:changed', handleSpaceChanged);
    return () => {
      window.ipcRenderer.off('space:changed', handleSpaceChanged);
    };
  }, [loadChatRooms]);

  // 监听选中事件
  useEffect(() => {
    const handleMouseUp = (event: MouseEvent) => handleTextSelection(event);

    // 在整个文档上监听
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleTextSelection, handleClickOutside]);

  const handleCancel = useCallback(() => {
    if (currentSessionId) {
      window.ipcRenderer.chat.cancel({ sessionId: currentSessionId });
    } else {
      window.ipcRenderer.chat.cancel();
    }
    setIsProcessing(false);
  }, [currentSessionId]);

  useEffect(() => {
    // --- Event Handlers ---

    // 1. Phase Start (e.g. Planning, Executing)
    const handlePhaseStart = (_: unknown, { name }: { name: string }) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;

        const newTimeline = [...lastMsg.timeline];
        // If the last item was running, mark it as done? No, phases can overlap or supersede.
        // Let's just add a new phase item.
        
        newTimeline.push({
          id: Math.random().toString(36),
          type: 'phase',
          title: name,
          content: '',
          status: 'running', // Phases are transient, but let's show them
          timestamp: Date.now()
        });

        return [...prev.slice(0, -1), { ...lastMsg, timeline: newTimeline }];
      });
    };

    // 2. Thought Start
    const handleThoughtStart = (_: unknown) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;

        const newTimeline = [...lastMsg.timeline];
        
        // Check if we already have a running thought (shouldn't happen with correct agent logic, but safe to check)
        const lastItem = newTimeline[newTimeline.length - 1];
        if (lastItem && lastItem.type === 'thought' && lastItem.status === 'running') {
            return prev; // Already thinking
        }

        newTimeline.push({
          id: Math.random().toString(36),
          type: 'thought',
          content: '',
          status: 'running',
          timestamp: Date.now()
        });

        return [...prev.slice(0, -1), { ...lastMsg, timeline: newTimeline }];
      });
    };

    // 3. Thought Delta
    const handleThoughtDelta = (_: unknown, data?: { content: string }) => {
      const content = data?.content;
      if (!content) return;
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;

        const newTimeline = [...lastMsg.timeline];
        const lastItemIndex = newTimeline.length - 1;
        const lastItem = newTimeline[lastItemIndex];

        if (lastItem && lastItem.type === 'thought' && lastItem.status === 'running') {
            // Update existing thought
            newTimeline[lastItemIndex] = {
                ...lastItem,
                content: (lastItem.content || '') + content
            };
        } else {
            // No running thought? Create one (fallback)
            newTimeline.push({
                id: Math.random().toString(36),
                type: 'thought',
                content: content,
                status: 'running',
                timestamp: Date.now()
            });
        }

        return [...prev.slice(0, -1), { ...lastMsg, timeline: newTimeline }];
      });
    };

    // 4. Thought End
    const handleThoughtEnd = (_: unknown) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;

        const newTimeline = [...lastMsg.timeline];
        const lastItemIndex = newTimeline.length - 1;
        const lastItem = newTimeline[lastItemIndex];

        if (lastItem && lastItem.type === 'thought' && lastItem.status === 'running') {
            newTimeline[lastItemIndex] = {
                ...lastItem,
                status: 'done',
                duration: Date.now() - lastItem.timestamp
            };
        }

        return [...prev.slice(0, -1), { ...lastMsg, timeline: newTimeline }];
      });
    };

    // Legacy handler for compatibility if backend sends old event
    const handleThinking = (_: unknown, { content }: { content: string }) => {
        // Map to thought start/delta
        // This is tricky because we don't know when it ends.
        // Let's just update the "legacy" thinking field for now if it exists
        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (!lastMsg || lastMsg.role !== 'ai') return prev;
            return [...prev.slice(0, -1), { ...lastMsg, thinking: content }];
        });
    };

  const handleResponseChunk = (_: unknown, { content }: { content: string }) => {
      if (!content) return;

      const now = Date.now();
      const lastChunk = lastStreamChunkRef.current;
      if (
        content === lastChunk.content &&
        (now - lastChunk.at) <= STREAM_CHUNK_DEDUPE_WINDOW_MS
      ) {
        return;
      }
      lastStreamChunkRef.current = { content, at: now };

      // 直接更新 Ref 缓冲，防止闭包过时
      missedChunksRef.current += content;

      // 1. Accumulate content
      if (!pendingUpdateRef.current) {
        pendingUpdateRef.current = { content: '' };
      }
      pendingUpdateRef.current.content += content;

      // 2. Start timer if not running
      if (!updateTimerRef.current) {
        updateTimerRef.current = setTimeout(() => {
          updateTimerRef.current = null;
          flushPendingAssistantChunk();
        }, STREAM_UPDATE_INTERVAL_MS);
      }
    };

    const handleToolStart = (_: unknown, toolData: { callId: string; name: string; input: unknown; description?: string }) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;

        const newTimeline = [...lastMsg.timeline];

        // Add Tool Item to Timeline
        newTimeline.push({
            id: Math.random().toString(36),
            type: 'tool-call',
            content: toolData.description || '',
            status: 'running',
            timestamp: Date.now(),
            toolData: {
                callId: toolData.callId,
                name: toolData.name,
                input: toolData.input
            }
        });

        // Also update legacy tools array
        const newTool: ToolEvent = {
          id: Math.random().toString(36),
          callId: toolData.callId,
          name: toolData.name,
          input: toolData.input,
          description: toolData.description,
          status: 'running'
        };

        return [...prev.slice(0, -1), { 
            ...lastMsg, 
            timeline: newTimeline,
            tools: [...lastMsg.tools, newTool] 
        }];
      });
    };

    const handleToolEnd = (_: unknown, toolData: { callId: string; name: string; output: { success: boolean; content: string } }) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;

        // Update Timeline
        const newTimeline = [...lastMsg.timeline];
        let matchedIndex = -1;

        // Prefer exact match with callId
        for (let i = newTimeline.length - 1; i >= 0; i--) {
            if (newTimeline[i].type === 'tool-call' && newTimeline[i].status === 'running') {
                if (newTimeline[i].toolData?.callId === toolData.callId) {
                  matchedIndex = i;
                  break;
                }
            }
        }

        // Fallback by name for backward compatibility
        if (matchedIndex === -1) {
          for (let i = newTimeline.length - 1; i >= 0; i--) {
              if (newTimeline[i].type === 'tool-call' && newTimeline[i].status === 'running') {
                  if (newTimeline[i].toolData?.name === toolData.name) {
                    matchedIndex = i;
                    break;
                  }
              }
          }
        }

        if (matchedIndex !== -1) {
          const targetItem = newTimeline[matchedIndex];
          newTimeline[matchedIndex] = {
              ...targetItem,
              status: toolData.output?.success ? 'done' : 'failed',
              duration: Date.now() - targetItem.timestamp,
              toolData: {
                  ...targetItem.toolData!,
                  output: toolData.output.content
              }
          };
        }

        // Update Legacy Tools
        const updatedTools = lastMsg.tools.map(t =>
          t.callId === toolData.callId ? { ...t, status: 'done', output: toolData.output } as ToolEvent : t
        );

        return [...prev.slice(0, -1), { 
            ...lastMsg, 
            timeline: newTimeline,
            tools: updatedTools 
        }];
      });
    };

    const handleToolUpdate = (_: unknown, toolData: { callId: string; name: string; partial: string }) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;
        if (!toolData?.partial) return prev;

        const newTimeline = [...lastMsg.timeline];
        let matchedIndex = -1;

        for (let i = newTimeline.length - 1; i >= 0; i--) {
          if (newTimeline[i].type === 'tool-call' && newTimeline[i].toolData?.callId === toolData.callId) {
            matchedIndex = i;
            break;
          }
        }

        if (matchedIndex === -1) {
          for (let i = newTimeline.length - 1; i >= 0; i--) {
            if (
              newTimeline[i].type === 'tool-call' &&
              newTimeline[i].status === 'running' &&
              newTimeline[i].toolData?.name === toolData.name
            ) {
              matchedIndex = i;
              break;
            }
          }
        }

        if (matchedIndex === -1) return prev;

        const targetItem = newTimeline[matchedIndex];
        const currentOutput = targetItem.toolData?.output || '';
        let mergedOutput = currentOutput;

        if (!currentOutput) {
          mergedOutput = toolData.partial;
        } else if (toolData.partial.startsWith(currentOutput)) {
          mergedOutput = toolData.partial;
        } else if (!currentOutput.endsWith(toolData.partial)) {
          mergedOutput = `${currentOutput}\n${toolData.partial}`;
        }

        newTimeline[matchedIndex] = {
          ...targetItem,
          toolData: {
            ...targetItem.toolData!,
            output: mergedOutput,
          },
        };

        return [...prev.slice(0, -1), {
          ...lastMsg,
          timeline: newTimeline,
        }];
      });
    };

    const handleSkillActivated = (_: unknown, skillData: { name: string; description: string }) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;
        
        // Add to Timeline
        const newTimeline = [...lastMsg.timeline, {
            id: Math.random().toString(36),
            type: 'skill' as any,
            content: skillData.description,
            status: 'done' as const,
            timestamp: Date.now(),
            skillData: skillData
        }];

        return [...prev.slice(0, -1), { 
            ...lastMsg, 
            timeline: newTimeline,
            activatedSkill: skillData 
        }];
      });
    };

    const handleConfirmRequest = (_: unknown, request: ToolConfirmRequest) => {
      setConfirmRequest(request);
    };

    const handleResponseEnd = (_: unknown, payload?: { content?: string }) => {
      flushPendingAssistantChunk();

      setIsProcessing(false);
      setErrorNotice(null);
      const finalContent = typeof payload?.content === 'string' ? payload.content : '';
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'ai') {
          const mergedContent = mergeAssistantContent(lastMsg.content || '', finalContent);
          return [...prev.slice(0, -1), { ...lastMsg, content: mergedContent, isStreaming: false }];
        }
        if (finalContent) {
          return [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'ai',
              content: finalContent,
              tools: [],
              timeline: [],
              isStreaming: false,
            }
          ];
        }
        return prev;
      });
      loadSessions(); // Update session list (e.g. title might change)
    };

    const handleSessionTitleUpdated = (_: unknown, { sessionId, title }: { sessionId: string; title: string }) => {
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, title } : s
      ));
    };

    const handlePlanUpdated = (_: unknown, { steps }: { steps: any[] }) => {
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (!lastMsg || lastMsg.role !== 'ai') return prev;

        return [...prev.slice(0, -1), { ...lastMsg, plan: steps }];
      });
    };

    const handleError = (_: unknown, error: ChatErrorEventPayload | string) => {
      setIsProcessing(false);
      setConfirmRequest(null);
      const { formatted, notice } = deriveChatErrorPresentation(error);
      setErrorNotice(notice);
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'ai' && lastMsg.isStreaming) {
          return [...prev.slice(0, -1), { ...lastMsg, content: formatted, isStreaming: false }];
        }
        return [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'ai',
            content: formatted,
            tools: [],
            timeline: [],
            isStreaming: false,
          }
        ];
      });
    };

    // Register Listeners
    window.ipcRenderer.on('chat:phase-start', handlePhaseStart);
    window.ipcRenderer.on('chat:thought-start', handleThoughtStart);
    window.ipcRenderer.on('chat:thought-delta', handleThoughtDelta);
    window.ipcRenderer.on('chat:thought-end', handleThoughtEnd);
    window.ipcRenderer.on('chat:thinking', handleThinking); // Keep legacy
    window.ipcRenderer.on('chat:response-chunk', handleResponseChunk);
    window.ipcRenderer.on('chat:tool-start', handleToolStart);
    window.ipcRenderer.on('chat:tool-update', handleToolUpdate);
    window.ipcRenderer.on('chat:tool-end', handleToolEnd);
    window.ipcRenderer.on('chat:skill-activated', handleSkillActivated);
    window.ipcRenderer.on('chat:tool-confirm-request', handleConfirmRequest);
    window.ipcRenderer.on('chat:response-end', handleResponseEnd);
    window.ipcRenderer.on('chat:error', handleError);
    window.ipcRenderer.on('chat:session-title-updated', handleSessionTitleUpdated);
    window.ipcRenderer.on('chat:plan-updated', handlePlanUpdated);

    return () => {
      window.ipcRenderer.off('chat:phase-start', handlePhaseStart);
      window.ipcRenderer.off('chat:thought-start', handleThoughtStart);
      window.ipcRenderer.off('chat:thought-delta', handleThoughtDelta);
      window.ipcRenderer.off('chat:thought-end', handleThoughtEnd);
      window.ipcRenderer.off('chat:thinking', handleThinking);
      window.ipcRenderer.off('chat:response-chunk', handleResponseChunk);
      window.ipcRenderer.off('chat:tool-start', handleToolStart);
      window.ipcRenderer.off('chat:tool-update', handleToolUpdate);
      window.ipcRenderer.off('chat:tool-end', handleToolEnd);
      window.ipcRenderer.off('chat:skill-activated', handleSkillActivated);
      window.ipcRenderer.off('chat:tool-confirm-request', handleConfirmRequest);
      window.ipcRenderer.off('chat:response-end', handleResponseEnd);
      window.ipcRenderer.off('chat:error', handleError);
      window.ipcRenderer.off('chat:session-title-updated', handleSessionTitleUpdated);
      window.ipcRenderer.off('chat:plan-updated', handlePlanUpdated);

      // Cleanup timer
      if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !pendingAttachment) || isProcessing) return;

    sendMessage(input, pendingAttachment || undefined);
  };

  const pickAttachment = useCallback(async () => {
    if (isProcessing) return;
    try {
      const result = await window.ipcRenderer.chat.pickAttachment({
        sessionId: currentSessionId || undefined,
      }) as { success?: boolean; canceled?: boolean; error?: string; attachment?: UploadedFileAttachment };
      if (!result?.success) {
        setErrorNotice(result?.error || '上传文件失败');
        return;
      }
      if (result.canceled) return;
      if (result.attachment) {
        setPendingAttachment(result.attachment);
      }
    } catch (error) {
      setErrorNotice(String(error || '上传文件失败'));
    }
  }, [currentSessionId, isProcessing]);

  const sendMessage = (content: string, attachment?: UploadedFileAttachment) => {
    shouldAutoScrollRef.current = true;
    setErrorNotice(null);
    const normalizedContent = String(content || '').trim();
    const displayText = normalizedContent || (attachment ? `请分析这个附件：${attachment.name}` : '');
    if (!displayText) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: normalizedContent || displayText,
      displayContent: displayText,
      attachment: attachment as unknown as Message['attachment'],
      tools: [],
      timeline: []
    };

    const aiPlaceholder: Message = {
      id: (Date.now() + 1).toString(),
      role: 'ai',
      content: '',
      tools: [],
      timeline: [],
      isStreaming: true
    };

    setMessages(prev => [...prev, userMsg, aiPlaceholder]);
    setInput('');
    setPendingAttachment(null);
    setIsProcessing(true);

    window.ipcRenderer.chat.send({
      sessionId: currentSessionId || undefined,
      message: normalizedContent || displayText,
      displayContent: displayText,
      attachment,
    });
  };

  const shortcuts = shortcutsProp || [
    { label: '📝 总结内容', text: '请总结以上内容，提炼核心要点。' },
    { label: '💡 提炼观点', text: '请提炼其中的关键观点和洞察。' },
    { label: '✂️ 润色优化', text: '请润色这段内容，使其更具吸引力。' },
    { label: '❓ 延伸提问', text: '基于以上内容，提出3个值得思考的延伸问题。' },
  ];

  const welcomeShortcuts = welcomeShortcutsProp || [
    { label: '📄 阅读稿件', text: '请帮我阅读并理解当前的稿件内容。' },
    { label: '✏️ 编辑稿件', text: '我想对当前稿件进行编辑优化，请提供建议。' },
    { label: '🔍 内容分析', text: '请深度分析当前内容，提炼核心观点。' },
    { label: '💡 创作建议', text: '请基于当前内容提供一些创作方向的建议。' }
  ];

  const formatTokenLabel = (value?: number) => {
    const safe = Math.max(0, Math.round(Number(value || 0)));
    if (safe >= 1000) {
      return `${Math.round(safe / 1000)}k`;
    }
    return `${safe}`;
  };

  const compactRatio = Math.max(0, Number(contextUsage?.compactRatio || 0));
  const contextUsedPercentRaw = Math.max(0, Math.min(100, compactRatio * 100));
  const contextRemainingPercentRaw = Math.max(0, 100 - contextUsedPercentRaw);
  const contextUsedPercentDisplay = contextUsedPercentRaw < 10
    ? contextUsedPercentRaw.toFixed(1)
    : `${Math.round(contextUsedPercentRaw)}`;
  const contextRemainingRounded = Math.round(contextRemainingPercentRaw);
  const contextRemainingPercent = compactRatio > 0 && contextRemainingRounded >= 100
    ? 99
    : Math.max(0, Math.min(100, contextRemainingRounded));
  const contextBadgeClass = contextUsedPercentRaw >= 90
    ? 'text-red-600 border-red-500/40 bg-red-500/10'
    : contextUsedPercentRaw >= 70
      ? 'text-amber-600 border-amber-500/40 bg-amber-500/10'
      : 'text-text-secondary border-border bg-surface-secondary/90';
  const compactThreshold = Math.max(0, Math.round(contextUsage?.compactThreshold || 0));
  const estimatedTotalTokens = Math.max(0, Math.round(contextUsage?.estimatedTotalTokens || 0));
  const contextRemainingRatio = Math.max(0, Math.min(1, 1 - compactRatio));
  const contextRingRadius = 17;
  const contextRingCircumference = 2 * Math.PI * contextRingRadius;
  const contextRingOffset = contextRingCircumference * (1 - contextRemainingRatio);
  const contextRingColorClass = contextRemainingPercentRaw <= 15
    ? 'text-red-500'
    : contextRemainingPercentRaw <= 35
      ? 'text-amber-500'
      : 'text-emerald-500';
  const isCompactWorkflowMode = Boolean(fixedSessionId && fixedSessionContextIndicatorMode === 'corner-ring');

  return (
    <div className={clsx('flex h-full min-w-0', wideContent && 'chat-layout-wide')}>
      {/* Sidebar - Session List (可折叠) - Only show if not fixed session */}
      {!fixedSessionId && (
      <div className={clsx(
        "bg-surface-secondary border-r border-border flex flex-col transition-all duration-300",
        sidebarCollapsed ? "w-0 overflow-hidden" : "w-64"
      )}>
        <div className="p-4 border-b border-border flex items-center gap-2">
          <button
            onClick={createNewSession}
            className="flex-1 flex items-center justify-center gap-2 bg-accent-primary text-white py-2 rounded-lg hover:bg-accent-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新对话
          </button>
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="p-2 text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary rounded-lg transition-colors"
            title="收起侧边栏"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map(session => (
            <div
              key={session.id}
              className={clsx(
                "group w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2 cursor-pointer",
                currentSessionId === session.id
                  ? "bg-surface-tertiary text-text-primary font-medium"
                  : "text-text-secondary hover:bg-surface-tertiary/50"
              )}
              onClick={() => selectSession(session.id)}
            >
              <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
              <span className="truncate flex-1">{session.title || 'Untitled Chat'}</span>
              <button
                onClick={(e) => deleteSession(session.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
                title="删除对话"
              >
                <X className="w-3 h-3 text-red-500" />
              </button>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 min-w-0 flex flex-col h-full relative">
        {/* Tool Confirmation Dialog */}
        <ToolConfirmDialog
          request={confirmRequest}
          onConfirm={handleConfirmTool}
          onCancel={handleCancelTool}
        />

        {/* Header - Sidebar Controls - Hide if fixed session */}
        {!fixedSessionId && (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-2 text-text-tertiary hover:text-text-primary transition-colors bg-surface-primary/80 backdrop-blur rounded-full shadow-sm border border-border"
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          {sidebarCollapsed && (
            <button
              onClick={createNewSession}
              className="p-2 text-text-tertiary hover:text-text-primary transition-colors bg-surface-primary/80 backdrop-blur rounded-full shadow-sm border border-border"
              title="新对话"
            >
              <Edit className="w-4 h-4" />
            </button>
          )}
        </div>
        )}

        {/* Linked Session Indicator */}
        {fixedSessionId && currentSessionId && fixedSessionBannerText && fixedSessionContextIndicatorMode === 'top' && (
            <div className="absolute top-0 left-0 right-0 z-10 flex flex-col items-center gap-1 pointer-events-none">
                <div className="bg-surface-secondary/90 backdrop-blur text-xs font-medium text-text-secondary px-3 py-1 rounded-b-lg shadow-sm border-b border-x border-border">
                   {fixedSessionBannerText}
                </div>
                {contextUsage?.success && (
                  <div className={clsx('text-[11px] px-2.5 py-1 rounded-full border backdrop-blur', contextBadgeClass)}>
                    上下文 {contextUsedPercentDisplay}% · {contextUsage.estimatedTotalTokens || 0}/{contextUsage.compactThreshold || 0} tokens · compact {contextUsage.compactRounds || 0} 次
                  </div>
                )}
            </div>
        )}

        {/* Corner Ring Compact Indicator (for fixed session, e.g. RedClaw) */}
        {fixedSessionId && currentSessionId && contextUsage?.success && fixedSessionContextIndicatorMode === 'corner-ring' && (
          <div className="absolute right-6 bottom-28 z-20 pointer-events-none">
            <div className="relative group pointer-events-auto">
              <button
                type="button"
                className="relative w-14 h-14 rounded-full border border-border bg-surface-primary/95 backdrop-blur shadow-md flex items-center justify-center"
                title="上下文窗口剩余空间"
                aria-label="上下文窗口剩余空间"
              >
                <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                  <circle
                    cx="22"
                    cy="22"
                    r={contextRingRadius}
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="text-border"
                  />
                  <circle
                    cx="22"
                    cy="22"
                    r={contextRingRadius}
                    fill="transparent"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className={contextRingColorClass}
                    strokeDasharray={contextRingCircumference}
                    strokeDashoffset={contextRingOffset}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-text-primary">
                  {contextRemainingPercent}%
                </span>
              </button>

                <div className="absolute right-0 bottom-[68px] w-64 p-3 rounded-2xl border border-border bg-surface-primary/95 backdrop-blur shadow-xl text-xs text-text-secondary opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100">
                <div className="font-semibold text-text-primary mb-1">背景信息窗口</div>
                <div>{contextUsedPercentDisplay}% 已用（剩余 {contextRemainingPercentRaw.toFixed(1)}%）</div>
                <div>已用 {formatTokenLabel(estimatedTotalTokens)} 标记，共 {formatTokenLabel(compactThreshold)}</div>
                <div className="mt-1 text-text-tertiary">RedClaw 自动压缩其背景信息</div>
              </div>
            </div>
          </div>
        )}

        {/* Header Actions - 清除按钮 */}
        {showClearButton && currentSessionId && messages.length > 0 && (
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={clearSession}
              className="p-2 text-text-tertiary hover:text-red-500 transition-colors bg-surface-primary/80 backdrop-blur rounded-full shadow-sm border border-border"
              title="清除历史"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 空会话时显示居中欢迎界面 */}
        {isEmptySession ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <div className={clsx('text-center space-y-6', emptySessionWidthClass)}>
              {/* Logo/Icon */}
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-primary to-purple-600 flex items-center justify-center shadow-lg">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
              </div>

              {/* 欢迎文字 */}
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-text-primary">{welcomeTitle}</h1>
                <p className="text-sm text-text-tertiary">
                  {welcomeSubtitle}
                </p>
              </div>

              {showWelcomeShortcuts && welcomeShortcuts.length > 0 && (
                <div className="flex flex-wrap justify-center gap-2 text-xs">
                  {welcomeShortcuts.map((shortcut) => (
                    <button
                      key={shortcut.label}
                      onClick={() => sendMessage(shortcut.text)}
                      className="px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary border border-transparent hover:border-border rounded-full text-text-secondary hover:text-accent-primary transition-all cursor-pointer"
                    >
                      {shortcut.label}
                    </button>
                  ))}
                </div>
              )}

              {/* 居中的输入框 */}
              <form onSubmit={handleSubmit} className="relative w-full mt-8">
                <div className="relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="输入您的问题，或描述您想完成的任务..."
                    className="w-full bg-surface-secondary border border-border rounded-xl pl-4 pr-24 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all shadow-sm"
                    disabled={isProcessing}
                    autoFocus
                  />
                  <div className="absolute right-3 top-3 flex items-center gap-2">
                    {allowFileUpload && (
                      <button
                        type="button"
                        onClick={() => void pickAttachment()}
                        disabled={isProcessing}
                        className="p-2 rounded-lg text-text-secondary hover:bg-surface-tertiary disabled:opacity-40"
                        title="上传文件"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={(!input.trim() && !pendingAttachment) || isProcessing}
                      className="p-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 disabled:opacity-30 disabled:hover:bg-accent-primary transition-colors"
                    >
                      {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {allowFileUpload && pendingAttachment && (
                  <div className="mt-2 rounded-lg border border-border bg-surface-secondary/60 px-3 py-2 text-xs text-text-secondary flex items-center justify-between">
                    <span className="truncate">附件: {pendingAttachment.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingAttachment(null)}
                      className="ml-2 text-text-tertiary hover:text-text-primary"
                      title="移除附件"
                    >
                      <FileX className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        ) : (
          <>
            {/* Selection Menu - 选中文字快捷菜单 */}
            {selectionMenu.visible && (
              <div
                data-selection-menu
                className="fixed z-[1000] transform -translate-x-1/2 -translate-y-full"
                style={{ left: selectionMenu.x, top: selectionMenu.y }}
              >
                <div className="bg-surface-primary border border-border rounded-lg shadow-xl overflow-hidden">
                  {!showRoomPicker ? (
                    <button
                      onClick={() => void handleOpenRoomPicker()}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface-secondary transition-colors whitespace-nowrap"
                    >
                      <Users className="w-4 h-4" />
                      发送到群聊讨论
                    </button>
                  ) : (
                    <div className="min-w-[180px]">
                      <div className="px-3 py-2 text-xs text-text-tertiary border-b border-border bg-surface-secondary">
                        选择群聊
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {isRoomPickerLoading ? (
                          <div className="px-3 py-2 text-sm text-text-tertiary flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            加载群聊中...
                          </div>
                        ) : chatRooms.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-text-tertiary">
                            暂无群聊
                          </div>
                        ) : (
                          chatRooms.map((room) => (
                            <button
                              key={room.id}
                              onClick={() => handleSendToRoom(room.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface-secondary transition-colors text-left"
                            >
                              <MessageSquare className="w-4 h-4 text-text-tertiary" />
                              <span className="truncate">{room.name}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {/* 小三角箭头 */}
                <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-surface-primary border-r border-b border-border transform rotate-45" />
              </div>
            )}

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              className={clsx('flex-1 min-w-0 overflow-y-auto py-5 md:py-6', contentOuterPaddingClass)}
            >
              <div className={clsx('mx-auto min-w-0 space-y-5 md:space-y-6', contentMaxWidthClass, contentWidthClass)}>
                {messages.map((msg) => (
                  <ErrorBoundary key={msg.id} name={`MessageItem-${msg.id}`}>
                      <MessageItem
                        msg={msg}
                        copiedMessageId={copiedMessageId}
                        onCopyMessage={handleCopyMessage}
                        workflowPlacement="bottom"
                        workflowVariant="compact"
                      />
                  </ErrorBoundary>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input Area - 底部固定 */}
            <div className={clsx('border-t border-border bg-surface-primary pb-5 pt-2 md:pb-6', contentOuterPaddingClass)}>
              <div className={clsx('mx-auto', contentMaxWidthClass, contentWidthClass)}>
                {errorNotice && (
                  <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {errorNotice}
                  </div>
                )}
                {showComposerShortcuts && shortcuts.length > 0 && (
                  <div className="mb-2 flex gap-2 overflow-x-auto py-1 no-scrollbar">
                    {shortcuts.map((shortcut) => (
                      <button
                        key={shortcut.label}
                        onClick={() => sendMessage(shortcut.text)}
                        disabled={isProcessing}
                        className="flex-shrink-0 rounded-full border border-border bg-surface-primary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent-primary/30 hover:text-accent-primary disabled:opacity-50"
                      >
                        {shortcut.label}
                      </button>
                    ))}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="relative w-full">
                  {allowFileUpload && pendingAttachment && (
                    <div className="mb-2 rounded-lg border border-border bg-surface-secondary/60 px-3 py-2 text-xs text-text-secondary flex items-center justify-between">
                      <span className="truncate">附件: {pendingAttachment.name}</span>
                      <button
                        type="button"
                        onClick={() => setPendingAttachment(null)}
                        className="ml-2 text-text-tertiary hover:text-text-primary"
                        title="移除附件"
                      >
                        <FileX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface-secondary px-3 py-2 shadow-sm transition-colors focus-within:border-accent-primary/40 focus-within:shadow">
                    <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="输入消息..."
                      className="h-10 flex-1 bg-transparent px-1 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                      disabled={isProcessing}
                    />
                    <div className="flex items-center gap-1">
                    {allowFileUpload && (
                      <button
                        type="button"
                        onClick={() => void pickAttachment()}
                        disabled={isProcessing}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:opacity-40"
                        title="上传文件"
                      >
                        <Paperclip className="h-4 w-4" />
                      </button>
                    )}
                    {isProcessing && (
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600"
                        title="Cancel"
                      >
                        <StopCircle className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={(!input.trim() && !pendingAttachment) || isProcessing}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-primary text-white shadow-sm transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                  </div>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
