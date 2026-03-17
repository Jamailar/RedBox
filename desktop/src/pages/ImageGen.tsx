import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, ImagePlus, RefreshCw, Sparkles } from 'lucide-react';

interface GeneratedAsset {
    id: string;
    title?: string;
    prompt?: string;
    previewUrl?: string;
    exists?: boolean;
    projectId?: string;
    provider?: string;
    model?: string;
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
    image_size?: string;
    image_quality?: string;
}

export function ImageGen() {
    const [settings, setSettings] = useState<SettingsShape>({});
    const [prompt, setPrompt] = useState('');
    const [projectId, setProjectId] = useState('');
    const [title, setTitle] = useState('');
    const [count, setCount] = useState(1);
    const [model, setModel] = useState('');
    const [size, setSize] = useState('1024x1024');
    const [quality, setQuality] = useState('standard');
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState('');
    const [assets, setAssets] = useState<GeneratedAsset[]>([]);

    const loadSettings = useCallback(async () => {
        try {
            const s = await window.ipcRenderer.getSettings();
            const next = (s || {}) as SettingsShape;
            setSettings(next);
            setModel(next.image_model || 'gpt-image-1');
            setSize(next.image_size || '1024x1024');
            setQuality(next.image_quality || 'standard');
        } catch (e) {
            console.error('Failed to load image settings:', e);
            setSettings({});
        }
    }, []);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim()) {
            setError('请先输入提示词');
            return;
        }

        setIsGenerating(true);
        setError('');
        try {
            const result = await window.ipcRenderer.invoke('image-gen:generate', {
                prompt,
                projectId: projectId.trim() || undefined,
                title: title.trim() || undefined,
                count,
                model: model.trim() || undefined,
                size: size.trim() || undefined,
                quality: quality.trim() || undefined,
            }) as { success?: boolean; error?: string; assets?: GeneratedAsset[] };

            if (!result?.success) {
                setError(result?.error || '生图失败');
                return;
            }
            setAssets(Array.isArray(result.assets) ? result.assets : []);
        } catch (e) {
            console.error('Failed to generate images:', e);
            setError('生图失败');
        } finally {
            setIsGenerating(false);
        }
    }, [count, model, projectId, prompt, quality, size, title]);

    const resolvedEndpoint = (settings.image_endpoint || settings.api_endpoint || '').trim();
    const resolvedApiKey = (settings.image_api_key || settings.api_key || '').trim();
    const hasConfig = Boolean(resolvedEndpoint) && Boolean(resolvedApiKey);

    return (
        <div className="h-full flex flex-col bg-background">
            <div className="border-b border-border px-6 py-4 flex items-center gap-3">
                <h1 className="text-lg font-semibold text-text-primary">生图</h1>
                <div className="text-xs text-text-tertiary">根据提示词生成配图并自动写入媒体库</div>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        onClick={() => void loadSettings()}
                        className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-surface-secondary text-text-secondary"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <RefreshCw className="w-3.5 h-3.5" />
                            刷新配置
                        </span>
                    </button>
                    <button
                        onClick={() => void window.ipcRenderer.invoke('media:open-root')}
                        className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-surface-secondary text-text-secondary"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <ExternalLink className="w-3.5 h-3.5" />
                            打开媒体库目录
                        </span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6 space-y-4">
                <div className="border border-border rounded-lg bg-surface-primary p-4 space-y-4">
                    <div className="text-xs text-text-secondary">
                        当前生图配置：provider=<span className="font-mono">{settings.image_provider || 'openai-compatible'}</span> · endpoint=<span className="font-mono">{resolvedEndpoint || '(未设置)'}</span>
                    </div>
                    {!hasConfig && (
                        <div className="text-xs text-status-error">
                            未检测到生图配置。请先到“设置 → AI 模型”填写生图 Endpoint 和 API Key。
                        </div>
                    )}

                    <textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="输入提示词，例如：一张温暖晨光中的北欧风民宿客厅，真实摄影风格，适合小红书封面"
                        rows={5}
                        className="w-full px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        <input
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            placeholder="资产标题（可选）"
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        />
                        <input
                            value={projectId}
                            onChange={(event) => setProjectId(event.target.value)}
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
                            value={size}
                            onChange={(event) => setSize(event.target.value)}
                            className="px-3 py-2 text-sm rounded-md border border-border bg-surface-secondary/20 focus:outline-none focus:ring-1 focus:ring-accent-primary"
                        >
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

                    <button
                        onClick={() => void handleGenerate()}
                        disabled={isGenerating || !hasConfig}
                        className="px-4 py-2 text-sm rounded-md bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-50"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                            {isGenerating ? '生成中...' : '开始生图'}
                        </span>
                    </button>

                    {error && (
                        <div className="text-xs text-status-error">{error}</div>
                    )}
                </div>

                {assets.length > 0 && (
                    <div className="space-y-3">
                        <div className="text-sm font-medium text-text-primary inline-flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-accent-primary" />
                            最新生成结果（{assets.length}）
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {assets.map((asset) => (
                                <div key={asset.id} className="border border-border rounded-lg bg-surface-primary overflow-hidden">
                                    {asset.previewUrl && asset.exists ? (
                                        <img src={asset.previewUrl} alt={asset.title || asset.id} className="w-full h-56 object-cover" />
                                    ) : (
                                        <div className="w-full h-56 bg-surface-secondary flex items-center justify-center text-text-tertiary text-xs">
                                            无法预览
                                        </div>
                                    )}
                                    <div className="p-3 space-y-1.5">
                                        <div className="text-sm text-text-primary truncate">{asset.title || asset.id}</div>
                                        <div className="text-[11px] text-text-tertiary truncate">{asset.projectId || '(无项目ID)'}</div>
                                        <div className="text-[11px] text-text-tertiary truncate">{asset.model || ''} · {asset.size || ''} · {asset.quality || ''}</div>
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
            </div>
        </div>
    );
}
