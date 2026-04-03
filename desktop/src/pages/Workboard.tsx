import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, Clock3, Link2, ListTodo, Loader2, Play, RefreshCw, X } from 'lucide-react';

type WorkItem = Awaited<ReturnType<typeof window.ipcRenderer.work.list>>[number];

type WorkColumnKey = 'ready' | 'blocked' | 'active' | 'waiting' | 'done';

const COLUMN_ORDER: Array<{ key: WorkColumnKey; label: string; tone: string }> = [
    { key: 'ready', label: '待启动', tone: 'bg-[#dff2ee] text-[#4b7f76]' },
    { key: 'blocked', label: '阻塞中', tone: 'bg-[#f6edcf] text-[#8c7543]' },
    { key: 'active', label: '进行中', tone: 'bg-[#d9e6fb] text-[#5f7499]' },
    { key: 'waiting', label: '等待中', tone: 'bg-[#e8def6] text-[#7d6d9a]' },
    { key: 'done', label: '已完成', tone: 'bg-[#edf0f4] text-[#6f7682]' },
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

function resolveColumnKey(item: WorkItem): WorkColumnKey {
    const effective = String(item.effectiveStatus || '').trim() as WorkColumnKey;
    if (COLUMN_ORDER.some((column) => column.key === effective)) {
        return effective;
    }
    const fallback = String(item.status || '').trim();
    if (fallback === 'pending') return 'blocked';
    if (fallback === 'active') return 'active';
    if (fallback === 'waiting') return 'waiting';
    if (fallback === 'done') return 'done';
    return 'blocked';
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
            const next = await window.ipcRenderer.work.list({ limit: 300 });
            setItems(next || []);
            setLastUpdatedAt(new Date().toISOString());
            setSelectedId((prev) => prev && next.some((item) => item.id === prev) ? prev : '');
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
            map.get(resolveColumnKey(item))?.push(item);
        }
        return map;
    }, [items]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedId) || null,
        [items, selectedId],
    );

    const stats = useMemo(() => ({
        total: items.length,
        automation: items.filter((item) => item.type === 'automation').length,
        ready: items.filter((item) => resolveColumnKey(item) === 'ready').length,
    }), [items]);

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
        <div className="h-full min-h-0 bg-[#fbfaf7] text-[#191919]">
            <div className="h-full min-h-0 flex flex-col px-8 py-7 gap-5">
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="px-3 py-1.5 rounded-full border border-[#ece5da] bg-white text-xs text-[#7d766a]">
                        全部 {stats.total}
                    </div>
                    <div className="px-3 py-1.5 rounded-full border border-[#ece5da] bg-white text-xs text-[#7d766a]">
                        Ready {stats.ready}
                    </div>
                    <div className="px-3 py-1.5 rounded-full border border-[#ece5da] bg-white text-xs text-[#7d766a]">
                        自动化 {stats.automation}
                    </div>
                    <div className="px-3 py-1.5 rounded-full border border-[#ece5da] bg-white text-xs text-[#7d766a]">
                        更新于 {formatDateTime(lastUpdatedAt)}
                    </div>
                    <button
                        onClick={() => void load()}
                        className="h-[34px] px-4 rounded-full border border-[#e7e0d4] bg-white text-xs inline-flex items-center gap-2 hover:bg-[#f5f1e9] shrink-0 shadow-[0_1px_2px_rgba(24,24,24,0.03)] text-[#7d766a]"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>

                {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 inline-flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-2">
                    <div className="h-full min-w-max grid auto-cols-[272px] grid-flow-col gap-5">
                        {COLUMN_ORDER.map((column) => {
                            const list = grouped.get(column.key) || [];
                            return (
                                <section key={column.key} className="h-full min-h-0 flex flex-col overflow-hidden">
                                    <div className="px-1 py-1 flex items-center">
                                        <div className="flex items-center gap-3">
                                            <h2 className="text-[18px] font-semibold tracking-[-0.02em]">{column.label}</h2>
                                            <span className="text-[14px] text-[#9a958b]">{list.length}</span>
                                        </div>
                                    </div>
                                    <div className="pt-4 space-y-4 overflow-y-auto pr-2">
                                        {list.length === 0 ? (
                                            <div className="rounded-[24px] border border-dashed border-[#e2d9ca] bg-white px-4 py-8 text-sm text-[#9a958b] text-center">
                                                当前列没有任务
                                            </div>
                                        ) : (
                                            list.map((item) => (
                                                <button
                                                    key={item.id}
                                                    onClick={() => setSelectedId(item.id)}
                                                    className="w-full text-left rounded-[22px] border border-[#ddd7cd] bg-white px-5 py-5 hover:shadow-[0_10px_24px_rgba(28,28,28,0.05)] transition shadow-[0_2px_8px_rgba(30,30,30,0.03)]"
                                                >
                                                    <div className="flex items-start gap-2.5">
                                                        <div className="mt-0.5 h-6 w-6 rounded-[8px] border-2 border-[#f7a31a] shrink-0" />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-[15px] font-semibold leading-[1.32] tracking-[-0.02em] line-clamp-2">
                                                                {item.title}
                                                            </div>
                                                            <div className="mt-2 text-[13px] leading-6 text-[#a29b91] line-clamp-2">
                                                                {item.summary || item.description || '暂无任务摘要'}
                                                            </div>

                                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium ${column.tone}`}>
                                                                    {column.label}
                                                                </span>
                                                                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium bg-[#f5e7df] text-[#7a7066]">
                                                                    {labelForType(item.type)}
                                                                </span>
                                                                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium bg-[#8ea0f4] text-white/90">
                                                                    P{item.priority}
                                                                </span>
                                                                {item.blockedBy.length > 0 && (
                                                                    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium bg-[#f8efcf] text-[#8f7440]">
                                                                        阻塞 {item.blockedBy.length}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {item.schedule?.mode && item.schedule.mode !== 'none' && (
                                                                <div className="mt-2.5 text-[12px] text-[#9a958b] line-clamp-2">
                                                                    {scheduleSummary(item)}
                                                                </div>
                                                            )}

                                                            <div className="mt-3 flex items-center gap-2 text-[#9a958b]">
                                                                <ListTodo className="w-[14px] h-[14px]" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </div>
            </div>

            {selectedItem && (
                <div className="fixed inset-0 z-[70] bg-black/35 backdrop-blur-[2px] flex items-center justify-center px-4">
                    <div className="w-full max-w-[780px] max-h-[85vh] overflow-hidden rounded-[28px] border border-[#ddd7cd] bg-white shadow-[0_28px_80px_rgba(20,20,20,0.15)]">
                        <div className="px-6 py-5 border-b border-[#ebe4d9] flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="text-[24px] font-semibold leading-8 tracking-[-0.02em]">{selectedItem.title}</div>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    <span className="inline-flex items-center rounded-full border border-[#e7dfd4] px-2.5 py-0.5 text-[10px] text-[#8c8579]">
                                        {selectedItem.id}
                                    </span>
                                    <span className="inline-flex items-center rounded-full border border-[#e7dfd4] px-2.5 py-0.5 text-[10px] text-[#8c8579]">
                                        {labelForType(selectedItem.type)}
                                    </span>
                                    <span className="inline-flex items-center rounded-full border border-[#e7dfd4] px-2.5 py-0.5 text-[10px] text-[#8c8579]">
                                        {selectedItem.effectiveStatus}
                                    </span>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedId('')}
                                className="h-10 w-10 rounded-full border border-[#e7dfd4] inline-flex items-center justify-center text-[#8c8579] hover:bg-[#f5f1e9] hover:text-[#191919]"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="px-6 py-6 overflow-y-auto max-h-[calc(85vh-84px)] space-y-6">
                            {selectedItem.description && (
                                <section>
                                    <div className="text-xs uppercase tracking-[0.16em] text-[#9a958b]">Description</div>
                                    <div className="mt-2 rounded-2xl border border-[#ebe4d9] bg-[#faf8f4] px-4 py-4 text-sm text-[#5d564b] whitespace-pre-wrap">
                                        {selectedItem.description}
                                    </div>
                                </section>
                            )}

                            {selectedItem.summary && (
                                <section>
                                    <div className="text-xs uppercase tracking-[0.16em] text-[#9a958b]">Summary</div>
                                    <div className="mt-2 text-sm text-[#5d564b] whitespace-pre-wrap">
                                        {selectedItem.summary}
                                    </div>
                                </section>
                            )}

                            {selectedItem.schedule?.mode && selectedItem.schedule.mode !== 'none' && (
                                <section>
                                    <div className="text-xs uppercase tracking-[0.16em] text-[#9a958b]">Schedule</div>
                                    <div className="mt-2 rounded-2xl border border-[#ebe4d9] bg-[#faf8f4] px-4 py-4 text-sm text-[#5d564b]">
                                        {scheduleSummary(selectedItem)}
                                    </div>
                                </section>
                            )}

                            <section>
                                <div className="text-xs uppercase tracking-[0.16em] text-[#9a958b]">Actions</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {selectedItem.type === 'automation' && (
                                        <button
                                            onClick={async () => {
                                                try {
                                                    setRunningNowId(selectedItem.id);
                                                    await triggerWorkItemNow(selectedItem);
                                                    await load();
                                                } catch (runError) {
                                                    alert(runError instanceof Error ? runError.message : String(runError));
                                                } finally {
                                                    setRunningNowId('');
                                                }
                                            }}
                                            className="h-9 px-3 rounded-full border border-[#e4ddd1] bg-white text-xs inline-flex items-center gap-2 hover:bg-[#f5f1e9]"
                                        >
                                            {runningNowId === selectedItem.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                                            立即执行
                                        </button>
                                    )}
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
                                            className="h-9 px-3 rounded-full border border-[#e4ddd1] bg-white text-xs inline-flex items-center gap-2 hover:bg-[#f5f1e9] disabled:opacity-60"
                                        >
                                            {updatingStatusId === selectedItem.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                            {action.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <div className="text-xs uppercase tracking-[0.16em] text-[#9a958b]">Refs</div>
                                    <div className="mt-2 space-y-2 text-sm text-[#5d564b]">
                                        <div className="flex items-center gap-2"><Link2 className="w-4 h-4" /> 项目 {selectedItem.refs.projectIds.join(', ') || '-'}</div>
                                        <div className="flex items-center gap-2"><Bot className="w-4 h-4" /> 会话 {selectedItem.refs.sessionIds.join(', ') || '-'}</div>
                                        <div className="flex items-center gap-2"><ListTodo className="w-4 h-4" /> 任务 {selectedItem.refs.taskIds.join(', ') || '-'}</div>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-xs uppercase tracking-[0.16em] text-[#9a958b]">Meta</div>
                                    <div className="mt-2 space-y-2 text-sm text-[#5d564b]">
                                        <div>创建时间 {formatDateTime(selectedItem.createdAt)}</div>
                                        <div>更新时间 {formatDateTime(selectedItem.updatedAt)}</div>
                                        <div>完成时间 {formatDateTime(selectedItem.completedAt)}</div>
                                    </div>
                                </div>
                            </section>

                            {Array.isArray((selectedItem.metadata as Record<string, unknown> | undefined)?.subagentRoles) && (
                                <section>
                                    <div className="text-xs uppercase tracking-[0.16em] text-[#9a958b]">Subagents</div>
                                    <div className="mt-2 text-sm text-[#5d564b]">
                                        {((selectedItem.metadata as Record<string, unknown>).subagentRoles as unknown[]).map((item) => String(item)).join(' -> ') || '-'}
                                    </div>
                                </section>
                            )}

                            {selectedItem.blockedBy.length > 0 && (
                                <section>
                                    <div className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Blocked By</div>
                                    <div className="mt-2 text-sm text-amber-700">
                                        {selectedItem.blockedBy.join(', ')}
                                    </div>
                                </section>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Workboard;
