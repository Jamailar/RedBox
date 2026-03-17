/**
 * AdvisorChatService - 智囊团聊天服务（pi-agent-core 版本）
 *
 * 专门为智囊团设计的聊天服务，包含：
 * - 思维链展示
 * - 知识库检索 (RAG)
 * - 基础工具支持（计算、文件写入/编辑）
 */

import { EventEmitter } from 'events';
import { Agent, type AgentEvent, type AgentTool } from '@mariozechner/pi-agent-core';
import { getModel, type Model } from '@mariozechner/pi-ai';
import {
    ToolRegistry,
    ToolExecutor,
    type ToolCallRequest,
    ToolConfirmationOutcome,
    type ToolResult,
} from './toolRegistry';
import { CalculatorTool } from './tools/calculatorTool';
import { WriteFileTool } from './tools/writeFileTool';
import { EditTool } from './tools/editTool';
import { embeddingService } from './vector/EmbeddingService';
import { searchVectors } from '../db';

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

interface AgentTextContent {
    type: 'text';
    text: string;
}

interface AssistantToolCallContent {
    type: 'toolCall';
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

interface AssistantMessageLike {
    role: string;
    content?: Array<AgentTextContent | AssistantToolCallContent | { type: string; [k: string]: unknown }>;
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
    private agent: Agent | null = null;

    constructor(config: AdvisorChatConfig) {
        super();
        this.config = config;

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
        history: ChatHistoryMessage[] = []
    ): Promise<string> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            this.emitEvent({
                type: 'thinking_start',
                content: '正在分析问题...',
            });

            const ragContext = await this.performRAG(message, signal, history);
            const systemPrompt = this.buildSystemPrompt(ragContext);

            this.emitEvent({
                type: 'thinking_chunk',
                content: '基于专业知识和上下文进行深度思考...',
            });

            const fullResponse = await this.runAgentLoop(message, history, systemPrompt, signal);

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
        if (this.agent) {
            this.agent.abort();
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

            const sources = searchResults.map(r => r.sourceId);
            const context = searchResults
                .map((r, i) => `[参考 ${i + 1}] (${r.sourceId})\n${r.content}`)
                .join('\n\n');

            this.emitEvent({
                type: 'rag_result',
                content: `检索到 ${searchResults.length} 条相关内容`,
                sources,
            });

            return {
                context,
                sources,
                reasoning: `基于语义相似度检索了 Top ${searchResults.length} 条相关记录。`
            };
        } catch (error) {
            console.error('[AdvisorChatService] RAG failed:', error);
            return { context: '', sources: [] };
        }
    }

    /**
     * 构建系统提示词
     */
    private buildSystemPrompt(ragContext: { context: string; sources: string[]; reasoning?: string }): string {
        const parts: string[] = [];

        parts.push(this.config.systemPrompt || `你是 ${this.config.advisorName}，一个专业的智囊团成员。`);

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

    private createModelWithBaseUrl(): Model<any> {
        const requestedModel = (this.config.model || 'gpt-4o').trim();
        const resolvedBaseUrl = (this.config.baseURL || 'https://api.openai.com/v1').trim();
        const isOfficialOpenAI = this.isOfficialOpenAIEndpoint(resolvedBaseUrl);

        if (isOfficialOpenAI) {
            const resolved = getModel('openai', requestedModel as any) as (Model<any> & { baseUrl?: string }) | undefined;
            if (resolved) {
                return {
                    ...resolved,
                    baseUrl: resolvedBaseUrl || resolved.baseUrl,
                };
            }

            const fallback = getModel('openai', 'gpt-4o' as any) as (Model<any> & { baseUrl?: string }) | undefined;
            if (fallback) {
                console.warn(`[AdvisorChatService] Unknown OpenAI model "${requestedModel}", fallback to gpt-4o`);
                return {
                    ...fallback,
                    baseUrl: resolvedBaseUrl || fallback.baseUrl,
                };
            }
        }

        const lower = `${requestedModel} ${resolvedBaseUrl}`.toLowerCase();
        const isQwenFamily = lower.includes('qwen') || lower.includes('dashscope.aliyuncs.com');
        const compat: Record<string, unknown> = {
            supportsStore: false,
            supportsDeveloperRole: false,
            maxTokensField: 'max_tokens',
            supportsReasoningEffort: !isQwenFamily,
        };

        if (isQwenFamily) {
            compat.thinkingFormat = 'qwen';
        }

        return {
            id: requestedModel || 'openai-compatible-model',
            name: `OpenAI-Compatible (${requestedModel || 'model'})`,
            api: 'openai-completions',
            provider: 'openai-compatible',
            baseUrl: resolvedBaseUrl,
            reasoning: true,
            input: ['text', 'image'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 16384,
            compat: compat as any,
        } as Model<any>;
    }

    private isOfficialOpenAIEndpoint(baseURL: string): boolean {
        try {
            const url = new URL(baseURL);
            return url.hostname === 'api.openai.com';
        } catch {
            return false;
        }
    }

    private createAgentTools(signal: AbortSignal): AgentTool[] {
        const schemaMap = new Map<string, unknown>();
        for (const schema of this.toolRegistry.getToolSchemas()) {
            schemaMap.set(schema.function.name, schema.function.parameters);
        }

        return this.toolRegistry.getAllTools().map((tool) => ({
            name: tool.name,
            label: tool.displayName || tool.name,
            description: tool.description,
            parameters: (schemaMap.get(tool.name) || {
                type: 'object',
                properties: {},
                additionalProperties: false,
            }) as any,
            execute: async (toolCallId: string, params: Record<string, unknown>) => {
                const request: ToolCallRequest = {
                    callId: toolCallId,
                    name: tool.name,
                    params,
                };
                const response = await this.toolExecutor.execute(request, signal);
                return this.toolResultToAgentResult(response.result);
            },
        })) as AgentTool[];
    }

    private toolResultToAgentResult(result: ToolResult) {
        const text = result.display || result.llmContent || '';
        return {
            content: [{ type: 'text' as const, text }],
            details: result,
        };
    }

    private historyToAgentMessages(history: ChatHistoryMessage[]) {
        return history.slice(-10).map((msg) => ({
            role: msg.role,
            content: [{ type: 'text', text: msg.content }],
            timestamp: Date.now(),
        })) as any[];
    }

    private extractTextFromAssistantMessage(message: AssistantMessageLike | null | undefined): string {
        if (!message || !Array.isArray(message.content)) return '';
        return message.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as AgentTextContent).text || '')
            .join('');
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
        let emittedEnd = false;

        this.agent = new Agent({
            initialState: {
                model: this.createModelWithBaseUrl(),
                thinkingLevel: 'off',
            },
            getApiKey: async () => this.config.apiKey,
        });
        this.agent.setSystemPrompt(systemPrompt);
        this.agent.setTools(this.createAgentTools(signal));
        this.agent.replaceMessages(this.historyToAgentMessages(history));

        const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
            if (signal.aborted) return;

            switch (event.type) {
                case 'message_update':
                    if (event.assistantMessageEvent.type === 'text_delta') {
                        fullResponse += event.assistantMessageEvent.delta;
                        this.emitEvent({ type: 'response_chunk', content: event.assistantMessageEvent.delta });
                    }
                    break;

                case 'message_end': {
                    const msg = event.message as AssistantMessageLike;
                    if (msg.role === 'assistant' && !fullResponse) {
                        const text = this.extractTextFromAssistantMessage(msg);
                        if (text) {
                            fullResponse = text;
                            this.emitEvent({ type: 'response_chunk', content: text });
                        }
                    }
                    break;
                }

                case 'tool_execution_start':
                    this.emitEvent({
                        type: 'tool_start',
                        tool: { name: event.toolName, params: event.args },
                    });
                    break;

                case 'tool_execution_end': {
                    const result = event.result as ToolResult | undefined;
                    const content = result?.display || result?.llmContent || '';
                    this.emitEvent({
                        type: 'tool_end',
                        tool: {
                            name: event.toolName,
                            result: {
                                success: !event.isError,
                                content,
                            },
                        },
                    });
                    break;
                }

                case 'agent_end':
                    if (!emittedEnd) {
                        this.emitEvent({ type: 'response_end', content: fullResponse });
                        emittedEnd = true;
                    }
                    break;
            }
        });

        try {
            await this.agent.prompt(message);
            await this.agent.waitForIdle();
        } finally {
            unsubscribe();
        }

        if (!emittedEnd) {
            this.emitEvent({ type: 'response_end', content: fullResponse });
        }

        return fullResponse;
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
