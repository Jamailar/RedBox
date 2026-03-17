import React, { memo } from 'react';
import { clsx } from 'clsx';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { ProcessTimeline, ProcessItem } from './ProcessTimeline';
import { ThinkingBubble, SkillActivatedBadge, ToolResultCard } from './ThinkingBubble';
import { TodoList, PlanStep } from './TodoList';

// Legacy types for compatibility (will be migrated)
export interface ToolEvent {
  id: string;
  callId: string;
  name: string;
  input: unknown;
  output?: { success: boolean; content: string };
  description?: string;
  status: 'running' | 'done';
}

export interface SkillEvent {
  name: string;
  description: string;
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  displayContent?: string;
  attachment?: {
    type: 'youtube-video';
    title: string;
    thumbnailUrl?: string;
    videoId?: string;
  };
  // New unified timeline
  timeline: ProcessItem[];
  // Plan steps
  plan?: PlanStep[];

  // Legacy fields (kept for compatibility during migration, but UI will prefer timeline)
  thinking?: string;
  tools: ToolEvent[];
  activatedSkill?: SkillEvent;

  isStreaming?: boolean;
}

interface MessageItemProps {
  msg: Message;
  copiedMessageId: string | null;
  onCopyMessage: (id: string, content: string) => void;
}

const MARKDOWN_COMPONENTS: Components = {
  code({ node, inline, className, children, ...props }: any) {
    return inline ? (
      <code className="bg-surface-secondary px-1.5 py-0.5 rounded text-accent-primary font-mono text-sm" {...props}>
        {children}
      </code>
    ) : (
      <pre className="bg-surface-secondary p-4 rounded-lg overflow-x-auto my-3">
        <code className="font-mono text-sm" {...props}>
          {children}
        </code>
      </pre>
    );
  },
  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border-collapse border border-border text-sm">
          {children}
        </table>
      </div>
    );
  },
  th({ children }: any) {
    return <th className="border border-border bg-surface-secondary px-4 py-2 text-left font-medium">{children}</th>;
  },
  td({ children }: any) {
    return <td className="border border-border px-4 py-2">{children}</td>;
  },
  a({ children, href }: any) {
    return <a href={href} className="text-accent-primary hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  ul({ children }: any) {
    return <ul className="list-disc list-outside ml-5 my-2 space-y-1">{children}</ul>;
  },
  ol({ children }: any) {
    return <ol className="list-decimal list-outside ml-5 my-2 space-y-1">{children}</ol>;
  },
  p({ children }: any) {
    return <p className="my-2">{children}</p>;
  },
};

export const MessageItem = memo(({ msg, copiedMessageId, onCopyMessage }: MessageItemProps) => {
  const isUser = msg.role === 'user';

  return (
    <div className={clsx("flex flex-col", isUser ? "items-end" : "items-start")}>

      {/* Plan Visualization (TodoList) */}
      {!isUser && msg.plan && msg.plan.length > 0 && (
        <TodoList steps={msg.plan} />
      )}

      {/* AI 工作流可视化 (新版 Timeline) */}
      {!isUser && msg.timeline && msg.timeline.length > 0 && (
        <ProcessTimeline items={msg.timeline} isStreaming={!!msg.isStreaming} />
      )}

      {/* AI 工作流可视化 (兼容旧版：思考、工具、技能) - 仅当 timeline 为空时显示 */}
      {!isUser && (!msg.timeline || msg.timeline.length === 0) && (msg.thinking || msg.tools.length > 0 || msg.activatedSkill) && (
        <div className="mb-4 w-full max-w-3xl space-y-3">
          {/* Thinking Bubble */}
          {msg.thinking && (
            <ThinkingBubble content={msg.thinking} isActive={!!msg.isStreaming && !msg.content} />
          )}

          {/* Activated Skill */}
          {msg.activatedSkill && (
            <SkillActivatedBadge
              name={msg.activatedSkill.name}
              description={msg.activatedSkill.description}
            />
          )}

          {/* Tool Calls */}
          {msg.tools.length > 0 && (
            <div className="bg-surface-secondary/50 rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 bg-surface-secondary border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center text-xs text-text-tertiary font-medium">
                  {/* ToolResultCard would be here in legacy mode, but simplifying for now */}
                  Tool Calls ({msg.tools.length})
                </div>
              </div>
              {/* Legacy tool list rendering omitted for brevity as we are migrating */}
            </div>
          )}
        </div>
      )}

      {/* 消息内容 */}
      {(msg.content || (msg.isStreaming && !msg.thinking)) && (
        isUser ? (
          /* 用户消息 */
          (() => {
            const videoCardMatch = msg.content.match(/<!--VIDEO_CARD:(.*?)-->/);
            let videoCard: { title: string; thumbnailUrl?: string; videoId?: string } | null = null;
            let displayText = msg.content;

            if (videoCardMatch) {
              try {
                videoCard = JSON.parse(videoCardMatch[1]);
                displayText = `总结视频「${videoCard?.title}」的内容`;
              } catch (e) {
                console.error('Failed to parse video card:', e);
              }
            }

            return (
              <div className="max-w-full px-5 py-3 rounded-2xl text-base leading-relaxed bg-accent-primary text-white shadow-sm">
                {videoCard && (
                  <div className="mb-3 bg-white/10 rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 p-2.5">
                      {videoCard.thumbnailUrl ? (
                        <img
                          src={videoCard.thumbnailUrl}
                          alt={videoCard.title}
                          className="w-20 h-12 object-cover rounded"
                        />
                      ) : (
                        <div className="w-20 h-12 bg-red-600 rounded flex items-center justify-center">
                          <span className="text-white text-xl">▶</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs opacity-70">YouTube 视频</div>
                        <div className="text-sm font-medium truncate" title={videoCard.title}>{videoCard.title.length > 10 ? videoCard.title.substring(0, 10) + "..." : videoCard.title}</div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="whitespace-pre-wrap">{displayText}</div>
              </div>
            );
          })()
        ) : (
          /* AI 回复 */
          <div className="w-full group">
            <div className="text-base leading-relaxed text-text-primary prose prose-neutral dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2 prose-li:my-0.5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={MARKDOWN_COMPONENTS}
              >
                {msg.content}
              </ReactMarkdown>
              {msg.isStreaming && (
                <span className="inline-block w-2 h-4 ml-1 bg-accent-primary animate-pulse align-middle" />
              )}
            </div>
            {/* 复制按钮 */}
            {!msg.isStreaming && msg.content && (
              <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onCopyMessage(msg.id, msg.content)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-tertiary hover:text-text-primary hover:bg-surface-secondary rounded-md transition-colors"
                  title="复制内容"
                >
                  {copiedMessageId === msg.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-500" />
                      <span className="text-green-500">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // 自定义比对函数：只有内容、状态、思考过程真正变化时才渲染
  // 忽略父组件其他无关 State 变化导致的重绘
  const msgChanged = 
    prevProps.msg.content !== nextProps.msg.content ||
    prevProps.msg.isStreaming !== nextProps.msg.isStreaming ||
    prevProps.msg.thinking !== nextProps.msg.thinking ||
    prevProps.msg.tools !== nextProps.msg.tools ||
    prevProps.msg.plan !== nextProps.msg.plan || // Check plan changes
    prevProps.msg.activatedSkill !== nextProps.msg.activatedSkill ||
    // Deep check for timeline changes (length or last item status/content)
    (prevProps.msg.timeline?.length !== nextProps.msg.timeline?.length) ||
    (prevProps.msg.timeline?.length > 0 && 
      (prevProps.msg.timeline[prevProps.msg.timeline.length - 1].content !== nextProps.msg.timeline[nextProps.msg.timeline.length - 1].content ||
       prevProps.msg.timeline[prevProps.msg.timeline.length - 1].status !== nextProps.msg.timeline[nextProps.msg.timeline.length - 1].status)
    );

  const copyStatusChanged = 
    (prevProps.copiedMessageId === prevProps.msg.id) !== (nextProps.copiedMessageId === nextProps.msg.id);

  return !msgChanged && !copyStatusChanged;
});