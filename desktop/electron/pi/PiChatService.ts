/**
 * PiChatService - 基于 pi-agent-core 的聊天服务
 *
 * 主聊天与知识库聊天统一走这里。
 */

import { BrowserWindow } from 'electron';
import { Agent, type AgentEvent, type AgentTool } from '@mariozechner/pi-agent-core';
import { getModel, type Model } from '@mariozechner/pi-ai';
import {
  getSettings,
  addChatMessage,
  getWorkspacePaths,
  getChatSession,
  getChatMessages,
  updateChatSessionMetadata,
} from '../db';
import { SkillManager } from '../core/skillManager';
import { Instance } from '../core/instance';
import {
  ToolRegistry,
  ToolExecutor,
  type ToolCallRequest,
  ToolConfirmationOutcome,
  type ToolResult,
} from '../core/toolRegistry';
import { createBuiltinTools } from '../core/tools';
import { createCompressionService } from '../core/compressionService';
import { getLongTermMemoryPrompt } from '../core/fileMemoryStore';
import { getRedClawProjectContextPrompt } from '../core/redclawStore';

interface SessionMetadata {
  associatedFilePath?: string;
  associatedFileId?: string;
  contextId?: string;
  contextType?: string;
  contextContent?: string;
  isContextBound?: boolean;
  compactSummary?: string;
  compactBaseMessageCount?: number;
  compactRounds?: number;
  compactUpdatedAt?: string;
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
  role?: string;
  content?: Array<AgentTextContent | AssistantToolCallContent | { type: string; [k: string]: unknown }>;
}

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface AgentRunResult {
  response: string;
  error?: string;
}

interface CompactContextResult {
  success: boolean;
  compacted: boolean;
  message: string;
  compactRounds?: number;
  compactUpdatedAt?: string;
}

const DEFAULT_REDCLAW_AUTO_COMPACT_TOKENS = 256000;

export class PiChatService {
  private window: BrowserWindow | null = null;
  private abortController: AbortController | null = null;
  private sessionId: string;
  private skillManager: SkillManager;
  private agent: Agent | null = null;
  private unsubscribeAgentEvents: (() => void) | null = null;
  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;

  constructor() {
    this.sessionId = `session_${Date.now()}`;
    this.skillManager = new SkillManager();

    this.toolRegistry = new ToolRegistry();
    const tools = createBuiltinTools().filter((tool) => tool.name !== 'explore_workspace');
    this.toolRegistry.registerTools(tools);
    this.toolExecutor = new ToolExecutor(
      this.toolRegistry,
      async () => ToolConfirmationOutcome.ProceedOnce,
    );
  }

  setWindow(window: BrowserWindow) {
    this.window = window;
  }

  getSkillManager() {
    return this.skillManager;
  }

  private sendToUI(channel: string, data: unknown) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    try {
      this.window.webContents.send(channel, data);
    } catch (error) {
      console.error(`[PiChatService] Failed to send event: ${channel}`, error);
    }
  }

  private previewForLog(value: unknown, maxLength = 500): string {
    try {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (!text) return '';
      return text.length > maxLength ? `${text.slice(0, maxLength)}...<truncated>` : text;
    } catch {
      return String(value);
    }
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.agent) {
      this.agent.abort();
    }
  }

  clearHistory() {
    this.sessionId = `session_${Date.now()}`;
    this.skillManager.resetActiveSkills();

    if (this.agent) {
      this.agent.clearMessages();
    }

    this.sendToUI('chat:response-chunk', { content: '\n\n[System] 对话历史已清除。\n' });
  }

  async compactContextNow(sessionId: string): Promise<CompactContextResult> {
    const metadata = this.getSessionMetadata(sessionId);
    if (metadata.contextType !== 'redclaw') {
      return {
        success: false,
        compacted: false,
        message: '当前会话不是 RedClaw 上下文会话，无法手动 compact。',
      };
    }

    const settings = (getSettings() || {}) as Record<string, unknown>;
    const apiKey = (settings.api_key as string) || (settings.openaiApiKey as string) || process.env.OPENAI_API_KEY || '';
    const baseURL = (settings.api_endpoint as string) || (settings.openaiApiBase as string) || 'https://api.openai.com/v1';
    const modelName = (settings.model_name as string) || (settings.openaiModel as string) || 'gpt-4o';

    if (!apiKey) {
      return {
        success: false,
        compacted: false,
        message: 'API Key 未配置，无法执行上下文压缩。',
      };
    }

    const model = this.createModelWithBaseUrl(modelName, baseURL);
    const beforeRounds = metadata.compactRounds || 0;
    const nextMetadata = await this.maybeCompactContext({
      sessionId,
      currentInput: '',
      metadata,
      apiKey,
      baseURL,
      modelName,
      contextWindow: this.getModelContextWindow(model),
      redClawCompactTargetTokens: this.getRedClawCompactTargetTokens(settings),
      force: true,
    });

    const compacted = (nextMetadata.compactRounds || 0) > beforeRounds;
    return {
      success: true,
      compacted,
      message: compacted ? '上下文已压缩。' : '当前上下文暂无可压缩内容。',
      compactRounds: nextMetadata.compactRounds,
      compactUpdatedAt: nextMetadata.compactUpdatedAt,
    };
  }

  async sendMessage(content: string, sessionId: string) {
    this.sessionId = sessionId;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const settings = (getSettings() || {}) as Record<string, unknown>;
    const apiKey = (settings.api_key as string) || (settings.openaiApiKey as string) || process.env.OPENAI_API_KEY || '';
    const baseURL = (settings.api_endpoint as string) || (settings.openaiApiBase as string) || 'https://api.openai.com/v1';
    const modelName = (settings.model_name as string) || (settings.openaiModel as string) || 'gpt-4o';

    if (!apiKey) {
      this.sendToUI('chat:error', { message: 'API Key 未配置' });
      this.sendToUI('chat:done', {});
      return;
    }

    const workspacePaths = getWorkspacePaths();
    const workspace = workspacePaths.base;
    Instance.init(workspace);

    try {
      await this.ensureSkillsDiscovered(workspace);
    } catch (error) {
      console.warn('[PiChatService] Failed to load skills:', error);
    }

    const model = this.createModelWithBaseUrl(modelName, baseURL);
    const redClawCompactTargetTokens = this.getRedClawCompactTargetTokens(settings);
    let metadata = this.getSessionMetadata(sessionId);
    metadata = await this.maybeCompactContext({
      sessionId,
      currentInput: content,
      metadata,
      apiKey,
      baseURL,
      modelName,
      contextWindow: this.getModelContextWindow(model),
      redClawCompactTargetTokens,
    });
    const longTermMemory = await this.loadLongTermMemoryContext();
    const redClawProjectContext = await this.loadRedClawProjectContext(metadata);
    const systemPrompt = this.buildSystemPrompt(workspacePaths, metadata, longTermMemory, redClawProjectContext);
    const history = this.historyToAgentMessages(sessionId, content, metadata);
    console.log('[PiChatService] sendMessage', {
      sessionId,
      modelName,
      baseURL,
      hasApiKey: Boolean(apiKey),
      historyCount: history.length,
      isContextBound: Boolean(metadata.isContextBound),
      compacted: Boolean(metadata.compactSummary),
      workspaceBase: workspacePaths.base,
      manuscriptsPath: workspacePaths.manuscripts,
      redClawCompactTargetTokens,
    });

    try {
      const runResult = await this.runAgentAttempt({
        model,
        apiKey,
        prompt: systemPrompt,
        history,
        userInput: content,
        signal,
      });

      const finalError = runResult.error || '';
      if (finalError) {
        console.error('[PiChatService] Agent completed with error state:', finalError);
        this.sendToUI('chat:error', { message: finalError });
        return;
      }

      const fullResponse = runResult.response || '';
      if (fullResponse) {
        addChatMessage({
          id: `msg_${Date.now()}`,
          session_id: sessionId,
          role: 'assistant',
          content: fullResponse,
        });
      }

      this.sendToUI('chat:response-end', { content: fullResponse });
    } catch (error: unknown) {
      if (!signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[PiChatService] Error:', errorMessage);
        this.sendToUI('chat:error', { message: errorMessage });
      }
    } finally {
      this.cleanupAgentSubscription();
      this.abortController = null;
      this.sendToUI('chat:done', {});
    }
  }

  private cleanupAgentSubscription() {
    if (this.unsubscribeAgentEvents) {
      this.unsubscribeAgentEvents();
      this.unsubscribeAgentEvents = null;
    }
  }

  private async runAgentAttempt(params: {
    model: Model<any>;
    apiKey: string;
    prompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }>; timestamp: number }>;
    userInput: string;
    signal: AbortSignal;
  }): Promise<AgentRunResult> {
    const { model, apiKey, prompt, history, userInput, signal } = params;
    const runtime = {
      response: '',
    };

    this.agent = this.createAgent(model, apiKey, prompt, history, signal);

    this.cleanupAgentSubscription();
    this.unsubscribeAgentEvents = this.agent.subscribe((event: AgentEvent) => {
      if (signal.aborted) return;

      switch (event.type) {
        case 'message_update':
          if (event.assistantMessageEvent.type === 'thinking_start') {
            this.sendToUI('chat:thought-start', {});
            break;
          }
          if (event.assistantMessageEvent.type === 'thinking_delta') {
            this.sendToUI('chat:thought-delta', { content: event.assistantMessageEvent.delta || '' });
            break;
          }
          if (event.assistantMessageEvent.type === 'thinking_end') {
            this.sendToUI('chat:thought-end', {});
            break;
          }
          if (event.assistantMessageEvent.type === 'text_delta') {
            const delta = event.assistantMessageEvent.delta;
            if (delta) {
              runtime.response += delta;
              this.sendToUI('chat:response-chunk', { content: delta });
            }
          }
          break;

        case 'message_end': {
          const msg = event.message as AssistantMessageLike;
          if (msg.role === 'assistant' && !runtime.response) {
            const text = this.extractText(msg.content);
            if (text) {
              runtime.response = text;
              this.sendToUI('chat:response-chunk', { content: text });
            }
          }
          break;
        }

        case 'tool_execution_start':
          console.log('[PiChatService] tool:start', {
            sessionId: this.sessionId,
            callId: event.toolCallId,
            name: event.toolName,
            args: this.previewForLog(event.args),
          });
          this.sendToUI('chat:tool-start', {
            callId: event.toolCallId,
            name: event.toolName,
            input: event.args,
            description: `执行工具: ${event.toolName}`,
          });
          break;

        case 'tool_execution_end': {
          const output = this.toolExecutionToOutput(event.result, event.isError);
          console.log('[PiChatService] tool:end', {
            sessionId: this.sessionId,
            callId: event.toolCallId,
            name: event.toolName,
            isError: event.isError,
            success: output.success,
            outputPreview: this.previewForLog(output.content),
          });
          this.sendToUI('chat:tool-end', {
            callId: event.toolCallId,
            name: event.toolName,
            output,
          });
          break;
        }

        case 'turn_end': {
          const msg = event.message as { role?: string; errorMessage?: string } | undefined;
          if (msg?.role === 'assistant' && msg.errorMessage) {
            console.error('[PiChatService] turn_end error:', msg.errorMessage);
          }
          break;
        }
      }
    });

    try {
      await this.agent.prompt(userInput);
      await this.agent.waitForIdle();

      if (!runtime.response) {
        runtime.response = this.getLastAssistantMessage(this.agent.state.messages as unknown[]);
      }

      const stateError = (this.agent.state as { error?: string }).error;
      const assistantError = this.getLastAssistantError(this.agent.state.messages as unknown[]);
      const finalError = assistantError || stateError;

      return {
        response: runtime.response,
        error: finalError || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        response: runtime.response,
        error: message,
      };
    }
  }

  private createAgent(
    model: Model<any>,
    apiKey: string,
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }>; timestamp: number }>,
    signal: AbortSignal,
  ): Agent {
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
      },
      getApiKey: async () => apiKey,
    });

    agent.setSystemPrompt(systemPrompt);
    agent.setTools(this.createAgentTools(signal));
    agent.replaceMessages(history as any[]);

    return agent;
  }

  private async ensureSkillsDiscovered(workspace: string): Promise<void> {
    await this.skillManager.discoverSkills(workspace);
  }

  private createModelWithBaseUrl(modelName: string, baseURL: string): Model<any> {
    const requestedModel = (modelName || 'gpt-4o').trim();
    const resolvedBaseUrl = (baseURL || 'https://api.openai.com/v1').trim();
    const isOfficialOpenAI = this.isOfficialOpenAIEndpoint(resolvedBaseUrl);

    if (isOfficialOpenAI) {
      const resolved = getModel('openai', requestedModel as any) as (Model<any> & { baseUrl?: string }) | undefined;
      if (resolved) {
        console.log('[PiChatService] model-resolved', { mode: 'openai-official', modelId: resolved.id, api: resolved.api });
        return {
          ...resolved,
          baseUrl: resolvedBaseUrl || resolved.baseUrl,
        };
      }

      const fallback = getModel('openai', 'gpt-4o' as any) as (Model<any> & { baseUrl?: string }) | undefined;
      if (fallback) {
        console.warn(`[PiChatService] Unknown OpenAI model "${requestedModel}", fallback to gpt-4o`);
        console.log('[PiChatService] model-resolved', { mode: 'openai-fallback', modelId: fallback.id, api: fallback.api });
        return {
          ...fallback,
          baseUrl: resolvedBaseUrl || fallback.baseUrl,
        };
      }
    }

    // OpenAI-compatible endpoint (DashScope/Ollama/vLLM/LiteLLM etc.)
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

    const customModel = {
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

    console.log('[PiChatService] model-resolved', {
      mode: 'openai-compatible',
      modelId: customModel.id,
      api: customModel.api,
      baseUrl: customModel.baseUrl,
      compat: customModel.compat,
    });

    return customModel;
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

    const tools = this.toolRegistry.getAllTools().map((tool) => ({
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

    tools.push({
      name: 'activate_skill',
      label: 'Activate Skill',
      description: '激活指定技能并将技能指令注入当前会话。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      } as any,
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const skillName = typeof params.name === 'string' ? params.name : '';
        const activated = skillName ? this.skillManager.activateSkill(skillName) : null;

        if (activated) {
          this.sendToUI('chat:skill-activated', {
            name: skillName,
            description: `技能 ${skillName} 已激活`,
          });
          return {
            content: [{ type: 'text' as const, text: activated }],
            details: { success: true },
          };
        }

        return {
          content: [{ type: 'text' as const, text: `Skill "${skillName}" not found or disabled.` }],
          details: { success: false },
        };
      },
    } as AgentTool);

    return tools;
  }

  private toolResultToAgentResult(result: ToolResult) {
    const text = result.llmContent || result.display || result.error?.message || '';
    return {
      content: [{ type: 'text' as const, text }],
      details: result,
    };
  }

  private toolExecutionToOutput(result: unknown, isError: boolean): { success: boolean; content: string } {
    const wrapped = result as { details?: ToolResult; content?: unknown } | undefined;
    const details = wrapped?.details;

    if (details) {
      return {
        success: !isError && details.success !== false,
        content: details.llmContent || details.display || details.error?.message || '',
      };
    }

    return {
      success: !isError,
      content: this.extractText(wrapped?.content),
    };
  }

  private getSessionMetadata(sessionId: string): SessionMetadata {
    const session = getChatSession(sessionId);
    if (!session?.metadata) {
      return {};
    }

    try {
      return JSON.parse(session.metadata) as SessionMetadata;
    } catch {
      return {};
    }
  }

  private getHistoryMessages(sessionId: string, currentInput: string): HistoryMessage[] {
    const history = getChatMessages(sessionId)
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: msg.timestamp || Date.now(),
      }));

    if (history.length > 0) {
      const last = history[history.length - 1];
      if (last.role === 'user' && last.content === currentInput) {
        history.pop();
      }
    }

    return history;
  }

  private historyToAgentMessages(
    sessionId: string,
    currentInput: string,
    metadata?: SessionMetadata
  ): Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }>; timestamp: number }> {
    const history = this.getHistoryMessages(sessionId, currentInput);
    let selected: HistoryMessage[] = history.slice(-30);

    if (metadata?.contextType === 'redclaw') {
      const compactBase = Math.max(0, Math.min(history.length, metadata.compactBaseMessageCount || 0));
      selected = history.slice(compactBase).slice(-80);
    }

    return selected.map((msg) => ({
      role: msg.role,
      content: [{ type: 'text' as const, text: msg.content }],
      timestamp: msg.timestamp,
    }));
  }

  private estimateTokenCountFromText(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private estimateTokenCountForHistory(messages: HistoryMessage[]): number {
    return messages.reduce((acc, msg) => acc + this.estimateTokenCountFromText(msg.content), 0);
  }

  private getModelContextWindow(model: Model<any>): number {
    const contextWindow = Number((model as { contextWindow?: number }).contextWindow);
    if (Number.isFinite(contextWindow) && contextWindow > 0) {
      return contextWindow;
    }
    return 128000;
  }

  private async maybeCompactContext(params: {
    sessionId: string;
    currentInput: string;
    metadata: SessionMetadata;
    apiKey: string;
    baseURL: string;
    modelName: string;
    contextWindow: number;
    redClawCompactTargetTokens?: number;
    force?: boolean;
  }): Promise<SessionMetadata> {
    const {
      sessionId,
      currentInput,
      apiKey,
      baseURL,
      modelName,
      contextWindow,
      redClawCompactTargetTokens,
      force = false,
    } = params;
    const metadata = { ...params.metadata };

    if (metadata.contextType !== 'redclaw') {
      return metadata;
    }

    const history = this.getHistoryMessages(sessionId, currentInput);
    if (!force && history.length < 20) {
      return metadata;
    }
    if (force && history.length < 6) {
      return metadata;
    }

    const compactBaseCount = Math.max(0, Math.min(history.length, metadata.compactBaseMessageCount || 0));
    const compactSummaryTokens = metadata.compactSummary ? this.estimateTokenCountFromText(metadata.compactSummary) : 0;
    const activeHistory = history.slice(compactBaseCount);
    const estimatedTotal = this.estimateTokenCountForHistory(activeHistory) + compactSummaryTokens;
    const compactThreshold = this.getRedClawCompactThreshold(contextWindow, redClawCompactTargetTokens);

    if (!force && estimatedTotal < compactThreshold) {
      return metadata;
    }

    const recentKeepCount = force ? 8 : 16;
    let compactUntil = Math.max(0, history.length - recentKeepCount);
    if (force && compactUntil <= compactBaseCount) {
      compactUntil = Math.max(compactBaseCount + 1, history.length - 2);
    }
    if (compactUntil <= compactBaseCount) {
      return metadata;
    }

    const deltaMessages = history.slice(compactBaseCount, compactUntil);
    if (deltaMessages.length < (force ? 2 : 6)) {
      return metadata;
    }

    const messagesForCompression = [
      ...(metadata.compactSummary ? [{ role: 'system', content: `Previous compact summary:\n${metadata.compactSummary}` }] : []),
      ...deltaMessages.map((msg) => ({ role: msg.role, content: msg.content })),
    ];

    const compressor = createCompressionService({
      apiKey,
      baseURL,
      model: modelName,
      threshold: 1,
    });

    try {
      const result = await compressor.compress(messagesForCompression);
      const summary = result.summary?.trim();
      if (!summary) {
        return metadata;
      }

      const nextMetadata: SessionMetadata = {
        ...metadata,
        compactSummary: summary,
        compactBaseMessageCount: compactUntil,
        compactRounds: (metadata.compactRounds || 0) + 1,
        compactUpdatedAt: new Date().toISOString(),
      };
      updateChatSessionMetadata(sessionId, nextMetadata as Record<string, unknown>);
      console.log('[PiChatService] context-compacted', {
        sessionId,
        compactUntil,
        compactRounds: nextMetadata.compactRounds,
      });
      return nextMetadata;
    } catch (error) {
      console.error('[PiChatService] context compact failed:', error);
      return metadata;
    }
  }

  private getRedClawCompactTargetTokens(settings: Record<string, unknown>): number {
    const raw = settings.redclaw_compact_target_tokens ?? settings.redclawCompactTargetTokens;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    return DEFAULT_REDCLAW_AUTO_COMPACT_TOKENS;
  }

  private getRedClawCompactThreshold(contextWindow: number, targetTokens?: number): number {
    const target = Number.isFinite(Number(targetTokens)) && Number(targetTokens) > 0
      ? Math.floor(Number(targetTokens))
      : DEFAULT_REDCLAW_AUTO_COMPACT_TOKENS;

    // 留出安全余量，避免接近模型极限触发 provider 上下文超限。
    const safeUpperBound = Math.max(24000, Math.floor(contextWindow * 0.88));
    return Math.max(16000, Math.min(target, safeUpperBound));
  }

  private getLastAssistantMessage(messages: unknown[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as { role?: string; content?: unknown };
      if (msg.role === 'assistant') {
        const text = this.extractText(msg.content);
        if (text) return text;
      }
    }
    return '';
  }

  private getLastAssistantError(messages: unknown[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i] as { role?: string; errorMessage?: string };
      if (msg.role === 'assistant' && typeof msg.errorMessage === 'string' && msg.errorMessage.trim()) {
        return msg.errorMessage;
      }
    }
    return '';
  }

  private extractText(content: unknown): string {
    if (!content) return '';

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (!item || typeof item !== 'object') return '';
          const value = item as Record<string, unknown>;
          if (typeof value.text === 'string') return value.text;
          if (typeof value.content === 'string') return value.content;
          return '';
        })
        .join('');
    }

    if (typeof content === 'object') {
      const value = content as Record<string, unknown>;
      if (typeof value.text === 'string') return value.text;
      if (typeof value.content === 'string') return value.content;
      try {
        return JSON.stringify(content);
      } catch {
        return '';
      }
    }

    return String(content);
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength)}\n\n[内容过长，已截断]`;
  }

  private async loadLongTermMemoryContext(): Promise<string> {
    try {
      return await getLongTermMemoryPrompt(40);
    } catch (error) {
      console.warn('[PiChatService] Failed to load long-term memory:', error);
      return '';
    }
  }

  private async loadRedClawProjectContext(metadata: SessionMetadata): Promise<string> {
    if (metadata.contextType !== 'redclaw') return '';
    try {
      return await getRedClawProjectContextPrompt(10);
    } catch (error) {
      console.warn('[PiChatService] Failed to load RedClaw projects context:', error);
      return '';
    }
  }

  private buildSystemPrompt(
    workspacePaths: ReturnType<typeof getWorkspacePaths>,
    metadata: SessionMetadata,
    longTermMemory: string,
    redClawProjectContext: string
  ): string {
    const workspace = workspacePaths.base;
    const skillsXml = this.skillManager.getSkillsXml();
    const activeSkills = this.skillManager.getActiveSkills();

    const promptParts: string[] = [
      '# 工作环境',
      `工作目录: ${workspace}`,
      `平台: ${process.platform}`,
      '',
      '## 固定目录结构（无需探索）',
      '你正在一个结构固定的 RedConvert 工作区中，路径如下：',
      `- workspaceRoot: ${workspacePaths.workspaceRoot}`,
      `- currentSpaceRoot: ${workspacePaths.base}`,
      `- skills: ${workspacePaths.skills}`,
      `- knowledge: ${workspacePaths.knowledge}`,
      `- knowledge/redbook: ${workspacePaths.knowledgeRedbook}`,
      `- knowledge/youtube: ${workspacePaths.knowledgeYoutube}`,
      `- advisors: ${workspacePaths.advisors}`,
      `- manuscripts: ${workspacePaths.manuscripts}`,
      `- media: ${workspacePaths.media}`,
      `- redclaw: ${workspacePaths.redclaw}`,
      '',
      '固定目录树（按此定位，不要盲目搜索）：',
      '```',
      '.',
      '├── advisors/',
      '├── knowledge/',
      '│   ├── redbook/',
      '│   └── youtube/',
      '├── manuscripts/',
      '├── media/',
      '├── redclaw/',
      '└── skills/',
      '```',
      '',
      '## 指令',
      '- 你是一个智能助手，擅长分析和解决问题。',
      '- 默认使用中文回复，除非用户明确要求其它语言。',
      '- 回答尽量直接、可执行，必要时再调用工具。',
      '- 执行文件修改或命令前，先明确说明要做什么。',
      '- 你的所有文件操作和命令操作必须严格限制在 currentSpaceRoot 内，禁止访问其外路径。',
      '- 上述目录结构是固定的。除非用户明确要求“查看目录结构/排查文件位置”，否则不要先做 list_dir 或 grep 全盘探索。',
      '- 对文件名/数量/路径/状态这类可验证事实，必须先调用工具读取真实结果，再回答。',
      '- 当用户询问“我有哪些稿件/列出稿件/稿件数量”时，先调用 `app_cli(command="manuscripts list")`，再基于结果回复。',
      '- 这类“列表/数量”回复必须显式包含工具返回的 count 与文件名；若工具报错或为空，需说明“工具返回为空/报错”，禁止臆测。',
      '- 禁止基于历史消息或猜测编造文件列表、数量和目录状态。',
      '- 处理本应用能力（空间、稿件、知识库、智囊团、RedClaw、媒体库、生图、档案、漫步、设置、技能、记忆）时，优先使用 `app_cli` 工具，以 CLI 命令方式操作。',
      '- 只有在 `app_cli` 不覆盖的场景下，才回退到其他文件工具或 bash。',
      '- CLI-first 规则：未来新增功能页必须补充 `app_cli` 子命令，保证可被 AI 自动化调用。',
      '- 你拥有 save_memory 工具：当用户明确给出长期偏好、事实、目标约束时，应保存为长期记忆。',
      '',
      '## app_cli 快速命令示例',
      '- 空间列表: `app_cli(command="spaces list")`',
      '- 稿件列表: `app_cli(command="manuscripts list")`',
      '- RedClaw建项目: `app_cli(command="redclaw create --goal \\"做一个小红书选题\\"")`',
      '- 生图入媒体库: `app_cli(command="image generate --prompt \\"...\\\" --count 2")`',
    ];

    if (longTermMemory) {
      promptParts.push(
        '',
        '## 用户长期记忆（文件存储）',
        '<long_term_memory>',
        this.truncate(longTermMemory, 12000),
        '</long_term_memory>',
        '回答应优先与长期记忆保持一致；若用户新指令与旧记忆冲突，以最新明确指令为准并调用 save_memory 更新。',
      );
    }

    if (metadata.associatedFilePath) {
      promptParts.push(
        '',
        '## 当前会话绑定文件',
        `- 文件路径: ${metadata.associatedFilePath}`,
        '- 当用户要求分析/修改当前稿件时，优先围绕该文件操作。',
      );
    }

    if (metadata.isContextBound && metadata.contextContent) {
      promptParts.push(
        '',
        '## 当前知识库上下文（重点）',
        `上下文类型: ${metadata.contextType || 'unknown'}`,
        `上下文ID: ${metadata.contextId || 'unknown'}`,
        '<knowledge_context>',
        this.truncate(metadata.contextContent, 12000),
        '</knowledge_context>',
        '回答时优先依据以上上下文，不要忽略。若上下文不足，再明确说明缺失信息。',
      );
    }

    if (metadata.contextType === 'redclaw') {
      promptParts.push(
        '',
        '## RedClaw 执行模式（小红书创作自动化）',
        '- 你要以“目标->策略->文案->配图->发布计划->复盘”的流程推进，不要只给泛泛建议。',
        '- 每次开始新目标时，先调用 `redclaw_create_project` 建立项目并在后续步骤持续复用 projectId。',
        '- 产出文案后必须调用 `redclaw_save_copy_pack` 保存标题候选、正文、标签、封面文案、发布计划。',
        '- 产出配图策略后必须调用 `redclaw_save_image_pack` 保存封面图和多张配图提示词。',
        '- 用户给出发布后数据时，必须调用 `redclaw_save_retrospective` 形成复盘并给出下一轮假设与动作。',
        '- 在继续历史任务前，可先调用 `redclaw_list_projects` 选择最近项目。',
      );
    }

    if (metadata.compactSummary) {
      promptParts.push(
        '',
        '## 对话压缩记忆（自动维护）',
        `压缩轮次: ${metadata.compactRounds || 1}`,
        '<compact_memory>',
        this.truncate(metadata.compactSummary, 14000),
        '</compact_memory>',
        '你必须把该压缩记忆视为此前对话事实，与当前轮最近消息一起综合推理。',
      );
    }

    if (metadata.contextType === 'redclaw' && redClawProjectContext) {
      promptParts.push(
        '',
        '## RedClaw 最近项目',
        '<redclaw_projects>',
        this.truncate(redClawProjectContext, 8000),
        '</redclaw_projects>',
      );
    }

    if (skillsXml) {
      promptParts.push('', '## 可用技能', skillsXml);
    }

    if (activeSkills.length > 0) {
      promptParts.push('', '## 已激活技能（必须遵循）');
      for (const skill of activeSkills) {
        promptParts.push(`### ${skill.name}`);
        promptParts.push(skill.body);
      }
    }

    return promptParts.join('\n');
  }
}

export default PiChatService;
