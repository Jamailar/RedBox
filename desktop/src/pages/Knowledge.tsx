import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import { Search, Trash2, Image, Heart, MessageCircle, X, ChevronLeft, ChevronRight, Play, FileText, ExternalLink, RefreshCw, Sparkles, Star, BookmarkPlus, FolderPlus, FolderOpen, Plus, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import type { PendingChatMessage } from '../App';
import { KnowledgeChatModal } from '../components/KnowledgeChatModal';
import { useFeatureFlag } from '../hooks/useFeatureFlags';
import { resolveAssetUrl } from '../utils/pathManager';

interface Note { type?: string; sourceUrl?: string;
    id: string;
    title: string;
    author: string;
    content: string;
    images: string[];
    tags?: string[];
    cover?: string;
    video?: string;
    videoUrl?: string;
    transcript?: string;
    stats: {
        likes: number;
        collects?: number;
    };
    createdAt: string;
}

interface YouTubeVideo {
    id: string;
    videoId: string;
    videoUrl: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    hasSubtitle: boolean;
    subtitleContent?: string;
    status?: 'processing' | 'completed' | 'failed';
    createdAt: string;
}

type TabType = 'xiaohongshu' | 'youtube' | 'docs';
type XhsTabType = 'all' | 'image' | 'video';

interface DocumentKnowledgeSource {
    id: string;
    kind: 'copied-file' | 'tracked-folder' | 'obsidian-vault';
    name: string;
    rootPath: string;
    locked: boolean;
    indexing: boolean;
    indexError?: string;
    fileCount: number;
    sampleFiles: string[];
    createdAt: string;
    updatedAt: string;
}

interface KnowledgeProps {
    isEmbedded?: boolean;
    isActive?: boolean;
    onNavigateToChat?: (message: PendingChatMessage) => void;
    referenceContent?: string; // 用于相似度排序的参考内容
}

interface CoverTemplate {
    id: string;
    name: string;
    prompt: string;
    styleHint: string;
    model: string;
    aspectRatio: string;
    size: string;
    quality: string;
    count: number;
    projectId: string;
    titlePrefix: string;
    referenceImages?: string[];
    updatedAt: string;
}

interface SettingsShape {
    image_model?: string;
    image_aspect_ratio?: string;
    image_size?: string;
    image_quality?: string;
    active_space_id?: string;
}

const COVER_TEMPLATE_STORAGE_PREFIX = 'redbox:cover-templates:v1';
const getCoverTemplateStorageKey = (spaceId: string) => `${COVER_TEMPLATE_STORAGE_PREFIX}:${spaceId || 'default'}`;
const createCoverTemplateId = () => `cover_tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeCoverTemplate = (raw: unknown): CoverTemplate | null => {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Record<string, unknown>;
    const name = String(item.name || '').trim();
    const prompt = String(item.prompt || '').trim();
    if (!name || !prompt) return null;
    const count = Number(item.count || 1);
    return {
        id: String(item.id || createCoverTemplateId()),
        name,
        prompt,
        styleHint: String(item.styleHint || ''),
        model: String(item.model || 'gpt-image-1'),
        aspectRatio: String(item.aspectRatio || '3:4'),
        size: String(item.size || '1024x1024'),
        quality: String(item.quality || 'standard'),
        count: Math.max(1, Math.min(4, Number.isFinite(count) ? Math.floor(count) : 1)),
        projectId: String(item.projectId || ''),
        titlePrefix: String(item.titlePrefix || ''),
        referenceImages: Array.isArray(item.referenceImages)
            ? item.referenceImages.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 4)
            : [],
        updatedAt: String(item.updatedAt || new Date().toISOString()),
    };
};

// 轻量级关键词提取（用于判断内容变化率）
const extractKeywords = (text: string): Set<string> => {
    if (!text) return new Set();
    const cleaned = text
        .replace(/^#+\s*/gm, '')
        .replace(/[*_`~\[\](){}|\\/<>]/g, ' ')
        .replace(/https?:\/\/\S+/g, '')
        .toLowerCase();
    const chineseWords = cleaned.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    const englishWords = (cleaned.match(/[a-z]{3,}/g) || []).filter(w =>
        !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'with', 'this', 'that', 'from', 'have', 'was', 'were'].includes(w)
    );
    return new Set([...chineseWords, ...englishWords]);
};

// 计算关键词变化率
const calculateChangeRate = (oldKeywords: Set<string>, newKeywords: Set<string>): number => {
    if (oldKeywords.size === 0 && newKeywords.size === 0) return 0;
    if (oldKeywords.size === 0 || newKeywords.size === 0) return 1;

    let added = 0, removed = 0;
    for (const kw of newKeywords) {
        if (!oldKeywords.has(kw)) added++;
    }
    for (const kw of oldKeywords) {
        if (!newKeywords.has(kw)) removed++;
    }
    const avgSize = (oldKeywords.size + newKeywords.size) / 2;
    return (added + removed) / avgSize;
};

// 计算内容哈希（简单版）
const hashContent = (content: string): string => {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(16);
};

export function Knowledge({ onNavigateToChat, isEmbedded = false, isActive = true, referenceContent }: KnowledgeProps) {
    const [activeTab, setActiveTab] = useState<TabType>('xiaohongshu');
    const [xhsTab, setXhsTab] = useState<XhsTabType>('all');
    const [notes, setNotes] = useState<Note[]>([]);
    const [youtubeVideos, setYoutubeVideos] = useState<YouTubeVideo[]>([]);
    const [documentSources, setDocumentSources] = useState<DocumentKnowledgeSource[]>([]);
    const [selectedNote, setSelectedNote] = useState<Note | null>(null);
    const [selectedVideo, setSelectedVideo] = useState<YouTubeVideo | null>(null);
    const [selectedImageIndex, setSelectedImageIndex] = useState(0);
    const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTag, setSelectedTag] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [imageAspectMap, setImageAspectMap] = useState<Record<string, 'portrait' | 'landscape'>>({});
    const [showSubtitle, setShowSubtitle] = useState(false);
    const [showTranscript, setShowTranscript] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [isSubtitleLoading, setIsSubtitleLoading] = useState(false);
    const wasActiveRef = useRef<boolean>(isActive);

    // 搜索框状态
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // 快捷键监听
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'k')) {
                e.preventDefault();
                setIsSearchOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 50);
            }
            if (e.key === 'Escape' && isSearchOpen) {
                e.preventDefault();
                setIsSearchOpen(false);
                setSearchQuery('');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSearchOpen]);

    // 功能开关
    const vectorRecommendationEnabled = useFeatureFlag('vectorRecommendation');

    // 向量相似度排序状态
    const [similarityOrder, setSimilarityOrder] = useState<Map<string, number>>(new Map());
    const [isSimilarityLoading, setIsSimilarityLoading] = useState(false);
    const lastContentHashRef = useRef<string | null>(null);
    const embeddingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);

    // 分页状态
    const [currentPage, setCurrentPage] = useState(1);
    const PAGE_SIZE = 10;

    // 清理函数
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (embeddingTimeoutRef.current) {
                clearTimeout(embeddingTimeoutRef.current);
            }
        };
    }, []);

    // 切换 tab 时重置分页
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab]);

    // 相似度排序 - 缓存读取立即执行，计算延迟执行
    useEffect(() => {
        // 检查功能开关
        if (!vectorRecommendationEnabled) {
            // 功能关闭时清空排序
            if (similarityOrder.size > 0) {
                setSimilarityOrder(new Map());
                lastContentHashRef.current = null;
            }
            return;
        }

        if (!isEmbedded || !referenceContent || referenceContent.trim().length < 10) {
            // 内容不足时也清空排序
            if (similarityOrder.size > 0) {
                setSimilarityOrder(new Map());
                lastContentHashRef.current = null;
            }
            return;
        }

        const contentHash = hashContent(referenceContent);
        const manuscriptId = `content_${contentHash}`;

        // 内容未变化时跳过
        if (lastContentHashRef.current === contentHash) {
            return;
        }

        // 内容变化了，立即清空旧排序，显示加载状态
        console.log('[Knowledge] Content changed, clearing old order');
        setSimilarityOrder(new Map());
        setIsSimilarityLoading(true);

        // 清除之前的定时器
        if (embeddingTimeoutRef.current) {
            clearTimeout(embeddingTimeoutRef.current);
            embeddingTimeoutRef.current = null;
        }

        // 立即尝试从缓存读取
        (async () => {
            try {
                const cacheResult = await window.ipcRenderer.invoke('similarity:get-cache', manuscriptId) as any;

                if (!isMountedRef.current) return;

                if (cacheResult?.success && cacheResult?.cache) {
                    const cache = cacheResult.cache;
                    if (cache.contentHash === contentHash && cache.knowledgeVersion === cacheResult.currentKnowledgeVersion) {
                        console.log('[Knowledge] Cache hit - using cached order');
                        const orderMap = new Map<string, number>();
                        cache.sortedIds.forEach((id: string, index: number) => orderMap.set(id, index));
                        setSimilarityOrder(orderMap);
                        lastContentHashRef.current = contentHash;
                        setCurrentPage(1);
                        setIsSimilarityLoading(false);
                        return;
                    }
                }

                // 缓存未命中，延迟计算（切换文件时用较短延迟）
                const DEBOUNCE_MS = 2000; // 2秒防抖

                embeddingTimeoutRef.current = setTimeout(async () => {
                    if (!isMountedRef.current) return;

                    try {
                        const embCacheResult = await window.ipcRenderer.invoke('embedding:get-manuscript-cache', manuscriptId) as any;
                        if (!isMountedRef.current) return;

                        let embedding: number[] | null = null;
                        const currentVersion = await window.ipcRenderer.invoke('similarity:get-knowledge-version');

                        if (embCacheResult?.success && embCacheResult?.cached?.contentHash === contentHash) {
                            console.log('[Knowledge] Using cached embedding');
                            embedding = embCacheResult.cached.embedding;
                        } else {
                            console.log('[Knowledge] Computing embedding...');
                            const computeResult = await window.ipcRenderer.invoke('embedding:compute', referenceContent) as any;
                            if (!isMountedRef.current) return;

                            if (!computeResult?.success || !computeResult?.embedding) {
                                console.warn('[Knowledge] Embedding failed:', computeResult?.error);
                                setIsSimilarityLoading(false);
                                return;
                            }

                            embedding = computeResult.embedding;

                            window.ipcRenderer.invoke('embedding:save-manuscript-cache', {
                                filePath: manuscriptId,
                                contentHash,
                                embedding
                            }).catch(console.error);
                        }

                        if (!isMountedRef.current) return;

                        const sortResult = await window.ipcRenderer.invoke('embedding:get-sorted-sources', embedding) as any;
                        if (!isMountedRef.current) return;

                        if (sortResult?.success && sortResult?.sorted) {
                            const sortedIds = sortResult.sorted.map((item: any) => item.sourceId);
                            const orderMap = new Map<string, number>();
                            sortedIds.forEach((id: string, index: number) => orderMap.set(id, index));
                            setSimilarityOrder(orderMap);
                            lastContentHashRef.current = contentHash;
                            setCurrentPage(1);

                            window.ipcRenderer.invoke('similarity:save-cache', {
                                manuscriptId,
                                contentHash,
                                knowledgeVersion: currentVersion,
                                sortedIds
                            }).catch(console.error);
                        }
                    } catch (e) {
                        console.error('[Knowledge] Similarity error:', e);
                    } finally {
                        if (isMountedRef.current) {
                            setIsSimilarityLoading(false);
                        }
                    }
                }, 5000); // 5秒防抖
            } catch (e) {
                console.error('[Knowledge] Cache lookup failed:', e);
            }
        })();

        return () => {
            if (embeddingTimeoutRef.current) {
                clearTimeout(embeddingTimeoutRef.current);
            }
        };
    }, [isEmbedded, referenceContent]);

    // Chat Modal State
    const [chatModalState, setChatModalState] = useState<{
        isOpen: boolean;
        contextId: string;
        contextType: string;
        contextTitle: string;
        contextContent: string;
    }>({
        isOpen: false,
        contextId: '',
        contextType: 'note',
        contextTitle: '',
        contextContent: ''
    });

    const openChat = (id: string, type: string, title: string, content: string) => {
        setChatModalState({
            isOpen: true,
            contextId: id,
            contextType: type,
            contextTitle: title,
            contextContent: content
        });
    };

    const loadNotes = useCallback(async () => {
        setIsLoading(true);
        try {
            const list = await window.ipcRenderer.invoke('knowledge:list') as Note[];
            setNotes(list || []);
        } catch (e) {
            console.error('Failed to load notes:', e);
            setNotes([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadYoutubeVideos = useCallback(async () => {
        setIsLoading(true);
        try {
            const list = await window.ipcRenderer.invoke('knowledge:list-youtube') as YouTubeVideo[];
            setYoutubeVideos(list || []);
        } catch (e) {
            console.error('Failed to load YouTube videos:', e);
            setYoutubeVideos([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadDocumentSources = useCallback(async () => {
        setIsLoading(true);
        try {
            const list = await window.ipcRenderer.invoke('knowledge:docs:list') as DocumentKnowledgeSource[];
            setDocumentSources(Array.isArray(list) ? list : []);
        } catch (error) {
            console.error('Failed to load document sources:', error);
            setDocumentSources([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeTab === 'xiaohongshu') {
            loadNotes();
        } else if (activeTab === 'youtube') {
            loadYoutubeVideos();
        } else {
            loadDocumentSources();
        }
    }, [activeTab, loadNotes, loadYoutubeVideos, loadDocumentSources]);

    // 每次从其他页面切回知识库时，强制刷新当前列表，避免页面显示旧缓存。
    useEffect(() => {
        const wasActive = wasActiveRef.current;
        wasActiveRef.current = isActive;
        if (!isActive || wasActive) {
            return;
        }

        if (activeTab === 'youtube') {
            loadYoutubeVideos();
            return;
        }
        if (activeTab === 'docs') {
            loadDocumentSources();
            return;
        }
        loadNotes();
    }, [isActive, activeTab, loadNotes, loadYoutubeVideos, loadDocumentSources]);

    // 监听 YouTube 视频更新事件
    useEffect(() => {
        const handleVideoUpdated = (_event: unknown, data: { noteId: string; status: string; hasSubtitle?: boolean }) => {
            console.log('[Knowledge] Video updated:', data);
            setYoutubeVideos(prev => prev.map(video =>
                video.id === data.noteId
                    ? { ...video, status: data.status as YouTubeVideo['status'], hasSubtitle: data.hasSubtitle ?? video.hasSubtitle }
                    : video
            ));
            // 如果当前选中的视频更新了，也更新选中状态
            if (selectedVideo?.id === data.noteId) {
                setSelectedVideo(prev => prev ? { ...prev, status: data.status as YouTubeVideo['status'], hasSubtitle: data.hasSubtitle ?? prev.hasSubtitle } : null);
            }
        };

        const handleNewVideo = (_event: unknown, data: { noteId: string; title: string; status?: string }) => {
            console.log('[Knowledge] New video added:', data);
            // 如果当前在 YouTube tab，重新加载列表
            if (activeTab === 'youtube') {
                loadYoutubeVideos();
            }
        };

        window.ipcRenderer.on('knowledge:youtube-video-updated', handleVideoUpdated);
        window.ipcRenderer.on('knowledge:new-youtube-video', handleNewVideo);

        return () => {
            window.ipcRenderer.off('knowledge:youtube-video-updated', handleVideoUpdated);
            window.ipcRenderer.off('knowledge:new-youtube-video', handleNewVideo);
        };
    }, [activeTab, loadYoutubeVideos, selectedVideo?.id]);

    useEffect(() => {
        const handleDocsUpdated = () => {
            if (activeTab === 'docs') {
                loadDocumentSources();
            }
        };
        window.ipcRenderer.on('knowledge:docs-updated', handleDocsUpdated);
        return () => {
            window.ipcRenderer.off('knowledge:docs-updated', handleDocsUpdated);
        };
    }, [activeTab, loadDocumentSources]);

    // Aggregate tags from notes
    const allTags = useMemo(() => {
        const tagCounts: Record<string, number> = {};
        notes.forEach(note => {
            if (note.tags && Array.isArray(note.tags)) {
                note.tags.forEach(tag => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
        });
        return Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1]) // Sort by count desc
            .map(([tag, count]) => ({ tag, count }));
    }, [notes]);

    const filteredXhsNotes = useMemo(() => {
        const filtered = notes.filter(note =>
            (!note.type || note.type === 'xiaohongshu') &&
            (note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            note.content.toLowerCase().includes(searchQuery.toLowerCase())) &&
            (!selectedTag || (note.tags && note.tags.includes(selectedTag)))
        ).filter(note => {
            if (xhsTab === 'all') return true;
            if (xhsTab === 'video') return !!note.video;
            return !note.video;
        });

        // 如果有向量相似度排序，使用它
        if (similarityOrder.size > 0) {
            return [...filtered].sort((a, b) => {
                const orderA = similarityOrder.get(a.id) ?? Infinity;
                const orderB = similarityOrder.get(b.id) ?? Infinity;
                return orderA - orderB;
            });
        }
        return filtered;
    }, [notes, searchQuery, xhsTab, selectedTag, similarityOrder]);

    // 分页后的数据
    const pagedXhsNotes = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredXhsNotes.slice(start, start + PAGE_SIZE);
    }, [filteredXhsNotes, currentPage]);

    const filteredDocs = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return documentSources;
        return documentSources.filter((source) =>
            source.name.toLowerCase().includes(query) ||
            source.rootPath.toLowerCase().includes(query) ||
            source.sampleFiles.some((file) => file.toLowerCase().includes(query))
        );
    }, [documentSources, searchQuery]);

    const pagedDocs = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredDocs.slice(start, start + PAGE_SIZE);
    }, [filteredDocs, currentPage]);

    const filteredVideos = useMemo(() => {
        const filtered = youtubeVideos.filter(video =>
            video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            video.description.toLowerCase().includes(searchQuery.toLowerCase())
        );

        if (similarityOrder.size > 0) {
            return [...filtered].sort((a, b) => {
                const orderA = similarityOrder.get(a.id) ?? Infinity;
                const orderB = similarityOrder.get(b.id) ?? Infinity;
                return orderA - orderB;
            });
        }
        return filtered;
    }, [youtubeVideos, searchQuery, similarityOrder]);

    // 分页后的视频
    const pagedVideos = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredVideos.slice(start, start + PAGE_SIZE);
    }, [filteredVideos, currentPage]);

    // 计算总页数
    const totalPages = useMemo(() => {
        if (activeTab === 'xiaohongshu') return Math.ceil(filteredXhsNotes.length / PAGE_SIZE);
        if (activeTab === 'docs') return Math.ceil(filteredDocs.length / PAGE_SIZE);
        return Math.ceil(filteredVideos.length / PAGE_SIZE);
    }, [activeTab, filteredXhsNotes.length, filteredDocs.length, filteredVideos.length]);

    // 切换 tab 或筛选条件时重置分页
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab, xhsTab, selectedTag, searchQuery]);

    const orderImages = (images: string[]) => {
        return [...images].sort((a, b) => {
            const extractIndex = (value: string) => {
                const clean = value.split('?')[0];
                const filename = clean.split('/').pop() || '';
                const match = filename.match(/(\d+)(?=\.[a-zA-Z0-9]+$)/);
                if (!match) return 999998;
                const num = Number(match[1]);
                if (Number.isNaN(num)) return 999998;
                return num === 0 ? 999999 : num;
            };
            return extractIndex(a) - extractIndex(b);
        });
    };

    const resolveAspectClass = (key: string) => {
        const aspect = imageAspectMap[key] || 'portrait';
        return aspect === 'landscape' ? 'aspect-[4/3]' : 'aspect-[3/4]';
    };

    const handleImageLoad = (key: string, event: SyntheticEvent<HTMLImageElement>) => {
        const img = event.currentTarget;
        const aspect = img.naturalWidth > img.naturalHeight ? 'landscape' : 'portrait';
        setImageAspectMap((prev) => (prev[key] === aspect ? prev : { ...prev, [key]: aspect }));
    };

    useEffect(() => {
        if (selectedNote) {
            setSelectedImageIndex(0);
            setIsImagePreviewOpen(false);
            setShowTranscript(false);
        }
    }, [selectedNote]);

    useEffect(() => {
        if (selectedVideo) {
            setShowSubtitle(false);
        }
    }, [selectedVideo]);

    const loadSelectedVideoSubtitle = useCallback(async (video: YouTubeVideo) => {
        if (!video?.id) return;
        setIsSubtitleLoading(true);
        try {
            const res = await window.ipcRenderer.readYoutubeSubtitle(video.id) as {
                success: boolean;
                subtitleContent?: string;
                hasSubtitle?: boolean;
                error?: string;
            };
            if (res.success && typeof res.subtitleContent === 'string') {
                setSelectedVideo(prev => prev && prev.id === video.id
                    ? { ...prev, subtitleContent: res.subtitleContent, hasSubtitle: res.hasSubtitle ?? prev.hasSubtitle }
                    : prev
                );
            }
        } catch (e) {
            console.error('Failed to read subtitle:', e);
        } finally {
            setIsSubtitleLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!selectedVideo) return;
        if (selectedVideo.hasSubtitle && (!selectedVideo.subtitleContent || !selectedVideo.subtitleContent.trim())) {
            loadSelectedVideoSubtitle(selectedVideo);
        }
    }, [selectedVideo, loadSelectedVideoSubtitle]);

    useEffect(() => {
        const handleNoteUpdated = (_event: unknown, _data: { noteId: string }) => {
            if (activeTab === 'xiaohongshu') {
                loadNotes();
            }
        };
        window.ipcRenderer.on('knowledge:note-updated', handleNoteUpdated);
        return () => {
            window.ipcRenderer.off('knowledge:note-updated', handleNoteUpdated);
        };
    }, [activeTab, loadNotes]);

    const handleDeleteNote = async (noteId: string) => {
        if (!confirm('确定要删除这篇笔记吗？')) return;

        try {
            await window.ipcRenderer.invoke('knowledge:delete', noteId);
            setNotes(notes.filter(n => n.id !== noteId));
            if (selectedNote?.id === noteId) {
                setSelectedNote(null);
            }
        } catch (e) {
            console.error('Failed to delete note:', e);
        }
    };

    const handleTranscribeNote = async (noteId: string) => {
        try {
            setIsTranscribing(true);
            const res = await window.ipcRenderer.invoke('knowledge:transcribe', noteId) as { success: boolean; transcript?: string; error?: string };
            if (res.success) {
                await loadNotes();
                const updated = await window.ipcRenderer.invoke('knowledge:list') as Note[];
                setNotes(updated || []);
                const refreshed = (updated || []).find(n => n.id === noteId) || null;
                setSelectedNote(refreshed);
                setShowTranscript(true);
            } else {
                alert(res.error || '转录失败');
            }
        } catch (e) {
            console.error('Failed to transcribe note:', e);
            alert('转录失败');
        } finally {
            setIsTranscribing(false);
        }
    };

    const handleSaveNoteCoverAsTemplate = useCallback(async (note: Note) => {
        try {
            const orderedImages = orderImages(note.images || []);
            const coverImage = orderedImages[selectedImageIndex] || note.cover || orderedImages[0] || '';
            if (!coverImage) {
                alert('这篇笔记没有可用封面图');
                return;
            }

            const settings = await window.ipcRenderer.getSettings() as SettingsShape | undefined;
            const spaceId = String(settings?.active_space_id || 'default').trim() || 'default';
            const storageKey = getCoverTemplateStorageKey(spaceId);

            const now = new Date().toISOString();
            const title = String(note.title || '未命名笔记').trim();
            const plainContent = String(note.content || '').replace(/\s+/g, ' ').trim();
            const summary = plainContent.slice(0, 160);
            const templateName = `知识库封面 · ${title.slice(0, 24) || note.id}`;
            const prompt = [
                `为小红书笔记生成封面图。`,
                `主题：${title}`,
                summary ? `内容摘要：${summary}` : '',
                `要求：标题区域清晰、主体突出、适合信息流封面点击。`,
            ].filter(Boolean).join('\n');

            const styleHint = [
                `来源：知识库笔记 ${note.id}`,
                note.sourceUrl ? `原文：${note.sourceUrl}` : '',
                `已绑定封面参考图，可在生成时直接复用。`,
            ].filter(Boolean).join('\n');

            let persistedCoverImage = coverImage;
            try {
                const saved = await window.ipcRenderer.invoke('cover:save-template-image', {
                    imageSource: coverImage,
                }) as { success?: boolean; previewUrl?: string; error?: string };
                if (saved?.success && saved.previewUrl) {
                    persistedCoverImage = saved.previewUrl;
                } else if (saved?.error) {
                    console.warn('cover:save-template-image returned fallback:', saved.error);
                }
            } catch (error) {
                console.warn('Failed to persist cover template image to cover folder, fallback to original url:', error);
            }

            let existing: CoverTemplate[] = [];
            try {
                const raw = window.localStorage.getItem(storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    existing = Array.isArray(parsed)
                        ? parsed.map(normalizeCoverTemplate).filter((item): item is CoverTemplate => Boolean(item))
                        : [];
                }
            } catch (error) {
                console.error('Failed to parse existing cover templates:', error);
            }

            const created: CoverTemplate = {
                id: createCoverTemplateId(),
                name: templateName,
                prompt,
                styleHint,
                model: String(settings?.image_model || 'gpt-image-1'),
                aspectRatio: String(settings?.image_aspect_ratio || '3:4'),
                size: String(settings?.image_size || ''),
                quality: String(settings?.image_quality || 'standard'),
                count: 1,
                projectId: '',
                titlePrefix: title.slice(0, 32),
                referenceImages: [persistedCoverImage],
                updatedAt: now,
            };

            const nextTemplates = [created, ...existing]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, 300);
            window.localStorage.setItem(storageKey, JSON.stringify(nextTemplates));
            window.dispatchEvent(new CustomEvent('cover:templates-updated', {
                detail: { spaceId },
            }));
            alert('已保存为封面模板，可在「封面」页直接套用。');
        } catch (error) {
            console.error('Failed to save cover template from note:', error);
            alert('保存封面模板失败');
        }
    }, [selectedImageIndex]);

    const handleDeleteVideo = async (videoId: string) => {
        if (!confirm('确定要删除这个视频吗？')) return;

        try {
            await window.ipcRenderer.invoke('knowledge:delete-youtube', videoId);
            setYoutubeVideos(youtubeVideos.filter(v => v.id !== videoId));
            if (selectedVideo?.id === videoId) {
                setSelectedVideo(null);
            }
        } catch (e) {
            console.error('Failed to delete video:', e);
        }
    };

    const openYouTube = (url: string) => {
        window.open(url, '_blank');
    };

    const handleRetrySubtitle = async (videoId: string) => {
        try {
            // 更新本地状态为处理中
            setYoutubeVideos(prev => prev.map(v =>
                v.id === videoId ? { ...v, status: 'processing' as const } : v
            ));
            if (selectedVideo?.id === videoId) {
                setSelectedVideo(prev => prev ? { ...prev, status: 'processing' } : null);
            }

            await window.ipcRenderer.invoke('knowledge:retry-youtube-subtitle', videoId);
            // 状态更新会通过 IPC 事件 'knowledge:youtube-video-updated' 自动处理
        } catch (e) {
            console.error('Failed to retry subtitle:', e);
        }
    };

    const handleAddDocumentFiles = async () => {
        const result = await window.ipcRenderer.invoke('knowledge:docs:add-files') as { success?: boolean; error?: string };
        if (!result?.success) {
            alert(result?.error || '添加文件失败');
            return;
        }
        await loadDocumentSources();
    };

    const handleAddDocumentFolder = async () => {
        const result = await window.ipcRenderer.invoke('knowledge:docs:add-folder') as { success?: boolean; error?: string };
        if (!result?.success) {
            alert(result?.error || '添加文件夹失败');
            return;
        }
        await loadDocumentSources();
    };

    const handleAddObsidianVault = async () => {
        const result = await window.ipcRenderer.invoke('knowledge:docs:add-obsidian-vault') as { success?: boolean; error?: string };
        if (!result?.success) {
            alert(result?.error || '添加 Obsidian 仓库失败');
            return;
        }
        await loadDocumentSources();
    };

    const handleDeleteDocumentSource = async (source: DocumentKnowledgeSource) => {
        if (!confirm(`确定要移除文档源“${source.name}”吗？`)) return;
        const result = await window.ipcRenderer.invoke('knowledge:docs:delete-source', source.id) as { success?: boolean; error?: string };
        if (!result?.success) {
            alert(result?.error || '删除文档源失败');
            return;
        }
        await loadDocumentSources();
    };

    // Embedded View Renders
    if (isEmbedded && selectedNote) {
        return (
            <div className="h-full overflow-y-auto bg-surface-primary p-4">
                <div className="flex items-center justify-between mb-4">
                    <button 
                        onClick={() => setSelectedNote(null)}
                        className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        返回列表
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => void handleSaveNoteCoverAsTemplate(selectedNote)}
                            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-primary bg-surface-secondary border border-border rounded hover:bg-surface-hover transition-colors"
                            title="保存封面为模板"
                        >
                            <BookmarkPlus className="w-3 h-3" />
                            存为封面模板
                        </button>
                        {selectedNote.video && !selectedNote.transcript && (
                            <button
                                onClick={() => handleTranscribeNote(selectedNote.id)}
                                disabled={isTranscribing}
                                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-text-primary bg-surface-secondary border border-border rounded hover:bg-surface-hover disabled:opacity-50 transition-colors"
                                title="提取文字"
                            >
                                {isTranscribing ? (
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                    <FileText className="w-3 h-3" />
                                )}
                                提取文字
                            </button>
                        )}
                    </div>
                </div>

                <h1 className="text-xl font-bold text-text-primary mb-2">{selectedNote.title}</h1>
                
                {selectedNote.video && (
                    <div className="relative mx-auto w-full mb-4">
                        <div className="relative rounded-lg overflow-hidden border border-border bg-surface-secondary">
                            <video
                                src={resolveAssetUrl(selectedNote.video)}
                                className="block w-full h-auto max-h-[300px] object-contain"
                                controls
                                playsInline
                                preload="metadata"
                            />
                        </div>
                    </div>
                )}

                {selectedNote.images && selectedNote.images.length > 0 && (() => {
                   const orderedImages = orderImages(selectedNote.images);
                   const currentImage = orderedImages[selectedImageIndex];
                   return (
                       <div className="relative aspect-square bg-black/5 rounded-lg overflow-hidden mb-4">
                           <img src={resolveAssetUrl(currentImage)} className="w-full h-full object-contain" />
                           {orderedImages.length > 1 && (
                               <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
                                   {selectedImageIndex + 1}/{orderedImages.length}
                               </div>
                           )}
                           {orderedImages.length > 1 && (
                               <>
                                   <button 
                                       className="absolute left-2 top-1/2 -translate-y-1/2 p-1 bg-black/30 rounded-full text-white hover:bg-black/50"
                                       onClick={(e) => {
                                           e.stopPropagation();
                                           setSelectedImageIndex(prev => prev === 0 ? orderedImages.length - 1 : prev - 1);
                                       }}
                                   >
                                       <ChevronLeft className="w-4 h-4" />
                                   </button>
                                   <button 
                                       className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-black/30 rounded-full text-white hover:bg-black/50"
                                       onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedImageIndex(prev => prev === orderedImages.length - 1 ? 0 : prev + 1);
                                       }}
                                   >
                                       <ChevronRight className="w-4 h-4" />
                                   </button>
                               </>
                           )}
                       </div>
                   );
                })()}

                <div className="whitespace-pre-wrap text-sm text-text-secondary font-sans leading-relaxed mb-4">
                    {selectedNote.content}
                </div>

                {selectedNote.video && selectedNote.transcript && (
                    <div className="bg-surface-secondary/50 rounded-lg border border-border overflow-hidden">
                        <button
                            onClick={() => setShowTranscript(!showTranscript)}
                            className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-text-primary hover:bg-surface-secondary/80 transition-colors"
                        >
                            <span className="flex items-center gap-2">
                                <FileText className="w-3.5 h-3.5" />
                                视频转录
                            </span>
                            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showTranscript ? 'rotate-90' : ''}`} />
                        </button>
                        {showTranscript && (
                            <div className="px-3 pb-3">
                                <pre className="text-xs text-text-secondary whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-auto">
                                    {selectedNote.transcript}
                                </pre>
                            </div>
                        )}
                    </div>
                )}

                {/* Chat Modal for Embedded View */}
                <KnowledgeChatModal
                    isOpen={chatModalState.isOpen}
                    onClose={() => setChatModalState(prev => ({ ...prev, isOpen: false }))}
                    contextId={chatModalState.contextId}
                    contextType={chatModalState.contextType}
                    contextTitle={chatModalState.contextTitle}
                    contextContent={chatModalState.contextContent}
                />
            </div>
        );
    }
    if (isEmbedded && selectedVideo) {
        return (
            <div className="h-full flex flex-col bg-surface">
                <div className="flex items-center justify-between p-2 border-b border-border">
                    <button
                        onClick={() => setSelectedVideo(null)}
                        className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors text-sm"
                    >
                        <ChevronLeft className="w-4 h-4" />
                        返回列表
                    </button>
                    {onNavigateToChat && selectedVideo.hasSubtitle && selectedVideo.subtitleContent && (
                        <button
                            onClick={() => {
                                const videoMeta = `<!--VIDEO_CARD:${JSON.stringify({
                                    title: selectedVideo.title,
                                    thumbnailUrl: selectedVideo.thumbnailUrl,
                                    videoId: selectedVideo.videoId
                                })}-->`;
                                onNavigateToChat({
                                    content: `${videoMeta}\n请总结这个视频的内容。`
                                });
                            }}
                            className="text-xs px-2 py-1 bg-surface-secondary border border-border rounded hover:bg-surface-hover"
                        >
                            AI 总结
                        </button>
                    )}
                </div>

                <div className="aspect-video bg-black rounded-lg overflow-hidden mb-4 relative group">
                    {selectedVideo.thumbnailUrl ? (
                        <img src={resolveAssetUrl(selectedVideo.thumbnailUrl)} className="w-full h-full object-cover opacity-80" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-text-tertiary bg-surface-secondary">
                            <Play className="w-12 h-12" />
                        </div>
                    )}
                    <button 
                        onClick={() => openYouTube(selectedVideo.videoUrl)}
                        className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/30 transition-colors"
                    >
                        <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            <Play className="w-6 h-6 text-white ml-1" fill="white" />
                        </div>
                    </button>
                </div>

                <h1 className="text-lg font-bold text-text-primary mb-2 leading-snug">{selectedVideo.title}</h1>
                
                {selectedVideo.description && (
                    <div className="bg-surface-secondary/50 rounded p-3 mb-4">
                        <div className="text-xs text-text-tertiary mb-1">视频简介</div>
                        <div className="text-xs text-text-secondary whitespace-pre-wrap line-clamp-3 hover:line-clamp-none cursor-pointer transition-all">
                            {selectedVideo.description}
                        </div>
                    </div>
                )}

                {selectedVideo.hasSubtitle && selectedVideo.subtitleContent ? (
                    <div className="space-y-2">
                         <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">字幕内容</h3>
                        </div>
                        <div className="text-xs text-text-secondary whitespace-pre-wrap font-sans leading-relaxed bg-surface-secondary/30 p-2 rounded max-h-[400px] overflow-y-auto">
                            {selectedVideo.subtitleContent}
                        </div>
                    </div>
                ) : (
                    <div className="text-xs text-text-tertiary text-center py-4 bg-surface-secondary/20 rounded">
                        {selectedVideo.status === 'processing' ? '字幕生成中...' : '暂无字幕内容'}
                    </div>
                )}

                {/* Chat Modal for Embedded View */}
                <KnowledgeChatModal
                    isOpen={chatModalState.isOpen}
                    onClose={() => setChatModalState(prev => ({ ...prev, isOpen: false }))}
                    contextId={chatModalState.contextId}
                    contextType={chatModalState.contextType}
                    contextTitle={chatModalState.contextTitle}
                    contextContent={chatModalState.contextContent}
                />
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col">
            <div className={clsx(
                "border-b border-border bg-surface-primary",
                isEmbedded ? "px-3 py-2" : "px-6 py-4"
            )}>
                <div className={clsx("flex flex-col", isEmbedded ? "gap-2" : "gap-3")}>
                    {/* Embedded mode: Tab + Search button OR Search input */}
                    {isEmbedded ? (
                        isSearchOpen ? (
                            /* Search input mode */
                            <div className="flex items-center gap-1">
                                <div className="relative flex-1">
                                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-tertiary" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="搜索..."
                                        autoFocus
                                        className="w-full bg-surface-secondary border border-border rounded-lg pl-7 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent-primary"
                                    />
                                </div>
                                <button
                                    onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}
                                    className="p-1 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ) : (
                            /* Tab switcher + search button */
                            <div className="flex items-center gap-1">
                                <div className="flex flex-1 bg-surface-secondary rounded-lg p-0.5">
                                    <button
                                        onClick={() => setActiveTab('xiaohongshu')}
                                        className={clsx(
                                            "flex-1 rounded-md font-medium transition-all flex items-center justify-center px-2 py-1 text-xs",
                                            activeTab === 'xiaohongshu'
                                                ? 'bg-surface-primary text-text-primary shadow-sm'
                                                : 'text-text-tertiary hover:text-text-secondary'
                                        )}
                                    >
                                        📕
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('youtube')}
                                        className={clsx(
                                            "flex-1 rounded-md font-medium transition-all flex items-center justify-center px-2 py-1 text-xs",
                                            activeTab === 'youtube'
                                                ? 'bg-surface-primary text-text-primary shadow-sm'
                                                : 'text-text-tertiary hover:text-text-secondary'
                                        )}
                                    >
                                        ▶️
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('docs')}
                                        className={clsx(
                                            "flex-1 rounded-md font-medium transition-all flex items-center justify-center px-2 py-1 text-xs",
                                            activeTab === 'docs'
                                                ? 'bg-surface-primary text-text-primary shadow-sm'
                                                : 'text-text-tertiary hover:text-text-secondary'
                                        )}
                                    >
                                        📝
                                    </button>
                                </div>
                                <button
                                    onClick={() => setIsSearchOpen(true)}
                                    className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded-lg transition-colors"
                                    title="搜索"
                                >
                                    <Search className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )
                    ) : (
                        /* Non-embedded: Search Toggle + Tab switcher */
                        isSearchOpen ? (
                            <div className="flex items-center gap-2 h-10">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="搜索知识库..."
                                        className="w-full bg-surface-secondary border border-border rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary animate-in fade-in zoom-in-95 duration-200"
                                    />
                                    {searchQuery && (
                                        <button
                                            onClick={() => setSearchQuery('')}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-tertiary hover:text-text-primary"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                                <button
                                    onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }}
                                    className="px-3 py-2 text-sm text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded-lg transition-colors"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-3 h-10">
                                <button
                                    onClick={() => setIsSearchOpen(true)}
                                    className="h-full px-3 text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded-lg transition-colors border border-transparent hover:border-border flex items-center justify-center"
                                    title="搜索 (Cmd+F)"
                                >
                                    <Search className="w-4 h-4" />
                                </button>
                                <div className="flex-1 flex p-1 bg-surface-secondary rounded-lg h-full">
                                    <button
                                        onClick={() => setActiveTab('xiaohongshu')}
                                        className={clsx(
                                            "flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2",
                                            activeTab === 'xiaohongshu'
                                                ? 'bg-surface-primary text-text-primary shadow-sm'
                                                : 'text-text-tertiary hover:text-text-secondary'
                                        )}
                                    >
                                        <span>📕</span>
                                        小红书
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('youtube')}
                                        className={clsx(
                                            "flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2",
                                            activeTab === 'youtube'
                                                ? 'bg-surface-primary text-text-primary shadow-sm'
                                                : 'text-text-tertiary hover:text-text-secondary'
                                        )}
                                    >
                                        <span>▶️</span>
                                        YouTube
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('docs')}
                                        className={clsx(
                                            "flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center justify-center gap-2",
                                            activeTab === 'docs'
                                                ? 'bg-surface-primary text-text-primary shadow-sm'
                                                : 'text-text-tertiary hover:text-text-secondary'
                                        )}
                                    >
                                        <span>📝</span>
                                        文档
                                    </button>
                                </div>
                            </div>
                        )
                    )}

                    {activeTab === 'xiaohongshu' && (
                        <div className="flex items-center gap-3 overflow-hidden py-1">
                            {/* 类型筛选 (左侧固定) */}
                            <div className="flex bg-surface-secondary p-0.5 rounded-lg border border-border/50 shrink-0">
                                <button
                                    onClick={() => setXhsTab('all')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                                        xhsTab === 'all'
                                            ? 'bg-surface-primary text-text-primary shadow-sm'
                                            : 'text-text-tertiary hover:text-text-secondary'
                                    }`}
                                >
                                    全部
                                </button>
                                <button
                                    onClick={() => setXhsTab('image')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                                        xhsTab === 'image'
                                            ? 'bg-surface-primary text-text-primary shadow-sm'
                                            : 'text-text-tertiary hover:text-text-secondary'
                                    }`}
                                >
                                    图文
                                </button>
                                <button
                                    onClick={() => setXhsTab('video')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                                        xhsTab === 'video'
                                            ? 'bg-surface-primary text-text-primary shadow-sm'
                                            : 'text-text-tertiary hover:text-text-secondary'
                                    }`}
                                >
                                    视频
                                </button>
                            </div>

                            {/* Tags Filter (右侧滚动) - Hidden in embedded mode */}
                            {!isEmbedded && allTags.length > 0 && (
                                <>
                                    <div className="w-px h-4 bg-border/50 shrink-0" />

                                    <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
                                        {/* "All" Tag Pill */}
                                        <button
                                            onClick={() => setSelectedTag(null)}
                                            className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-all border ${
                                                !selectedTag
                                                    ? 'bg-surface-primary text-text-primary border-border shadow-sm ring-1 ring-border/50'
                                                    : 'bg-transparent text-text-tertiary border-transparent hover:bg-surface-secondary hover:text-text-secondary'
                                            }`}
                                        >
                                            全部标签
                                        </button>

                                        {/* Tag Pills */}
                                        {allTags.map(({ tag, count }) => (
                                            <button
                                                key={tag}
                                                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                                                className={`shrink-0 px-3 py-1 text-xs rounded-full transition-all flex items-center gap-1.5 border ${
                                                    selectedTag === tag
                                                        ? 'bg-accent-primary text-white border-accent-primary shadow-md shadow-accent-primary/20'
                                                        : 'bg-surface-secondary/50 text-text-secondary border-transparent hover:bg-surface-secondary hover:text-text-primary'
                                                }`}
                                            >
                                                <span className="opacity-70">#</span>
                                                {tag}
                                                <span className={`text-[10px] py-0.5 px-1.5 rounded-full ${
                                                    selectedTag === tag
                                                        ? 'bg-white/20 text-white'
                                                        : 'bg-surface-tertiary text-text-tertiary'
                                                }`}>
                                                    {count}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
                {isLoading ? (
                    <div className="text-center text-text-tertiary text-xs py-16">加载中...</div>
                ) : activeTab === 'docs' ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={handleAddDocumentFiles}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-surface-primary hover:bg-surface-secondary transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                添加文件
                            </button>
                            <button
                                onClick={handleAddDocumentFolder}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-surface-primary hover:bg-surface-secondary transition-colors"
                            >
                                <FolderPlus className="w-3.5 h-3.5" />
                                添加文件夹
                            </button>
                            <button
                                onClick={handleAddObsidianVault}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg bg-surface-primary hover:bg-surface-secondary transition-colors"
                            >
                                <FolderOpen className="w-3.5 h-3.5" />
                                添加 Obsidian 仓库
                            </button>
                        </div>

                        {filteredDocs.length === 0 ? (
                            <div className="text-center text-text-tertiary text-xs py-16">
                                暂无文档源，可添加文件、文件夹或 Obsidian 仓库
                            </div>
                        ) : (
                            <div className="grid gap-3">
                                {pagedDocs.map((source) => (
                                    <div
                                        key={source.id}
                                        className="rounded-xl border border-border bg-surface-primary p-4 shadow-sm"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-sm font-semibold text-text-primary truncate">{source.name}</div>
                                                    <span className={clsx(
                                                        'text-[10px] px-1.5 py-0.5 rounded-full',
                                                        source.kind === 'obsidian-vault'
                                                            ? 'bg-violet-100 text-violet-700'
                                                            : source.kind === 'tracked-folder'
                                                                ? 'bg-blue-100 text-blue-700'
                                                                : 'bg-emerald-100 text-emerald-700'
                                                    )}>
                                                        {source.kind === 'obsidian-vault' ? 'Obsidian' : source.kind === 'tracked-folder' ? '文件夹' : '文件'}
                                                    </span>
                                                    {source.locked && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                                            锁定目录
                                                        </span>
                                                    )}
                                                    {source.indexing && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                                            <Loader2 className="w-3 h-3 animate-spin" />
                                                            建立索引中
                                                        </span>
                                                    )}
                                                    {!source.indexing && source.indexError && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                                                            索引失败
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="mt-1 text-[11px] text-text-tertiary truncate">{source.rootPath}</div>
                                                {!source.indexing && source.indexError && (
                                                    <div className="mt-1 text-[11px] text-red-500 truncate">
                                                        {source.indexError}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <div className="text-xs text-text-secondary">{source.fileCount} 个文档</div>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDeleteDocumentSource(source)}
                                                    className="p-1.5 rounded-md text-text-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                                    title="移除此文档源"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                        {source.sampleFiles.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-1.5">
                                                {source.sampleFiles.map((file) => (
                                                    <span
                                                        key={`${source.id}-${file}`}
                                                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-surface-secondary text-text-secondary"
                                                    >
                                                        <FileText className="w-3 h-3" />
                                                        <span className="max-w-[300px] truncate">{file}</span>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : activeTab === 'xiaohongshu' ? (
                    /* Xiaohongshu Notes Grid */
                    filteredXhsNotes.length === 0 ? (
                        <div className="text-center text-text-tertiary text-xs py-16">
                            暂无笔记，使用插件保存小红书笔记
                        </div>
                    ) : (
                        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 45%), 1fr))" }}>
                            {pagedXhsNotes.map((note) => {
                                const orderedImages = orderImages(note.images || []);
                                const coverImage = note.cover || orderedImages[0];
                                return (
                                    <button
                                        key={note.id}
                                        onClick={() => setSelectedNote(note)}
                                        className="w-full text-left bg-surface-primary border border-border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                                    >
                                        {coverImage ? (
                                            <div className={`w-full ${resolveAspectClass(note.id)} bg-surface-secondary overflow-hidden`}>
                                                <img
                                                    src={resolveAssetUrl(coverImage)}
                                                    alt={note.title}
                                                    className="w-full h-full object-cover"
                                                    onLoad={(event) => handleImageLoad(note.id, event)}
                                                />
                                            </div>
                                        ) : note.video ? (
                                            <div className="relative w-full aspect-[3/4] bg-surface-secondary overflow-hidden flex items-center justify-center">
                                                <video
                                                    src={resolveAssetUrl(note.video)}
                                                    className="w-full h-full object-contain"
                                                    muted
                                                    playsInline
                                                    preload="metadata"
                                                />
                                                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                    <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                                                        <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="aspect-[3/4] bg-surface-secondary flex items-center justify-center text-text-tertiary">
                                                <Image className="w-6 h-6" />
                                            </div>
                                        )}
                                        <div className="p-3">
                                            <div className="text-xs font-semibold text-text-primary line-clamp-2">{note.title}</div>
                                            <div className="mt-1.5 text-[11px] text-text-tertiary line-clamp-3">
                                                {note.content}
                                            </div>
                                            {!isEmbedded && note.tags && note.tags.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {note.tags.slice(0, 3).map(tag => (
                                                        <span key={tag} className="text-[10px] text-accent-primary bg-accent-primary/5 px-1.5 py-0.5 rounded">
                                                            #{tag}
                                                        </span>
                                                    ))}
                                                    {note.tags.length > 3 && (
                                                        <span className="text-[10px] text-text-tertiary px-1">+{note.tags.length - 3}</span>
                                                    )}
                                                </div>
                                            )}
                                            <div className="mt-2.5 flex items-center gap-2 text-[10px] text-text-tertiary">
                                                <span className="flex items-center gap-1">
                                                    <Heart className="w-3 h-3" />
                                                    {note.stats?.likes || 0}
                                                </span>
                                                {typeof note.stats?.collects === 'number' && (
                                                    <span className="flex items-center gap-1">
                                                        <Star className="w-3 h-3" />
                                                        {note.stats.collects}
                                                    </span>
                                                )}
                                                {note.images?.length > 0 && (
                                                    <span className="flex items-center gap-1">
                                                        <Image className="w-3 h-3" />
                                                        {note.images.length}
                                                    </span>
                                                )}
                                                {note.video && (
                                                    <span className="flex items-center gap-1">
                                                        <Play className="w-3 h-3" />
                                                        视频
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )
                ) : (
                    /* YouTube Videos Grid */
                    filteredVideos.length === 0 ? (
                        <div className="text-center text-text-tertiary text-xs py-16">
                            暂无视频，复制 YouTube 链接后可自动采集保存
                        </div>
                    ) : (
                        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 45%), 1fr))" }}>
                            {pagedVideos.map((video) => {
                                const isProcessing = video.status === 'processing';
                                const isFailed = video.status === 'failed';
                                return (
                                <button
                                    key={video.id}
                                    onClick={() => setSelectedVideo(video)}
                                    className={`w-full text-left bg-surface-primary border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow ${
                                        isProcessing ? 'border-yellow-400 animate-pulse' : isFailed ? 'border-red-400' : 'border-border'
                                    }`}
                                >
                                    <div className="relative aspect-video bg-surface-secondary overflow-hidden">
                                        {video.thumbnailUrl && !isProcessing ? (
                                            <img
                                                src={resolveAssetUrl(video.thumbnailUrl)}
                                                alt={video.title}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-text-tertiary">
                                                {isProcessing ? (
                                                    <div className="flex flex-col items-center gap-2">
                                                        <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                                                        <span className="text-xs text-yellow-600">处理中...</span>
                                                    </div>
                                                ) : (
                                                    <Play className="w-8 h-8" />
                                                )}
                                            </div>
                                        )}
                                        {/* Processing overlay */}
                                        {isProcessing && video.thumbnailUrl && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                                <div className="flex flex-col items-center gap-2">
                                                    <div className="w-10 h-10 border-3 border-white border-t-transparent rounded-full animate-spin" />
                                                    <span className="text-xs text-white font-medium">下载字幕中...</span>
                                                </div>
                                            </div>
                                        )}
                                        {/* Play overlay - only show when completed */}
                                        {!isProcessing && !isFailed && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
                                                <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center">
                                                    <Play className="w-6 h-6 text-white ml-1" fill="white" />
                                                </div>
                                            </div>
                                        )}
                                        {/* Status badges */}
                                        {video.hasSubtitle && !isProcessing && (
                                            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-white flex items-center gap-1">
                                                <FileText className="w-3 h-3" />
                                                字幕
                                            </div>
                                        )}
                                        {isFailed && (
                                            <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-red-600 rounded text-[10px] text-white">
                                                处理失败
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-3">
                                        <div className="text-xs font-semibold text-text-primary line-clamp-2">{video.title}</div>
                                        <div className="mt-1.5 text-[11px] text-text-tertiary line-clamp-2">
                                            {isProcessing ? '正在下载字幕和封面...' : (video.description || '暂无描述')}
                                        </div>
                                        <div className="mt-2 flex items-center justify-between">
                                            <span className="text-[10px] text-text-tertiary">
                                                {new Date(video.createdAt).toLocaleDateString()}
                                            </span>
                                            {isProcessing && (
                                                <span className="text-[10px] text-yellow-600 font-medium">处理中</span>
                                            )}
                                        </div>
                                    </div>
                                </button>
                                );
                            })}
                        </div>
                    )
                )}

                {/* 分页控件 */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-4 pb-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="px-2 py-1 text-xs rounded border border-border hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronLeft className="w-3 h-3" />
                        </button>
                        <span className="text-xs text-text-tertiary">
                            {currentPage} / {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="px-2 py-1 text-xs rounded border border-border hover:bg-surface-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <ChevronRight className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>

            {/* Xiaohongshu Note Detail Modal */}
            {selectedNote && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={() => setSelectedNote(null)}
                >
                    <div
                        className="w-full max-w-3xl mx-4 bg-surface-primary rounded-2xl border border-border shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
                            <div className="min-w-0">
                                <h1 className="text-lg font-semibold text-text-primary line-clamp-2">{selectedNote.title}</h1>
                                <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                                    <span>作者: {selectedNote.author}</span>
                                    <span className="flex items-center gap-1">
                                        <Heart className="w-3 h-3" /> {selectedNote.stats?.likes || 0}
                                    </span>
                                    {typeof selectedNote.stats?.collects === 'number' && (
                                        <span className="flex items-center gap-1">
                                            <Star className="w-3 h-3" /> {selectedNote.stats.collects}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => openChat(
                                        selectedNote.id,
                                        selectedNote.video ? 'xiaohongshu_video' : 'xiaohongshu_note',
                                        selectedNote.title,
                                        selectedNote.content + (selectedNote.transcript ? `\n\nVideo Transcript:\n${selectedNote.transcript}` : '')
                                    )}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary bg-surface-secondary border border-border rounded-lg hover:bg-surface-hover transition-all"
                                >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    AI 助手
                                </button>
                                <button
                                    onClick={() => void handleSaveNoteCoverAsTemplate(selectedNote)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary bg-surface-secondary border border-border rounded-lg hover:bg-surface-hover transition-all"
                                    title="保存封面为模板"
                                >
                                    <BookmarkPlus className="w-3.5 h-3.5" />
                                    存为封面模板
                                </button>
                                {selectedNote.video && !selectedNote.transcript && (
                                    <button
                                        onClick={() => handleTranscribeNote(selectedNote.id)}
                                        disabled={isTranscribing}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg hover:from-blue-600 hover:to-cyan-600 transition-all shadow-sm disabled:opacity-60"
                                        title="提取文字"
                                    >
                                        {isTranscribing ? (
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <FileText className="w-3.5 h-3.5" />
                                        )}
                                        提取文字
                                    </button>
                                )}
                                <button
                                    onClick={() => setSelectedNote(null)}
                                    className="p-2 text-text-tertiary hover:text-text-primary transition-colors"
                                    title="关闭"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-6 space-y-6" onClick={(event) => event.stopPropagation()}>
                            {selectedNote.video && (
                                <div className="relative mx-auto w-full max-w-[480px]">
                                    <div className="relative rounded-xl overflow-hidden border border-border bg-surface-secondary">
                                        <video
                                            src={resolveAssetUrl(selectedNote.video)}
                                            className="block w-full h-auto max-h-[60vh] object-contain"
                                            controls
                                            playsInline
                                            preload="metadata"
                                        />
                                    </div>
                                </div>
                            )}

                            {selectedNote.images && selectedNote.images.length > 0 && (() => {
                                const orderedImages = orderImages(selectedNote.images);
                                const currentImage = orderedImages[selectedImageIndex];
                                const aspectClass = resolveAspectClass(currentImage);
                                return (
                                    <div className="relative mx-auto w-full max-w-[360px]">
                                        <div className={`relative rounded-xl overflow-hidden border border-border bg-surface-secondary ${aspectClass}`}>
                                            <img
                                                src={resolveAssetUrl(currentImage)}
                                                alt={`图片 ${selectedImageIndex + 1}`}
                                                className="w-full h-full object-cover"
                                                onLoad={(event) => handleImageLoad(currentImage, event)}
                                                onClick={() => setIsImagePreviewOpen(true)}
                                            />
                                        </div>
                                        {orderedImages.length > 1 && (
                                            <>
                                                <button
                                                    onClick={() => setSelectedImageIndex((prev) => (prev === 0 ? orderedImages.length - 1 : prev - 1))}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                                                >
                                                    <ChevronLeft className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => setSelectedImageIndex((prev) => (prev === orderedImages.length - 1 ? 0 : prev + 1))}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60"
                                                >
                                                    <ChevronRight className="w-4 h-4" />
                                                </button>
                                                <div className="absolute bottom-3 right-3 text-[11px] text-white bg-black/50 rounded-full px-2 py-0.5">
                                                    {selectedImageIndex + 1}/{orderedImages.length}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })()}

                            <div className="bg-surface-secondary/50 rounded-lg border border-border p-4">
                                <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans leading-relaxed">
                                    {selectedNote.content}
                                </pre>
                            </div>

                            {selectedNote.video && selectedNote.transcript && (
                                <div className="bg-surface-secondary/50 rounded-lg border border-border overflow-hidden">
                                    <button
                                        onClick={() => setShowTranscript(!showTranscript)}
                                        className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-text-primary hover:bg-surface-secondary/80 transition-colors"
                                    >
                                        <span className="flex items-center gap-2">
                                            <FileText className="w-4 h-4" />
                                            视频转录
                                        </span>
                                        <ChevronRight className={`w-4 h-4 transition-transform ${showTranscript ? 'rotate-90' : ''}`} />
                                    </button>
                                    {showTranscript && (
                                        <div className="px-4 pb-4">
                                            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-auto">
                                                {selectedNote.transcript}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 border-t border-border flex items-center justify-between" onClick={(event) => event.stopPropagation()}>
                            <div className="text-xs text-text-tertiary">保存时间 {selectedNote.createdAt}</div>
                            <button
                                onClick={() => handleDeleteNote(selectedNote.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                删除笔记
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* YouTube Video Detail Modal */}
            {selectedVideo && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={() => setSelectedVideo(null)}
                >
                    <div
                        className="w-full max-w-4xl mx-4 bg-surface-primary rounded-2xl border border-border shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
                            <div className="min-w-0 flex-1">
                                <h1 className="text-lg font-semibold text-text-primary line-clamp-2">{selectedVideo.title}</h1>
                                <div className="flex items-center gap-3 mt-1 text-xs text-text-tertiary">
                                    <span>保存于 {new Date(selectedVideo.createdAt).toLocaleDateString()}</span>
                                    {selectedVideo.hasSubtitle && (
                                        <span className="flex items-center gap-1 text-green-600">
                                            <FileText className="w-3 h-3" /> 有字幕
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => openChat(
                                        selectedVideo.id,
                                        'youtube_video',
                                        selectedVideo.title,
                                        `Title: ${selectedVideo.title}\nDescription: ${selectedVideo.description || 'None'}\n\nSubtitle:\n${selectedVideo.subtitleContent || '(No subtitle)'}`
                                    )}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-primary bg-surface-secondary border border-border rounded-lg hover:bg-surface-hover transition-all"
                                >
                                    <MessageCircle className="w-3.5 h-3.5" />
                                    AI 助手
                                </button>
                                <button
                                    onClick={() => setSelectedVideo(null)}
                                    className="p-2 text-text-tertiary hover:text-text-primary transition-colors"
                                    title="关闭"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-6 space-y-6" onClick={(event) => event.stopPropagation()}>
                            {/* Thumbnail */}
                            <div className="relative mx-auto w-full max-w-2xl">
                                <div className="relative rounded-xl overflow-hidden border border-border bg-surface-secondary aspect-video">
                                    {selectedVideo.thumbnailUrl ? (
                                        <img
                                            src={resolveAssetUrl(selectedVideo.thumbnailUrl)}
                                            alt={selectedVideo.title}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-text-tertiary">
                                            <Play className="w-12 h-12" />
                                        </div>
                                    )}
                                    {/* Play button overlay */}
                                    <button
                                        onClick={() => openYouTube(selectedVideo.videoUrl)}
                                        className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors"
                                    >
                                        <div className="w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
                                            <Play className="w-8 h-8 text-white ml-1" fill="white" />
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* Description */}
                            {selectedVideo.description && (
                                <div className="bg-surface-secondary/50 rounded-lg border border-border p-4">
                                    <h3 className="text-sm font-semibold text-text-primary mb-2">视频描述</h3>
                                    <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans leading-relaxed">
                                        {selectedVideo.description}
                                    </pre>
                                </div>
                            )}

                            {/* Subtitle */}
                            {selectedVideo.hasSubtitle && selectedVideo.subtitleContent && (
                                <div className="bg-surface-secondary/50 rounded-lg border border-border overflow-hidden">
                                    <button
                                        onClick={() => setShowSubtitle(!showSubtitle)}
                                        className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-text-primary hover:bg-surface-secondary/80 transition-colors"
                                    >
                                        <span className="flex items-center gap-2">
                                            <FileText className="w-4 h-4" />
                                            字幕内容
                                        </span>
                                        <ChevronRight className={`w-4 h-4 transition-transform ${showSubtitle ? 'rotate-90' : ''}`} />
                                    </button>
                                    {showSubtitle && (
                                        <div className="px-4 pb-4">
                                            <pre className="text-sm text-text-secondary whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-auto">
                                                {selectedVideo.subtitleContent}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            )}
                            {selectedVideo.hasSubtitle && !selectedVideo.subtitleContent && isSubtitleLoading && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-sm text-blue-700">正在加载字幕...</span>
                                </div>
                            )}

                            {/* No Subtitle - Retry Button */}
                            {!selectedVideo.hasSubtitle && selectedVideo.status === 'completed' && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-yellow-700">
                                        <FileText className="w-4 h-4" />
                                        <span className="text-sm">该视频暂无字幕</span>
                                    </div>
                                    <button
                                        onClick={() => handleRetrySubtitle(selectedVideo.id)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-yellow-700 border border-yellow-400 rounded hover:bg-yellow-100 transition-colors"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        重新获取字幕
                                    </button>
                                </div>
                            )}

                            {/* Processing Status */}
                            {selectedVideo.status === 'processing' && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-sm text-blue-700">正在获取字幕...</span>
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 border-t border-border flex items-center justify-between" onClick={(event) => event.stopPropagation()}>
                            <button
                                onClick={() => openYouTube(selectedVideo.videoUrl)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                在 YouTube 打开
                            </button>
                            <button
                                onClick={() => handleDeleteVideo(selectedVideo.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500 border border-red-200 rounded hover:bg-red-50"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                删除视频
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Preview Modal (for Xiaohongshu) */}
            {selectedNote && isImagePreviewOpen && selectedNote.images && selectedNote.images.length > 0 && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
                    onClick={() => setIsImagePreviewOpen(false)}
                >
                    {(() => {
                        const orderedImages = orderImages(selectedNote.images);
                        const currentImage = orderedImages[selectedImageIndex];
                        return (
                            <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(event) => event.stopPropagation()}>
                                <img src={resolveAssetUrl(currentImage)} alt="预览图" className="max-h-[90vh] max-w-[90vw] object-contain" />
                                {orderedImages.length > 1 && (
                                    <>
                                        <button
                                            onClick={() => setSelectedImageIndex((prev) => (prev === 0 ? orderedImages.length - 1 : prev - 1))}
                                            className="absolute left-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
                                        >
                                            <ChevronLeft className="w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => setSelectedImageIndex((prev) => (prev === orderedImages.length - 1 ? 0 : prev + 1))}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
                                        >
                                            <ChevronRight className="w-5 h-5" />
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => setIsImagePreviewOpen(false)}
                                    className="absolute top-3 right-3 h-8 w-8 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Knowledge Chat Modal */}
            <KnowledgeChatModal
                isOpen={chatModalState.isOpen}
                onClose={() => setChatModalState(prev => ({ ...prev, isOpen: false }))}
                contextId={chatModalState.contextId}
                contextType={chatModalState.contextType}
                contextTitle={chatModalState.contextTitle}
                contextContent={chatModalState.contextContent}
            />
        </div>
    );
}
