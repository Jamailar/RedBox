import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Clapperboard, MessageSquare, Plus } from 'lucide-react';
import { EditableTrackTimeline } from './EditableTrackTimeline';
import { resolveAssetUrl } from '../../utils/pathManager';

const ChatWorkspace = lazy(async () => ({
  default: (await import('../../pages/Chat')).Chat,
}));

type MediaAssetLike = {
  id: string;
  title?: string;
  relativePath?: string;
  previewUrl?: string;
};

type PackageStateLike = Record<string, unknown>;

type VideoClipLike = {
  clipId?: string;
  assetId?: string;
  name?: string;
  order?: number;
  track?: string;
  durationMs?: number;
  enabled?: boolean;
};

type PreviewTab = 'preview' | 'script';
type DragTarget = 'materials' | 'chat' | 'timeline';

type DragState = {
  target: DragTarget;
  startX: number;
  startY: number;
  materialPaneWidth: number;
  chatPaneWidth: number;
  timelineHeight: number;
};

const VIDEO_EDITING_SHORTCUTS = [
  { label: '查看时间线', text: '请先查看当前视频工程的时间线片段，概括当前结构、轨道和明显问题。' },
  { label: '生成字幕', text: '请为当前视频工程规划字幕策略，并说明下一步如何生成和对齐字幕。' },
  { label: '粗剪 30 秒', text: '请基于当前视频工程，提出一个 30 秒内的粗剪方案，说明应该保留、删除和重排哪些片段。' },
  { label: '导出粗剪', text: '请检查当前视频工程是否具备导出条件；如果条件满足，直接导出当前粗剪版本。' },
];

function inferAssetKind(asset: MediaAssetLike): 'image' | 'video' | 'audio' | 'unknown' {
  const source = String(asset.previewUrl || asset.relativePath || '').toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/.test(source)) return 'image';
  if (/\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/.test(source)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?|$)/.test(source)) return 'audio';
  return 'unknown';
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export interface VideoDraftWorkbenchProps {
  title: string;
  editorFile: string;
  packageAssets: Array<Record<string, unknown>>;
  packagePreviewAssets: MediaAssetLike[];
  primaryVideoAsset?: MediaAssetLike | null;
  timelineClipCount: number;
  timelineTrackNames: string[];
  timelineClips: VideoClipLike[];
  editorBody: string;
  editorBodyDirty: boolean;
  isSavingEditorBody: boolean;
  editorChatSessionId: string | null;
  onEditorBodyChange: (value: string) => void;
  onOpenBindAssets: () => void;
  onPackageStateChange: (state: PackageStateLike) => void;
}

export function VideoDraftWorkbench({
  title,
  editorFile,
  packagePreviewAssets,
  primaryVideoAsset,
  timelineClipCount,
  timelineTrackNames,
  timelineClips,
  editorBody,
  editorBodyDirty,
  isSavingEditorBody,
  editorChatSessionId,
  onEditorBodyChange,
  onOpenBindAssets,
  onPackageStateChange,
}: VideoDraftWorkbenchProps) {
  const [previewTab, setPreviewTab] = useState<PreviewTab>('preview');
  const [materialPaneWidth, setMaterialPaneWidth] = useState(300);
  const [chatPaneWidth, setChatPaneWidth] = useState(380);
  const [timelineHeight, setTimelineHeight] = useState(280);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [currentPreviewAssetId, setCurrentPreviewAssetId] = useState<string | null>(primaryVideoAsset?.id || null);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const displayAssets = useMemo(
    () => (packagePreviewAssets.length > 0 ? packagePreviewAssets : ([primaryVideoAsset].filter(Boolean) as MediaAssetLike[])),
    [packagePreviewAssets, primaryVideoAsset]
  );

  useEffect(() => {
    if (!displayAssets.length) {
      setCurrentPreviewAssetId(null);
      return;
    }
    if (currentPreviewAssetId && displayAssets.some((asset) => asset.id === currentPreviewAssetId)) {
      return;
    }
    setCurrentPreviewAssetId(
      primaryVideoAsset && displayAssets.some((asset) => asset.id === primaryVideoAsset.id)
        ? primaryVideoAsset.id
        : displayAssets[0]?.id || null
    );
  }, [currentPreviewAssetId, displayAssets, primaryVideoAsset]);

  const currentPreviewAsset = useMemo(
    () => displayAssets.find((asset) => asset.id === currentPreviewAssetId) || primaryVideoAsset || displayAssets[0] || null,
    [currentPreviewAssetId, displayAssets, primaryVideoAsset]
  );

  const clipAssetMap = useMemo(() => {
    const map = new Map<string, string>();
    timelineClips.forEach((clip) => {
      const clipId = String(clip.clipId || '').trim();
      const assetId = String(clip.assetId || '').trim();
      if (clipId && assetId) {
        map.set(clipId, assetId);
      }
    });
    return map;
  }, [timelineClips]);

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (dragState.target === 'materials') {
        const deltaX = event.clientX - dragState.startX;
        setMaterialPaneWidth(clamp(dragState.materialPaneWidth + deltaX, 240, 420));
        return;
      }
      if (dragState.target === 'chat') {
        const deltaX = dragState.startX - event.clientX;
        setChatPaneWidth(clamp(dragState.chatPaneWidth + deltaX, 300, 560));
        return;
      }
      const deltaY = dragState.startY - event.clientY;
      setTimelineHeight(clamp(dragState.timelineHeight + deltaY, 220, 460));
    };

    const handlePointerUp = () => {
      setDragState(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = dragState.target === 'timeline' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragState]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || previewTab !== 'preview') return;
    if (Math.abs(video.currentTime - previewCurrentTime) < 0.08) return;
    video.currentTime = previewCurrentTime;
  }, [previewCurrentTime, previewTab, currentPreviewAssetId]);

  return (
    <div
      className="flex-1 min-h-0 grid bg-[#171717] text-white"
      style={{
        gridTemplateColumns: `minmax(0,1fr) 8px ${chatPaneWidth}px`,
        gridTemplateRows: `minmax(0,1fr) 8px ${timelineHeight}px`,
      }}
    >
      <div
        className="min-h-0 grid"
        style={{
          gridTemplateColumns: `${materialPaneWidth}px 8px minmax(0,1fr)`,
        }}
      >
        <div className="min-h-0 border-r border-b border-white/10 bg-[#1f1f1f]">
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-sm font-medium text-cyan-300">素材</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <button
                type="button"
                onClick={onOpenBindAssets}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.04] px-4 py-4 text-sm text-white/80 hover:border-cyan-400/40 hover:bg-white/[0.06]"
              >
                <Plus className="h-4 w-4" />
                导入素材
              </button>
              <div className="mt-4 text-xs font-medium uppercase tracking-[0.22em] text-white/35">素材</div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                {displayAssets.map((asset, index) => {
                  const kind = inferAssetKind(asset);
                  return (
                    <button
                      key={asset.id || index}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('application/x-redbox-asset-id', asset.id);
                        event.dataTransfer.effectAllowed = 'copyMove';
                      }}
                      onClick={() => setCurrentPreviewAssetId(asset.id)}
                      className={clsx(
                        'rounded-2xl border bg-white/[0.04] p-2 text-left transition',
                        currentPreviewAsset?.id === asset.id ? 'border-cyan-400/55 ring-1 ring-cyan-400/35' : 'border-white/10 hover:border-white/20'
                      )}
                    >
                      <div className="overflow-hidden rounded-xl bg-black/30">
                        {kind === 'video' ? (
                          <video src={resolveAssetUrl(asset.previewUrl || asset.relativePath || '')} className="h-20 w-full object-cover" muted playsInline />
                        ) : (
                          <img src={resolveAssetUrl(asset.previewUrl || asset.relativePath || '')} alt={asset.title || asset.id} className="h-20 w-full object-cover" />
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-white">{asset.title || asset.relativePath || asset.id}</div>
                          <div className="mt-0.5 text-[11px] text-white/45">{kind === 'video' ? '视频' : kind === 'image' ? '图片/关键帧' : '素材'}</div>
                        </div>
                        <div className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/55">
                          {asset.id === currentPreviewAsset?.id ? '预览' : '拖入'}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {displayAssets.length === 0 && (
                  <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-5 text-sm text-white/55">
                    还没有关联素材。先导入视频、图片或关键帧。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          className="cursor-col-resize border-b border-r border-white/10 bg-white/[0.03] transition-colors hover:bg-cyan-400/20"
          onPointerDown={(event) => {
            event.preventDefault();
            setDragState({
              target: 'materials',
              startX: event.clientX,
              startY: event.clientY,
              materialPaneWidth,
              chatPaneWidth,
              timelineHeight,
            });
          }}
        />

        <div className="min-h-0 border-r border-b border-white/10 bg-[#111111]">
          <div className="flex h-full min-h-0 flex-col px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-5 text-sm">
                <button
                  type="button"
                  onClick={() => setPreviewTab('preview')}
                  className={previewTab === 'preview' ? 'font-medium text-white' : 'font-medium text-white/45'}
                >
                  预览
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('script')}
                  className={previewTab === 'script' ? 'font-medium text-white' : 'font-medium text-white/45'}
                >
                  脚本
                </button>
              </div>
              <div className="text-xs text-white/45">
                {previewTab === 'script'
                  ? (isSavingEditorBody ? '保存中...' : editorBodyDirty ? '待保存' : '已保存')
                  : `${timelineClipCount} 个片段`}
              </div>
            </div>

            <div className="mt-4 flex-1 overflow-hidden rounded-[24px] border border-white/10 bg-[#1b1b1b]">
              {previewTab === 'preview' ? (
                currentPreviewAsset ? (
                  inferAssetKind(currentPreviewAsset) === 'video' ? (
                    <video
                      ref={previewVideoRef}
                      src={resolveAssetUrl(currentPreviewAsset.previewUrl || currentPreviewAsset.relativePath || '')}
                      className="h-full w-full object-contain"
                      controls
                      playsInline
                      onTimeUpdate={(event) => {
                        setPreviewCurrentTime(event.currentTarget.currentTime);
                      }}
                    />
                  ) : (
                    <img
                      src={resolveAssetUrl(currentPreviewAsset.previewUrl || currentPreviewAsset.relativePath || '')}
                      alt={currentPreviewAsset.title || title}
                      className="h-full w-full object-contain"
                    />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-center text-white/55">
                    <div>
                      <Clapperboard className="mx-auto h-10 w-10 text-white/35" />
                      <div className="mt-3 text-sm">还没有可预览的视频素材</div>
                      <div className="mt-1 text-xs text-white/35">先在左侧导入或关联视频、图片或关键帧</div>
                    </div>
                  </div>
                )
              ) : (
                <textarea
                  value={editorBody}
                  onChange={(event) => onEditorBodyChange(event.target.value)}
                  placeholder="在这里写视频脚本、镜头安排、剪辑目标和导出要求。"
                  className="h-full w-full resize-none bg-transparent px-5 py-5 text-sm leading-7 text-white outline-none placeholder:text-white/30"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        className="row-span-3 cursor-col-resize bg-white/[0.03] transition-colors hover:bg-cyan-400/20"
        onPointerDown={(event) => {
          event.preventDefault();
          setDragState({
            target: 'chat',
            startX: event.clientX,
            startY: event.clientY,
            materialPaneWidth,
            chatPaneWidth,
            timelineHeight,
          });
        }}
      />

      <div className="row-span-3 min-h-0 border-l border-white/10 bg-[#131313] text-white">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <MessageSquare className="h-4 w-4 text-cyan-400" />
              视频剪辑助手
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {editorChatSessionId ? (
              <Suspense fallback={<div className="h-full flex items-center justify-center text-white/45">AI 会话加载中...</div>}>
                <ChatWorkspace
                  fixedSessionId={editorChatSessionId}
                  defaultCollapsed={true}
                  showClearButton={true}
                  fixedSessionBannerText=""
                  showWelcomeShortcuts={false}
                  showComposerShortcuts={true}
                  shortcuts={VIDEO_EDITING_SHORTCUTS}
                  welcomeShortcuts={VIDEO_EDITING_SHORTCUTS}
                  welcomeTitle="视频剪辑助手"
                  welcomeSubtitle="围绕当前视频工程做粗剪、调序、trim、字幕和导出建议"
                  contentLayout="default"
                  contentWidthPreset="narrow"
                  allowFileUpload={true}
                  messageWorkflowPlacement="bottom"
                  messageWorkflowVariant="compact"
                  messageWorkflowEmphasis="default"
                  surfaceTone="dark"
                />
              </Suspense>
            ) : (
              <div className="h-full flex items-center justify-center px-6 text-center text-sm text-white/45">正在初始化视频剪辑会话...</div>
            )}
          </div>
        </div>
      </div>

      <div
        className="col-span-1 border-r border-white/10 bg-white/[0.03] transition-colors hover:bg-cyan-400/20"
        onPointerDown={(event) => {
          event.preventDefault();
          setDragState({
            target: 'timeline',
            startX: event.clientX,
            startY: event.clientY,
            materialPaneWidth,
            chatPaneWidth,
            timelineHeight,
          });
        }}
      />

      <div className="min-h-0 border-r border-white/10 bg-[#151515] px-5 py-4">
        <EditableTrackTimeline
          filePath={editorFile}
          clips={timelineClips as Array<Record<string, unknown>>}
          fallbackTracks={timelineTrackNames}
          accent="cyan"
          emptyLabel="把视频、图片或关键帧拖入时间轴开始排布"
          onPackageStateChange={onPackageStateChange}
          controlledCursorTime={previewCurrentTime}
          onCursorTimeChange={(time) => setPreviewCurrentTime(time)}
          onSelectedClipChange={(clipId) => {
            if (!clipId) return;
            const assetId = clipAssetMap.get(clipId);
            if (assetId) {
              setCurrentPreviewAssetId(assetId);
            }
          }}
        />
      </div>
    </div>
  );
}
