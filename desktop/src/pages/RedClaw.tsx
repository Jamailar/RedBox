import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Minimize2, Settings2, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Chat } from './Chat';

const REDCLAW_CONTEXT_ID = 'redclaw-singleton';
const REDCLAW_CONTEXT_TYPE = 'redclaw';
const REDCLAW_CONTEXT = [
    'RedClaw 是一个面向小红书创作自动化的执行型助手。',
    '工作目标：基于用户目标制定选题、产出内容、优化标题与封面文案，并给出可执行发布计划。',
    '默认输出结构：目标拆解、内容策略、执行步骤、风险提示。',
].join('\n');

const REDCLAW_SHORTCUTS = [
    { label: '🎯 新建项目', text: '这是一个新的小红书创作目标，请先创建 RedClaw 项目，再推进完整创作流程。' },
    { label: '🧠 生成文案包', text: '请基于当前项目目标生成完整小红书文案包，并调用 redclaw_save_copy_pack 保存。' },
    { label: '🖼️ 生成配图包', text: '请为当前项目生成封面与配图提示词，并调用 redclaw_save_image_pack 保存。' },
    { label: '📊 复盘本次发布', text: '请基于当前项目进行发布复盘，并调用 redclaw_save_retrospective 保存。' },
];

const REDCLAW_WELCOME_SHORTCUTS = [
    { label: '🚀 启动创作', text: '我想开始一个小红书创作项目，请先明确目标并创建项目。' },
    { label: '✍️ 继续文案', text: '继续当前项目，先回顾项目状态，再完成文案包。' },
    { label: '🎨 继续配图', text: '继续当前项目，完善封面和配图提示词，并保存配图包。' },
    { label: '🔁 做复盘', text: '我已经发布了内容，请引导我输入数据并完成复盘。' },
];

function normalizeClawHubSlug(input: string): string {
    const value = (input || '').trim();
    if (!value) return '';

    if (/^https?:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            if (url.hostname !== 'clawhub.ai' && url.hostname !== 'www.clawhub.ai') {
                return '';
            }
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] === 'skills' && parts[1]) {
                return parts[1].trim().toLowerCase();
            }
            return '';
        } catch {
            return '';
        }
    }

    return value
        .replace(/^clawhub\//i, '')
        .replace(/^\/+|\/+$/g, '')
        .trim()
        .toLowerCase();
}

export function RedClaw() {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isSessionLoading, setIsSessionLoading] = useState(true);
    const [activeSpaceName, setActiveSpaceName] = useState<string>('默认空间');
    const [chatRefreshKey, setChatRefreshKey] = useState(0);
    const [chatActionLoading, setChatActionLoading] = useState<'clear' | 'compact' | null>(null);
    const [chatActionMessage, setChatActionMessage] = useState('');
    const [skillsOpen, setSkillsOpen] = useState(false);
    const [skills, setSkills] = useState<SkillDefinition[]>([]);
    const [isSkillsLoading, setIsSkillsLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [installSource, setInstallSource] = useState('');
    const [isInstallingSkill, setIsInstallingSkill] = useState(false);

    const initSession = useCallback(async () => {
        setIsSessionLoading(true);
        try {
            const spaceInfo = await window.ipcRenderer.invoke('spaces:list') as {
                activeSpaceId?: string;
                spaces?: Array<{ id: string; name: string }>;
            } | null;
            const activeSpaceId = spaceInfo?.activeSpaceId || 'default';
            const spaceName = spaceInfo?.spaces?.find((space) => space.id === activeSpaceId)?.name || activeSpaceId;
            setActiveSpaceName(spaceName);

            const session = await window.ipcRenderer.chat.getOrCreateContextSession({
                contextId: `${REDCLAW_CONTEXT_ID}:${activeSpaceId}`,
                contextType: REDCLAW_CONTEXT_TYPE,
                title: `RedClaw · ${spaceName}`,
                initialContext: `${REDCLAW_CONTEXT}\n当前空间: ${spaceName} (${activeSpaceId})`,
            });
            setSessionId(session.id);
        } catch (error) {
            console.error('Failed to initialize RedClaw session:', error);
            setSessionId(null);
        } finally {
            setIsSessionLoading(false);
        }
    }, []);

    useEffect(() => {
        void initSession();
    }, [initSession]);

    useEffect(() => {
        if (!chatActionMessage) return;
        const timer = window.setTimeout(() => setChatActionMessage(''), 2600);
        return () => window.clearTimeout(timer);
    }, [chatActionMessage]);

    const enabledCount = useMemo(() => skills.filter((skill) => !skill.disabled).length, [skills]);

    const loadSkills = useCallback(async () => {
        setIsSkillsLoading(true);
        try {
            const list = await window.ipcRenderer.listSkills();
            setSkills((list || []) as SkillDefinition[]);
        } catch (error) {
            console.error('Failed to load skills:', error);
            setSkills([]);
        } finally {
            setIsSkillsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!skillsOpen) return;
        void loadSkills();
    }, [skillsOpen, loadSkills]);

    const toggleSkill = useCallback(async (skill: SkillDefinition) => {
        try {
            const channel = skill.disabled ? 'skills:enable' : 'skills:disable';
            const res = await window.ipcRenderer.invoke(channel, { name: skill.name }) as { success?: boolean; error?: string };
            if (!res?.success) {
                setStatusMessage(res?.error || '技能状态更新失败');
                return;
            }
            setStatusMessage(skill.disabled ? `已启用技能：${skill.name}` : `已禁用技能：${skill.name}`);
            await loadSkills();
        } catch (error) {
            console.error('Failed to toggle skill:', error);
            setStatusMessage('技能状态更新失败');
        }
    }, [loadSkills]);

    const installSkill = useCallback(async () => {
        if (isInstallingSkill) return;

        const slug = normalizeClawHubSlug(installSource);
        if (!slug) {
            setStatusMessage('请输入 ClawHub 技能 slug 或技能链接');
            return;
        }

        setIsInstallingSkill(true);
        try {
            const result = await window.ipcRenderer.invoke('skills:market-install', { slug, tag: 'latest' }) as {
                success?: boolean;
                error?: string;
                displayName?: string;
            };
            if (!result?.success) {
                setStatusMessage(result?.error || '技能安装失败');
                return;
            }
            setInstallSource('');
            setStatusMessage(`已安装技能：${result.displayName || slug}`);
            await loadSkills();
        } catch (error) {
            console.error('Failed to install skill:', error);
            setStatusMessage('技能安装失败');
        } finally {
            setIsInstallingSkill(false);
        }
    }, [installSource, isInstallingSkill, loadSkills]);

    const clearRedClawChat = useCallback(async () => {
        if (!sessionId || chatActionLoading) return;
        setChatActionLoading('clear');
        try {
            const result = await window.ipcRenderer.chat.clearMessages(sessionId);
            if (!result?.success) {
                setChatActionMessage('清空失败，请稍后重试');
                return;
            }
            setChatRefreshKey((value) => value + 1);
            setChatActionMessage('已清空 RedClaw 对话记录');
        } catch (error) {
            console.error('Failed to clear RedClaw chat:', error);
            setChatActionMessage('清空失败，请稍后重试');
        } finally {
            setChatActionLoading(null);
        }
    }, [chatActionLoading, sessionId]);

    const compactRedClawContext = useCallback(async () => {
        if (!sessionId || chatActionLoading) return;
        setChatActionLoading('compact');
        try {
            const result = await window.ipcRenderer.chat.compactContext(sessionId);
            if (!result?.success) {
                setChatActionMessage(result?.message || '压缩失败，请稍后重试');
                return;
            }
            if (result.compacted) {
                setChatRefreshKey((value) => value + 1);
            }
            setChatActionMessage(result.message || (result.compacted ? '上下文已压缩' : '暂无可压缩内容'));
        } catch (error) {
            console.error('Failed to compact RedClaw context:', error);
            setChatActionMessage('压缩失败，请稍后重试');
        } finally {
            setChatActionLoading(null);
        }
    }, [chatActionLoading, sessionId]);

    return (
        <div className="h-full relative">
            {isSessionLoading ? (
                <div className="h-full flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3 text-text-tertiary">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-xs">正在初始化 RedClaw...</span>
                    </div>
                </div>
            ) : sessionId ? (
                <>
                    <Chat
                        key={`${sessionId}:${chatRefreshKey}`}
                        fixedSessionId={sessionId}
                        defaultCollapsed={true}
                        showClearButton={false}
                        fixedSessionBannerText={`RedClaw 单会话（空间：${activeSpaceName}）`}
                        shortcuts={REDCLAW_SHORTCUTS}
                        welcomeShortcuts={REDCLAW_WELCOME_SHORTCUTS}
                        welcomeTitle="RedClaw 创作执行台"
                        welcomeSubtitle="围绕“目标-文案-配图-复盘”完整推进小红书创作任务"
                        contentLayout="center-2-3"
                    />
                    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                        <button
                            onClick={() => void clearRedClawChat()}
                            disabled={chatActionLoading !== null}
                            className="px-3 py-2 rounded-full border border-border bg-surface-primary/90 backdrop-blur text-text-secondary hover:text-red-500 hover:border-red-500/40 transition-colors flex items-center gap-2 disabled:opacity-60"
                            title="清空聊天记录"
                        >
                            {chatActionLoading === 'clear' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            <span className="text-xs">清空</span>
                        </button>
                        <button
                            onClick={() => void compactRedClawContext()}
                            disabled={chatActionLoading !== null}
                            className="px-3 py-2 rounded-full border border-border bg-surface-primary/90 backdrop-blur text-text-secondary hover:text-accent-primary hover:border-accent-primary/40 transition-colors flex items-center gap-2 disabled:opacity-60"
                            title="压缩上下文"
                        >
                            {chatActionLoading === 'compact' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Minimize2 className="w-4 h-4" />}
                            <span className="text-xs">压缩</span>
                        </button>
                        <button
                            onClick={() => setSkillsOpen(true)}
                            className="px-3 py-2 rounded-full border border-border bg-surface-primary/90 backdrop-blur text-text-secondary hover:text-accent-primary hover:border-accent-primary/40 transition-colors flex items-center gap-2"
                            title="技能"
                        >
                            <Settings2 className="w-4 h-4" />
                            <span className="text-xs">技能</span>
                        </button>
                    </div>
                    {chatActionMessage && (
                        <div className="absolute top-16 right-4 z-20 text-xs px-3 py-2 rounded-lg border border-border bg-surface-primary/95 text-text-secondary shadow-sm">
                            {chatActionMessage}
                        </div>
                    )}
                </>
            ) : (
                <div className="h-full flex items-center justify-center text-text-tertiary text-sm">
                    RedClaw 会话初始化失败
                </div>
            )}

            {skillsOpen && (
                <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={() => setSkillsOpen(false)}>
                    <div
                        className="absolute right-0 top-0 h-full w-[420px] max-w-[95vw] bg-surface-primary border-l border-border flex flex-col"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="h-14 px-4 border-b border-border flex items-center justify-between">
                            <div>
                                <div className="text-sm font-semibold text-text-primary">RedClaw 技能</div>
                                <div className="text-[11px] text-text-tertiary">已启用 {enabledCount} 个技能</div>
                            </div>
                            <button
                                onClick={() => setSkillsOpen(false)}
                                className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-secondary"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            <div className="border border-border rounded-lg p-3 bg-surface-secondary/40 space-y-2">
                                <div className="text-xs text-text-secondary font-medium">安装技能</div>
                                <input
                                    type="text"
                                    value={installSource}
                                    onChange={(event) => setInstallSource(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            void installSkill();
                                        }
                                    }}
                                    placeholder="输入 skill slug 或 ClawHub 链接"
                                    className="w-full px-3 py-2 rounded-md border border-border bg-surface-primary text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                                />
                                <button
                                    onClick={() => void installSkill()}
                                    disabled={isInstallingSkill || !installSource.trim()}
                                    className="w-full px-3 py-2 rounded-md text-xs border border-border bg-surface-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                                >
                                    {isInstallingSkill ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                                    <span>{isInstallingSkill ? '安装中...' : '安装技能'}</span>
                                </button>
                            </div>

                            {isSkillsLoading ? (
                                <div className="text-xs text-text-tertiary flex items-center gap-2">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    正在加载技能...
                                </div>
                            ) : skills.length === 0 ? (
                                <div className="text-xs text-text-tertiary border border-dashed border-border rounded-lg p-4">
                                    当前空间还没有技能。
                                </div>
                            ) : (
                                skills.map((skill) => (
                                    <div key={skill.location} className="border border-border rounded-lg p-3 bg-surface-secondary/40">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-sm text-text-primary font-medium truncate">{skill.name}</div>
                                                <div className="text-xs text-text-tertiary mt-1 line-clamp-2">{skill.description || '无描述'}</div>
                                                <div className="text-[11px] text-text-tertiary mt-2 truncate">{skill.location}</div>
                                            </div>
                                            <button
                                                onClick={() => void toggleSkill(skill)}
                                                className={clsx(
                                                    'px-2.5 py-1 rounded text-[11px] border transition-colors shrink-0',
                                                    skill.disabled
                                                        ? 'border-border text-text-tertiary hover:text-text-primary hover:border-text-tertiary'
                                                        : 'border-green-500/40 text-green-600 hover:bg-green-500/10'
                                                )}
                                            >
                                                {skill.disabled ? '已禁用' : '已启用'}
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {statusMessage && (
                            <div className="px-4 py-3 border-t border-border text-xs text-text-secondary bg-surface-secondary/40">
                                {statusMessage}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
