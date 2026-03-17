import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, MessageSquarePlus, Settings as SettingsIcon, Lightbulb, FolderOpen, Users, FileEdit, Archive, Dices, Globe, Plus, Pencil, ChevronDown, Bot, Image, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import type { ViewType } from '../App';
import { IndexingStatus } from './IndexingStatus';

const appLogo = new URL('../../Box.png', import.meta.url).href;

interface LayoutProps {
  children: ReactNode;
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
}

const NAV_ITEMS: { id: ViewType; label: string; icon: typeof MessageSquare; group?: string }[] = [
  // { id: 'chat', label: 'AI 对话', icon: MessageSquare },
  { id: 'manuscripts', label: '稿件', icon: FileEdit },
  { id: 'wander', label: '漫步', icon: Dices },
  // { id: 'archives', label: '档案', icon: Archive },
  // { id: 'skills', label: '技能库', icon: Lightbulb },
  { id: 'knowledge', label: '知识库', icon: FolderOpen },
  { id: 'advisors', label: '智囊团', icon: Users },
  { id: 'creative-chat', label: '创意聊天室', icon: MessageSquarePlus },
  { id: 'redclaw', label: 'RedClaw', icon: Bot },
  { id: 'media-library', label: '媒体库', icon: Image },
  { id: 'image-gen', label: '生图', icon: Sparkles },
  { id: 'xhs-browser', label: '红书', icon: Globe },
  { id: 'settings', label: '设置', icon: SettingsIcon },
];

interface WorkspaceSpace {
  id: string;
  name: string;
}

type SpaceDialogMode = 'create' | 'rename';

export function Layout({ children, currentView, onNavigate }: LayoutProps) {
  const [spaces, setSpaces] = useState<WorkspaceSpace[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>('');
  const [isSwitchingSpace, setIsSwitchingSpace] = useState(false);
  const [isSpaceMenuOpen, setIsSpaceMenuOpen] = useState(false);
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null);
  const [isSpaceDialogOpen, setIsSpaceDialogOpen] = useState(false);
  const [spaceDialogMode, setSpaceDialogMode] = useState<SpaceDialogMode>('create');
  const [spaceDialogName, setSpaceDialogName] = useState('');
  const [spaceDialogTargetId, setSpaceDialogTargetId] = useState<string | null>(null);
  const [isSpaceDialogSubmitting, setIsSpaceDialogSubmitting] = useState(false);
  const spaceMenuRef = useRef<HTMLDivElement | null>(null);
  const isFixedViewportView = currentView === 'xhs-browser' || currentView === 'manuscripts';
  const activeSpaceName = useMemo(
    () => spaces.find((space) => space.id === activeSpaceId)?.name || '暂无空间',
    [activeSpaceId, spaces]
  );

  const loadSpaces = useCallback(async () => {
    try {
      const result = await window.ipcRenderer.invoke('spaces:list') as { spaces?: WorkspaceSpace[]; activeSpaceId?: string } | null;
      setSpaces(result?.spaces || []);
      setActiveSpaceId(result?.activeSpaceId || '');
    } catch (error) {
      console.error('Failed to load spaces:', error);
      setSpaces([]);
      setActiveSpaceId('');
    }
  }, []);

  useEffect(() => {
    void loadSpaces();

    const handleSpaceChanged = () => {
      void loadSpaces();
    };
    window.ipcRenderer.on('space:changed', handleSpaceChanged);
    return () => {
      window.ipcRenderer.off('space:changed', handleSpaceChanged);
    };
  }, [loadSpaces]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!spaceMenuRef.current) return;
      if (!spaceMenuRef.current.contains(event.target as Node)) {
        setIsSpaceMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isSpaceMenuOpen) {
      setHoveredSpaceId(null);
    }
  }, [isSpaceMenuOpen]);

  const handleSwitchSpace = useCallback(async (nextSpaceId: string) => {
    if (!nextSpaceId || nextSpaceId === activeSpaceId) return;
    setIsSwitchingSpace(true);
    try {
      const result = await window.ipcRenderer.invoke('spaces:switch', nextSpaceId) as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        alert(result?.error || '切换空间失败');
        return;
      }
      setIsSpaceMenuOpen(false);
      window.location.reload();
    } catch (error) {
      console.error('Failed to switch space:', error);
      alert('切换空间失败，请重试');
    } finally {
      setIsSwitchingSpace(false);
    }
  }, [activeSpaceId]);

  const openCreateSpaceDialog = useCallback(() => {
    setIsSpaceMenuOpen(false);
    setSpaceDialogMode('create');
    setSpaceDialogTargetId(null);
    setSpaceDialogName('');
    setIsSpaceDialogOpen(true);
  }, []);

  const openRenameSpaceDialog = useCallback((space: WorkspaceSpace) => {
    setIsSpaceMenuOpen(false);
    setSpaceDialogMode('rename');
    setSpaceDialogTargetId(space.id);
    setSpaceDialogName(space.name);
    setIsSpaceDialogOpen(true);
  }, []);

  const closeSpaceDialog = useCallback(() => {
    if (isSpaceDialogSubmitting) return;
    setIsSpaceDialogOpen(false);
    setSpaceDialogName('');
    setSpaceDialogTargetId(null);
  }, [isSpaceDialogSubmitting]);

  const submitSpaceDialog = useCallback(async () => {
    const trimmedName = spaceDialogName.trim();
    if (!trimmedName) {
      alert('空间名称不能为空');
      return;
    }

    setIsSpaceDialogSubmitting(true);
    try {
      if (spaceDialogMode === 'create') {
        const result = await window.ipcRenderer.invoke('spaces:create', trimmedName) as { success?: boolean; space?: WorkspaceSpace; error?: string } | null;
        if (!result?.success || !result.space) {
          alert(result?.error || '创建空间失败');
          return;
        }
        setIsSpaceDialogOpen(false);
        setSpaceDialogName('');
        setSpaceDialogTargetId(null);
        await loadSpaces();
        await handleSwitchSpace(result.space.id);
        return;
      }

      if (!spaceDialogTargetId) {
        alert('未找到要重命名的空间');
        return;
      }

      const result = await window.ipcRenderer.invoke('spaces:rename', { id: spaceDialogTargetId, name: trimmedName }) as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        alert(result?.error || '重命名失败');
        return;
      }

      setIsSpaceDialogOpen(false);
      setSpaceDialogName('');
      setSpaceDialogTargetId(null);
      await loadSpaces();
    } catch (error) {
      console.error('Failed to submit space dialog:', error);
      alert(spaceDialogMode === 'create' ? '创建空间失败，请重试' : '重命名空间失败，请重试');
    } finally {
      setIsSpaceDialogSubmitting(false);
    }
  }, [handleSwitchSpace, loadSpaces, spaceDialogMode, spaceDialogName, spaceDialogTargetId]);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-text-primary">
      {/* Sidebar */}
      <aside className="w-48 bg-surface-secondary border-r border-border flex flex-col">
        {/* App Title */}
        <div className="h-12 flex items-center px-4 border-b border-border/50">
          <img src={appLogo} alt="RedBox" className="w-5 h-5 mr-2" />
          <span className="font-semibold text-sm">红盒子</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={clsx(
                "w-full flex items-center px-3 py-2 text-sm rounded-md transition-colors",
                currentView === id
                  ? "bg-white shadow-sm text-accent-primary font-medium"
                  : "text-text-secondary hover:bg-surface-primary/50 hover:text-text-primary"
              )}
            >
              <Icon className="w-4 h-4 mr-3" />
              {label}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-2">
          <div className="space-y-1">
            <div className="text-[11px] text-text-tertiary">空间</div>
            <div ref={spaceMenuRef} className="relative">
              <button
                onClick={() => setIsSpaceMenuOpen((prev) => !prev)}
                disabled={isSwitchingSpace}
                className="w-full h-7 px-2 rounded-md border border-border bg-surface-primary text-xs text-text-primary disabled:opacity-50 flex items-center justify-between"
              >
                <span className="truncate">{activeSpaceName}</span>
                <ChevronDown className={clsx('w-3 h-3 text-text-tertiary transition-transform', isSpaceMenuOpen && 'rotate-180')} />
              </button>

              {isSpaceMenuOpen && (
                <div className="absolute left-0 right-0 bottom-full mb-1 rounded-md border border-border bg-surface-primary shadow-lg z-50 overflow-hidden">
                  <div className="max-h-44 overflow-y-auto">
                    {spaces.length === 0 ? (
                      <div className="h-8 px-2 text-xs text-text-tertiary flex items-center">
                        暂无空间
                      </div>
                    ) : (
                      spaces.map((space) => {
                        const isActive = space.id === activeSpaceId;
                        const showEdit = hoveredSpaceId === space.id;
                        return (
                          <div
                            key={space.id}
                            className={clsx(
                              'h-8 px-2 flex items-center gap-1',
                              isActive ? 'bg-accent-primary/10' : 'hover:bg-surface-secondary'
                            )}
                            onMouseEnter={() => setHoveredSpaceId(space.id)}
                            onMouseLeave={() => setHoveredSpaceId((prev) => (prev === space.id ? null : prev))}
                          >
                            <button
                              onClick={() => {
                                void handleSwitchSpace(space.id);
                              }}
                              className={clsx('flex-1 text-left text-xs truncate', isActive ? 'text-accent-primary' : 'text-text-primary')}
                            >
                              {space.name}
                            </button>
                            <button
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                openRenameSpaceDialog(space);
                              }}
                              className={clsx(
                                'w-5 h-5 inline-flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-primary transition-opacity',
                                showEdit ? 'opacity-100' : 'opacity-0 pointer-events-none'
                              )}
                              title="重命名空间"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <button
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openCreateSpaceDialog();
                    }}
                    className="w-full h-8 px-2 border-t border-border text-xs text-text-secondary hover:text-text-primary hover:bg-surface-secondary flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    新建空间
                  </button>
                </div>
              )}
            </div>
          </div>
          <IndexingStatus />
          <div className="text-xs text-text-tertiary text-center">
            v1.7.1 • 本地运行
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface-primary relative">
        {/* Draggable Header (Mac) */}
        <div className="h-8 w-full app-region-drag absolute top-0 left-0 z-50" />

        {/* Content */}
        <div
          className={clsx(
            'flex-1 pt-8',
            isFixedViewportView ? 'min-h-0 flex flex-col overflow-hidden' : 'overflow-auto'
          )}
        >
          {children}
        </div>
      </main>

      {isSpaceDialogOpen && (
        <div
          className="fixed inset-0 z-[120] bg-black/30 flex items-center justify-center"
          onMouseDown={closeSpaceDialog}
        >
          <div
            className="w-80 rounded-lg border border-border bg-surface-primary shadow-xl p-4 space-y-3"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="text-sm font-medium text-text-primary">
              {spaceDialogMode === 'create' ? '新建空间' : '重命名空间'}
            </div>
            <input
              autoFocus
              value={spaceDialogName}
              onChange={(event) => setSpaceDialogName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitSpaceDialog();
                } else if (event.key === 'Escape') {
                  closeSpaceDialog();
                }
              }}
              className="w-full h-9 rounded-md border border-border bg-surface-secondary px-3 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
              placeholder="请输入空间名称"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={closeSpaceDialog}
                disabled={isSpaceDialogSubmitting}
                className="h-8 px-3 text-xs rounded-md border border-border text-text-secondary hover:text-text-primary hover:bg-surface-secondary disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  void submitSpaceDialog();
                }}
                disabled={isSpaceDialogSubmitting}
                className="h-8 px-3 text-xs rounded-md bg-accent-primary text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {isSpaceDialogSubmitting ? '处理中...' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
