import { useState, useEffect } from 'react';
import { RefreshCw, Sparkles, History, X, Trash2, PenLine, Dices, Lightbulb, FileText, Play } from 'lucide-react';
import { clsx } from 'clsx';

interface WanderItem {
  id: string;
  type: 'note' | 'video';
  title: string;
  content: string;
  cover?: string;
}

interface WanderResult {
  content_direction: string;
  thinking_process: string[];
  topic: { title: string; connections: number[] };
}

interface WanderHistoryRecord {
  id: string;
  items: string;
  result: string;
  created_at: number;
}

interface WanderProps {
  onNavigateToManuscript?: (filePath: string) => void;
}

export function Wander({ onNavigateToManuscript }: WanderProps) {
  const [items, setItems] = useState<WanderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [parsedResult, setParsedResult] = useState<WanderResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [showFinal, setShowFinal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<WanderHistoryRecord[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  // 去创作：创建稿件并跳转
  const goCreate = async () => {
    if (!parsedResult || !onNavigateToManuscript) return;
    const title = parsedResult.topic.title;
    // 兼容旧字段名 connections 和新字段名 content_direction
    const direction = parsedResult.content_direction || (parsedResult as any).connections || '';
    const content = `# ${title}\n\n## 内容方向\n\n${direction}\n\n## 正文\n\n`;

    const result = await window.ipcRenderer.invoke('manuscripts:create-file', {
      parentPath: '',
      name: title,
      content
    }) as { success: boolean; path?: string; error?: string };

    if (result.success && result.path) {
      onNavigateToManuscript(result.path);
    } else {
      console.error('Failed to create manuscript:', result.error);
    }
  };

  // 加载历史记录列表
  const loadHistoryList = async () => {
    const list = await window.ipcRenderer.invoke('wander:list-history') as WanderHistoryRecord[];
    setHistoryList(list);
    return list;
  };

  // 加载单条历史记录
  const loadHistory = (record: WanderHistoryRecord) => {
    try {
      const parsedItems = JSON.parse(record.items) as WanderItem[];
      const parsedRes = JSON.parse(record.result) as WanderResult;
      setItems(parsedItems);
      setParsedResult(parsedRes);
      setParseError(null);
      setPhase('done');
      setShowFinal(true);
      setCurrentHistoryId(record.id);
      setShowHistory(false);
    } catch (e) {
      console.error('Failed to parse history:', e);
    }
  };

  // 删除历史记录
  const deleteHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await window.ipcRenderer.invoke('wander:delete-history', id);
    const newList = historyList.filter(h => h.id !== id);
    setHistoryList(newList);
    if (currentHistoryId === id) {
      if (newList.length > 0) {
        loadHistory(newList[0]);
      } else {
        setPhase('idle');
        setShowFinal(false);
        setParsedResult(null);
        setItems([]);
        setCurrentHistoryId(null);
      }
    }
  };

  // 初始化：加载最新的历史记录
  useEffect(() => {
    (async () => {
      const list = await loadHistoryList();
      if (list.length > 0) {
        loadHistory(list[0]);
      } else {
        // 没有历史时强制回到初始态，避免状态残留导致无法开始第一次漫步
        setPhase('idle');
        setShowFinal(false);
        setParsedResult(null);
        setParseError(null);
        setItems([]);
        setCurrentHistoryId(null);
      }
    })();
  }, []);

  const parseJsonPayload = <T,>(payload?: string | null): T | null => {
    if (!payload) return null;
    const trimmed = payload.trim();
    const stripCodeFence = (text: string) => text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const tryParse = (text: string) => {
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    };
    const direct = tryParse(trimmed);
    if (direct) return direct;
    const noFence = tryParse(stripCodeFence(trimmed));
    if (noFence) return noFence;
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    return null;
  };

  const startWander = async () => {
    setPhase('running');
    setLoading(true);
    setParsedResult(null);
    setParseError(null);
    setItems([]);
    setShowFinal(false);
    setCurrentHistoryId(null);
    try {
      const randomItems = await window.ipcRenderer.invoke('wander:get-random') as WanderItem[];
      setItems(randomItems);
      if (randomItems.length === 0) {
        setParseError('暂无足够内容，请先收集一些笔记或视频。');
        setPhase('done');
        setShowFinal(true);
        return;
      }
      const response = await window.ipcRenderer.invoke('wander:brainstorm', randomItems) as { result: string; historyId?: string; error?: string };
      if (response.error) {
        setParsedResult(null);
        setParseError(response.error);
      } else {
        const parsed = parseJsonPayload<WanderResult>(response.result);
        if (parsed && parsed.topic) {
          setParsedResult(parsed);
          if (response.historyId) {
            setCurrentHistoryId(response.historyId);
            loadHistoryList();
          }
        } else {
          setParsedResult(null);
          setParseError('结果解析失败');
        }
      }
      setPhase('done');
      setShowFinal(true);
    } catch (error) {
      console.error('Brainstorm failed:', error);
      setParsedResult(null);
      setParseError('调用失败，请稍后重试');
      setPhase('done');
      setShowFinal(true);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full flex flex-col bg-surface-primary overflow-hidden">
      {phase === 'idle' ? (
        <div className="flex-1 flex flex-col items-center justify-center space-y-6">
          <div className="p-4 bg-accent-primary/10 rounded-full">
            <Dices className="w-12 h-12 text-accent-primary opacity-80" />
          </div>
          <div className="text-center space-y-2 max-w-md">
            <h2 className="text-lg font-semibold text-text-primary">开启一次随机漫步</h2>
            <p className="text-sm text-text-tertiary">
              系统将从您的知识库中随机抽取内容，
              <br />
              寻找它们之间的隐秘关联，激发新的创作灵感。
            </p>
          </div>
          <button
            onClick={startWander}
            className="group px-6 py-2.5 bg-accent-primary hover:bg-accent-hover text-white rounded-lg font-medium transition-all flex items-center gap-2 shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            <span>开始漫步</span>
          </button>
        </div>
      ) : (
        <>
          <div className="px-8 py-6 border-b border-border bg-surface-primary flex items-center justify-between shrink-0">
            <div>
              <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <Dices className="w-5 h-5 text-brand-red" />
                漫步模式
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { loadHistoryList(); setShowHistory(true); }}
                className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-surface-secondary rounded-lg transition-colors"
              >
                <History className="w-4 h-4" />
                历史记录
              </button>
              <button
                onClick={startWander}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 bg-surface-secondary hover:bg-surface-hover text-text-primary text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={clsx("w-3.5 h-3.5", loading && "animate-spin")} />
                再次漫步
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-4xl mx-auto space-y-8">
              {loading && (
                <div className="flex flex-col items-center justify-center gap-4 py-20 animate-in fade-in duration-500">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full border-2 border-surface-secondary"></div>
                    <div className="absolute top-0 left-0 w-12 h-12 rounded-full border-2 border-brand-red border-t-transparent animate-spin"></div>
                  </div>
                  <div className="text-sm text-text-tertiary">正在漫步并寻找灵感...</div>
                </div>
              )}

              {showFinal && parsedResult && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  {/* 选题结果 */}
                  <div className="bg-surface-primary border border-border rounded-xl p-6 shadow-sm">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2 text-brand-red mb-2">
                        <Lightbulb className="w-5 h-5" />
                        <span className="text-sm font-medium">灵感生成</span>
                      </div>
                      <button
                        onClick={goCreate}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-red hover:bg-brand-red-text text-white text-xs font-medium rounded-md transition-colors"
                      >
                        <PenLine className="w-3.5 h-3.5" />
                        去创作
                      </button>
                    </div>

                    <h2 className="text-xl font-bold text-text-primary mb-4 leading-tight">
                      {parsedResult.topic.title}
                    </h2>

                    <div className="bg-surface-secondary/50 rounded-lg p-4 border border-border/50">
                      <div className="text-sm text-text-secondary leading-relaxed">
                        <span className="text-text-primary font-medium mr-2">内容方向:</span>
                        {parsedResult.content_direction}
                      </div>
                    </div>

                    {parseError && (
                      <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-4">
                        {parseError}
                      </div>
                    )}
                  </div>

                  {/* 知识库卡片 */}
                  <div>
                    <h3 className="text-sm font-medium text-text-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Dices className="w-4 h-4" /> 参考素材
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {items.map((item, index) => {
                        const isConnected = parsedResult.topic.connections.includes(index + 1);
                        return (
                          <div
                            key={item.id}
                            className={clsx(
                              "group relative flex flex-col rounded-lg overflow-hidden border transition-all duration-300 bg-surface-primary",
                              isConnected
                                ? "border-brand-red/40 ring-1 ring-brand-red/10 shadow-sm"
                                : "border-border hover:border-border/80"
                            )}
                          >
                            {/* 封面图 */}
                            <div className="aspect-video bg-surface-secondary relative overflow-hidden">
                              {item.cover ? (
                                <img
                                  src={item.cover}
                                  alt={item.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-text-tertiary/30">
                                  {item.type === 'video' ? <Play className="w-8 h-8" /> : <FileText className="w-8 h-8" />}
                                </div>
                              )}

                              {/* 关联标记 */}
                              {isConnected && (
                                <div className="absolute top-2 right-2 bg-brand-red text-white text-[10px] px-2 py-0.5 rounded shadow-sm font-medium">
                                  关联
                                </div>
                              )}
                            </div>

                            {/* 内容区域 */}
                            <div className="p-3 flex-1 flex flex-col">
                              <div className="flex items-center gap-2 mb-2">
                                <span className={clsx(
                                  "text-[10px] px-1.5 py-0.5 rounded font-medium",
                                  item.type === 'video'
                                    ? "bg-red-50 text-red-600"
                                    : "bg-blue-50 text-blue-600"
                                )}>
                                  {item.type === 'video' ? '视频' : '笔记'}
                                </span>
                              </div>

                              <h4 className="text-sm font-medium text-text-primary line-clamp-2 mb-2 group-hover:text-brand-red transition-colors">
                                {item.title}
                              </h4>

                              <p className="text-xs text-text-tertiary line-clamp-3 leading-relaxed mt-auto">
                                {item.content}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {showFinal && !parsedResult && parseError && (
                <div className="text-sm text-text-secondary bg-surface-secondary border border-border rounded-lg p-6 text-center">
                  {parseError}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 历史记录弹窗 */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowHistory(false)}>
          <div className="bg-surface-primary rounded-xl border border-border shadow-2xl w-full max-w-md max-h-[70vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <h3 className="font-semibold text-text-primary text-sm">灵感历史</h3>
              <button onClick={() => setShowHistory(false)} className="text-text-tertiary hover:text-text-primary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-1">
              {historyList.length === 0 ? (
                <div className="p-8 text-center text-text-tertiary text-xs">
                  暂无历史记录
                </div>
              ) : (
                historyList.map(record => {
                  let title = '未知选题';
                  try {
                    const parsed = JSON.parse(record.result);
                    title = parsed.topic?.title || title;
                  } catch {}
                  const isActive = currentHistoryId === record.id;
                  return (
                    <div
                      key={record.id}
                      onClick={() => loadHistory(record)}
                      className={clsx(
                        "px-4 py-3 cursor-pointer rounded-lg transition-all flex items-center justify-between group",
                        isActive ? "bg-brand-red/5" : "hover:bg-surface-secondary"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className={clsx("text-sm font-medium truncate mb-0.5", isActive ? "text-brand-red" : "text-text-primary")}>
                          {title}
                        </div>
                        <div className="text-[10px] text-text-tertiary">
                          {formatDate(record.created_at)}
                        </div>
                      </div>
                      <button
                        onClick={(e) => deleteHistory(record.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-50 rounded transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
