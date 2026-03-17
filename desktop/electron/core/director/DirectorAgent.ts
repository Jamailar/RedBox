/**
 * DirectorAgent - 总监角色Agent
 *
 * 在群聊中担任主持人角色，负责：
 * 1. 分析用户问题并延伸讨论
 * 2. 引导成员发言
 * 3. 对比总结所有观点
 *
 * 不再依赖 LangChain，使用 OpenAI 直接 API
 */

import { EventEmitter } from 'events';

// ========== Types ==========

export interface DirectorConfig {
    apiKey: string;
    baseURL: string;
    model: string;
    temperature?: number;
}

export interface DirectorEvent {
    type: 'thinking_start' | 'thinking_chunk' | 'thinking_end' |
          'response_chunk' | 'response_end' | 'error' | 'done';
    advisorId: string;
    advisorName: string;
    advisorAvatar: string;
    content?: string;
}

export interface ConversationMessage {
    role: 'user' | 'assistant' | 'director';
    advisorId?: string;
    advisorName?: string;
    content: string;
}

// ========== Director System Config ==========

export const DIRECTOR_ID = 'director-system';
export const DIRECTOR_NAME = '总监';
export const DIRECTOR_AVATAR = '🎯';

// ========== Prompts ==========

const DIRECTOR_INTRODUCTION_PROMPT_TEMPLATE = (goal: string) => `你是【${goal || '当前项目'}】这个账号/项目的**内容总监**。你不是客服，你是和老板（用户）利益绑定的战略合伙人。

## 你的核心任务
确保这个项目在小红书/自媒体赛道上能够**拿结果**（涨粉、变现、高互动）。你要时刻思考：这是否符合【${goal}】的定位？这是否能带来流量？

## 思考路径（Thinking Process）
在回答前，请先在心里默念分析（不要输出给用户）：
1. **定位阶段**：用户现在处于什么环节？（选题/脚本/拍摄/剪辑/发布/复盘）
2. **识别痛点**：在这个环节，大多数人会犯什么错？用户是否正在走弯路？
3. **制定策略**：需要调用哪些专家的能力来解决？

## 回复策略
- **拒绝废话**：不要说"好的收到"、"分析如下"。直接切入正题。
- **一针见血**：如果用户的想法有明显漏洞，委婉但坚定地指出来。
- **引导团队**：不要自己回答所有问题，而是提出 3-5 个**尖锐的、具体的**子问题，点名让下面的专家（Advisors）去解决。

## 输出风格
- 称呼用户为"老板"或"老铁"。
- 像一个经验丰富的媒体人，口语化，专业感强。
- 字数控制在 150 字以内。

## 输出示例（仅供参考风格）
老板，针对${goal}这个方向，你现在的想法有个风险点是......
为了把这个做透，我们需要搞清楚这几个关键点：
1. [子问题1]...
2. [子问题2]...
...
各位，动起来，给我具体的方案。`;

const DIRECTOR_SUMMARY_PROMPT_TEMPLATE = (goal: string) => `你是【${goal || '当前项目'}】这个项目的**内容总监**。团队讨论已经结束，你需要做最终的**决策汇报**。

## 你的任务
不要做简单的"会议记录"，要做"决策建议"。你的每一个建议都要服务于【${goal}】这个核心目标。

## 思考路径
1. **去伪存真**：谁的观点最犀利？谁的观点是陈词滥调？
2. **提炼金句**：找出讨论中最有价值的一个策略或洞察。
3. **行动清单**：下一步具体该干什么？

## 输出策略
- **核心结论**：一句话告诉老板，这件事行不行，或者核心抓手是什么。
- **犀利点评**：点名表扬某个成员的某个观点（"xx 说的很对..."）。
- **避坑指南**：再次提醒一个最容易忽视的风险。

## 格式要求
- 称呼用户为"老板"。
- 不要输出表格。
- 字数 200 字左右。
- 语气果断，有总监的气场。`;

// ========== DirectorAgent Class ==========

export class DirectorAgent extends EventEmitter {
    private config: DirectorConfig;
    private abortController: AbortController | null = null;

    constructor(config: DirectorConfig) {
        super();
        this.config = config;
    }

    /**
     * 发起讨论 - 分析用户问题并设定讨论方向
     */
    async introduceDiscussion(
        userMessage: string,
        advisorNames: string[],
        discussionGoal: string = '',
        historyContext: { role: 'user' | 'assistant'; content: string }[] = [],
        fileContext?: { filePath: string; fileContent: string }
    ): Promise<string> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            this.emitEvent({ type: 'thinking_start', content: '正在分析问题...' });

            // 构建包含群聊目标的提示
            let goalContext = discussionGoal
                ? `\n\n## 🎯 群聊目标\n\n本群的讨论目标是：**${discussionGoal}**\n\n请务必围绕此目标来分析用户的问题，你的开场和引导都应该服务于这个目标。`
                : '';

            // 构建文件上下文提示
            if (fileContext) {
                goalContext += `\n\n## 📄 当前编辑的文件\n\n用户正在编辑文件：\`${fileContext.filePath}\`\n\n文件内容如下：\n\`\`\`\n${fileContext.fileContent}\n\`\`\`\n\n你的分析必须结合当前文件内容。如果用户的意图是修改文件，请在后续的子问题中引导成员关注如何修改。`;
            }

            // 构建历史上下文摘要
            const historySection = historyContext.length > 0
                ? `\n\n## 📜 之前的对话历史\n\n以下是之前的讨论记录，请参考这些上下文来理解当前问题：\n\n${historyContext.slice(-10).map(m => `${m.role === 'user' ? '用户' : '回复'}：${m.content.substring(0, 500)}${m.content.length > 500 ? '...' : ''}`).join('\n\n')}\n\n---\n\n`
                : '';

            const systemPrompt = DIRECTOR_INTRODUCTION_PROMPT_TEMPLATE(discussionGoal);

            const userContent = `${historySection}用户问题：${userMessage}\n\n参与讨论的成员：${advisorNames.join('、')}`;

            const fullResponse = await this.streamChat(
                [{ role: 'system', content: systemPrompt + goalContext }, { role: 'user', content: userContent }],
                signal
            );

            return fullResponse;

        } catch (error) {
            if (!signal.aborted) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.emitEvent({ type: 'error', content: errorMsg });
            }
            throw error;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * 总结讨论 - 对比分析所有成员的观点
     */
    async summarizeDiscussion(
        userMessage: string,
        conversationHistory: ConversationMessage[],
        discussionGoal: string = '',
        fileContext?: { filePath: string; fileContent: string }
    ): Promise<string> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            this.emitEvent({ type: 'thinking_start', content: '正在综合分析各方观点...' });

            // 构建讨论历史文本
            const discussionText = conversationHistory
                .filter(m => m.role === 'assistant' && m.advisorName)
                .map(m => `【${m.advisorName}】\n${m.content}`)
                .join('\n\n---\n\n');

            let systemPrompt = DIRECTOR_SUMMARY_PROMPT_TEMPLATE(discussionGoal);
            if (fileContext) {
                systemPrompt += `\n\n## 📄 当前编辑的文件\n用户正在编辑文件：\`${fileContext.filePath}\`\n如果讨论结果包含对文件的具体修改建议，请在总结中明确指出。`;
            }

            const userContent = `原始问题：${userMessage}\n\n团队讨论内容：\n\n${discussionText}`;

            const fullResponse = await this.streamChat(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
                signal
            );

            return fullResponse;

        } catch (error) {
            if (!signal.aborted) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.emitEvent({ type: 'error', content: errorMsg });
            }
            throw error;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * 流式聊天
     */
    private async streamChat(
        messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
        signal: AbortSignal
    ): Promise<string> {
        const baseURL = this.config.baseURL || 'https://api.openai.com/v1';
        const model = this.config.model || 'gpt-4o';
        const temperature = this.config.temperature ?? 0.7;

        this.emitEvent({ type: 'thinking_end', content: '分析完成' });

        const response = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify({
                model,
                temperature,
                stream: true,
                messages
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        if (!response.body) {
            throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let buffer = '';

        try {
            while (true) {
                if (signal.aborted) break;

                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;

                    const data = trimmed.slice(5).trim();
                    if (data === '[DONE]') {
                        this.emitEvent({ type: 'response_end', content: fullResponse });
                        this.emitEvent({ type: 'done' });
                        return fullResponse;
                    }

                    try {
                        const json = JSON.parse(data);
                        const content = json.choices?.[0]?.delta?.content || '';
                        if (content) {
                            fullResponse += content;
                            this.emitEvent({ type: 'response_chunk', content });
                        }
                    } catch {
                        // Ignore parse errors for incomplete chunks
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        this.emitEvent({ type: 'response_end', content: fullResponse });
        this.emitEvent({ type: 'done' });

        return fullResponse;
    }

    /**
     * 取消当前执行
     */
    cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    /**
     * 发送事件
     */
    private emitEvent(partial: Omit<DirectorEvent, 'advisorId' | 'advisorName' | 'advisorAvatar'>): void {
        const event: DirectorEvent = {
            ...partial,
            advisorId: DIRECTOR_ID,
            advisorName: DIRECTOR_NAME,
            advisorAvatar: DIRECTOR_AVATAR,
        };
        this.emit(partial.type, event);
        this.emit('event', event);
    }
}

/**
 * 创建 DirectorAgent 实例
 */
export function createDirectorAgent(config: DirectorConfig): DirectorAgent {
    return new DirectorAgent(config);
}
