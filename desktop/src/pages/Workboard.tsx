import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, Clock3, Link2, ListTodo, Loader2, Play, RefreshCw } from 'lucide-react';

type WorkItem = Awaited<ReturnType<typeof window.ipcRenderer.work.list>>[number];

type WorkColumnKey = 'ready' | 'blocked' | 'active' | 'waiting' | 'done';

const COLUMN_ORDER: Array<{ key: WorkColumnKey; label: string; tone: string }> = [
    { key: 'ready', label: 'Ready', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    { key: 'blocked', label: 'Blocked', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
    { key: 'active', label: 'Active', tone: 'text-sky-700 bg-sky-50 border-sky-200' },
    { key: 'waiting', label: 'Waiting', tone: 'text-violet-700 bg-violet-50 border-violet-200' },
    { key: 'done', label: 'Done', tone: 'text-slate-700 bg-slate-100 border-slate-200' },
];

function labelForType(type: string): string {
    switch (type) {
        case 'redclaw-note':
            return '笔记';
        case 'redclaw-project':
            return '项目';
        case 'automation':
            return '自动化';
        case 'research':
            return '调研';
        case 'review':
            return '评审';
        case 'external-message':
            return '外部消息';
        default:
            return type || '任务';
    }
}

function formatDateTime(value?: string): string {
    if (!value) return '-';
    const ts = Date.parse(value);
    if (!Number.isFinite(ts)) return value;
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function scheduleSummary(item: WorkItem): string {
    const schedule = item.schedule;
    if (!schedule || schedule.mode === 'none') return '';
    if (schedule.mode === 'long-cycle') {
        return `长周期 ${schedule.completedRounds || 0}/${schedule.totalRounds || 0} · 下次 ${formatDateTime(schedule.nextRunAt)}`;
    }
    if (schedule.mode === 'interval') {
        return `每 ${schedule.intervalMinutes || '-'} 分钟 · 下次 ${formatDateTime(schedule.nextRunAt)}`;
    }
    if (schedule.mode === 'daily') {
        return `每天 ${schedule.time || '-'} · 下次 ${formatDateTime(schedule.nextRunAt)}`;
    }
    if (schedule.mode === 'weekly') {
        return `每周 ${Array.isArray(schedule.weekdays) ? schedule.weekdays.join(',') : '-'} ${schedule.time || ''} · 下次 ${formatDateTime(schedule.nextRunAt)}`;
    }
    return `一次性任务 · 计划 ${formatDateTime(schedule.runAt || schedule.nextRunAt)}`;
}

async function triggerWorkItemNow(item: WorkItem): Promise<void> {
    const metadata = (item.metadata || {}) as Record<string, unknown>;
    if (metadata.scheduledTaskId) {
        await window.ipcRenderer.redclawRunner.runScheduledNow({ taskId: String(metadata.scheduledTaskId) });
        return;
    }
    if (metadata.longCycleTaskId) {
        await window.ipcRenderer.redclawRunner.runLongCycleNow({ taskId: String(metadata.longCycleTaskId) });
        return;
    }
    throw new Error('当前工作项没有可立即执行的自动化绑定。');
}

export function Workboard() {
    const [items, setItems] = useState<WorkItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [lastUpdatedAt, setLastUpdatedAt] = useState('');
    const [selectedId, setSelectedId] = useState<string>('');
    const [runningNowId, setRunningNowId] = useState<string>('');
    const [updatingStatusId, setUpdatingStatusId] = useState<string>('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const next = await window.ipcRenderer.work.list({ limit: 200 });
            setItems(next || []);
            setLastUpdatedAt(new Date().toISOString());
            setSelectedId((prev) => prev && next.some((item) => item.id === prev) ? prev : (next[0]?.id || ''));
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : String(loadError));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const grouped = useMemo(() => {
        const map = new Map<WorkColumnKey, WorkItem[]>();
        for (const column of COLUMN_ORDER) {
            map.set(column.key, []);
        }
        for (const item of items) {
            const key = (COLUMN_ORDER.some((column) => column.key === item.effectiveStatus)
                ? item.effectiveStatus
                : (item.status === 'pending' ? 'blocked' : item.status)) as WorkColumnKey;
            map.get(key)?.push(item);
        }
        return map;
    }, [items]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedId) || null,
        [items, selectedId],
    );

    const readyItems = useMemo(
        () => items.filter((item) => item.effectiveStatus === 'ready').slice(0, 8),
        [items],
    );

    const automationItems = useMemo(
        () => items.filter((item) => item.type === 'automation').slice(0, 8),
        [items],
    );

    const updateStatus = useCallback(async (item: WorkItem, status: 'pending' | 'active' | 'waiting' | 'done' | 'cancelled') => {
        try {
            setUpdatingStatusId(item.id);
            await window.ipcRenderer.work.update({ id: item.id, status });
            await load();
        } catch (updateError) {
            alert(updateError instanceof Error ? updateError.message : String(updateError));
        } finally {
            setUpdatingStatusId('');
        }
    }, [load]);

    return (
        <div className="h-full min-h-0 bg-surface-primary text-text-primary">
            <div className="h-full min-h-0 flex flex-col px-6 py-5 gap-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-text-tertiary">
                            <ListTodo className="w-4 h-4" />
                            Workboard
                        </div>
                        <h1 className="mt-2 text-2xl font-semibold">统一任务调度台</h1>
                        <p className="mt-2 max-w-3xl text-sm text-text-secondary">
                            这里统一展示 ready、blocked、active、waiting、done。RedClaw 项目、一次性笔记、定时任务、长周期任务都挂在同一套 work item 上。
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => void load()}
                            className="h-10 px-4 rounded-lg border border-border bg-surface-secondary text-sm inline-flex items-center gap-2 hover:bg-surface-hover"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_360px] gap-5 min-h-0 flex-1">
                    <div className="min-h-0 flex flex-col gap-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                            {COLUMN_ORDER.map((column) => {
                                const list = grouped.get(column.key) || [];
                                return (
                                    <div key={column.key} className="rounded-2xl border border-border bg-surface-secondary/70 min-h-[260px] flex flex-col">
                                        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${column.tone}`}>
                                                {column.label}
                                            </span>
                                            <span className="text-xs text-text-tertiary">{list.length}</span>
                                        </div>
                                        <div className="p-3 space-y-3 overflow-auto">
                                            {list.length === 0 ? (
                                                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-xs text-text-tertiary text-center">
                                                    当前列没有任务
                                                </div>
                                            ) : (
                                                list.map((item) => (
                                                    <button
                                                        key={item.id}
                                                        onClick={() => setSelectedId(item.id)}
                                                        className={`w-full text-left rounded-xl border px-3 py-3 transition ${
                                                            selectedId === item.id
                                                                ? 'border-emerald-300 bg-emerald-50/70'
                                                                : 'border-border bg-surface-primary hover:bg-surface-hover'
                                                        }`}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-medium truncate">{item.title}</div>
                                                                <div className="mt-1 text-[11px] text-text-tertiary">
                                                                    {labelForType(item.type)} · P{item.priority}
                                                                </div>
                                                            </div>
                                                            {item.type === 'automation' && (
                                                                <Clock3 className="w-4 h-4 text-text-tertiary shrink-0 mt-0.5" />
                                                            )}
                                                        </div>
                                                        {item.summary && (
                                                            <div className="mt-2 text-xs text-text-secondary line-clamp-3">
                                                                {item.summary}
                                                            </div>
                                                        )}
                                                        {item.blockedBy.length > 0 && (
                                                            <div className="mt-2 text-[11px] text-amber-700">
                                                                阻塞于 {item.blockedBy.length} 个前置任务
                                                            </div>
                                                        )}
                                                        {item.schedule?.mode && item.schedule.mode !== 'none' && (
                                                            <div className="mt-2 text-[11px] text-text-tertiary">
                                                                {scheduleSummary(item)}
                                                            </div>
                                                        )}
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="min-h-0 flex flex-col gap-4">
                        <div className="rounded-2xl border border-border bg-surface-secondary/70 p-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Ready Queue</div>
                            <div className="mt-3 space-y-2">
                                {readyItems.length === 0 ? (
                                    <div className="text-sm text-text-tertiary">当前没有 ready 任务。</div>
                                ) : (
                                    readyItems.map((item) => (
                                        <div key={item.id} className="rounded-xl border border-border bg-surface-primary px-3 py-2">
                                            <div className="text-sm font-medium">{item.title}</div>
                                            <div className="mt-1 text-[11px] text-text-tertiary">{labelForType(item.type)} · {item.id}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-surface-secondary/70 p-4">
                            <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Automation</div>
                            <div className="mt-3 space-y-2">
                                {automationItems.length === 0 ? (
                                    <div className="text-sm text-text-tertiary">当前没有自动化任务。</div>
                                ) : (
                                    automationItems.map((item) => (
                                        <div key={item.id} className="rounded-xl border border-border bg-surface-primary px-3 py-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium truncate">{item.title}</div>
                                                    <div className="mt-1 text-[11px] text-text-tertiary">{scheduleSummary(item)}</div>
                                                </div>
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            setRunningNowId(item.id);
                                                            await triggerWorkItemNow(item);
                                                            await load();
                                                        } catch (runError) {
                                                            alert(runError instanceof Error ? runError.message : String(runError));
                                                        } finally {
                                                            setRunningNowId('');
                                                        }
                                                    }}
                                                    className="h-8 px-3 rounded-md border border-border text-xs inline-flex items-center gap-1.5 hover:bg-surface-hover"
                                                >
                                                    {runningNowId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                                                    立即执行
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-surface-secondary/70 p-4 min-h-0 flex-1 overflow-auto">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Inspector</div>
                                <div className="text-[11px] text-text-tertiary">更新于 {formatDateTime(lastUpdatedAt)}</div>
                            </div>
                            {!selectedItem ? (
                                <div className="mt-4 text-sm text-text-tertiary">选择左侧任务查看详情。</div>
                            ) : (
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <div className="text-lg font-semibold">{selectedItem.title}</div>
                                        <div className="mt-1 text-xs text-text-tertiary">
                                            {selectedItem.id} · {labelForType(selectedItem.type)} · {selectedItem.effectiveStatus}
                                        </div>
                                    </div>

                                    {selectedItem.description && (
                                        <div className="rounded-xl border border-border bg-surface-primary px-3 py-3 text-sm text-text-secondary whitespace-pre-wrap">
                                            {selectedItem.description}
                                        </div>
                                    )}

                                    {selectedItem.summary && (
                                        <div>
                                            <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Summary</div>
                                            <div className="mt-2 text-sm text-text-secondary whitespace-pre-wrap">{selectedItem.summary}</div>
                                        </div>
                                    )}

                                    {selectedItem.schedule?.mode && selectedItem.schedule.mode !== 'none' && (
                                        <div>
                                            <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Schedule</div>
                                            <div className="mt-2 rounded-xl border border-border bg-surface-primary px-3 py-3 text-sm text-text-secondary">
                                                {scheduleSummary(selectedItem)}
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Actions</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {[
                                                { key: 'pending', label: '回到待启动' },
                                                { key: 'active', label: '开始执行' },
                                                { key: 'waiting', label: '标记等待' },
                                                { key: 'done', label: '标记完成' },
                                                { key: 'cancelled', label: '取消' },
                                            ].map((action) => (
                                                <button
                                                    key={action.key}
                                                    onClick={() => void updateStatus(selectedItem, action.key as 'pending' | 'active' | 'waiting' | 'done' | 'cancelled')}
                                                    disabled={updatingStatusId === selectedItem.id}
                                                    className="h-9 px-3 rounded-lg border border-border bg-surface-primary text-xs inline-flex items-center gap-2 hover:bg-surface-hover disabled:opacity-60"
                                                >
                                                    {updatingStatusId === selectedItem.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                                    {action.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3">
                                        <div>
                                            <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Refs</div>
                                            <div className="mt-2 space-y-2 text-sm text-text-secondary">
                                                <div className="flex items-center gap-2"><Link2 className="w-4 h-4" /> 项目 {selectedItem.refs.projectIds.join(', ') || '-'}</div>
                                                <div className="flex items-center gap-2"><Bot className="w-4 h-4" /> 会话 {selectedItem.refs.sessionIds.join(', ') || '-'}</div>
                                                <div className="flex items-center gap-2"><ListTodo className="w-4 h-4" /> 任务 {selectedItem.refs.taskIds.join(', ') || '-'}</div>
                                            </div>
                                        </div>

                                        {Array.isArray((selectedItem.metadata as Record<string, unknown> | undefined)?.subagentRoles) && (
                                            <div>
                                                <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Subagents</div>
                                                <div className="mt-2 text-sm text-text-secondary">
                                                    {((selectedItem.metadata as Record<string, unknown>).subagentRoles as unknown[]).map((item) => String(item)).join(' -> ') || '-'}
                                                </div>
                                            </div>
                                        )}

                                        {selectedItem.blockedBy.length > 0 && (
                                            <div>
                                                <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Blocked By</div>
                                                <div className="mt-2 text-sm text-amber-700">
                                                    {selectedItem.blockedBy.join(', ')}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 inline-flex items-center gap-2">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Workboard;
