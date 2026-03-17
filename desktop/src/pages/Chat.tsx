import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Terminal, Loader2, StopCircle, Trash2, Plus, MessageSquare, X, PanelLeftClose, PanelLeft, Sparkles, Edit, Users } from 'lucide-react';
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
  welcomeTitle?: string;
  welcomeSubtitle?: string;
  contentLayout?: 'default' | 'center-2-3';
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
  welcomeTitle = '有什么可以帮您？',
  welcomeSubtitle = '我可以帮您阅读和编辑稿件、分析内容、提供创作建议',
  contentLayout = 'default',
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Throttle buffer for streaming updates
  const pendingUpdateRef = useRef<{ content: string } | null>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // 缓冲未处理的 chunk，用于解决页面加载期间的数据丢失问题
  const missedChunksRef = useRef<string>('');
  const centeredContent = contentLayout === 'center-2-3';
  const contentWidthClass = centeredContent ? 'w-2/3 mx-auto' : 'w-full';

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
      if (container) {
        container.scrollTop = container.scrollHeight;
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }
    });
  }, [messages, currentSessionId]);

  // Load sessions on mount
  useEffect(() => {
    loadChatRooms();

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
  }, [fixedSessionId]); // Add fixedSessionId dependency

  // 加载群聊列表
  const loadChatRooms = async () => {
    try {
      const rooms = await window.ipcRenderer.invoke('chatrooms:list') as ChatRoom[];
      setChatRooms(rooms || []);
    } catch (error) {
      console.error('Failed to load chat rooms:', error);
    }
  };

  // 处理从其他页面传来的待发送消息（如知识库的"AI脑爆"）
  useEffect(() => {
    // 已处理过或正在处理中，跳过
    if (!pendingMessage || isProcessing || pendingMessageHandledRef.current) {
      return;
    }

    // 标记为已处理
    pendingMessageHandledRef.current = true;

    const sendPendingMessage = async () => {
      // 总是创建新会话用于 AI 脑爆
      let sessionId: string;
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

      // 直接设置消息（不是追加，因为是新会话）
      setMessages([userMsg, aiPlaceholder]);
      setIsProcessing(true);

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
  }, [pendingMessage, isProcessing, onMessageConsumed]);

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
      const history = await window.ipcRenderer.chat.getMessages(sessionId);
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

      // 检查是否有缓冲的 missedChunks
      if (missedChunksRef.current) {
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
          setIsProcessing(true); // 恢复 processing 状态
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
          setIsProcessing(true);
        }
      }

      setMessages(uiMessages);
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

  // 处理文字选中
  const handleTextSelection = useCallback(() => {
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

  // 监听选中事件
  useEffect(() => {
    const handleMouseUp = () => handleTextSelection();

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
          const chunk = pendingUpdateRef.current?.content || '';
          pendingUpdateRef.current = null;
          updateTimerRef.current = null;

          if (!chunk) return;

          // 清空对应的缓冲，因为即将写入 State
          missedChunksRef.current = missedChunksRef.current.replace(chunk, '');

          // 3. Batch update
          setMessages(prev => {
            // 如果消息列表为空，说明可能正在加载中，保持在 missedChunksRef 中等待回放
            if (prev.length === 0) {
                // 回滚缓冲
                missedChunksRef.current = chunk + missedChunksRef.current;
                return prev;
            }

            const lastMsg = prev[prev.length - 1];
            // 如果最后一条不是 AI 消息，也缓冲起来
            if (!lastMsg || lastMsg.role !== 'ai') {
                missedChunksRef.current = chunk + missedChunksRef.current;
                return prev;
            }

            return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + chunk }];
          });
        }, 100); // 10FPS throttle
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
            content: '', // Can be description
            status: 'running',
            timestamp: Date.now(),
            toolData: {
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
        // Find the tool item. Since callId isn't on ProcessItem root, we might need to store it or find by toolData.
        // But for simplicity, we assume the last 'tool-call' running item is the one (since tools are usually sequential in our agent).
        // A better way is to add callId to ProcessItem.
        // Let's iterate backwards.
        for (let i = newTimeline.length - 1; i >= 0; i--) {
            if (newTimeline[i].type === 'tool-call' && newTimeline[i].status === 'running') {
                // Check name if possible, or just assume order
                if (newTimeline[i].toolData?.name === toolData.name) {
                    newTimeline[i] = {
                        ...newTimeline[i],
                        status: toolData.output?.success ? 'done' : 'failed',
                        duration: Date.now() - newTimeline[i].timestamp,
                        toolData: {
                            ...newTimeline[i].toolData!,
                            output: toolData.output.content
                        }
                    };
                    break;
                }
            }
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

    const handleResponseEnd = () => {
      // Flush any pending updates immediately
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
        const chunk = pendingUpdateRef.current?.content || '';
        pendingUpdateRef.current = null;

        if (chunk) {
            missedChunksRef.current = missedChunksRef.current.replace(chunk, '');
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (!lastMsg || lastMsg.role !== 'ai') return prev;
                return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + chunk }];
            });
        }
      }

      setIsProcessing(false);
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'ai') {
          return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
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

    const handleError = (_: unknown, error: { message: string }) => {
      setIsProcessing(false);
      setConfirmRequest(null);
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'ai',
          content: `Error: ${error.message}`,
          tools: [],
          timeline: [],
          isStreaming: false
        }
      ]);
    };

    // Register Listeners
    window.ipcRenderer.on('chat:phase-start', handlePhaseStart);
    window.ipcRenderer.on('chat:thought-start', handleThoughtStart);
    window.ipcRenderer.on('chat:thought-delta', handleThoughtDelta);
    window.ipcRenderer.on('chat:thought-end', handleThoughtEnd);
    window.ipcRenderer.on('chat:thinking', handleThinking); // Keep legacy
    window.ipcRenderer.on('chat:response-chunk', handleResponseChunk);
    window.ipcRenderer.on('chat:tool-start', handleToolStart);
    window.ipcRenderer.on('chat:tool-end', handleToolEnd);
    window.ipcRenderer.on('chat:skill-activated', handleSkillActivated);
    window.ipcRenderer.on('chat:tool-confirm-request', handleConfirmRequest);
    window.ipcRenderer.on('chat:response-end', handleResponseEnd);
    window.ipcRenderer.on('chat:done', handleResponseEnd); // Fallback
    window.ipcRenderer.on('chat:error', handleError);
    window.ipcRenderer.on('chat:session-title-updated', handleSessionTitleUpdated);
    window.ipcRenderer.on('chat:plan-updated', handlePlanUpdated);

    return () => {
      window.ipcRenderer.removeAllListeners('chat:phase-start');
      window.ipcRenderer.removeAllListeners('chat:thought-start');
      window.ipcRenderer.removeAllListeners('chat:thought-delta');
      window.ipcRenderer.removeAllListeners('chat:thought-end');
      window.ipcRenderer.removeAllListeners('chat:thinking');
      window.ipcRenderer.removeAllListeners('chat:response-chunk');
      window.ipcRenderer.removeAllListeners('chat:tool-start');
      window.ipcRenderer.removeAllListeners('chat:tool-end');
      window.ipcRenderer.removeAllListeners('chat:skill-activated');
      window.ipcRenderer.removeAllListeners('chat:tool-confirm-request');
      window.ipcRenderer.removeAllListeners('chat:response-end');
      window.ipcRenderer.removeAllListeners('chat:done');
      window.ipcRenderer.removeAllListeners('chat:error');
      window.ipcRenderer.removeAllListeners('chat:session-title-updated');
      window.ipcRenderer.removeAllListeners('chat:plan-updated');

      // Cleanup timer
      if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    sendMessage(input);
  };

  const sendMessage = (content: string) => {
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: content,
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
    setIsProcessing(true);

    window.ipcRenderer.chat.send({
      sessionId: currentSessionId || undefined,
      message: content
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

  return (
    <div className="flex h-full">
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
      <div className="flex-1 flex flex-col h-full relative">
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
        {fixedSessionId && currentSessionId && fixedSessionBannerText && (
            <div className="absolute top-0 left-0 right-0 z-10 flex justify-center pointer-events-none">
                <div className="bg-surface-secondary/90 backdrop-blur text-xs font-medium text-text-secondary px-3 py-1 rounded-b-lg shadow-sm border-b border-x border-border">
                   {fixedSessionBannerText}
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
            <div className={clsx(
              'text-center space-y-6',
              centeredContent ? 'w-2/3 mx-auto' : 'max-w-2xl w-full',
            )}>
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

              {/* 快捷功能提示 */}
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

              {/* 居中的输入框 */}
              <form onSubmit={handleSubmit} className="relative w-full mt-8">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="输入您的问题，或描述您想完成的任务..."
                  className="w-full bg-surface-secondary border border-border rounded-xl pl-4 pr-14 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all shadow-sm"
                  disabled={isProcessing}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isProcessing}
                  className="absolute right-3 top-3 p-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 disabled:opacity-30 disabled:hover:bg-accent-primary transition-colors"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <>
            {/* Selection Menu - 选中文字快捷菜单 */}
            {selectionMenu.visible && (
              <div
                data-selection-menu
                className="fixed z-[100] transform -translate-x-1/2 -translate-y-full"
                style={{ left: selectionMenu.x, top: selectionMenu.y }}
              >
                <div className="bg-surface-primary border border-border rounded-lg shadow-xl overflow-hidden">
                  {!showRoomPicker ? (
                    <button
                      onClick={() => setShowRoomPicker(true)}
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
                        {chatRooms.length === 0 ? (
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
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-6">
              <div className={clsx('space-y-8', contentWidthClass)}>
                {messages.map((msg) => (
                  <ErrorBoundary key={msg.id} name={`MessageItem-${msg.id}`}>
                      <MessageItem
                        msg={msg}
                        copiedMessageId={copiedMessageId}
                        onCopyMessage={handleCopyMessage}
                      />
                  </ErrorBoundary>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input Area - 底部固定 */}
            <div className="p-6 pt-2 border-t border-border bg-surface-primary">
              <div className={contentWidthClass}>
                {/* Shortcuts */}
                <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar py-1">
                  {shortcuts.map((shortcut) => (
                    <button
                      key={shortcut.label}
                      onClick={() => sendMessage(shortcut.text)}
                      disabled={isProcessing}
                      className="flex-shrink-0 px-3 py-1.5 bg-surface-secondary hover:bg-surface-tertiary border border-border rounded-full text-xs text-text-secondary transition-colors disabled:opacity-50 hover:text-accent-primary"
                    >
                      {shortcut.label}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSubmit} className="relative w-full">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="输入消息..."
                    className="w-full bg-surface-secondary border border-border rounded-lg pl-4 pr-20 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary transition-all shadow-sm"
                    disabled={isProcessing}
                  />
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    {isProcessing && (
                      <button
                        type="button"
                        onClick={handleCancel}
                        className="p-1.5 text-red-500 hover:text-red-600 transition-colors"
                        title="Cancel"
                      >
                        <StopCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={!input.trim() || isProcessing}
                      className="p-1.5 text-text-secondary hover:text-accent-primary disabled:opacity-30 transition-colors"
                    >
                      {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
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
