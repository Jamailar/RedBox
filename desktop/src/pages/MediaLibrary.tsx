import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Link2, RefreshCw, Save, FolderOpen } from 'lucide-react';
import clsx from 'clsx';

type MediaAssetSource = 'generated' | 'planned' | 'imported';

interface MediaAsset {
    id: string;
    source: MediaAssetSource;
    projectId?: string;
    title?: string;
    prompt?: string;
    provider?: string;
    model?: string;
    size?: string;
    quality?: string;
    mimeType?: string;
    relativePath?: string;
    boundManuscriptPath?: string;
    createdAt: string;
    updatedAt: string;
    absolutePath?: string;
    previewUrl?: string;
    exists?: boolean;
}

interface MediaListResponse {
    success?: boolean;
    error?: string;
    assets?: MediaAsset[];
}

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: FileNode[];
}

interface AssetDraft {
    title: string;
    projectId: string;
    prompt: string;
}

function flattenManuscripts(nodes: FileNode[]): string[] {
    const result: string[] = [];
    const walk = (items: FileNode[]) => {
        for (const item of items) {
            if (item.isDirectory) {
                walk(item.children || []);
                continue;
            }
            if (item.path.endsWith('.md')) {
                result.push(item.path);
            }
        }
    };
    walk(nodes);
    return result.sort((a, b) => a.localeCompare(b));
}

export function MediaLibrary() {
    const [assets, setAssets] = useState<MediaAsset[]>([]);
    const [manuscripts, setManuscripts] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [sourceFilter, setSourceFilter] = useState<'all' | MediaAssetSource>('all');
    const [projectFilter, setProjectFilter] = useState('');
    const [drafts, setDrafts] = useState<Record<string, AssetDraft>>({});
    const [bindTarget, setBindTarget] = useState<Record<string, string>>({});
    const [workingId, setWorkingId] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [mediaResult, tree] = await Promise.all([
                window.ipcRenderer.invoke('media:list', { limit: 500 }) as Promise<MediaListResponse>,
                window.ipcRenderer.invoke('manuscripts:list') as Promise<FileNode[]>,
            ]);

            if (!mediaResult?.success) {
                setError(mediaResult?.error || '加载媒体库失败');
                setAssets([]);
            } else {
                setAssets(Array.isArray(mediaResult.assets) ? mediaResult.assets : []);
            }
            setManuscripts(flattenManuscripts(Array.isArray(tree) ? tree : []));
            setDrafts({});
            setBindTarget({});
        } catch (e) {
            console.error('Failed to load media library:', e);
            setError('加载媒体库失败');
            setAssets([]);
            setManuscripts([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const filteredAssets = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return assets.filter((asset) => {
            if (sourceFilter !== 'all' && asset.source !== sourceFilter) return false;
            if (projectFilter.trim() && (asset.projectId || '') !== projectFilter.trim()) return false;
            if (!keyword) return true;
            const text = [
                asset.title || '',
                asset.prompt || '',
                asset.projectId || '',
                asset.boundManuscriptPath || '',
                asset.id,
            ].join('\n').toLowerCase();
            return text.includes(keyword);
        });
    }, [assets, projectFilter, query, sourceFilter]);

    const getDraft = useCallback((asset: MediaAsset): AssetDraft => {
        const existing = drafts[asset.id];
        if (existing) return existing;
        return {
            title: asset.title || '',
            projectId: asset.projectId || '',
            prompt: asset.prompt || '',
        };
    }, [drafts]);

    const updateDraft = useCallback((assetId: string, patch: Partial<AssetDraft>) => {
        setDrafts((prev) => {
            const current = prev[assetId] || { title: '', projectId: '', prompt: '' };
            return {
                ...prev,
                [assetId]: { ...current, ...patch },
            };
        });
    }, []);

    const handleSaveMetadata = useCallback(async (asset: MediaAsset) => {
        const draft = getDraft(asset);
        setWorkingId(asset.id);
        try {
            const result = await window.ipcRenderer.invoke('media:update', {
                assetId: asset.id,
                title: draft.title,
                projectId: draft.projectId,
                prompt: draft.prompt,
            }) as { success?: boolean; error?: string };
            if (!result?.success) {
                alert(result?.error || '更新失败');
                return;
            }
            await loadData();
        } catch (e) {
            console.error('Failed to update media metadata:', e);
            alert('更新失败');
        } finally {
            setWorkingId(null);
        }
    }, [getDraft, loadData]);

    const handleBind = useCallback(async (asset: MediaAsset) => {
        const manuscriptPath = bindTarget[asset.id] || asset.boundManuscriptPath || '';
        if (!manuscriptPath) {
            alert('请选择要绑定的稿件');
            return;
        }
        setWorkingId(asset.id);
        try {
            const result = await window.ipcRenderer.invoke('media:bind', {
                assetId: asset.id,
                manuscriptPath,
            }) as { success?: boolean; error?: string };
            if (!result?.success) {
                alert(result?.error || '绑定失败');
                return;
            }
            await loadData();
        } catch (e) {
            console.error('Failed to bind media asset:', e);
            alert('绑定失败');
        } finally {
            setWorkingId(null);
        }
    }, [bindTarget, loadData]);

    return (
        <div className="h-full flex flex-col bg-background">
            <div className="border-b border-border px-6 py-4 flex items-center gap-3">
                <h1 className="text-lg font-semibold text-text-primary">媒体库</h1>
                <div className="text-xs text-text-tertiary">管理 AI 生成图、计划图并绑定稿件</div>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        onClick={() => void window.ipcRenderer.invoke('media:open-root')}
                        className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-surface-secondary text-text-secondary"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <FolderOpen className="w-3.5 h-3.5" />
                            打开目录
                        </span>
                    </button>
                    <button
                        onClick={() => void loadData()}
                        className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-surface-secondary text-text-secondary"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <RefreshCw className="w-3.5 h-3.5" />
                            刷新
                        </span>
                    </button>
                </div>
            </div>

            <div className="px-6 py-3 border-b border-border bg-surface-secondary/20 flex items-center gap-2">
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索标题、提示词、项目ID、稿件路径"
                    className="flex-1 min-w-0 px-3 py-2 text-sm rounded-md border border-border bg-surface-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
                <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value as 'all' | MediaAssetSource)}
                    className="px-3 py-2 text-sm rounded-md border border-border bg-surface-primary focus:outline-none"
                >
                    <option value="all">全部来源</option>
                    <option value="generated">已生成</option>
                    <option value="planned">计划项</option>
                    <option value="imported">导入</option>
                </select>
                <input
                    value={projectFilter}
                    onChange={(event) => setProjectFilter(event.target.value)}
                    placeholder="按项目ID过滤"
                    className="w-44 px-3 py-2 text-sm rounded-md border border-border bg-surface-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
            </div>

            <div className="flex-1 overflow-auto p-6">
                {loading ? (
                    <div className="text-sm text-text-tertiary">正在加载媒体库...</div>
                ) : error ? (
                    <div className="text-sm text-status-error">{error}</div>
                ) : filteredAssets.length === 0 ? (
                    <div className="text-sm text-text-tertiary">暂无媒体资产</div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {filteredAssets.map((asset) => {
                            const draft = getDraft(asset);
                            const selectedManuscript = bindTarget[asset.id] || asset.boundManuscriptPath || '';
                            const busy = workingId === asset.id;
                            return (
                                <div key={asset.id} className="border border-border rounded-lg bg-surface-primary overflow-hidden">
                                    {asset.previewUrl && asset.exists ? (
                                        <img src={asset.previewUrl} alt={asset.title || asset.id} className="w-full h-52 object-cover bg-surface-secondary" />
                                    ) : (
                                        <div className="w-full h-52 bg-surface-secondary flex items-center justify-center text-text-tertiary text-xs">
                                            {asset.source === 'planned' ? '计划配图（尚未生成）' : '图片文件不可用'}
                                        </div>
                                    )}

                                    <div className="p-4 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={clsx(
                                                'text-[11px] px-2 py-0.5 rounded border',
                                                asset.source === 'generated' && 'text-green-600 border-green-500/40',
                                                asset.source === 'planned' && 'text-amber-600 border-amber-500/40',
                                                asset.source === 'imported' && 'text-blue-600 border-blue-500/40'
                                            )}>
                                                {asset.source}
                                            </span>
                                            <span className="text-[11px] text-text-tertiary">{new Date(asset.updatedAt).toLocaleString()}</span>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <input
                                                value={draft.title}
                                                onChange={(event) => updateDraft(asset.id, { title: event.target.value })}
                                                placeholder="标题"
                                                className="px-2.5 py-2 text-xs rounded border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                                            />
                                            <input
                                                value={draft.projectId}
                                                onChange={(event) => updateDraft(asset.id, { projectId: event.target.value })}
                                                placeholder="项目ID"
                                                className="px-2.5 py-2 text-xs rounded border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                                            />
                                        </div>

                                        <textarea
                                            value={draft.prompt}
                                            onChange={(event) => updateDraft(asset.id, { prompt: event.target.value })}
                                            placeholder="提示词"
                                            rows={3}
                                            className="w-full px-2.5 py-2 text-xs rounded border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                                        />

                                        <div className="text-[11px] text-text-tertiary break-all">
                                            {asset.relativePath || '(无文件路径)'}
                                        </div>
                                        <div className="text-[11px] text-text-tertiary break-all">
                                            已绑定稿件：{asset.boundManuscriptPath || '(未绑定)'}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <select
                                                value={selectedManuscript}
                                                onChange={(event) => setBindTarget((prev) => ({ ...prev, [asset.id]: event.target.value }))}
                                                className="flex-1 min-w-0 px-2.5 py-2 text-xs rounded border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                                            >
                                                <option value="">选择稿件绑定</option>
                                                {manuscripts.map((filePath) => (
                                                    <option key={filePath} value={filePath}>
                                                        {filePath}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => void handleBind(asset)}
                                                disabled={busy}
                                                className="px-2.5 py-2 text-xs rounded border border-border hover:bg-surface-secondary text-text-secondary disabled:opacity-50"
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    <Link2 className="w-3.5 h-3.5" />
                                                    绑定稿件
                                                </span>
                                            </button>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => void handleSaveMetadata(asset)}
                                                disabled={busy}
                                                className="px-2.5 py-2 text-xs rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    <Save className="w-3.5 h-3.5" />
                                                    保存
                                                </span>
                                            </button>
                                            <button
                                                onClick={() => void window.ipcRenderer.invoke('media:open', { assetId: asset.id })}
                                                className="px-2.5 py-2 text-xs rounded border border-border hover:bg-surface-secondary text-text-secondary"
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                    打开文件
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
