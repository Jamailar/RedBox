/**
 * Agent Executor - Agent 执行器核心
 *
 * 负责管理 Agent 的执行循环、工具调用、消息处理
 * 不再依赖 LangChain，使用 OpenAI 直接 API
 */

import { ToolRegistry, ToolExecutor, type ToolCallRequest, type ToolCallResponse, type ToolConfirmationDetails, ToolConfirmationOutcome } from './toolRegistry';
import { SkillManager } from './skillManager';
import { getCoreSystemPrompt } from './prompts/systemPrompt';
import { createBuiltinTools } from './tools';

// ========== Types ==========

/**
 * Agent 配置
 */
export interface AgentConfig {
    /** API Key */
    apiKey: string;
    /** API Base URL */
    baseURL: string;
    /** 模型名称 */
    model: string;
    /** 最大轮次 */
    maxTurns?: number;
    /** 最大执行时间（分钟） */
    maxTimeMinutes?: number;
    /** 项目根目录（用于发现项目技能） */
    projectRoot?: string;
    /** 温度参数 */
    temperature?: number;
}

/**
 * Agent 事件类型
 */
export type AgentEvent =
    | { type: 'thinking'; content: string }
    | { type: 'thought_chunk'; content: string }
    | { type: 'tool_start'; callId: string; name: string; params: unknown; description: string }
    | { type: 'tool_end'; callId: string; name: string; result: { success: boolean; content: string } }
    | { type: 'tool_output'; callId: string; chunk: string }
    | { type: 'tool_confirm_request'; callId: string; name: string; details: ToolConfirmationDetails }
    | { type: 'response_chunk'; content: string }
    | { type: 'response_end'; content: string }
    | { type: 'skill_activated'; name: string; description: string }
    | { type: 'error'; message: string }
    | { type: 'done'; summary?: string };

/**
 * 工具确认请求的解析器
 */
interface PendingConfirmation {
    callId: string;
    resolve: (outcome: ToolConfirmationOutcome) => void;
}

// ========== Agent Executor Class ==========

/**
 * Agent 执行器
 */
export class AgentExecutor {
    private toolRegistry: ToolRegistry;
    private toolExecutor: ToolExecutor;
    private skillManager: SkillManager;
    private config: AgentConfig;
    private onEvent: (event: AgentEvent) => void;
    private abortController: AbortController | null = null;
    private pendingConfirmations: Map<string, PendingConfirmation> = new Map();
    private activatedSkillContent: string = '';

    constructor(
        config: AgentConfig,
        onEvent: (event: AgentEvent) => void
    ) {
        this.config = config;
        this.onEvent = onEvent;

        // 初始化工具注册表
        this.toolRegistry = new ToolRegistry();
        const builtinTools = createBuiltinTools({ pack: 'full' });
        this.toolRegistry.registerTools(builtinTools);

        // 初始化工具执行器（带确认回调）
        this.toolExecutor = new ToolExecutor(
            this.toolRegistry,
            this.handleConfirmRequest.bind(this)
        );

        // 初始化技能管理器
        this.skillManager = new SkillManager();
    }

    /**
     * 初始化（发现技能等）
     */
    async initialize(): Promise<void> {
        await this.skillManager.discoverSkills(this.config.projectRoot);
    }

    /**
     * 运行 Agent
     */
    async run(message: string): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            // 发送思考状态
            this.onEvent({ type: 'thinking', content: 'Processing your request...' });

            // 生成系统提示词
            const systemPrompt = getCoreSystemPrompt({
                skills: this.skillManager.getSkills(),
                tools: this.toolRegistry.getAllTools(),
                activatedSkillContent: this.activatedSkillContent,
                interactive: true,
            });

            // 初始化消息历史
            const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message },
            ];

            // Agent 循环
            let turnCount = 0;
            const maxTurns = this.config.maxTurns || 20;
            const startTime = Date.now();
            const maxTimeMs = (this.config.maxTimeMinutes || 10) * 60 * 1000;

            while (turnCount < maxTurns) {
                // 检查超时
                if (Date.now() - startTime > maxTimeMs) {
                    this.onEvent({ type: 'error', message: 'Agent execution timed out' });
                    break;
                }

                // 检查取消
                if (signal.aborted) {
                    this.onEvent({ type: 'error', message: 'Agent execution cancelled' });
                    break;
                }

                turnCount++;

                // 调用模型
                const response = await this.callLLM(messages);

                // 处理工具调用
                if (response.tool_calls && response.tool_calls.length > 0) {
                    // 添加 AI 消息到历史
                    messages.push({
                        role: 'assistant',
                        content: response.content || '',
                    });

                    // 执行工具调用
                    const toolResults = await this.executeToolCalls(response.tool_calls, signal);

                    // 添加工具结果到历史
                    for (const result of toolResults) {
                        messages.push({
                            role: 'user',
                            content: result.result.llmContent,
                        });
                    }

                    // 继续循环
                    continue;
                }

                // 没有工具调用，处理最终响应
                const finalContent = response.content || '';

                // 流式发送响应
                this.onEvent({ type: 'response_chunk', content: finalContent });
                this.onEvent({ type: 'response_end', content: finalContent });

                break;
            }

            this.onEvent({ type: 'done' });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.onEvent({ type: 'error', message: errorMessage });
        } finally {
            this.abortController = null;
        }
    }

    /**
     * 调用 LLM
     */
    private async callLLM(messages: { role: string; content: string }[]): Promise<{ content: string; tool_calls?: { id: string; name: string; args: any }[] }> {
        const baseURL = normalizeApiBaseUrl(this.config.baseURL || 'https://api.openai.com/v1', 'https://api.openai.com/v1');
        const model = this.config.model || 'gpt-4o';
        const temperature = this.config.temperature ?? 0.7;

        const toolSchemas = this.toolRegistry.getToolSchemas();

        const response = await fetch(safeUrlJoin(baseURL, '/chat/completions'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify({
                model,
                temperature,
                messages,
                tools: toolSchemas.length > 0 ? toolSchemas : undefined,
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json() as {
            choices?: { message: { content: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]
        };

        const message = data.choices?.[0]?.message;
        return {
            content: message?.content || '',
            tool_calls: message?.tool_calls?.map(tc => ({
                id: tc.id,
                name: tc.function.name,
                args: JSON.parse(tc.function.arguments),
            })),
        };
    }

    /**
     * 执行工具调用
     */
    private async executeToolCalls(
        toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>,
        signal: AbortSignal
    ): Promise<ToolCallResponse[]> {
        const results: ToolCallResponse[] = [];

        for (const toolCall of toolCalls) {
            const callId = toolCall.id || Math.random().toString(36).substring(7);
            const tool = this.toolRegistry.getTool(toolCall.name);

            // 发送工具开始事件
            this.onEvent({
                type: 'tool_start',
                callId,
                name: toolCall.name,
                params: toolCall.args,
                description: tool?.getDescription(toolCall.args) || `Calling ${toolCall.name}`,
            });

            // 特殊处理：skill / activate_skill
            if (toolCall.name === 'activate_skill' || toolCall.name === 'skill') {
                const skillName = toolCall.args.name as string;
                const result = await this.handleActivateSkill(skillName, callId);
                results.push(result);
                continue;
            }

            // 执行工具
            const request: ToolCallRequest = {
                callId,
                name: toolCall.name,
                params: toolCall.args,
            };

            const onOutput = (chunk: string) => {
                this.onEvent({ type: 'tool_output', callId, chunk });
            };

            const response = await this.toolExecutor.execute(request, signal, onOutput);

            // 发送工具结束事件
            this.onEvent({
                type: 'tool_end',
                callId,
                name: toolCall.name,
                result: {
                    success: response.result.success,
                    content: response.result.display || response.result.llmContent,
                },
            });

            results.push(response);
        }

        return results;
    }

    /**
     * 处理技能激活
     */
    private async handleActivateSkill(name: string, callId: string): Promise<ToolCallResponse> {
        const startTime = Date.now();
        const skillContent = await this.skillManager.activateSkill(name);

        if (!skillContent) {
            return {
                callId,
                name: 'skill',
                result: {
                    success: false,
                    llmContent: `Skill "${name}" not found or is disabled.`,
                },
                durationMs: Date.now() - startTime,
            };
        }

        // 保存激活的技能内容
        this.activatedSkillContent = skillContent;

        const skill = this.skillManager.getSkill(name);
        this.onEvent({
            type: 'skill_activated',
            name,
            description: skill?.description || '',
        });

        return {
            callId,
            name: 'skill',
            result: {
                success: true,
                llmContent: skillContent,
            },
            durationMs: Date.now() - startTime,
        };
    }

    /**
     * 处理工具确认请求
     */
    private async handleConfirmRequest(
        callId: string,
        tool: { name: string; displayName: string },
        _params: unknown,
        details: ToolConfirmationDetails
    ): Promise<ToolConfirmationOutcome> {
        return new Promise((resolve) => {
            // 存储待处理的确认
            this.pendingConfirmations.set(callId, { callId, resolve });

            // 发送确认请求事件
            this.onEvent({
                type: 'tool_confirm_request',
                callId,
                name: tool.name,
                details,
            });

            // 设置超时（60秒后自动取消）
            setTimeout(() => {
                if (this.pendingConfirmations.has(callId)) {
                    this.pendingConfirmations.delete(callId);
                    resolve(ToolConfirmationOutcome.Cancel);
                }
            }, 60000);
        });
    }

    /**
     * 响应工具确认（从 UI 调用）
     */
    confirmToolCall(callId: string, outcome: ToolConfirmationOutcome): void {
        const pending = this.pendingConfirmations.get(callId);
        if (pending) {
            this.pendingConfirmations.delete(callId);
            pending.resolve(outcome);
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
     * 获取工具注册表
     */
    getToolRegistry(): ToolRegistry {
        return this.toolRegistry;
    }

    /**
     * 获取技能管理器
     */
    getSkillManager(): SkillManager {
        return this.skillManager;
    }
}

// ========== Factory Function ==========

/**
 * 创建并初始化 Agent 执行器
 */
export async function createAgentExecutor(
    config: AgentConfig,
    onEvent: (event: AgentEvent) => void
): Promise<AgentExecutor> {
    const executor = new AgentExecutor(config, onEvent);
    await executor.initialize();
    return executor;
}
import { normalizeApiBaseUrl, safeUrlJoin } from './urlUtils';
