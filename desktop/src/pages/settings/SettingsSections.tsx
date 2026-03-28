import type { Dispatch, SetStateAction } from 'react';
import { AlertCircle, Database, Download, FolderOpen, Info, RefreshCw, Save, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type {
    McpServerConfig,
    MemoryHistoryEntry,
    MemoryMaintenanceStatus,
    MemorySearchResult,
    ToolDiagnosticDescriptor,
    ToolDiagnosticRunResult,
    UserMemory,
} from './shared';

type SettingsFormData = {
    workspace_dir: string;
    debug_log_enabled: boolean;
};

type YtdlpStatus = {
    installed?: boolean;
    version?: string;
    path?: string;
} | null;

type McpOauthState = Record<string, { connected?: boolean; tokenPath?: string } | undefined>;

type FeatureFlags = {
    vectorRecommendation: boolean;
};

interface GeneralSettingsSectionProps {
    appVersion: string;
    formData: SettingsFormData;
    setFormData: Dispatch<SetStateAction<any>>;
    recentDebugLogs: string[];
    isDebugLogsLoading: boolean;
    handleRefreshDebugLogs: () => Promise<void>;
    handleOpenDebugLogDir: () => Promise<void>;
    handleVersionTap: () => void;
}

export function GeneralSettingsSection({
    appVersion,
    formData,
    setFormData,
    recentDebugLogs,
    isDebugLogsLoading,
    handleRefreshDebugLogs,
    handleOpenDebugLogDir,
    handleVersionTap,
}: GeneralSettingsSectionProps) {
    return (
        <section className="space-y-6">
            <h2 className="text-lg font-medium text-text-primary mb-6">常规设置</h2>

            <div className="bg-surface-secondary/30 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                            <Info className="w-4 h-4" />
                            红盒子 RedBox
                        </h3>
                        <p className="text-xs text-text-tertiary mt-1">
                            当前版本:{' '}
                            <button
                                type="button"
                                onClick={handleVersionTap}
                                className="font-mono hover:text-text-primary transition-colors"
                            >
                                {appVersion || '加载中...'}
                            </button>
                        </p>
                        <p className="text-xs text-text-tertiary mt-1">
                            自动更新已关闭，请前往 GitHub Releases 手动下载新版本。
                        </p>
                    </div>
                    <a
                        href="https://github.com/Jamailar/RedBox/releases"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-1.5 border border-border text-text-primary text-xs font-medium rounded hover:bg-surface-secondary"
                    >
                        <Download className="w-3 h-3" />
                        打开下载页
                    </a>
                </div>
            </div>

            <div className="group">
                <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    数据存储路径
                </label>
                <p className="text-[10px] text-text-tertiary mb-2">
                    技能和知识库文件将保存在此目录下。留空则使用默认目录 ~/.redconvert
                </p>
                <div className="flex items-center gap-2">
                    <div className="flex-1 relative">
                        <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                        <input
                            type="text"
                            value={formData.workspace_dir}
                            onChange={(e) => setFormData((d: any) => ({ ...d, workspace_dir: e.target.value }))}
                            placeholder="~/.redconvert"
                            className="w-full bg-surface-secondary/30 rounded border border-border pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                        />
                    </div>
                </div>
                <p className="text-[10px] text-text-tertiary mt-2">
                    目录结构：<code className="bg-surface-secondary px-1 rounded">/skills/</code> 技能文件 · <code className="bg-surface-secondary px-1 rounded">/knowledge/notes/</code> 笔记
                </p>
            </div>
            <div className="bg-surface-secondary/30 rounded-lg border border-border p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-medium text-text-primary">调试日志</h3>
                        <p className="text-xs text-text-tertiary mt-1">
                            开启后会把主进程日志、聊天日志和工具诊断日志写入本地日志文件，便于追踪 RedClaw 工具调用失败。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setFormData((prev: any) => ({ ...prev, debug_log_enabled: !prev.debug_log_enabled }))}
                        className={clsx(
                            'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
                            formData.debug_log_enabled ? 'bg-[#34C759]' : 'bg-gray-300'
                        )}
                    >
                        <span
                            className={clsx(
                                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                                formData.debug_log_enabled ? 'translate-x-6' : 'translate-x-1'
                            )}
                        />
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void handleRefreshDebugLogs()}
                        className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                    >
                        {isDebugLogsLoading ? '刷新中...' : '刷新日志'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleOpenDebugLogDir()}
                        className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                    >
                        打开日志目录
                    </button>
                </div>
                <div className="rounded-lg border border-border bg-surface-primary/60 p-3">
                    <div className="text-[11px] text-text-tertiary mb-2">最近日志预览</div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-5 text-text-secondary">
                        {recentDebugLogs.length ? recentDebugLogs.join('\n') : '暂无日志。开启后保存设置并重试相关操作。'}
                    </pre>
                </div>
            </div>
        </section>
    );
}

interface MemorySettingsSectionProps {
    newMemoryType: UserMemory['type'];
    setNewMemoryType: Dispatch<SetStateAction<UserMemory['type']>>;
    newMemoryContent: string;
    setNewMemoryContent: Dispatch<SetStateAction<string>>;
    handleAddMemory: () => Promise<void>;
    isMemoryLoading: boolean;
    memories: UserMemory[];
    archivedMemories: UserMemory[];
    memoryHistory: MemoryHistoryEntry[];
    maintenanceStatus: MemoryMaintenanceStatus | null;
    onRunMaintenance: () => Promise<void>;
    memorySearchQuery: string;
    setMemorySearchQuery: Dispatch<SetStateAction<string>>;
    includeArchivedInSearch: boolean;
    setIncludeArchivedInSearch: Dispatch<SetStateAction<boolean>>;
    memorySearchResults: MemorySearchResult[];
    isMemorySearching: boolean;
    onSearchMemories: () => Promise<void>;
    handleDeleteMemory: (id: string) => void;
}

const memoryTypeTone = (type: UserMemory['type']) => (
    type === 'preference' ? 'bg-purple-500/10 text-purple-500'
        : type === 'fact' ? 'bg-blue-500/10 text-blue-500'
            : 'bg-gray-500/10 text-text-tertiary'
);

const memoryTypeLabel = (type: UserMemory['type']) => (
    type === 'preference' ? '偏好' : type === 'fact' ? '事实' : '一般'
);

const historyActionLabel = (action: MemoryHistoryEntry['action']) => {
    switch (action) {
        case 'create': return '创建';
        case 'update': return '更新';
        case 'dedupe': return '去重合并';
        case 'archive': return '归档';
        case 'delete': return '删除';
        case 'access': return '访问';
        default: return action;
    }
};

export function MemorySettingsSection({
    newMemoryType,
    setNewMemoryType,
    newMemoryContent,
    setNewMemoryContent,
    handleAddMemory,
    isMemoryLoading,
    memories,
    archivedMemories,
    memoryHistory,
    maintenanceStatus,
    onRunMaintenance,
    memorySearchQuery,
    setMemorySearchQuery,
    includeArchivedInSearch,
    setIncludeArchivedInSearch,
    memorySearchResults,
    isMemorySearching,
    onSearchMemories,
    handleDeleteMemory,
}: MemorySettingsSectionProps) {
    return (
        <section className="space-y-6">
            <div>
                <h2 className="text-lg font-medium text-text-primary mb-2">用户记忆管理</h2>
                <p className="text-xs text-text-tertiary">
                    AI 会自动从对话中提取并保存关于您的偏好和重要信息。您可以在此手动管理这些记忆。
                </p>
            </div>

            <div className="bg-surface-secondary/30 rounded-lg border border-border p-4">
                <div className="flex gap-2">
                    <select
                        value={newMemoryType}
                        onChange={(e) => setNewMemoryType(e.target.value as UserMemory['type'])}
                        className="bg-surface-secondary/50 border border-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent-primary"
                    >
                        <option value="general">一般</option>
                        <option value="preference">偏好</option>
                        <option value="fact">事实</option>
                    </select>
                    <input
                        type="text"
                        value={newMemoryContent}
                        onChange={(e) => setNewMemoryContent(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleAddMemory();
                            }
                        }}
                        placeholder="添加一条新记忆，例如：'我喜欢简洁的代码风格'..."
                        className="flex-1 bg-surface-secondary/50 border border-border rounded px-3 py-1.5 text-xs focus:outline-none focus:border-accent-primary"
                    />
                    <button
                        type="button"
                        onClick={() => void handleAddMemory()}
                        disabled={!newMemoryContent.trim()}
                        className="px-4 py-1.5 bg-accent-primary text-white text-xs font-medium rounded hover:opacity-90 disabled:opacity-50"
                    >
                        添加
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface-secondary/20 rounded-lg border border-border p-4">
                    <div className="text-[11px] text-text-tertiary mb-1">当前有效记忆</div>
                    <div className="text-2xl font-semibold text-text-primary">{memories.length}</div>
                </div>
                <div className="bg-surface-secondary/20 rounded-lg border border-border p-4">
                    <div className="text-[11px] text-text-tertiary mb-1">归档版本</div>
                    <div className="text-2xl font-semibold text-text-primary">{archivedMemories.length}</div>
                </div>
                <div className="bg-surface-secondary/20 rounded-lg border border-border p-4">
                    <div className="text-[11px] text-text-tertiary mb-1">历史事件</div>
                    <div className="text-2xl font-semibold text-text-primary">{memoryHistory.length}</div>
                </div>
            </div>

            <div className="bg-surface-secondary/20 rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-text-primary">后台记忆整理器</h3>
                        <p className="text-[11px] text-text-tertiary mt-1">
                            独立于对话循环之外，周期性使用 LLM 整理、去重、归档和更新长期记忆。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void onRunMaintenance()}
                        className="inline-flex items-center gap-2 px-3 py-1.5 border border-border rounded text-xs font-medium text-text-primary hover:bg-surface-secondary"
                    >
                        <RefreshCw className={clsx('w-3.5 h-3.5', maintenanceStatus?.running && 'animate-spin')} />
                        立即整理
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="bg-surface-primary/60 rounded border border-border p-3">
                        <div className="text-[10px] text-text-tertiary mb-1">状态</div>
                        <div className="text-sm font-medium text-text-primary">
                            {maintenanceStatus?.running ? '整理中' : maintenanceStatus?.started ? '已启用' : '未启动'}
                        </div>
                    </div>
                    <div className="bg-surface-primary/60 rounded border border-border p-3">
                        <div className="text-[10px] text-text-tertiary mb-1">待处理变更</div>
                        <div className="text-sm font-medium text-text-primary">{maintenanceStatus?.pendingMutations ?? 0}</div>
                    </div>
                    <div className="bg-surface-primary/60 rounded border border-border p-3">
                        <div className="text-[10px] text-text-tertiary mb-1">上次执行</div>
                        <div className="text-xs text-text-primary">
                            {maintenanceStatus?.lastRunAt ? new Date(maintenanceStatus.lastRunAt).toLocaleString() : '暂无'}
                        </div>
                    </div>
                    <div className="bg-surface-primary/60 rounded border border-border p-3">
                        <div className="text-[10px] text-text-tertiary mb-1">下次计划</div>
                        <div className="text-xs text-text-primary">
                            {maintenanceStatus?.nextScheduledAt ? new Date(maintenanceStatus.nextScheduledAt).toLocaleString() : '按需触发'}
                        </div>
                    </div>
                </div>
                {maintenanceStatus?.lastSummary && (
                    <div className="text-xs text-text-secondary">
                        最近摘要：{maintenanceStatus.lastSummary}
                    </div>
                )}
                {maintenanceStatus?.lastError && (
                    <div className="text-xs text-red-500 bg-red-500/5 border border-red-200 rounded p-3">
                        最近错误：{maintenanceStatus.lastError}
                    </div>
                )}
            </div>

            <div className="bg-surface-secondary/20 rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-text-primary">记忆搜索</h3>
                        <p className="text-[11px] text-text-tertiary mt-1">
                            文档型检索，不使用向量。按内容、标签、类型和新近度综合排序。
                        </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                        <input
                            type="checkbox"
                            checked={includeArchivedInSearch}
                            onChange={(e) => setIncludeArchivedInSearch(e.target.checked)}
                            className="rounded border-border"
                        />
                        包含归档
                    </label>
                </div>
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                        <input
                            type="text"
                            value={memorySearchQuery}
                            onChange={(e) => setMemorySearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void onSearchMemories();
                                }
                            }}
                            placeholder="搜索记忆，例如：redclaw、用户偏好、封面..."
                            className="w-full bg-surface-primary/60 border border-border rounded pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-accent-primary"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => void onSearchMemories()}
                        disabled={!memorySearchQuery.trim()}
                        className="px-4 py-2 border border-border rounded text-xs font-medium text-text-primary hover:bg-surface-secondary disabled:opacity-50"
                    >
                        搜索
                    </button>
                </div>
                {!memorySearchQuery.trim() ? (
                    <div className="text-[11px] text-text-tertiary">输入关键词后执行检索。</div>
                ) : isMemorySearching ? (
                    <div className="text-[11px] text-text-tertiary">搜索中...</div>
                ) : memorySearchResults.length === 0 ? (
                    <div className="text-[11px] text-text-tertiary">没有命中结果。</div>
                ) : (
                    <div className="space-y-2">
                        {memorySearchResults.slice(0, 12).map((memory) => (
                            <div key={memory.id} className="p-3 bg-surface-primary/60 border border-border rounded-lg">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider', memoryTypeTone(memory.type))}>
                                        {memoryTypeLabel(memory.type)}
                                    </span>
                                    {memory.status === 'archived' && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600">已归档</span>
                                    )}
                                    <span className="text-[10px] text-text-tertiary">score {memory.score}</span>
                                    {(memory.matchReasons || []).length > 0 && (
                                        <span className="text-[10px] text-text-tertiary">{memory.matchReasons.join(' · ')}</span>
                                    )}
                                </div>
                                <div className="text-sm text-text-secondary">{memory.content}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-text-primary">当前有效记忆</h3>
                    <span className="text-[11px] text-text-tertiary">只展示当前生效版本</span>
                </div>
                {isMemoryLoading ? (
                    <div className="text-center py-8 text-text-tertiary text-xs">加载中...</div>
                ) : memories.length === 0 ? (
                    <div className="text-center py-8 text-text-tertiary text-xs border border-dashed border-border rounded-lg">
                        暂无记忆数据。AI 会在聊天中自动学习，或者您可以手动添加。
                    </div>
                ) : (
                    memories.map((memory) => (
                        <div key={memory.id} className="group flex items-start justify-between p-3 bg-surface-secondary/20 border border-border rounded-lg hover:border-accent-primary/30 transition-colors">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={clsx(
                                        'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
                                        memoryTypeTone(memory.type)
                                    )}>
                                        {memoryTypeLabel(memory.type)}
                                    </span>
                                    <span className="text-[10px] text-text-tertiary">
                                        {new Date(memory.updated_at || memory.created_at).toLocaleString()}
                                    </span>
                                    {(memory.revision || 1) > 1 && (
                                        <span className="text-[10px] text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                            rev {memory.revision}
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-text-secondary">{memory.content}</p>
                                {(memory.tags?.length || 0) > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {memory.tags.map((tag) => (
                                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-primary border border-border text-text-tertiary">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => handleDeleteMemory(memory.id)}
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-text-tertiary hover:text-red-500 hover:bg-red-500/10 rounded transition-all"
                                title="删除"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))
                )}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-text-primary">归档记忆</h3>
                    <span className="text-[11px] text-text-tertiary">旧版本、冲突覆盖、容量裁剪都会归档到这里</span>
                </div>
                {isMemoryLoading ? (
                    <div className="text-center py-6 text-text-tertiary text-xs">加载中...</div>
                ) : archivedMemories.length === 0 ? (
                    <div className="text-center py-6 text-text-tertiary text-xs border border-dashed border-border rounded-lg">
                        暂无归档记忆。
                    </div>
                ) : (
                    <div className="space-y-2">
                        {archivedMemories.slice(0, 50).map((memory) => (
                            <div key={memory.id} className="p-3 bg-surface-secondary/10 border border-border rounded-lg">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider', memoryTypeTone(memory.type))}>
                                        {memoryTypeLabel(memory.type)}
                                    </span>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600">
                                        已归档
                                    </span>
                                    <span className="text-[10px] text-text-tertiary">
                                        {new Date(memory.archived_at || memory.updated_at || memory.created_at).toLocaleString()}
                                    </span>
                                    {memory.archive_reason && (
                                        <span className="text-[10px] text-text-tertiary">原因: {memory.archive_reason}</span>
                                    )}
                                </div>
                                <p className="text-sm text-text-secondary">{memory.content}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-text-primary">记忆历史</h3>
                    <span className="text-[11px] text-text-tertiary">展示最近的记忆维护轨迹</span>
                </div>
                {isMemoryLoading ? (
                    <div className="text-center py-6 text-text-tertiary text-xs">加载中...</div>
                ) : memoryHistory.length === 0 ? (
                    <div className="text-center py-6 text-text-tertiary text-xs border border-dashed border-border rounded-lg">
                        暂无历史记录。
                    </div>
                ) : (
                    <div className="space-y-2">
                        {memoryHistory.slice(0, 80).map((entry) => (
                            <div key={entry.id} className="p-3 bg-surface-secondary/10 border border-border rounded-lg">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary">
                                        {historyActionLabel(entry.action)}
                                    </span>
                                    <span className="text-[10px] text-text-tertiary">
                                        {new Date(entry.timestamp).toLocaleString()}
                                    </span>
                                    {entry.reason && (
                                        <span className="text-[10px] text-text-tertiary">{entry.reason}</span>
                                    )}
                                </div>
                                <div className="mt-2 text-xs text-text-secondary space-y-1">
                                    {entry.before?.content && (
                                        <div>旧: {entry.before.content}</div>
                                    )}
                                    {entry.after?.content && (
                                        <div>新: {entry.after.content}</div>
                                    )}
                                    {!entry.before?.content && !entry.after?.content && (
                                        <div>origin: {entry.origin_id}</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}

interface KnowledgeSettingsSectionProps {
    vectorStats: { documents?: number; vectors?: number } | null;
    handleRebuildIndex: () => Promise<void>;
    isRebuilding: boolean;
}

export function KnowledgeSettingsSection({ vectorStats, handleRebuildIndex, isRebuilding }: KnowledgeSettingsSectionProps) {
    return (
        <section className="space-y-6">
            <h2 className="text-lg font-medium text-text-primary mb-6">知识库索引管理</h2>

            <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-secondary/30 rounded-lg border border-border p-4">
                    <div className="text-xs text-text-tertiary mb-1">已索引文档</div>
                    <div className="text-2xl font-bold text-text-primary">
                        {vectorStats?.documents || 0}
                    </div>
                </div>
                <div className="bg-surface-secondary/30 rounded-lg border border-border p-4">
                    <div className="text-xs text-text-tertiary mb-1">向量切片数</div>
                    <div className="text-2xl font-bold text-text-primary">
                        {vectorStats?.vectors || 0}
                    </div>
                </div>
            </div>

            <div className="bg-surface-secondary/20 rounded-lg border border-border p-4">
                <h3 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    索引操作
                </h3>
                <p className="text-xs text-text-tertiary mb-4">
                    如果发现检索结果不准确或知识库内容未更新，可以尝试重建索引。
                    此操作会清空当前所有向量数据并重新扫描知识库文件。
                </p>

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={() => void handleRebuildIndex()}
                        disabled={isRebuilding}
                        className="flex items-center px-4 py-2 border border-red-200 bg-red-50/50 text-red-600 text-xs font-medium rounded hover:bg-red-100/50 transition-colors disabled:opacity-50"
                    >
                        {isRebuilding ? <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
                        {isRebuilding ? '重建中...' : '重建所有索引'}
                    </button>
                </div>
            </div>
        </section>
    );
}

interface ToolsSettingsSectionProps {
    isSyncingMcp: boolean;
    handleDiscoverAndImportMcp: () => Promise<void>;
    handleAddMcpServer: () => void;
    handleSaveMcpServers: () => Promise<void>;
    mcpStatusMessage: string;
    mcpServers: McpServerConfig[];
    handleUpdateMcpServer: (id: string, updater: (item: McpServerConfig) => McpServerConfig) => void;
    handleDeleteMcpServer: (id: string) => Promise<void>;
    stringifyEnvRecord: (env?: Record<string, string>) => string;
    parseEnvText: (text: string) => Record<string, string>;
    mcpOauthState: McpOauthState;
    handleRefreshMcpOAuth: (server: McpServerConfig) => Promise<void>;
    handleTestMcpServer: (server: McpServerConfig) => Promise<void>;
    mcpTestingId: string;
    ytdlpStatus: YtdlpStatus;
    handleInstallYtdlp: () => Promise<void>;
    handleUpdateYtdlp: () => Promise<void>;
    isInstallingTool: boolean;
    installProgress: number;
    showDeveloperDiagnostics: boolean;
    toolDiagnostics: ToolDiagnosticDescriptor[];
    toolDiagnosticResults: Record<string, ToolDiagnosticRunResult | undefined>;
    toolDiagnosticRunning: Record<string, 'direct' | 'ai' | undefined>;
    handleRunDirectToolDiagnostic: (toolName: string) => Promise<void>;
    handleRunAiToolDiagnostic: (toolName: string) => Promise<void>;
    handleRefreshToolDiagnostics: () => Promise<void>;
    handleRunAllDirectToolDiagnostics: () => Promise<void>;
    handleRunAllAiToolDiagnostics: () => Promise<void>;
}

export function ToolsSettingsSection({
    isSyncingMcp,
    handleDiscoverAndImportMcp,
    handleAddMcpServer,
    handleSaveMcpServers,
    mcpStatusMessage,
    mcpServers,
    handleUpdateMcpServer,
    handleDeleteMcpServer,
    stringifyEnvRecord,
    parseEnvText,
    mcpOauthState,
    handleRefreshMcpOAuth,
    handleTestMcpServer,
    mcpTestingId,
    ytdlpStatus,
    handleInstallYtdlp,
    handleUpdateYtdlp,
    isInstallingTool,
    installProgress,
    showDeveloperDiagnostics,
    toolDiagnostics,
    toolDiagnosticResults,
    toolDiagnosticRunning,
    handleRunDirectToolDiagnostic,
    handleRunAiToolDiagnostic,
    handleRefreshToolDiagnostics,
    handleRunAllDirectToolDiagnostics,
    handleRunAllAiToolDiagnostics,
}: ToolsSettingsSectionProps) {
    const availabilityTone = (tool: ToolDiagnosticDescriptor) => {
        switch (tool.availabilityStatus) {
            case 'available':
                return 'bg-green-500/10 text-green-600';
            case 'missing_context':
                return 'bg-amber-500/10 text-amber-600';
            case 'internal_only':
                return 'bg-purple-500/10 text-purple-600';
            case 'not_in_current_pack':
                return 'bg-slate-500/10 text-slate-600';
            default:
                return 'bg-red-500/10 text-red-600';
        }
    };

    const availabilityLabel = (tool: ToolDiagnosticDescriptor) => {
        switch (tool.availabilityStatus) {
            case 'available':
                return '可用';
            case 'missing_context':
                return '当前上下文不可用';
            case 'internal_only':
                return '内部工具';
            case 'not_in_current_pack':
                return '当前 pack 未暴露';
            default:
                return '注册异常';
        }
    };

    return (
        <section className="space-y-6">
            <h2 className="text-lg font-medium text-text-primary mb-6">外部工具管理</h2>

            <div className="bg-surface-secondary/30 rounded-lg border border-border p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-text-primary">MCP 数据源中台</h3>
                        <p className="text-xs text-text-tertiary mt-1">
                            管理 MCP Server，并支持从本机常见客户端一键导入配置。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleDiscoverAndImportMcp()}
                            disabled={isSyncingMcp}
                            className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors disabled:opacity-50"
                        >
                            {isSyncingMcp ? '导入中...' : '一键导入本机配置'}
                        </button>
                        <button
                            type="button"
                            onClick={handleAddMcpServer}
                            disabled={isSyncingMcp}
                            className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors disabled:opacity-50"
                        >
                            新增 Server
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleSaveMcpServers()}
                            disabled={isSyncingMcp}
                            className="px-3 py-1.5 bg-accent-primary text-white rounded text-xs hover:opacity-90 disabled:opacity-50"
                        >
                            保存 MCP
                        </button>
                    </div>
                </div>

                {mcpStatusMessage && (
                    <div className="text-xs text-text-secondary border border-border rounded px-3 py-2 bg-surface-primary/60">
                        {mcpStatusMessage}
                    </div>
                )}

                {mcpServers.length === 0 ? (
                    <div className="text-xs text-text-tertiary border border-dashed border-border rounded-lg px-3 py-5 text-center">
                        暂无 MCP Server。你可以新增一条，或使用“一键导入本机配置”。
                    </div>
                ) : (
                    <div className="space-y-3">
                        {mcpServers.map((server) => (
                            <div key={server.id} className="border border-border rounded-lg p-3 bg-surface-primary/40 space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <div className="md:col-span-2">
                                        <label className="block text-[11px] text-text-tertiary mb-1">名称</label>
                                        <input
                                            type="text"
                                            value={server.name}
                                            onChange={(e) => handleUpdateMcpServer(server.id, (item) => ({ ...item, name: e.target.value }))}
                                            className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                        />
                                        <div className="mt-1 text-[11px] text-text-tertiary font-mono">id: {server.id}</div>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] text-text-tertiary mb-1">传输协议</label>
                                        <select
                                            value={server.transport}
                                            onChange={(e) => handleUpdateMcpServer(server.id, (item) => ({ ...item, transport: e.target.value as McpServerConfig['transport'] }))}
                                            className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                        >
                                            <option value="stdio">stdio</option>
                                            <option value="streamable-http">streamable-http</option>
                                            <option value="sse">sse</option>
                                        </select>
                                    </div>
                                    <div className="flex items-end justify-between gap-2">
                                        <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                                            <input
                                                type="checkbox"
                                                checked={server.enabled}
                                                onChange={(e) => handleUpdateMcpServer(server.id, (item) => ({ ...item, enabled: e.target.checked }))}
                                            />
                                            启用
                                        </label>
                                        <button
                                            type="button"
                                            onClick={() => void handleDeleteMcpServer(server.id)}
                                            className="px-2.5 py-1.5 border border-red-300 text-red-600 rounded text-xs hover:bg-red-50/70 transition-colors"
                                        >
                                            删除
                                        </button>
                                    </div>
                                </div>

                                {server.transport === 'stdio' ? (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-[11px] text-text-tertiary mb-1">Command</label>
                                            <input
                                                type="text"
                                                value={server.command || ''}
                                                onChange={(e) => handleUpdateMcpServer(server.id, (item) => ({ ...item, command: e.target.value }))}
                                                placeholder="npx"
                                                className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] text-text-tertiary mb-1">Args（空格分隔）</label>
                                            <input
                                                type="text"
                                                value={(server.args || []).join(' ')}
                                                onChange={(e) => handleUpdateMcpServer(server.id, (item) => ({
                                                    ...item,
                                                    args: e.target.value.split(' ').map((arg) => arg.trim()).filter(Boolean),
                                                }))}
                                                placeholder="-y @modelcontextprotocol/server-filesystem /path"
                                                className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] text-text-tertiary mb-1">Env（每行 KEY=VALUE）</label>
                                            <textarea
                                                value={stringifyEnvRecord(server.env)}
                                                onChange={(e) => handleUpdateMcpServer(server.id, (item) => ({
                                                    ...item,
                                                    env: parseEnvText(e.target.value),
                                                }))}
                                                rows={3}
                                                className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-xs focus:outline-none focus:border-accent-primary transition-colors"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <label className="block text-[11px] text-text-tertiary mb-1">URL</label>
                                        <input
                                            type="text"
                                            value={server.url || ''}
                                            onChange={(e) => handleUpdateMcpServer(server.id, (item) => ({ ...item, url: e.target.value }))}
                                            placeholder="https://your-mcp-host/sse"
                                            className="w-full bg-surface-secondary/30 rounded border border-border px-3 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
                                        />
                                    </div>
                                )}

                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-[11px] text-text-tertiary">
                                        OAuth: {mcpOauthState[server.id]?.connected ? '已连接' : '未连接'}
                                        {mcpOauthState[server.id]?.tokenPath ? (
                                            <span className="ml-1 font-mono">{mcpOauthState[server.id]?.tokenPath}</span>
                                        ) : null}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void handleRefreshMcpOAuth(server)}
                                            className="px-2.5 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                                        >
                                            刷新 OAuth
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void handleTestMcpServer(server)}
                                            disabled={mcpTestingId === server.id}
                                            className="px-2.5 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors disabled:opacity-50"
                                        >
                                            {mcpTestingId === server.id ? '测试中...' : '测试连接'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="bg-surface-secondary/30 rounded-lg border border-border p-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                            yt-dlp (YouTube 下载器)
                            {ytdlpStatus?.installed ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/10 text-green-500 font-medium">已安装</span>
                            ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-500 font-medium">未安装</span>
                            )}
                        </h3>
                        <p className="text-xs text-text-tertiary mt-1">
                            用于智囊团功能的 YouTube 视频信息获取和字幕下载。
                        </p>
                        <div className="mt-2 text-[10px] text-text-tertiary font-mono">
                            {ytdlpStatus?.version && <div>版本: {ytdlpStatus.version}</div>}
                            {ytdlpStatus?.path && <div>路径: {ytdlpStatus.path}</div>}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        {!ytdlpStatus?.installed ? (
                            <button
                                type="button"
                                onClick={() => void handleInstallYtdlp()}
                                disabled={isInstallingTool}
                                className="flex items-center gap-2 px-3 py-1.5 bg-accent-primary text-white text-xs font-medium rounded hover:opacity-90 disabled:opacity-50"
                            >
                                {isInstallingTool ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                {isInstallingTool ? '安装中...' : '一键安装'}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => void handleUpdateYtdlp()}
                                disabled={isInstallingTool}
                                className="flex items-center gap-2 px-3 py-1.5 border border-border text-text-primary text-xs font-medium rounded hover:bg-surface-secondary disabled:opacity-50"
                            >
                                {isInstallingTool ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                {isInstallingTool ? '更新中...' : '检查更新'}
                            </button>
                        )}
                    </div>
                </div>

                {isInstallingTool && installProgress > 0 && (
                    <div className="mt-4">
                        <div className="h-1 bg-border rounded-full overflow-hidden">
                            <div
                                className="h-full bg-accent-primary transition-all duration-300"
                                style={{ width: `${installProgress}%` }}
                            />
                        </div>
                        <div className="flex justify-between mt-1">
                            <span className="text-[10px] text-text-tertiary">下载中...</span>
                            <span className="text-[10px] text-text-tertiary">{installProgress}%</span>
                        </div>
                    </div>
                )}
            </div>

            {showDeveloperDiagnostics && (
            <div className="bg-surface-secondary/30 rounded-lg border border-border p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-medium text-text-primary">开发者工具调用诊断</h3>
                        <p className="text-xs text-text-tertiary mt-1">
                            直接测试用于验证工具本身是否可用，AI 调用测试用于验证模型是否真的会正确发起 tool_call。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleRefreshToolDiagnostics()}
                            className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                        >
                            刷新列表
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleRunAllDirectToolDiagnostics()}
                            className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                        >
                            全部直接测试
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleRunAllAiToolDiagnostics()}
                            className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary transition-colors"
                        >
                            全部 AI 测试
                        </button>
                    </div>
                </div>

                {toolDiagnostics.length === 0 ? (
                    <div className="text-xs text-text-tertiary border border-dashed border-border rounded-lg px-3 py-5 text-center">
                        暂无可诊断工具。
                    </div>
                ) : (
                    <div className="space-y-3">
                        {toolDiagnostics.map((tool) => {
                            const result = toolDiagnosticResults[tool.name];
                            const runningMode = toolDiagnosticRunning[tool.name];
                            const isRunnable = tool.availabilityStatus === 'available';
                            return (
                                <div key={tool.name} className="rounded-lg border border-border bg-surface-primary/50 p-3 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium text-text-primary">{tool.displayName}</span>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary border border-border text-text-tertiary">
                                                    {tool.name}
                                                </span>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary border border-border text-text-tertiary">
                                                    {tool.kind}
                                                </span>
                                                <span className={clsx('text-[10px] px-1.5 py-0.5 rounded', availabilityTone(tool))}>
                                                    {availabilityLabel(tool)}
                                                </span>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary border border-border text-text-tertiary">
                                                    {tool.visibility}
                                                </span>
                                            </div>
                                            <p className="text-xs text-text-tertiary mt-1">{tool.description || '暂无描述'}</p>
                                            <p className="text-[11px] text-text-tertiary mt-1">{tool.availabilityReason}</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button
                                                type="button"
                                                onClick={() => void handleRunDirectToolDiagnostic(tool.name)}
                                                disabled={!isRunnable || Boolean(runningMode)}
                                                className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary disabled:opacity-50"
                                            >
                                                {runningMode === 'direct' ? '直接测试中...' : '直接测试'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void handleRunAiToolDiagnostic(tool.name)}
                                                disabled={!isRunnable || Boolean(runningMode)}
                                                className="px-3 py-1.5 border border-border rounded text-xs hover:bg-surface-secondary disabled:opacity-50"
                                            >
                                                {runningMode === 'ai' ? 'AI 测试中...' : 'AI 调用测试'}
                                            </button>
                                        </div>
                                    </div>

                                    {result && (
                                        <div className={clsx(
                                            'rounded border p-3 text-xs space-y-2',
                                            result.success
                                                ? 'border-green-200 bg-green-500/5'
                                                : 'border-red-200 bg-red-500/5'
                                        )}>
                                            <div className="flex items-center gap-2">
                                                <span className={clsx(
                                                    'px-1.5 py-0.5 rounded text-[10px] font-medium',
                                                    result.success ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                                                )}>
                                                    {result.mode === 'direct' ? '直接测试' : 'AI 调用测试'}
                                                </span>
                                                <span className="text-text-secondary">
                                                    {result.success ? '成功' : (result.error || '失败')}
                                                </span>
                                            </div>
                                            <details>
                                                <summary className="cursor-pointer text-text-secondary">查看详情</summary>
                                                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-primary/70 p-3 text-[11px] leading-5 text-text-secondary">
                                                    {JSON.stringify(result, null, 2)}
                                                </pre>
                                            </details>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            )}
        </section>
    );
}

interface ExperimentalSettingsSectionProps {
    flags: FeatureFlags;
    updateFlag: (key: keyof FeatureFlags, value: boolean) => void;
}

export function ExperimentalSettingsSection({ flags, updateFlag }: ExperimentalSettingsSectionProps) {
    return (
        <section className="space-y-6">
            <div>
                <h2 className="text-lg font-medium text-text-primary mb-2">实验性功能</h2>
                <p className="text-xs text-text-tertiary">
                    以下功能仍在开发和测试中，可能不稳定或影响性能。请谨慎开启。
                </p>
            </div>

            <div className="space-y-4">
                <div className="bg-surface-secondary/30 rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex-1 pr-4">
                            <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
                                向量推荐
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-600 font-medium">
                                    Beta
                                </span>
                            </h3>
                            <p className="text-xs text-text-tertiary mt-1.5 leading-relaxed">
                                在稿件编辑器的分栏视图中，根据当前稿件内容的向量相似度对知识库进行智能排序。
                                开启后，与当前内容最相关的素材会优先显示。
                            </p>
                            <p className="text-[10px] text-text-tertiary mt-2 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" />
                                此功能会调用 Embedding API 计算向量，可能产生额外费用
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateFlag('vectorRecommendation', !flags.vectorRecommendation)}
                            className={clsx(
                                'relative w-11 h-6 rounded-full transition-colors shrink-0',
                                flags.vectorRecommendation ? 'bg-accent-primary' : 'bg-border'
                            )}
                        >
                            <div
                                className={clsx(
                                    'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform',
                                    flags.vectorRecommendation ? 'translate-x-6' : 'translate-x-1'
                                )}
                            />
                        </button>
                    </div>
                </div>
            </div>

        </section>
    );
}

interface SettingsSaveBarProps {
    activeTab: 'general' | 'ai' | 'knowledge' | 'tools' | 'memory' | 'experimental';
    status: 'idle' | 'saving' | 'saved' | 'error';
}

export function SettingsSaveBar({ activeTab, status }: SettingsSaveBarProps) {
    if (activeTab !== 'general' && activeTab !== 'ai') {
        return null;
    }

    return (
        <div className="fixed bottom-0 left-48 right-0 p-4 bg-surface-primary border-t border-border flex items-center justify-between z-10 transition-all">
            <div className="text-xs">
                {status === 'saved' && <span className="text-status-success">保存成功</span>}
                {status === 'error' && <span className="text-status-error">保存失败</span>}
            </div>

            <button
                type="submit"
                disabled={status === 'saving'}
                className="flex items-center px-6 py-2 bg-text-primary text-background text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm"
            >
                <Save className="w-4 h-4 mr-2" />
                {status === 'saving' ? '保存中...' : '保存配置'}
            </button>
        </div>
    );
}
