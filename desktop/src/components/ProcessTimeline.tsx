import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';

// --- Types ---

export type ProcessItemType = 'phase' | 'thought' | 'tool-call' | 'skill';

export interface ProcessItem {
  id: string;
  type: ProcessItemType;
  title?: string;
  content: string;
  status: 'running' | 'done' | 'failed';
  toolData?: {
    callId?: string;
    name: string;
    input: unknown;
    output?: string;
  };
  skillData?: {
    name: string;
    description: string;
  };
  duration?: number;
  timestamp: number;
}

// --- Helper: Get user-friendly status text ---

const getStatusText = (items: ProcessItem[]): string => {
  // Find the last running item to determine current action
  const runningItem = [...items].reverse().find(item => item.status === 'running');

  if (!runningItem) {
    const failedCount = items.filter(item => item.status === 'failed').length;
    if (failedCount > 0) {
      return `处理完成（${failedCount} 个步骤失败）`;
    }
    return `处理完成（${items.length} 个步骤）`;
  }

  if (runningItem.type === 'thought') {
    return '正在思考...';
  }

  if (runningItem.type === 'tool-call' && runningItem.toolData?.name) {
    const name = runningItem.toolData.name;

    if (name === 'save_memory') return '正在记录...';
    if (name === 'read_file') return '正在查阅...';
    if (name === 'web_search' || name === 'duckduckgo_search') return '正在搜索...';
    if (name === 'write_file' || name === 'edit_file') return '正在编辑...';
    if (name === 'bash' || name === 'run_command') return '正在执行...';
    if (name === 'list_dir' || name === 'explore_workspace') return '正在浏览...';
    if (name === 'grep') return '正在查找...';
    if (name === 'calculator') return '正在计算...';

    return '正在处理...';
  }

  if (runningItem.type === 'skill') {
    return '正在准备...';
  }

  return '正在处理...';
};

const getToolDisplayLabel = (name: string): string => {
  const labelMap: Record<string, string> = {
    save_memory: '写入记忆',
    read_file: '读取文件',
    write_file: '写入文件',
    edit_file: '编辑文件',
    list_dir: '列出目录',
    grep: '内容搜索',
    app_cli: '应用命令',
    bash: '终端执行',
    run_command: '终端执行',
    web_search: '联网搜索',
    duckduckgo_search: '联网搜索',
    calculator: '计算器',
    explore_workspace: '工作区浏览',
  };
  return labelMap[name] || name;
};

const stringifyValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toObjectIfJsonLike = (value: unknown): Record<string, unknown> | null => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const getToolSummary = (toolName: string, input: unknown): string => {
  const inputObject = toObjectIfJsonLike(input);
  if (!inputObject) return '';

  const pickText = (...keys: string[]): string => {
    for (const key of keys) {
      const value = inputObject[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };

  if (toolName === 'app_cli') {
    return pickText('command');
  }
  if (toolName === 'bash' || toolName === 'run_command') {
    return pickText('cmd', 'command');
  }
  if (toolName === 'read_file') {
    return pickText('filePath', 'path');
  }
  if (toolName === 'write_file' || toolName === 'edit_file') {
    return pickText('filePath', 'path');
  }
  if (toolName === 'list_dir') {
    return pickText('path');
  }
  if (toolName === 'explore_workspace') {
    return pickText('target');
  }
  if (toolName === 'web_search' || toolName === 'duckduckgo_search') {
    return pickText('query', 'q');
  }
  return '';
};

const truncateText = (text: string, maxLength = 1800): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n... (已截断)`;
};

const formatDuration = (duration?: number): string => {
  if (!duration || duration <= 0) return '';
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60_000) return `${(duration / 1000).toFixed(1)}s`;
  const minutes = Math.floor(duration / 60_000);
  const seconds = Math.round((duration % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const formatTime = (timestamp: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};

// --- Main Component ---

interface ProcessTimelineProps {
  items: ProcessItem[];
  isStreaming?: boolean;
  variant?: 'default' | 'compact';
}

type TimelineFilter = 'all' | 'running' | 'failed' | 'done' | 'tool';

const FILTER_LABELS: Record<TimelineFilter, string> = {
  all: '全部',
  running: '运行中',
  failed: '失败',
  done: '已完成',
  tool: '仅工具',
};

export function ProcessTimeline({ items, isStreaming, variant = 'default' }: ProcessTimelineProps) {
  if (!items || items.length === 0) return null;

  const isCompact = variant === 'compact';
  const timelineItems = isCompact ? items.slice(-8) : items;
  const hasRunningItem = items.some(item => item.status === 'running');
  const statusText = getStatusText(timelineItems);
  const [expanded, setExpanded] = useState(!isCompact);
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [search, setSearch] = useState('');
  const [expandAllOutputs, setExpandAllOutputs] = useState(false);
  const [copiedDiagnosticId, setCopiedDiagnosticId] = useState<string | null>(null);
  const runningCount = timelineItems.filter(item => item.status === 'running').length;
  const failedCount = timelineItems.filter(item => item.status === 'failed').length;
  const doneCount = timelineItems.filter(item => item.status === 'done').length;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredItems = timelineItems.filter(item => {
    if (filter === 'running' && item.status !== 'running') return false;
    if (filter === 'failed' && item.status !== 'failed') return false;
    if (filter === 'done' && item.status !== 'done') return false;
    if (filter === 'tool' && item.type !== 'tool-call') return false;

    if (!normalizedSearch) return true;

    const isTool = item.type === 'tool-call';
    const toolName = isTool ? item.toolData?.name || '' : '';
    const toolSummary = isTool ? getToolSummary(toolName, item.toolData?.input) : '';
    const haystack = [
      item.title || '',
      item.content || '',
      item.status || '',
      toolName,
      toolSummary,
      item.toolData?.callId || '',
      stringifyValue(item.toolData?.input),
      item.toolData?.output || '',
    ].join('\n').toLowerCase();
    return haystack.includes(normalizedSearch);
  });
  const failedToolItems = filteredItems.filter(item => item.type === 'tool-call' && item.status === 'failed');

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  };

  const buildToolDiagnostic = (item: ProcessItem): string => {
    const toolName = item.toolData?.name || 'unknown_tool';
    const label = getToolDisplayLabel(toolName);
    const lines = [
      '# RedClaw Tool Diagnostic',
      `status: ${item.status}`,
      `time: ${formatTime(item.timestamp)}`,
      `duration: ${formatDuration(item.duration) || 'n/a'}`,
      `tool: ${label} (${toolName})`,
      `callId: ${item.toolData?.callId || 'n/a'}`,
      '',
      '## description',
      item.content || '(empty)',
      '',
      '## input',
      stringifyValue(item.toolData?.input) || '(empty)',
      '',
      '## output',
      item.toolData?.output || '(empty)',
    ];
    return lines.join('\n');
  };

  const handleCopyDiagnostic = async (item: ProcessItem) => {
    const ok = await copyText(buildToolDiagnostic(item));
    if (!ok) return;
    setCopiedDiagnosticId(item.id);
    setTimeout(() => {
      setCopiedDiagnosticId(current => (current === item.id ? null : current));
    }, 1500);
  };

  useEffect(() => {
    if (hasRunningItem) {
      setExpanded(true);
    }
  }, [hasRunningItem]);

  return (
    <div className={clsx(
      'w-full overflow-hidden animate-in fade-in duration-200',
      isCompact
        ? 'mt-1.5 max-w-[760px] rounded-lg border border-border/40 bg-surface-primary/50'
        : 'my-2 max-w-3xl rounded-xl border border-border/80 bg-surface-primary/85',
    )}>
      <div className={clsx(
        'flex items-center justify-between gap-3',
        isCompact ? 'px-2.5 py-1.5 border-b border-border/40 bg-surface-secondary/10' : 'px-3 py-2 border-b border-border/70 bg-surface-secondary/35',
      )}>
        <div className={clsx(
          'min-w-0 flex items-center gap-2 text-text-secondary',
          isCompact ? 'text-xs' : 'text-sm',
        )}>
          {hasRunningItem || isStreaming ? (
            <span className="inline-flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500/90" />
          ) : (
            <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500/90" />
          )}
          <span className="truncate">{statusText}</span>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {!isCompact && runningCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
              {runningCount} 运行中
            </span>
          )}
          {!isCompact && doneCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">
              {doneCount} 完成
            </span>
          )}
          {!isCompact && failedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">
              {failedCount} 失败
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className={clsx(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-text-tertiary transition-colors hover:bg-surface-secondary hover:text-text-primary',
              isCompact ? 'text-[11px]' : 'text-xs',
            )}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>{expanded ? '收起步骤' : `查看步骤 (${timelineItems.length})`}</span>
          </button>
        </div>
      </div>

      {expanded && (
        <div className={clsx(isCompact ? 'p-2 space-y-1.5' : 'p-3 space-y-2')}>
          {!isCompact && (
          <div className="rounded-lg border border-border/70 bg-surface-secondary/35 p-2 flex items-center gap-2 flex-wrap">
            {(Object.keys(FILTER_LABELS) as TimelineFilter[]).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={
                  `text-xs px-2 py-1 rounded-md transition-colors border ` +
                  (filter === key
                    ? 'bg-accent-primary/15 text-accent-primary border-accent-primary/40'
                    : 'bg-surface-primary text-text-tertiary border-border hover:text-text-primary')
                }
              >
                {FILTER_LABELS[key]}
              </button>
            ))}
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索命令、路径、callId、输出..."
              className="h-7 min-w-[220px] flex-1 rounded-md border border-border bg-surface-primary px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary/40"
            />
            <button
              type="button"
              onClick={() => setExpandAllOutputs(v => !v)}
              className={
                `text-xs px-2 py-1 rounded-md border transition-colors ` +
                (expandAllOutputs
                  ? 'bg-accent-primary/15 text-accent-primary border-accent-primary/40'
                  : 'bg-surface-primary text-text-tertiary border-border hover:text-text-primary')
              }
            >
              {expandAllOutputs ? '恢复自动展开' : '展开全部输出'}
            </button>
            {failedToolItems.length > 0 && (
              <span className="text-[11px] px-2 py-1 rounded-md border border-red-500/30 bg-red-500/10 text-red-500">
                当前筛选命中 {failedToolItems.length} 个失败工具
              </span>
            )}
            <span className="text-[11px] text-text-tertiary px-1">
              {filteredItems.length}/{timelineItems.length}
            </span>
            </div>
          )}

          <div className={clsx(!isCompact && 'border-l-2 border-border/65 pl-3 ml-1')}>
          {filteredItems.map(item => {
            const inputText = item.type === 'tool-call' ? truncateText(stringifyValue(item.toolData?.input)) : '';
            const outputText = item.type === 'tool-call' ? truncateText(item.toolData?.output || '') : '';
            const durationText = formatDuration(item.duration);
            const isTool = item.type === 'tool-call';
            const title =
              item.title ||
              (isTool ? item.toolData?.name || 'tool_call' : item.type === 'thought' ? '思考' : item.type === 'skill' ? '技能' : '阶段');
            const subtitle = item.content?.trim();
            const toolName = isTool ? (item.toolData?.name || title) : '';
            const toolDisplayLabel = isTool ? getToolDisplayLabel(toolName) : '';
            const toolCallId = isTool ? item.toolData?.callId : undefined;
            const toolSummary = isTool ? getToolSummary(toolName, item.toolData?.input) : '';
            const timeText = formatTime(item.timestamp);
            const lineTitle = isTool ? toolDisplayLabel : title;
            const lineDetail = (isTool ? toolSummary : subtitle) || '';
            const statusDotClass =
              item.status === 'running'
                ? 'bg-blue-500 animate-pulse'
                : item.status === 'failed'
                  ? 'bg-red-500'
                  : 'bg-emerald-500';

            return (
              <div key={item.id} className={clsx(
                'overflow-hidden rounded-md border border-border/80 bg-surface-primary/70',
                isCompact && 'border-border/40 bg-surface-primary/35 shadow-none',
              )}>
                <div className={clsx(
                  'flex items-center justify-between gap-2',
                  isCompact ? 'px-2.5 py-1.5' : 'px-3 py-2',
                )}>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={clsx('h-2 w-2 shrink-0 rounded-full', statusDotClass)} />
                      {isTool && (
                        <span className="rounded-full border border-border/60 bg-surface-secondary/55 px-1.5 py-0 text-[10px] text-text-tertiary">
                          tool
                        </span>
                      )}
                      <span className={clsx(
                        'truncate font-medium text-text-primary',
                        isCompact ? 'text-[11px]' : 'text-xs',
                      )}>
                        {lineTitle}
                      </span>
                      {lineDetail && (
                        <span className={clsx(
                          'min-w-0 truncate text-text-tertiary',
                          isCompact ? 'text-[11px]' : 'text-xs',
                        )}>
                          · {lineDetail}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {!isCompact && timeText && (
                      <span className="text-[11px] text-text-tertiary">{timeText}</span>
                    )}
                    {durationText && item.status !== 'running' && (
                      <span className="text-[11px] text-text-tertiary">{durationText}</span>
                    )}
                    {!isCompact && isTool && item.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => void handleCopyDiagnostic(item)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-border bg-surface-secondary text-text-tertiary hover:text-text-primary transition-colors"
                      >
                        {copiedDiagnosticId === item.id ? (
                          <>
                            <Check className="w-3 h-3 text-green-500" />
                            <span className="text-green-500">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>复制诊断</span>
                          </>
                        )}
                      </button>
                    )}
                      {!isCompact && isTool && toolCallId && (
                        <span className="hidden max-w-[180px] truncate text-[11px] text-text-tertiary lg:inline">
                          {toolCallId}
                        </span>
                      )}
                  </div>
                </div>

                {isTool && !isCompact && (inputText || outputText) && (
                  <details className="border-t border-border/70 px-3 py-2 bg-surface-secondary/30" open={expandAllOutputs || item.status === 'running' || item.status === 'failed'}>
                    <summary className="text-xs text-text-tertiary cursor-pointer select-none hover:text-text-primary">
                      查看参数与输出
                    </summary>
                    {inputText && (
                      <div className="mt-2">
                        <div className="text-[11px] text-text-tertiary mb-1">输入参数</div>
                        <pre className="text-xs font-mono bg-surface-primary rounded p-2 whitespace-pre-wrap break-words max-h-36 overflow-auto">
                          {inputText}
                        </pre>
                      </div>
                    )}
                    {outputText && (
                      <div className="mt-2">
                        <div className="text-[11px] text-text-tertiary mb-1">工具输出</div>
                        <pre className="text-xs font-mono bg-surface-primary rounded p-2 whitespace-pre-wrap break-words max-h-44 overflow-auto">
                          {outputText}
                        </pre>
                      </div>
                    )}
                  </details>
                )}
              </div>
            );
          })}
          </div>
          {filteredItems.length === 0 && (
            <div className="rounded-lg border border-border/70 bg-surface-primary/60 px-3 py-4 text-center text-xs text-text-tertiary">
              当前筛选条件下没有匹配的步骤。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
