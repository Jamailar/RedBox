import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Link2, RefreshCw, Save, FolderOpen, ImagePlus, Sparkles, Search, SlidersHorizontal, Image, Pencil } from 'lucide-react';
import clsx from 'clsx';
import { resolveAssetUrl } from '../utils/pathManager';

type MediaAssetSource = 'generated' | 'planned' | 'imported';

interface MediaAsset {
    id: string;
    source: MediaAssetSource;
    projectId?: string;
    title?: string;
    prompt?: string;
    provider?: string;
    providerTemplate?: string;
    model?: string;
    aspectRatio?: string;
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

interface GeneratedAsset {
    id: string;
    title?: string;
    prompt?: string;
    previewUrl?: string;
    exists?: boolean;
    projectId?: string;
    provider?: string;
    providerTemplate?: string;
    model?: string;
    aspectRatio?: string;
    size?: string;
    quality?: string;
    relativePath?: string;
    updatedAt: string;
}

interface SettingsShape {
    api_endpoint?: string;
    api_key?: string;
    image_provider?: string;
    image_endpoint?: string;
    image_api_key?: string;
    image_model?: string;
    image_provider_template?: string;
    image_aspect_ratio?: string;
    image_size?: string;
    image_quality?: string;
}

const SOURCE_META: Record<MediaAssetSource, { label: string; badgeClass: string; chipClass: string }> = {
    generated: {
        label: '已生成',
        badgeClass: 'text-emerald-600 border-emerald-500/40 bg-emerald-500/10',
        chipClass: 'border-emerald-500/30 text-emerald-700 bg-emerald-500/10',
    },
    planned: {
        label: '计划项',
        badgeClass: 'text-amber-600 border-amber-500/40 bg-amber-500/10',
        chipClass: 'border-amber-500/30 text-amber-700 bg-amber-500/10',
    },
    imported: {
        label: '导入',
        badgeClass: 'text-blue-600 border-blue-500/40 bg-blue-500/10',
        chipClass: 'border-blue-500/30 text-blue-700 bg-blue-500/10',
    },
};

const ASPECT_RATIO_OPTIONS = [
    { value: '3:4', label: '3:4' },
    { value: '4:3', label: '4:3' },
    { value: '9:16', label: '9:16' },
    { value: '16:9', label: '16:9' },
    { value: 'auto', label: 'auto' },
] as const;

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsDataURL(file);
});

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
    const [settings, setSettings] = useState<SettingsShape>({});
    const [prompt, setPrompt] = useState('');
    const [genProjectId, setGenProjectId] = useState('');
    const [genTitle, setGenTitle] = useState('');
    const [count, setCount] = useState(1);
    const [model, setModel] = useState('');
    const [aspectRatio, setAspectRatio] = useState('3:4');
    const [size, setSize] = useState('');
    const [quality, setQuality] = useState('standard');
    const [generationMode, setGenerationMode] = useState<'text-to-image' | 'reference-guided' | 'image-to-image'>('text-to-image');
    const [referenceImages, setReferenceImages] = useState<Array<{ name: string; dataUrl: string }>>([]);
    const [isReadingRefImages, setIsReadingRefImages] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [genError, setGenError] = useState('');
    const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>([]);
    const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);

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
            setExpandedAssetId(null);
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

    const loadSettings = useCallback(async () => {
        try {
            const s = await window.ipcRenderer.getSettings();
            const next = (s || {}) as SettingsShape;
            setSettings(next);
            setModel(next.image_model || 'gpt-image-1');
            setAspectRatio(next.image_aspect_ratio || '3:4');
            setSize(next.image_size || '');
            setQuality(next.image_quality || 'standard');
        } catch (e) {
            console.error('Failed to load image settings:', e);
            setSettings({});
        }
    }, []);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

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

    const sourceStats = useMemo(() => {
        return assets.reduce<Record<'all' | MediaAssetSource, number>>((acc, asset) => {
            acc.all += 1;
            acc[asset.source] += 1;
            return acc;
        }, {
            all: 0,
            generated: 0,
            planned: 0,
            imported: 0,
        });
    }, [assets]);

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

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim()) {
            setGenError('请先输入提示词');
            return;
        }
        if (generationMode === 'image-to-image' && referenceImages.length === 0) {
            setGenError('图生图模式至少需要 1 张参考图');
            return;
        }

        setIsGenerating(true);
        setGenError('');
        try {
            const effectiveMode = referenceImages.length > 0
                ? generationMode
                : 'text-to-image';
            const result = await window.ipcRenderer.invoke('image-gen:generate', {
                prompt,
                projectId: genProjectId.trim() || undefined,
                title: genTitle.trim() || undefined,
                generationMode: effectiveMode,
                referenceImages: referenceImages.map((item) => item.dataUrl),
                count,
                model: model.trim() || undefined,
                provider: settings.image_provider || undefined,
                providerTemplate: settings.image_provider_template || undefined,
                aspectRatio: aspectRatio.trim() || undefined,
                size: size.trim() || undefined,
                quality: quality.trim() || undefined,
            }) as { success?: boolean; error?: string; assets?: GeneratedAsset[] };

            if (!result?.success) {
                setGenError(result?.error || '生图失败');
                return;
            }
            setGeneratedAssets(Array.isArray(result.assets) ? result.assets : []);
            await loadData();
        } catch (e) {
            console.error('Failed to generate images:', e);
            setGenError('生图失败');
        } finally {
            setIsGenerating(false);
        }
    }, [aspectRatio, count, genProjectId, genTitle, generationMode, loadData, model, prompt, quality, referenceImages, settings.image_provider, settings.image_provider_template, size]);

    const handleReferenceFiles = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        setIsReadingRefImages(true);
        try {
            const results = await Promise.all(files.slice(0, 4).map(async (file) => ({
                name: file.name,
                dataUrl: await readFileAsDataUrl(file),
            })));
            setReferenceImages((prev) => {
                const merged = [...prev, ...results].slice(0, 4);
                const deduped = new Map<string, { name: string; dataUrl: string }>();
                for (const item of merged) {
                    const key = `${item.name}:${item.dataUrl.slice(0, 64)}`;
                    if (!deduped.has(key)) deduped.set(key, item);
                }
                return Array.from(deduped.values()).slice(0, 4);
            });
        } catch (uploadError) {
            console.error('Failed to parse reference images:', uploadError);
            setGenError('参考图读取失败，请重试');
        } finally {
            setIsReadingRefImages(false);
            event.target.value = '';
        }
    }, []);

    const resolvedEndpoint = (settings.image_endpoint || settings.api_endpoint || '').trim();
    const resolvedApiKey = (settings.image_api_key || settings.api_key || '').trim();
    const hasImageConfig = Boolean(resolvedEndpoint) && Boolean(resolvedApiKey);

    return (
        <div className="h-full flex flex-col bg-background">
            <div className="border-b border-border px-4 py-2 bg-surface-secondary/45">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-accent-primary/15 border border-accent-primary/20 text-accent-primary flex items-center justify-center shrink-0">
                        <Image className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-base leading-none font-semibold text-text-primary">媒体库画廊</h1>
                        <div className="text-[11px] mt-0.5 text-text-tertiary truncate">管理 AI 生成图、计划图并快速绑定稿件</div>
                    </div>

                    <div className="hidden xl:flex items-center gap-1.5 min-w-0 ml-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-md border border-border bg-surface-primary/70 text-text-secondary whitespace-nowrap">
                            总资产 {sourceStats.all}
                        </span>
                        <span className={clsx('text-[10px] px-2 py-0.5 rounded-md border whitespace-nowrap', SOURCE_META.generated.chipClass)}>
                            已生成 {sourceStats.generated}
                        </span>
                        <span className={clsx('text-[10px] px-2 py-0.5 rounded-md border whitespace-nowrap', SOURCE_META.planned.chipClass)}>
                            计划项 {sourceStats.planned}
                        </span>
                        <span className={clsx('text-[10px] px-2 py-0.5 rounded-md border whitespace-nowrap', SOURCE_META.imported.chipClass)}>
                            导入 {sourceStats.imported}
                        </span>
                    </div>

                    <div className="ml-auto flex items-center gap-1.5">
                        <button
                            onClick={() => void window.ipcRenderer.invoke('media:open-root')}
                            className="h-7 px-2.5 text-[11px] rounded-md border border-border hover:bg-surface-secondary text-text-secondary"
                        >
                            <span className="inline-flex items-center gap-1">
                                <FolderOpen className="w-3.5 h-3.5" />
                                打开目录
                            </span>
                        </button>
                        <button
                            onClick={() => void loadData()}
                            className="h-7 px-2.5 text-[11px] rounded-md border border-border hover:bg-surface-secondary text-text-secondary"
                        >
                            <span className="inline-flex items-center gap-1">
                                <RefreshCw className="w-3.5 h-3.5" />
                                刷新
                            </span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="px-6 py-3 border-b border-border bg-surface-secondary/20 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                        <Search className="w-4 h-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="搜索标题、提示词、项目ID、稿件路径"
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-surface-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        />
                    </div>
                    <input
                        value={projectFilter}
                        onChange={(event) => setProjectFilter(event.target.value)}
                        placeholder="按项目ID过滤"
                        className="w-full lg:w-52 px-3 py-2 text-sm rounded-md border border-border bg-surface-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    />
                    <select
                        value={sourceFilter}
                        onChange={(event) => setSourceFilter(event.target.value as 'all' | MediaAssetSource)}
                        className="w-full lg:w-40 px-3 py-2 text-sm rounded-md border border-border bg-surface-primary focus:outline-none"
                    >
                        <option value="all">全部来源</option>
                        <option value="generated">已生成</option>
                        <option value="planned">计划项</option>
                        <option value="imported">导入</option>
                    </select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary px-2 py-1 rounded-md border border-border bg-surface-primary/70">
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        快速筛选
                    </span>
                    {(['all', 'generated', 'planned', 'imported'] as const).map((filterKey) => {
                        const active = sourceFilter === filterKey;
                        const countValue = sourceStats[filterKey];
                        const label = filterKey === 'all' ? '全部来源' : SOURCE_META[filterKey].label;
                        return (
                            <button
                                key={filterKey}
                                onClick={() => setSourceFilter(filterKey)}
                                className={clsx(
                                    'text-[11px] px-2.5 py-1 rounded-md border transition-colors',
                                    active
                                        ? (filterKey === 'all' ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary' : SOURCE_META[filterKey].chipClass)
                                        : 'border-border bg-surface-primary text-text-secondary hover:bg-surface-secondary'
                                )}
                            >
                                {label} · {countValue}
                            </button>
                        );
                    })}
                    <div className="ml-auto text-[11px] text-text-tertiary">
                        当前结果 {filteredAssets.length}
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-6">
                <div className="border border-border rounded-xl bg-surface-primary p-4 md:p-5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <Sparkles className="w-4 h-4 text-accent-primary" />
                        在媒体库内生图
                    </div>
                    <div className="text-xs text-text-secondary">
                        当前生图配置：provider=<span className="font-mono">{settings.image_provider || 'openai-compatible'}</span> · template=<span className="font-mono">{settings.image_provider_template || 'openai-images'}</span> · endpoint=<span className="font-mono">{resolvedEndpoint || '(未设置)'}</span>
                    </div>
                    {!hasImageConfig && (
                        <div className="text-xs text-status-error">
                            未检测到生图配置。请先到“设置 → AI 模型”填写生图 Endpoint 和 API Key。
                        </div>
                    )}

                    <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="输入提示词，例如：一张温暖晨光中的北欧风民宿客厅，真实摄影风格，适合小红书封面"
                        rows={4}
                        className="w-full px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    />

                    <div className="space-y-2">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <select
                                value={generationMode}
                                onChange={(event) => setGenerationMode(event.target.value as 'text-to-image' | 'reference-guided' | 'image-to-image')}
                                className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                            >
                                <option value="text-to-image">文生图</option>
                                <option value="reference-guided">参考图引导</option>
                                <option value="image-to-image">图生图</option>
                            </select>
                            <label className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 cursor-pointer hover:bg-surface-secondary/30">
                                {isReadingRefImages ? '读取参考图中...' : '上传参考图（最多4张）'}
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={handleReferenceFiles}
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() => setReferenceImages([])}
                                className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 hover:bg-surface-secondary/30 disabled:opacity-50"
                                disabled={!referenceImages.length}
                            >
                                清空参考图
                            </button>
                        </div>
                        {referenceImages.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {referenceImages.map((item, index) => (
                                    <div key={`${item.name}-${index}`} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded border border-border bg-surface-secondary/20 text-xs text-text-secondary">
                                        <span className="truncate max-w-[220px]">{item.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => setReferenceImages((prev) => prev.filter((_, i) => i !== index))}
                                            className="text-text-tertiary hover:text-text-primary"
                                        >
                                            移除
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        <input
                            value={genTitle}
                            onChange={(event) => setGenTitle(event.target.value)}
                            placeholder="资产标题（可选）"
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        />
                        <input
                            value={genProjectId}
                            onChange={(event) => setGenProjectId(event.target.value)}
                            placeholder="项目ID（可选）"
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        />
                        <input
                            value={model}
                            onChange={(event) => setModel(event.target.value)}
                            placeholder="模型（如 gpt-image-1）"
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        />
                        <select
                            value={aspectRatio}
                            onChange={(event) => setAspectRatio(event.target.value)}
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        >
                            {ASPECT_RATIO_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <select
                            value={size}
                            onChange={(event) => setSize(event.target.value)}
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        >
                            <option value="">自动（按比例）</option>
                            <option value="1024x1024">1024x1024</option>
                            <option value="1024x1536">1024x1536</option>
                            <option value="1536x1024">1536x1024</option>
                            <option value="auto">auto</option>
                        </select>
                        <select
                            value={quality}
                            onChange={(event) => setQuality(event.target.value)}
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        >
                            <option value="standard">standard</option>
                            <option value="high">high</option>
                            <option value="auto">auto</option>
                        </select>
                        <select
                            value={count}
                            onChange={(event) => setCount(Number(event.target.value))}
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        >
                            <option value={1}>1 张</option>
                            <option value={2}>2 张</option>
                            <option value={3}>3 张</option>
                            <option value={4}>4 张</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => void handleGenerate()}
                            disabled={isGenerating || !hasImageConfig}
                            className="px-4 py-2 text-sm rounded-md bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
                        >
                            <span className="inline-flex items-center gap-1.5">
                                {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                                {isGenerating ? '生成中...' : '开始生图'}
                            </span>
                        </button>
                        <button
                            onClick={() => void loadSettings()}
                            className="px-3 py-2 text-xs rounded-md border border-border hover:bg-surface-secondary text-text-secondary"
                        >
                            刷新生图配置
                        </button>
                    </div>

                    {genError && <div className="text-xs text-status-error">{genError}</div>}
                </div>

                {generatedAssets.length > 0 && (
                    <div className="space-y-3">
                        <div className="text-sm font-medium text-text-primary inline-flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-accent-primary" />
                            最新生成结果（{generatedAssets.length}）
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                            {generatedAssets.map((asset) => (
                                <div key={asset.id} className="group border border-border rounded-xl bg-surface-primary overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                    {asset.previewUrl && asset.exists ? (
                                        <img src={resolveAssetUrl(asset.previewUrl)} alt={asset.title || asset.id} className="w-full aspect-[4/5] object-cover" />
                                    ) : (
                                        <div className="w-full aspect-[4/5] bg-surface-secondary flex items-center justify-center text-text-tertiary text-xs">
                                            无法预览
                                        </div>
                                    )}
                                    <div className="p-3 space-y-1.5">
                                        <div className="text-sm text-text-primary truncate">{asset.title || asset.id}</div>
                                        <div className="text-[11px] text-text-tertiary truncate">{asset.projectId || '(无项目ID)'}</div>
                                        <div className="text-[11px] text-text-tertiary truncate">{asset.model || ''} · {asset.aspectRatio || asset.size || ''} · {asset.quality || ''}</div>
                                        <button
                                            onClick={() => void window.ipcRenderer.invoke('media:open', { assetId: asset.id })}
                                            className="mt-1 px-2.5 py-1.5 text-xs rounded border border-border hover:bg-surface-secondary text-text-secondary"
                                        >
                                            <span className="inline-flex items-center gap-1">
                                                <ExternalLink className="w-3.5 h-3.5" />
                                                打开文件
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="text-sm text-text-tertiary">正在加载媒体库...</div>
                ) : error ? (
                    <div className="text-sm text-status-error">{error}</div>
                ) : filteredAssets.length === 0 ? (
                    <div className="text-sm text-text-tertiary">暂无媒体资产</div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                        {filteredAssets.map((asset) => {
                            const draft = getDraft(asset);
                            const selectedManuscript = bindTarget[asset.id] || asset.boundManuscriptPath || '';
                            const busy = workingId === asset.id;
                            const isExpanded = expandedAssetId === asset.id;
                            const sourceMeta = SOURCE_META[asset.source];
                            return (
                                <div key={asset.id} className="group border border-border rounded-2xl bg-surface-primary overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                    <div className="relative aspect-[4/5] bg-surface-secondary">
                                        {asset.previewUrl && asset.exists ? (
                                            <img src={resolveAssetUrl(asset.previewUrl)} alt={asset.title || asset.id} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-surface-secondary flex items-center justify-center text-text-tertiary text-xs px-4 text-center">
                                                {asset.source === 'planned' ? '计划配图（尚未生成）' : '图片文件不可用'}
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent pointer-events-none" />
                                        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-2">
                                            <span className={clsx('text-[10px] px-2 py-0.5 rounded-md border backdrop-blur bg-black/15', sourceMeta.badgeClass)}>
                                                {sourceMeta.label}
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-md border border-white/25 bg-black/25 text-white">
                                                {new Date(asset.updatedAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                                            <div className="text-sm font-medium truncate">{draft.title || asset.title || asset.id}</div>
                                            <div className="text-[11px] text-white/80 truncate">
                                                {draft.projectId || asset.projectId || '未设置项目ID'} · {asset.aspectRatio || asset.size || 'auto'}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-3 space-y-2">
                                        <div className="text-[11px] text-text-tertiary truncate">
                                            提示词：{(draft.prompt || asset.prompt || '暂无提示词').replace(/\s+/g, ' ')}
                                        </div>
                                        <div className="text-[11px] text-text-tertiary truncate">
                                            稿件：{asset.boundManuscriptPath || '(未绑定)'}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => void window.ipcRenderer.invoke('media:open', { assetId: asset.id })}
                                                className="flex-1 px-2.5 py-2 text-xs rounded border border-border hover:bg-surface-secondary text-text-secondary"
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                    打开
                                                </span>
                                            </button>
                                            <button
                                                onClick={() => setExpandedAssetId((prev) => (prev === asset.id ? null : asset.id))}
                                                className={clsx(
                                                    'px-2.5 py-2 text-xs rounded border transition-colors',
                                                    isExpanded
                                                        ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary'
                                                        : 'border-border hover:bg-surface-secondary text-text-secondary'
                                                )}
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    <Pencil className="w-3.5 h-3.5" />
                                                    {isExpanded ? '收起' : '编辑'}
                                                </span>
                                            </button>
                                        </div>

                                        {isExpanded && (
                                            <div className="pt-2 mt-2 border-t border-border space-y-2">
                                                <div className="grid grid-cols-1 gap-2">
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
                                                            绑定
                                                        </span>
                                                    </button>
                                                </div>

                                                <button
                                                    onClick={() => void handleSaveMetadata(asset)}
                                                    disabled={busy}
                                                    className="w-full px-2.5 py-2 text-xs rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
                                                >
                                                    <span className="inline-flex items-center gap-1">
                                                        <Save className="w-3.5 h-3.5" />
                                                        {busy ? '保存中...' : '保存元数据'}
                                                    </span>
                                                </button>
                                            </div>
                                        )}
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
