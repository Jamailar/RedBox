/**
 * ChatService - 通用聊天服务（pi-agent-core 迁移兼容版）
 *
 * 说明：
 * - 旧版依赖 LangChain/LangGraph，现已移除。
 * - 当前主流程已由 PiChatService 承接，此类保留给旧调用方与类型导出。
 */

import { EventEmitter } from 'events';
import {
    ToolRegistry,
    ToolExecutor,
    type ToolConfirmationDetails,
    ToolConfirmationOutcome,
} from './toolRegistry';
import { SkillManager } from './skillManager';
import { createBuiltinTools } from './tools';
import { CompressionService, createCompressionService } from './compressionService';
import { Instance } from './instance';
import { createAgentExecutor, type AgentExecutor, type AgentConfig, type AgentEvent } from './agentExecutor';

// ========== Types ==========

export interface ChatServiceConfig {
    apiKey: string;
    baseURL: string;
    model: string;
    maxTurns?: number;
    maxTimeMinutes?: number;
    projectRoot?: string;
    temperature?: number;
    streaming?: boolean;
    compressionThreshold?: number;
}

export enum StreamingState {
    Idle = 'idle',
    Responding = 'responding',
    WaitingConfirmation = 'waiting_confirmation',
}

export interface HistoryItem {
    id: string;
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string;
    timestamp: number;
    toolCalls?: Array<{
        id: string;
        name: string;
        args: Record<string, unknown>;
    }>;
    toolCallId?: string;
}

export interface ChatServiceEvents {
    'state_change': (state: StreamingState) => void;
    'thinking': (content: string) => void;
    'response_chunk': (content: string) => void;
    'response_end': (content: string) => void;
    'tool_start': (data: { callId: string; name: string; params: unknown; description: string }) => void;
    'tool_end': (data: { callId: string; name: string; result: { success: boolean; content: string } }) => void;
    'tool_output': (data: { callId: string; chunk: string }) => void;
    'tool_confirm_request': (data: { callId: string; name: string; details: ToolConfirmationDetails }) => void;
    'skill_activated': (data: { name: string; description: string }) => void;
    'history_updated': (history: HistoryItem[]) => void;
    'error': (error: { message: string; recoverable?: boolean }) => void;
    'done': () => void;
}

// ========== ChatService ==========

export class ChatService extends EventEmitter {
    private config: ChatServiceConfig;
    private toolRegistry: ToolRegistry;
    private toolExecutor: ToolExecutor;
    private skillManager: SkillManager;
    private compressionService: CompressionService;

    private streamingState: StreamingState = StreamingState.Idle;
    private messageQueue: string[] = [];
    private history: HistoryItem[] = [];
    private currentExecutor: AgentExecutor | null = null;

    constructor(config: ChatServiceConfig) {
        super();
        this.config = config;

        this.toolRegistry = new ToolRegistry();
        this.toolRegistry.registerTools(createBuiltinTools({ chatService: this, pack: 'full' }));

        this.toolExecutor = new ToolExecutor(
            this.toolRegistry,
            this.handleConfirmRequest.bind(this)
        );

        this.skillManager = new SkillManager();
        if (config.projectRoot) {
            Instance.init(config.projectRoot);
        }

        this.compressionService = createCompressionService({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            model: config.model,
            threshold: config.compressionThreshold,
        });
    }

    async initialize(): Promise<void> {
        await this.skillManager.discoverSkills(this.config.projectRoot);
    }

    async sendMessage(message: string): Promise<void> {
        const trimmed = message.trim();
        if (!trimmed) return;

        if (this.streamingState !== StreamingState.Idle) {
            this.messageQueue.push(trimmed);
            return;
        }

        await this.processMessage(trimmed);
    }

    async restoreHistory(history: HistoryItem[]): Promise<void> {
        this.history = [...history];
        this.emit('history_updated', this.getHistory());
    }

    cancel(): void {
        this.currentExecutor?.cancel();
        this.setStreamingState(StreamingState.Idle);
    }

    confirmToolCall(callId: string, outcome: ToolConfirmationOutcome): void {
        this.currentExecutor?.confirmToolCall(callId, outcome);
    }

    getHistory(): HistoryItem[] {
        return [...this.history];
    }

    clearHistory(): void {
        this.history = [];
        this.emit('history_updated', this.getHistory());
    }

    getState(): StreamingState {
        return this.streamingState;
    }

    getToolRegistry(): ToolRegistry {
        return this.toolRegistry;
    }

    getSkillManager(): SkillManager {
        return this.skillManager;
    }

    private async processMessage(message: string): Promise<void> {
        try {
            this.setStreamingState(StreamingState.Responding);
            this.emit('thinking', 'Processing your request...');

            this.addHistoryItem({ role: 'user', content: message });

            const executorConfig: AgentConfig = {
                apiKey: this.config.apiKey,
                baseURL: this.config.baseURL,
                model: this.config.model,
                maxTurns: this.config.maxTurns,
                maxTimeMinutes: this.config.maxTimeMinutes,
                projectRoot: this.config.projectRoot,
                temperature: this.config.temperature,
            };

            this.currentExecutor = await createAgentExecutor(
                executorConfig,
                (event) => this.handleAgentEvent(event)
            );

            await this.currentExecutor.run(this.buildPromptWithHistory(message));
            this.emit('done');
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.emit('error', { message: msg, recoverable: false });
        } finally {
            this.currentExecutor = null;
            this.setStreamingState(StreamingState.Idle);
            this.processQueuedMessages();
        }
    }

    private buildPromptWithHistory(message: string): string {
        const historyContext = this.history
            .slice(-12)
            .filter((h) => h.role !== 'system')
            .map((h) => `${h.role}: ${h.content}`)
            .join('\n');

        if (!historyContext) return message;
        return `Conversation history:\n${historyContext}\n\nCurrent user request:\n${message}`;
    }

    private handleAgentEvent(event: AgentEvent): void {
        switch (event.type) {
            case 'thinking':
                this.emit('thinking', event.content);
                break;

            case 'response_chunk':
                this.emit('response_chunk', event.content);
                break;

            case 'response_end':
                this.addHistoryItem({ role: 'assistant', content: event.content });
                this.emit('response_end', event.content);
                break;

            case 'tool_start':
                this.emit('tool_start', {
                    callId: event.callId,
                    name: event.name,
                    params: event.params,
                    description: event.description,
                });
                break;

            case 'tool_output':
                this.emit('tool_output', { callId: event.callId, chunk: event.chunk });
                break;

            case 'tool_end':
                this.addHistoryItem({
                    role: 'tool',
                    content: event.result.content,
                    toolCallId: event.callId,
                });
                this.emit('tool_end', {
                    callId: event.callId,
                    name: event.name,
                    result: event.result,
                });
                break;

            case 'tool_confirm_request':
                this.setStreamingState(StreamingState.WaitingConfirmation);
                this.emit('tool_confirm_request', {
                    callId: event.callId,
                    name: event.name,
                    details: event.details,
                });
                break;

            case 'skill_activated':
                this.emit('skill_activated', {
                    name: event.name,
                    description: event.description,
                });
                break;

            case 'error':
                this.emit('error', { message: event.message, recoverable: false });
                break;
        }
    }

    private async handleConfirmRequest(
        callId: string,
        tool: { name: string },
        _params: unknown,
        details: ToolConfirmationDetails
    ): Promise<ToolConfirmationOutcome> {
        this.setStreamingState(StreamingState.WaitingConfirmation);
        this.emit('tool_confirm_request', {
            callId,
            name: tool.name,
            details,
        });
        // 兼容旧接口：默认自动放行一次，真实确认由外部触发 confirmToolCall。
        return ToolConfirmationOutcome.ProceedOnce;
    }

    private processQueuedMessages(): void {
        if (this.messageQueue.length === 0 || this.streamingState !== StreamingState.Idle) {
            return;
        }
        const next = this.messageQueue.shift();
        if (next) {
            void this.processMessage(next);
        }
    }

    private setStreamingState(state: StreamingState): void {
        if (this.streamingState !== state) {
            this.streamingState = state;
            this.emit('state_change', state);
        }
    }

    private addHistoryItem(item: Omit<HistoryItem, 'id' | 'timestamp'>): void {
        const historyItem: HistoryItem = {
            ...item,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            timestamp: Date.now(),
        };
        this.history.push(historyItem);
        this.emit('history_updated', this.getHistory());
    }
}

// ========== Factory ==========

export async function createChatService(config: ChatServiceConfig): Promise<ChatService> {
    const service = new ChatService(config);
    await service.initialize();
    return service;
}
