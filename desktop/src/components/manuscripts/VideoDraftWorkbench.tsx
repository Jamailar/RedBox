import { lazy, Suspense } from 'react';
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
  id?: string;
  assetId?: string;
  name?: string;
  order?: number;
  track?: string;
  durationMs?: number;
  enabled?: boolean;
};

const VIDEO_EDITING_SHORTCUTS = [
  { label: '生成字幕', text: '请为当前视频工程规划字幕策略，并说明下一步如何生成和对齐字幕。' },
];

function inferAssetKind(asset: MediaAssetLike): 'image' | 'video' | 'audio' | 'unknown' {
  const source = String(asset.previewUrl || asset.relativePath || '').toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/.test(source)) return 'image';
  if (/\.(mp4|mov|webm|m4v|mkv|avi)(\?|$)/.test(source)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?|$)/.test(source)) return 'audio';
  return 'unknown';
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
  packageAssets,
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
  return (
    <div className="flex-1 min-h-0 grid grid-cols-[320px_minmax(0,1fr)_380px] grid-rows-[minmax(0,1fr)_270px] bg-[#171717] text-white">
      <div className="min-h-0 border-r border-b border-white/10 bg-[#1f1f1f]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-4 text-sm">
              {['素材', '脚本', 'AI生成'].map((item, index) => (
                <div key={item} className={index === 0 ? 'font-medium text-cyan-300' : 'font-medium text-white/55'}>
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <button
              type="button"
              onClick={onOpenBindAssets}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.04] px-4 py-5 text-sm text-white/80 hover:border-cyan-400/40 hover:bg-white/[0.06]"
            >
              <Plus className="h-4 w-4" />
              导入 / 关联素材
            </button>
            <div className="mt-4 text-xs font-medium uppercase tracking-[0.22em] text-white/35">素材</div>
            <div className="mt-3 space-y-3">
              {(packagePreviewAssets.length > 0 ? packagePreviewAssets : [primaryVideoAsset].filter(Boolean) as MediaAssetLike[]).map((asset, index) => {
                const kind = inferAssetKind(asset);
                return (
                  <div key={asset.id || index} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="overflow-hidden rounded-xl bg-black/30">
                      {kind === 'video' ? (
                        <video src={resolveAssetUrl(asset.previewUrl || asset.relativePath || '')} className="h-28 w-full object-cover" muted playsInline />
                      ) : (
                        <img src={resolveAssetUrl(asset.previewUrl || asset.relativePath || '')} alt={asset.title || asset.id} className="h-28 w-full object-cover" />
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{asset.title || asset.relativePath || asset.id}</div>
                        <div className="mt-1 text-xs text-white/45">{kind === 'video' ? '视频素材' : kind === 'image' ? '图片/关键帧' : '素材'}</div>
                      </div>
                      <div className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-white/55">
                        {asset.id === primaryVideoAsset?.id ? '预览中' : '已关联'}
                      </div>
                    </div>
                  </div>
                );
              })}
              {packagePreviewAssets.length === 0 && !primaryVideoAsset && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-5 text-sm text-white/55">
                  还没有关联素材。先导入视频、图片或关键帧。
                </div>
              )}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-white/35">脚本</div>
              <div className="text-xs text-white/40">{isSavingEditorBody ? '保存中...' : editorBodyDirty ? '待保存' : '已保存'}</div>
            </div>
            <textarea
              value={editorBody}
              onChange={(event) => onEditorBodyChange(event.target.value)}
              placeholder="在这里写视频脚本、镜头安排、剪辑目标和导出要求。"
              className="mt-3 h-64 w-full resize-none rounded-2xl border border-white/10 bg-[#141414] px-4 py-4 text-sm leading-7 text-white outline-none placeholder:text-white/30"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 border-r border-b border-white/10 bg-[#111111]">
        <div className="flex h-full min-h-0 flex-col px-5 py-4">
          <div className="flex items-center justify-between text-sm text-white/65">
            <span>预览</span>
            <span>{timelineClipCount} 个片段</span>
          </div>
          <div className="mt-4 flex-1 overflow-hidden rounded-[24px] border border-white/10 bg-[#1b1b1b]">
            {primaryVideoAsset ? (
              inferAssetKind(primaryVideoAsset) === 'video' ? (
                <video
                  src={resolveAssetUrl(primaryVideoAsset.previewUrl || primaryVideoAsset.relativePath || '')}
                  className="h-full w-full object-contain"
                  controls
                  playsInline
                />
              ) : (
                <img
                  src={resolveAssetUrl(primaryVideoAsset.previewUrl || primaryVideoAsset.relativePath || '')}
                  alt={primaryVideoAsset.title || title}
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
            )}
          </div>
          <div className="mt-4 grid grid-cols-4 gap-3">
            {[
              { label: '素材', value: `${packageAssets.length}` },
              { label: '轨道', value: `${timelineTrackNames.length}` },
              { label: '片段', value: `${timelineClipCount}` },
              { label: '状态', value: packageAssets.length > 0 ? '编辑中' : '待整理' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3">
                <div className="text-[11px] text-white/35">{stat.label}</div>
                <div className="mt-1 text-sm font-medium text-white">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row-span-2 min-h-0 border-l border-white/10 bg-[#131313] text-white">
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

      <div className="col-span-2 min-h-0 border-r border-white/10 bg-[#151515] px-5 py-4">
        <EditableTrackTimeline
          filePath={editorFile}
          clips={timelineClips}
          fallbackTracks={timelineTrackNames}
          accent="cyan"
          emptyLabel="拖入素材到时间轴开始排布镜头"
          onPackageStateChange={onPackageStateChange}
        />
      </div>
    </div>
  );
}
