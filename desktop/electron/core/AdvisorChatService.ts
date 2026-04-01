/**
 * AdvisorChatService - 智囊团聊天服务（统一 QueryRuntime 版本）
 *
 * 专门为智囊团设计的聊天服务，包含：
 * - 思维链展示
 * - 知识库检索 (RAG)
 * - 基础工具支持（计算、文件写入/编辑）
 */

import { EventEmitter } from 'events';
import {
    ToolRegistry,
    ToolExecutor,
    ToolConfirmationOutcome,
} from './toolRegistry';
import {
    addChatMessage,
    type ChatMessage,
    createChatSession,
    getChatMessages,
    getChatSessionByContext,
    searchVectors,
} from '../db';
import { CalculatorTool } from './tools/calculatorTool';
import { WriteFileTool } from './tools/writeFileTool';
import { EditTool } from './tools/editTool';
import { embeddingService } from './vector/EmbeddingService';
import { QueryRuntime } from './queryRuntime';
import { getAgentRuntime, getLongTaskCoordinator } from './ai';

// ========== Types ==========

/**
 * 智囊团聊天配置
 */
export interface AdvisorChatConfig {
    /** API Key */
    apiKey: string;
    /** API Base URL */
    baseURL: string;
    /** 模型名称 */
    model: string;
    /** 智囊团 ID */
    advisorId: string;
    /** 智囊团名称 */
    advisorName: string;
    /** 智囊团头像 */
    advisorAvatar: string;
    /** 系统提示词 */
    systemPrompt: string;
    /** 知识库目录 */
    knowledgeDir?: string;
    /** 最大轮次 */
    maxTurns?: number;
    /** 温度参数 */
    temperature?: number;
}

export interface AdvisorSendOptions {
    ragQuery?: string;
    discussionTask?: string;
}

/**
 * 思维链事件类型
 */
export interface ThinkingEvent {
    type: 'thinking_start' | 'thinking_chunk' | 'thinking_end' |
    'rag_start' | 'rag_result' |
    'tool_start' | 'tool_end' |
    'response_chunk' | 'response_end' |
    'error' | 'done';
    advisorId: string;
    advisorName: string;
    advisorAvatar: string;
    content?: string;
    sources?: string[];
    tool?: {
        name: string;
        params?: unknown;
        result?: { success: boolean; content: string };
    };
}

/**
 * 对话历史消息
 */
interface ChatHistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

// ========== AdvisorChatService Class ==========

/**
 * 智囊团聊天服务
 */
export class AdvisorChatService extends EventEmitter {
    private config: AdvisorChatConfig;
    private toolRegistry: ToolRegistry;
    private toolExecutor: ToolExecutor;
    private abortController: AbortController | null = null;
    private readonly sessionId: string;

    constructor(config: AdvisorChatConfig) {
        super();
        this.config = config;
        this.sessionId = this.ensureSession().id;

        // 初始化工具注册表（仅包含安全工具）
        this.toolRegistry = new ToolRegistry();
        this.toolRegistry.registerTools([
            new CalculatorTool(),
            new WriteFileTool(),
            new EditTool(),
        ]);

        // 初始化工具执行器（智囊团模式默认允许）
        this.toolExecutor = new ToolExecutor(
            this.toolRegistry,
            async () => ToolConfirmationOutcome.ProceedOnce
        );
    }

    /**
     * 发送消息
     */
    async sendMessage(
        message: string,
        history: ChatHistoryMessage[] = [],
        options: AdvisorSendOptions = {},
    ): Promise<string> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            const session = this.ensureSession();
            addChatMessage({
                id: `advisor_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                session_id: session.id,
                role: 'user',
                content: message,
            });

            this.emitEvent({
                type: 'thinking_start',
                content: '正在分析问题...',
            });

            const effectiveHistory = history.length > 0 ? history : this.getStoredHistory();
            const ragContext = await this.performRAG(options.ragQuery || message, signal, effectiveHistory);
            const systemPrompt = this.buildSystemPrompt(ragContext, options);

            this.emitEvent({
                type: 'thinking_chunk',
                content: '基于专业知识和上下文进行深度思考...',
            });

            const fullResponse = await this.runAgentLoop(message, effectiveHistory, systemPrompt, signal);

            addChatMessage({
                id: `advisor_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                session_id: session.id,
                role: 'assistant',
                content: fullResponse,
            });

            this.emitEvent({ type: 'thinking_end', content: '思考完成' });
            this.emitEvent({ type: 'done' });
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
     * 取消执行
     */
    cancel(): void {
        if (this.abortController) {
            this.abortController.abort();
        }
    }

    /**
     * 执行 RAG 检索 (纯向量检索)
     */
    private async performRAG(
        query: string,
        signal: AbortSignal,
        _history: ChatHistoryMessage[] = []
    ): Promise<{ context: string; sources: string[]; reasoning?: string }> {
        if (!this.config.knowledgeDir) {
            return { context: '', sources: [] };
        }

        this.emitEvent({
            type: 'rag_start',
            content: '正在检索知识库...',
        });

        try {
            const queryEmbedding = await embeddingService.embedQuery(query);
            if (signal.aborted) {
                return { context: '', sources: [] };
            }

            const searchResults = searchVectors(queryEmbedding, 5, {
                advisorId: this.config.advisorId
            });

            if (searchResults.length === 0) {
                console.log(`[AdvisorChatService] RAG: No results found for query: "${query}"`);
                this.emitEvent({
                    type: 'rag_result',
                    content: '未检索到相关知识',
                    sources: [],
                });
                return { context: '', sources: [] };
            }

            console.log(`[AdvisorChatService] RAG: Found ${searchResults.length} results for query: "${query}"`);

            const sources = searchResults.map((r: { sourceId: string }) => r.sourceId);
            const context = searchResults
                .map((r: { sourceId: string; content: string }, i: number) => `[参考 ${i + 1}] (${r.sourceId})\n${r.content}`)
                .join('\n\n');

            this.emitEvent({
                type: 'rag_result',
                content: `检索到 ${searchResults.length} 条相关内容`,
                sources,
            });

            return {
                context,
                sources,
                reasoning: `基于当前问题与分工检索了 Top ${searchResults.length} 条相关记录。`
            };
        } catch (error) {
            console.error('[AdvisorChatService] RAG failed:', error);
            return { context: '', sources: [] };
        }
    }

    /**
     * 构建系统提示词
     */
    private buildSystemPrompt(
        ragContext: { context: string; sources: string[]; reasoning?: string },
        options: AdvisorSendOptions = {},
    ): string {
        const parts: string[] = [];

        parts.push(this.config.systemPrompt || `你是 ${this.config.advisorName}，一个专业的智囊团成员。`);

        if (options.discussionTask) {
            parts.push(`
## 你的本轮分工

${options.discussionTask}

要求：
- 优先完成这项分工，不要替其他成员作答。
- 先调用你自己的经验和知识库，再输出观点。
- 最终发言必须直接回应这项分工。`);
        }

        parts.push(`
## 思考方式 (Thinking Process)

在回答前，请像真人一样思考：
1. **意图洞察**：用户真正想问什么？（别看表面，看痛点）
2. **经验调用**：结合下方的【唤醒记忆】，我有类似的经历吗？
3. **观点形成**：基于我的性格，我怎么看这件事？支持还是反对？
4. **语言组织**：用最接地气的话说出来。`);

        if (ragContext.context) {
            let ragSection = `
## 唤醒记忆 (Recalled Experiences)

以下是你脑海中浮现的相关经验和案例（Knowledge Base）：`;

            if (ragContext.reasoning) {
                ragSection += `
（潜意识联想: ${ragContext.reasoning}）`;
            }

            ragSection += `

${ragContext.context}

**重要**：请将这些信息内化为你的直觉和观点，**严禁**直接复述或说"根据资料"、"知识库显示"。要把它们当作你自己的经验来讲。`;

            parts.push(ragSection);
        }

        parts.push(`
## 辅助能力
如果遇到需要精确计算或改写文件的情况，可以调用工具。但请记住，你的核心价值在于你的**观点**和**判断**。`);

        return parts.join('\n\n');
    }

    private historyToRuntimeMessages(history: ChatHistoryMessage[]) {
        return history.slice(-10).map((msg) => ({
            role: msg.role,
            content: msg.content,
        })) as Array<{ role: 'user' | 'assistant'; content: string }>;
    }

    /**
     * 执行 Agent 循环
     */
    private async runAgentLoop(
        message: string,
        history: ChatHistoryMessage[],
        systemPrompt: string,
        signal: AbortSignal
    ): Promise<string> {
        let fullResponse = '';

        const analysis = getAgentRuntime().analyzeRuntimeContext({
            runtimeContext: {
                sessionId: this.sessionId,
                runtimeMode: 'advisor-discussion',
                userInput: message,
                metadata: {
                    contextType: 'advisor-discussion',
                    contextId: this.config.advisorId,
                },
            },
        });

        if (analysis.shouldUseCoordinator) {
            const prepared = await getAgentRuntime().prepareExecution({
                runtimeContext: {
                    sessionId: this.sessionId,
                    runtimeMode: 'advisor-discussion',
                    userInput: message,
                    metadata: {
                        contextType: 'advisor-discussion',
                        contextId: this.config.advisorId,
                    },
                },
                baseSystemPrompt: systemPrompt,
                llm: {
                    apiKey: this.config.apiKey,
                    baseURL: this.config.baseURL,
                    model: this.config.model,
                    timeoutMs: 45000,
                },
            });

            await getLongTaskCoordinator().maybeRun(prepared.task.id, {
                baseSystemPrompt: systemPrompt,
                onRuntimeEvent: (event) => {
                    switch (event.type) {
                        case 'thinking':
                            this.emitEvent({
                                type: 'thinking_chunk',
                                content: event.content,
                            });
                            break;
                        case 'tool_start':
                            this.emitEvent({
                                type: 'tool_start',
                                tool: { name: event.name, params: event.params },
                            });
                            break;
                        case 'tool_end':
                            this.emitEvent({
                                type: 'tool_end',
                                tool: {
                                    name: event.name,
                                    result: {
                                        success: event.result.success,
                                        content: event.result.display || event.result.llmContent || '',
                                    },
                                },
                            });
                            break;
                        case 'response_chunk':
                            fullResponse = event.content;
                            this.emitEvent({ type: 'response_chunk', content: event.content });
                            break;
                        case 'response_end':
                            fullResponse = event.content;
                            this.emitEvent({ type: 'response_end', content: event.content });
                            break;
                        case 'error':
                            this.emitEvent({ type: 'error', content: event.message });
                            break;
                        case 'done':
                            this.emitEvent({ type: 'done' });
                            break;
                        default:
                            break;
                    }
                },
            });
            return fullResponse;
        }

        const runtime = new QueryRuntime(
            this.toolRegistry,
            this.toolExecutor,
            {
                onEvent: (event) => {
                    switch (event.type) {
                        case 'thinking':
                            this.emitEvent({
                                type: 'thinking_chunk',
                                content: event.content,
                            });
                            break;
                        case 'tool_start':
                            this.emitEvent({
                                type: 'tool_start',
                                tool: { name: event.name, params: event.params },
                            });
                            break;
                        case 'tool_end':
                            this.emitEvent({
                                type: 'tool_end',
                                tool: {
                                    name: event.name,
                                    result: {
                                        success: event.result.success,
                                        content: event.result.display || event.result.llmContent || '',
                                    },
                                },
                            });
                            break;
                        case 'response_chunk':
                            fullResponse = event.content;
                            this.emitEvent({ type: 'response_chunk', content: event.content });
                            break;
                        case 'response_end':
                            fullResponse = event.content;
                            this.emitEvent({ type: 'response_end', content: event.content });
                            break;
                        case 'error':
                            this.emitEvent({ type: 'error', content: event.message });
                            break;
                        case 'done':
                            this.emitEvent({ type: 'done' });
                            break;
                        default:
                            break;
                    }
                },
            },
            {
                sessionId: this.sessionId,
                apiKey: this.config.apiKey,
                baseURL: this.config.baseURL,
                model: this.config.model,
                systemPrompt,
                messages: this.historyToRuntimeMessages(history),
                signal,
                maxTurns: this.config.maxTurns || 8,
                maxTimeMinutes: 6,
                temperature: this.config.temperature ?? 0.7,
                toolPack: 'chatroom',
                runtimeMode: 'advisor-discussion',
                interactive: true,
                requiresHumanApproval: Boolean(analysis.route.requiresHumanApproval),
            },
        );

        const result = await runtime.run(message);
        if (result.error) {
            throw new Error(result.error);
        }
        fullResponse = result.response || fullResponse;
        return fullResponse;
    }

    private ensureSession() {
        const existing = getChatSessionByContext(this.config.advisorId, 'advisor-discussion');
        if (existing) {
            return existing;
        }
        return createChatSession(`advisor_${this.config.advisorId}_${Date.now()}`, `Advisor ${this.config.advisorName}`, {
            contextType: 'advisor-discussion',
            contextId: this.config.advisorId,
        });
    }

    private getStoredHistory(): ChatHistoryMessage[] {
        return getChatMessages(this.sessionId)
            .filter((msg): msg is ChatMessage & { role: 'user' | 'assistant' } => msg.role === 'user' || msg.role === 'assistant')
            .slice(-10)
            .map((msg) => ({
                role: msg.role,
                content: msg.content,
            })) as ChatHistoryMessage[];
    }

    /**
     * 发送事件
     */
    private emitEvent(partial: Omit<ThinkingEvent, 'advisorId' | 'advisorName' | 'advisorAvatar'>): void {
        const event: ThinkingEvent = {
            ...partial,
            advisorId: this.config.advisorId,
            advisorName: this.config.advisorName,
            advisorAvatar: this.config.advisorAvatar,
        };
        this.emit(partial.type, event);
        this.emit('event', event);
    }
}

/**
 * 创建智囊团聊天服务实例
 */
export function createAdvisorChatService(config: AdvisorChatConfig): AdvisorChatService {
    return new AdvisorChatService(config);
}
