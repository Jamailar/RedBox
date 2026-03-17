/**
 * DiscussionFlowService - 讨论流程控制服务
 *
 * 管理群聊中的讨论流程：
 * 1. 总监开场分析
 * 2. 成员随机顺序发言（每个人看到之前所有发言）
 * 3. 总监总结对比
 */

import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import {
    DirectorAgent,
    createDirectorAgent,
    DIRECTOR_ID,
    DIRECTOR_NAME,
    DIRECTOR_AVATAR,
    type ConversationMessage,
    type DirectorConfig,
} from './DirectorAgent';
import {
    createAdvisorChatService,
    type AdvisorChatConfig,
} from '../AdvisorChatService';

// ========== Types ==========

export interface DiscussionConfig {
    apiKey: string;
    baseURL: string;
    model: string;
}

export interface AdvisorInfo {
    id: string;
    name: string;
    avatar: string;
    systemPrompt: string;
    knowledgeDir: string;
}

export interface DiscussionMessage {
    id: string;
    role: 'user' | 'advisor' | 'director';
    advisorId?: string;
    advisorName?: string;
    advisorAvatar?: string;
    content: string;
    timestamp: string;
    phase?: 'introduction' | 'discussion' | 'summary';
}

// ========== DiscussionFlowService Class ==========

export class DiscussionFlowService extends EventEmitter {
    private config: DiscussionConfig;
    private win: BrowserWindow | null;
    private abortController: AbortController | null = null;

    constructor(config: DiscussionConfig, win: BrowserWindow | null = null) {
        super();
        this.config = config;
        this.win = win;
    }

    /**
     * 执行完整的讨论流程
     * @param isSixHatsMode 是否为六顶思考帽模式（按固定顺序，无总监）
     * @param discussionGoal 群聊目标（所有成员围绕此目标讨论）
     */
    async orchestrateDiscussion(
        roomId: string,
        userMessage: string,
        advisors: AdvisorInfo[],
        existingHistory: DiscussionMessage[] = [],
        isSixHatsMode: boolean = false,
        discussionGoal: string = '',
        fileContext?: { filePath: string; fileContent: string }
    ): Promise<DiscussionMessage[]> {
        this.abortController = new AbortController();
        const newMessages: DiscussionMessage[] = [];
        const conversationHistory: ConversationMessage[] = [];

        // 将历史消息转换为对话历史格式，供 AI 参考
        const historyContext = existingHistory.map(msg => {
            if (msg.role === 'user') {
                return { role: 'user' as const, content: msg.content };
            } else if (msg.role === 'director') {
                return { role: 'assistant' as const, content: `[总监]：${msg.content}` };
            } else if (msg.role === 'advisor') {
                return { role: 'assistant' as const, content: `[${msg.advisorName || '顾问'}]：${msg.content}` };
            }
            return null;
        }).filter(Boolean) as { role: 'user' | 'assistant'; content: string }[];

        try {
            // 获取成员名称列表
            const advisorNames = advisors.map(a => a.name);

            // ========== 六顶思考帽模式：按固定顺序发言，无总监 ==========
            if (isSixHatsMode) {
                // 按顺序发言（白→红→黑→黄→绿→蓝）
                for (let i = 0; i < advisors.length; i++) {
                    const advisor = advisors[i];
                    if (this.abortController?.signal.aborted) break;

                    // 构建包含历史和当前轮次所有发言的上下文
                    const fullHistory = [
                        // 历史对话
                        ...historyContext,
                        // 当前用户消息
                        { role: 'user' as const, content: userMessage },
                        // 当前轮次之前成员的发言
                        ...conversationHistory
                            .filter(m => m.role === 'assistant')
                            .map(m => ({
                                role: 'assistant' as const,
                                content: `[${m.advisorName}的观点]\n${m.content}`
                            }))
                    ];

                    const response = await this.advisorSpeak(
                        advisor,
                        userMessage,
                        fullHistory,
                        discussionGoal
                    );

                    const advisorMessage: DiscussionMessage = {
                        id: `msg_${Date.now()}_${advisor.id}`,
                        role: 'advisor',
                        advisorId: advisor.id,
                        advisorName: advisor.name,
                        advisorAvatar: advisor.avatar,
                        content: response,
                        timestamp: new Date().toISOString(),
                        phase: 'discussion',
                    };
                    newMessages.push(advisorMessage);
                    conversationHistory.push({
                        role: 'assistant',
                        advisorId: advisor.id,
                        advisorName: advisor.name,
                        content: response,
                    });
                }

                this.emit('discussion_complete', { roomId, messages: newMessages });
                return newMessages;
            }

            // ========== 普通模式：总监开场 -> 成员随机发言 -> 总监总结 ==========

            // ========== 阶段1：总监开场 ==========
            const directorIntro = await this.directorIntroduction(
                userMessage,
                advisorNames,
                discussionGoal,
                historyContext,  // 传递历史上下文
                fileContext      // 传递文件上下文
            );

            const introMessage: DiscussionMessage = {
                id: `msg_${Date.now()}_director_intro`,
                role: 'director',
                advisorId: DIRECTOR_ID,
                advisorName: DIRECTOR_NAME,
                advisorAvatar: DIRECTOR_AVATAR,
                content: directorIntro,
                timestamp: new Date().toISOString(),
                phase: 'introduction',
            };
            newMessages.push(introMessage);
            conversationHistory.push({
                role: 'director',
                advisorId: DIRECTOR_ID,
                advisorName: DIRECTOR_NAME,
                content: directorIntro,
            });

            // ========== 阶段2：成员轮流发言（随机顺序）==========
            const shuffledAdvisors = this.shuffleArray([...advisors]);

            for (const advisor of shuffledAdvisors) {
                if (this.abortController?.signal.aborted) break;

                // 构建包含历史和当前轮次所有发言的上下文
                const fullHistory = [
                    // 历史对话
                    ...historyContext,
                    // 当前用户消息
                    { role: 'user' as const, content: userMessage },
                    // 总监开场
                    { role: 'assistant' as const, content: `[总监分析]\n${directorIntro}` },
                    // 当前轮次之前成员的发言
                    ...conversationHistory
                        .filter(m => m.role === 'assistant')
                        .map(m => ({
                            role: 'assistant' as const,
                            content: `[${m.advisorName}的观点]\n${m.content}`
                        }))
                ];

                const response = await this.advisorSpeak(
                    advisor,
                    userMessage,
                    fullHistory,
                    discussionGoal,
                    fileContext
                );

                const advisorMessage: DiscussionMessage = {
                    id: `msg_${Date.now()}_${advisor.id}`,
                    role: 'advisor',
                    advisorId: advisor.id,
                    advisorName: advisor.name,
                    advisorAvatar: advisor.avatar,
                    content: response,
                    timestamp: new Date().toISOString(),
                    phase: 'discussion',
                };
                newMessages.push(advisorMessage);
                conversationHistory.push({
                    role: 'assistant',
                    advisorId: advisor.id,
                    advisorName: advisor.name,
                    content: response,
                });
            }

            // ========== 阶段3：总监总结 ==========
            if (!this.abortController?.signal.aborted) {
                const directorSummary = await this.directorSummarize(
                    userMessage,
                    conversationHistory,
                    fileContext
                );

                const summaryMessage: DiscussionMessage = {
                    id: `msg_${Date.now()}_director_summary`,
                    role: 'director',
                    advisorId: DIRECTOR_ID,
                    advisorName: DIRECTOR_NAME,
                    advisorAvatar: DIRECTOR_AVATAR,
                    content: directorSummary,
                    timestamp: new Date().toISOString(),
                    phase: 'summary',
                };
                newMessages.push(summaryMessage);
            }

            this.emit('discussion_complete', { roomId, messages: newMessages });
            return newMessages;

        } catch (error) {
            this.emit('discussion_error', { roomId, error });
            throw error;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * 总监开场分析
     */
    private async directorIntroduction(
        userMessage: string,
        advisorNames: string[],
        discussionGoal: string = '',
        historyContext: { role: 'user' | 'assistant'; content: string }[] = [],
        fileContext?: { filePath: string; fileContent: string }
    ): Promise<string> {
        const directorConfig: DirectorConfig = {
            apiKey: this.config.apiKey,
            baseURL: this.config.baseURL,
            model: this.config.model,
            temperature: 0.7,
        };

        const director = createDirectorAgent(directorConfig);

        // 转发事件到前端
        director.on('event', (event) => {
            this.forwardEventToFrontend('director', event);
        });

        // 通知前端总监开始发言
        this.sendToFrontend('creative-chat:advisor-start', {
            advisorId: DIRECTOR_ID,
            advisorName: DIRECTOR_NAME,
            advisorAvatar: DIRECTOR_AVATAR,
            phase: 'introduction',
        });

        return await director.introduceDiscussion(userMessage, advisorNames, discussionGoal, historyContext, fileContext);
    }

    /**
     * 成员发言
     */
    private async advisorSpeak(
        advisor: AdvisorInfo,
        userMessage: string,
        history: { role: 'user' | 'assistant'; content: string }[],
        discussionGoal: string = '',
        fileContext?: { filePath: string; fileContent: string }
    ): Promise<string> {
        const advisorConfig: AdvisorChatConfig = {
            apiKey: this.config.apiKey,
            baseURL: this.config.baseURL,
            model: this.config.model,
            advisorId: advisor.id,
            advisorName: advisor.name,
            advisorAvatar: advisor.avatar,
            systemPrompt: this.enhanceSystemPrompt(advisor.systemPrompt, history, discussionGoal, fileContext),
            knowledgeDir: advisor.knowledgeDir,
            maxTurns: 3,
            temperature: 0.7,
        };

        const advisorService = createAdvisorChatService(advisorConfig);

        // 转发事件到前端
        advisorService.on('event', (event) => {
            this.forwardEventToFrontend('advisor', event);
        });

        // 通知前端成员开始发言
        this.sendToFrontend('creative-chat:advisor-start', {
            advisorId: advisor.id,
            advisorName: advisor.name,
            advisorAvatar: advisor.avatar,
            phase: 'discussion',
        });

        return await advisorService.sendMessage(userMessage, history);
    }

    /**
     * 总监总结
     */
    private async directorSummarize(
        userMessage: string,
        conversationHistory: ConversationMessage[],
        fileContext?: { filePath: string; fileContent: string }
    ): Promise<string> {
        const directorConfig: DirectorConfig = {
            apiKey: this.config.apiKey,
            baseURL: this.config.baseURL,
            model: this.config.model,
            temperature: 0.7,
        };

        const director = createDirectorAgent(directorConfig);

        // 转发事件到前端
        director.on('event', (event) => {
            this.forwardEventToFrontend('director', event);
        });

        // 通知前端总监开始总结
        this.sendToFrontend('creative-chat:advisor-start', {
            advisorId: DIRECTOR_ID,
            advisorName: DIRECTOR_NAME,
            advisorAvatar: DIRECTOR_AVATAR,
            phase: 'summary',
        });

        return await director.summarizeDiscussion(userMessage, conversationHistory, '', fileContext);
    }

    /**
     * 增强系统提示词，加入上下文感知和群聊目标
     */
    private enhanceSystemPrompt(
        basePrompt: string,
        history: { role: 'user' | 'assistant'; content: string }[],
        discussionGoal: string = '',
        fileContext?: { filePath: string; fileContent: string }
    ): string {
        let prompt = basePrompt;

        // 加入文件上下文
        if (fileContext) {
            prompt += `\n\n## 当前文件上下文\n文件名: ${fileContext.filePath}\n内容:\n\`\`\`\n${fileContext.fileContent}\n\`\`\``;
        }

        const contextInfo = history.length > 1
            ? `\n\n## 讨论上下文\n\n在你之前，已有其他成员发表了观点。请参考他们的观点，提出你独特的见解，可以补充、支持或提出不同看法。`
            : '';

        // 群聊目标提示
        const goalInfo = discussionGoal
            ? `\n\n## 🎯 群聊目标\n\n本次讨论的核心目标是：**${discussionGoal}**\n\n请务必围绕此目标展开分析和讨论，你的所有观点和建议都应该服务于这个目标。`
            : '';

        // 检查是否是六顶思考帽模式（通过提示词内容判断）
        const isSixHatsMode = basePrompt.includes('六顶思考帽');

        if (isSixHatsMode) {
            // 六顶思考帽模式：强调深度思考和工具使用
            return `${prompt}${goalInfo}${contextInfo}

## 重要提示
- 你是群聊讨论中的一员，请根据你的帽子角色发表观点
- **紧扣目标**：你的分析必须围绕群聊目标"${discussionGoal || '用户提出的问题'}"展开
- **主动使用工具**：当需要数据支撑、案例佐证时，请使用 web_search 搜索
- **深度思考**：按照你的"深度思考流程"逐步分析
- 如果有其他帽子的观点，请适当回应或对比
- 突出你的独特视角，与其他帽子形成互补`;
        }

        // 普通顾问模式
        return `${prompt}${goalInfo}${contextInfo}

# 核心指令 (Core Directive)
你不是一个只会搜索资料的AI，你是一个有血有肉的**行业专家**。
1. **拒绝平庸**：不要给出那种"正确的废话"。如果用户的想法很烂，请用符合你性格的方式（委婉或犀利）指出来。
2. **第一人称**：所有观点必须带入"我"的视角（"我看过很多类似的号..."，"我觉得..."）。
3. **经验内化**：你即将收到的【参考资料/知识库】是你的**过往经验**。不要说"根据资料显示"，要说"根据我的经验"。
4. **行动导向**：不要只分析问题，要给方案。

# 语言风格
口语化，像在微信群里聊天。禁止使用"综上所述"、"总而言之"等翻译腔。`;
    }

    /**
     * 随机打乱数组
     */
    private shuffleArray<T>(array: T[]): T[] {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    /**
     * 转发事件到前端
     */
    private forwardEventToFrontend(source: 'director' | 'advisor', event: any): void {
        switch (event.type) {
            case 'thinking_start':
            case 'thinking_chunk':
            case 'thinking_end':
                this.sendToFrontend('creative-chat:thinking', {
                    advisorId: event.advisorId,
                    advisorName: event.advisorName,
                    advisorAvatar: event.advisorAvatar,
                    type: event.type,
                    content: event.content,
                });
                break;

            case 'rag_start':
            case 'rag_result':
                this.sendToFrontend('creative-chat:rag', {
                    advisorId: event.advisorId,
                    type: event.type,
                    content: event.content,
                    sources: event.sources,
                });
                break;

            case 'tool_start':
            case 'tool_end':
                this.sendToFrontend('creative-chat:tool', {
                    advisorId: event.advisorId,
                    type: event.type,
                    tool: event.tool,
                });
                break;

            case 'response_chunk':
                this.sendToFrontend('creative-chat:stream', {
                    advisorId: event.advisorId,
                    content: event.content,
                    done: false,
                });
                break;

            case 'response_end':
                this.sendToFrontend('creative-chat:stream', {
                    advisorId: event.advisorId,
                    content: '',
                    done: true,
                });
                break;

            case 'error':
                console.error(`[${source}] Error:`, event.content);
                break;
        }
    }

    /**
     * 发送消息到前端
     */
    private sendToFrontend(channel: string, data: any): void {
        this.win?.webContents.send(channel, data);
    }

    /**
     * 取消讨论
     */
    cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
    }
}

/**
 * 创建讨论流程服务实例
 */
export function createDiscussionFlowService(
    config: DiscussionConfig,
    win: BrowserWindow | null = null
): DiscussionFlowService {
    return new DiscussionFlowService(config, win);
}
