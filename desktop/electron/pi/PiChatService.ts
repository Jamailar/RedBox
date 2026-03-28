/**
 * PiChatService - 基于 pi-agent-core 的聊天服务
 *
 * 主聊天与知识库聊天统一走这里。
 */

import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  Agent,
  type AgentEvent,
  type AgentTool,
  type BeforeToolCallResult,
  type AfterToolCallResult,
} from '@mariozechner/pi-agent-core';
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
  type ToolCallResponse,
  ToolConfirmationOutcome,
  type ToolResult,
} from '../core/toolRegistry';
import { createBuiltinTools } from '../core/tools';
import { createCompressionService } from '../core/compressionService';
import { getLongTermMemoryPrompt } from '../core/fileMemoryStore';
import { getRedClawProjectContextPrompt } from '../core/redclawStore';
import { getMcpServers } from '../core/mcpStore';
import {
  ensureRedClawOnboardingCompletedWithDefaults,
  handleRedClawOnboardingTurn,
  loadRedClawProfilePromptBundle,
  type RedClawProfilePromptBundle,
} from '../core/redclawProfileStore';
import { resolveChatMaxTokens } from '../core/chatTokenConfig';
import { resolveModelScopeFromContextType, resolveScopedModelName } from '../core/modelScopeSettings';
import { normalizeApiBaseUrl, safeUrlJoin } from '../core/urlUtils';
import { logDebugEvent } from '../core/debugLogger';
import { loadPrompt, renderPrompt } from '../prompts/runtime';

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
  streamedChunks: boolean;
}

interface ToolMarkupCleanupResult {
  hasLeakedToolMarkup: boolean;
  cleanedText: string;
  leakedToolNames: string[];
}

interface TextualToolCall {
  raw: string;
  name: string;
  args: Record<string, unknown>;
}

interface GeneratedImagePreview {
  id: string;
  previewUrl: string;
  prompt?: string;
}

interface CompactContextResult {
  success: boolean;
  compacted: boolean;
  message: string;
  compactRounds?: number;
  compactUpdatedAt?: string;
}

interface SessionRuntimeState {
  isProcessing: boolean;
  partialResponse: string;
  updatedAt: number;
}

const DEFAULT_REDCLAW_AUTO_COMPACT_TOKENS = 256000;
const DEFAULT_MODEL_CONTEXT_WINDOW_FALLBACK = 64000;
const TOOL_GUARD_MAX_TOTAL_CALLS = 24;
const TOOL_GUARD_MAX_CALLS_PER_TOOL = 12;
const TOOL_GUARD_MAX_REPEAT_SIGNATURE = 3;
const TOOL_RESULT_MAX_TEXT_CHARS = 32000;
const TOOL_RESULT_MAX_LLM_CHARS = 22000;
const TOOL_RESULT_MAX_DISPLAY_CHARS = 26000;
const TOOL_RESULT_MAX_ERROR_CHARS = 4000;
const PI_CHAT_SYSTEM_BASE_TEMPLATE = loadPrompt(
  'runtime/pi/system_base.txt',
  'You are an expert coding assistant operating inside pi.\nCurrent date: {{current_date}}\nCurrent working directory: {{current_working_directory}}'
);

interface ToolGuardState {
  totalCalls: number;
  callsByTool: Map<string, number>;
  callsBySignature: Map<string, number>;
  restrictToAppCliInRedClaw: boolean;
  blockedTools: Set<string>;
}

interface ChatErrorPayload {
  message: string;
  raw?: string;
  category?: 'auth' | 'quota' | 'rate_limit' | 'network' | 'timeout' | 'request' | 'unknown';
  statusCode?: number;
  errorCode?: string;
  hint?: string;
}

export class PiChatService {
  private window: BrowserWindow | null = null;
  private abortController: AbortController | null = null;
  private sessionId: string;
  private skillManager: SkillManager;
  private agent: Agent | null = null;
  private unsubscribeAgentEvents: (() => void) | null = null;
  private toolRegistry: ToolRegistry;
  private toolExecutor: ToolExecutor;
  private runtimeState: SessionRuntimeState = {
    isProcessing: false,
    partialResponse: '',
    updatedAt: 0,
  };

  constructor() {
    this.sessionId = `session_${Date.now()}`;
    this.skillManager = new SkillManager();
    this.toolRegistry = new ToolRegistry();
    const tools = createBuiltinTools({ pack: 'redclaw' });
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

  private buildChatErrorPayload(rawError: unknown): ChatErrorPayload {
    const rawMessage = rawError instanceof Error
      ? (rawError.message || String(rawError))
      : String(rawError || 'Unknown error');
    const compactRaw = rawMessage.trim().slice(0, 6000);
    const lower = compactRaw.toLowerCase();

    const statusMatch = compactRaw.match(/\b([1-5]\d{2})\b/);
    const statusCode = statusMatch ? Number(statusMatch[1]) : undefined;

    const errorCodeMatch = compactRaw.match(/\b(invalid_api_key|incorrect_api_key|insufficient_quota|quota_exceeded|rate_limit_exceeded|invalid_request_error|context_length_exceeded|max_tokens|model_not_found|authentication_error)\b/i);
    const errorCode = errorCodeMatch ? errorCodeMatch[1] : undefined;

    let category: ChatErrorPayload['category'] = 'unknown';
    let hint = '请检查 AI 源配置后重试。';

    if (
      statusCode === 401 ||
      statusCode === 403 ||
      lower.includes('invalid api key') ||
      lower.includes('incorrect api key') ||
      lower.includes('authentication') ||
      lower.includes('unauthorized') ||
      lower.includes('permission denied') ||
      lower.includes('api key')
    ) {
      category = 'auth';
      hint = '请检查 API Key 是否正确、是否过期、是否有权限访问该模型。';
    } else if (
      lower.includes('insufficient balance') ||
      lower.includes('insufficient_balance') ||
      lower.includes('insufficient_quota') ||
      lower.includes('quota') ||
      lower.includes('billing') ||
      lower.includes('(1008)') ||
      lower.includes('余额') ||
      lower.includes('额度')
    ) {
      category = 'quota';
      hint = '账号额度可能已用尽，请充值或切换到有余额的 AI 源。';
    } else if (
      statusCode === 429 ||
      lower.includes('rate limit') ||
      lower.includes('too many requests')
    ) {
      category = 'rate_limit';
      hint = '请求频率过高，请稍后重试或降低并发。';
    } else if (
      lower.includes('fetch failed') ||
      lower.includes('network') ||
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('certificate') ||
      lower.includes('self signed')
    ) {
      category = 'network';
      hint = '网络或网关连接异常，请检查 baseURL、代理和证书配置。';
    } else if (
      lower.includes('timeout') ||
      lower.includes('timed out') ||
      lower.includes('abort')
    ) {
      category = 'timeout';
      hint = '请求超时，请稍后重试。';
    } else if (
      lower.includes('max_tokens') ||
      lower.includes('context length') ||
      lower.includes('context_length_exceeded') ||
      lower.includes('invalid request')
    ) {
      category = 'request';
      hint = '请求参数可能不兼容（例如模型名、max_tokens、上下文长度）。';
    }

    const statusLabel = statusCode ? `HTTP ${statusCode}` : '';
    const codeLabel = errorCode ? `${errorCode}` : '';
    const title = [statusLabel, codeLabel].filter(Boolean).join(' · ');
    const message = title
      ? `AI 请求失败（${title}）`
      : 'AI 请求失败';

    return {
      message,
      raw: compactRaw,
      category,
      statusCode,
      errorCode,
      hint,
    };
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

  private normalizeStreamingTextDelta(rawDelta: string, currentResponse: string): string {
    const delta = typeof rawDelta === 'string' ? rawDelta : '';
    if (!delta) return '';
    if (!currentResponse) return delta;

    // Some providers emit cumulative content instead of strict token deltas.
    if (delta.startsWith(currentResponse)) {
      return delta.slice(currentResponse.length);
    }

    // Merge overlapped chunks to avoid duplicated tail/head when stream framing differs.
    const maxOverlap = Math.min(currentResponse.length, delta.length);
    for (let overlap = maxOverlap; overlap >= 4; overlap -= 1) {
      if (currentResponse.endsWith(delta.slice(0, overlap))) {
        return delta.slice(overlap);
      }
    }

    return delta;
  }

  private reconcileAssistantText(currentResponse: string, candidate: string): string {
    const current = typeof currentResponse === 'string' ? currentResponse : '';
    const next = typeof candidate === 'string' ? candidate : '';
    if (!next) return current;
    if (!current) return next;
    if (next === current) return current;
    if (next.startsWith(current)) return next;
    if (next.length > current.length) return next;
    return current;
  }

  private emitDebugLog(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
    logDebugEvent('pi-chat', level, message, {
      sessionId: this.sessionId,
      ...((data && typeof data === 'object' && !Array.isArray(data)) ? data as Record<string, unknown> : { data }),
    });
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

  getRuntimeState(): SessionRuntimeState {
    return {
      ...this.runtimeState,
    };
  }

  private setRuntimeState(next: Partial<SessionRuntimeState>) {
    this.runtimeState = {
      ...this.runtimeState,
      ...next,
      updatedAt: Date.now(),
    };
  }

  clearHistory() {
    this.sessionId = `session_${Date.now()}`;
    this.skillManager.resetActiveSkills();
    this.setRuntimeState({
      isProcessing: false,
      partialResponse: '',
    });

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
    const baseURL = normalizeApiBaseUrl(
      (settings.api_endpoint as string) || (settings.openaiApiBase as string) || 'https://api.openai.com/v1',
      'https://api.openai.com/v1',
    );
    const modelName = (settings.model_name as string) || (settings.openaiModel as string) || 'gpt-4o';

    if (!apiKey) {
      return {
        success: false,
        compacted: false,
        message: 'API Key 未配置，无法执行上下文压缩。',
      };
    }

    const model = this.createModelWithBaseUrl(modelName, baseURL, settings);
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
    this.setRuntimeState({
      isProcessing: true,
      partialResponse: '',
    });

    const settings = (getSettings() || {}) as Record<string, unknown>;
    const apiKey = (settings.api_key as string) || (settings.openaiApiKey as string) || process.env.OPENAI_API_KEY || '';
    const baseURL = normalizeApiBaseUrl(
      (settings.api_endpoint as string) || (settings.openaiApiBase as string) || 'https://api.openai.com/v1',
      'https://api.openai.com/v1',
    );
    let metadata = this.getSessionMetadata(sessionId);
    const modelScope = resolveModelScopeFromContextType(String(metadata.contextType || ''));
    const modelName = resolveScopedModelName(settings, modelScope, (settings.openaiModel as string) || 'gpt-4o');

    const workspacePaths = getWorkspacePaths();
    const workspace = workspacePaths.base;
    Instance.init(workspace);
    this.emitDebugLog('info', 'sendMessage:start', {
      messageLength: String(content || '').length,
      modelName,
      baseURL,
      workspace,
      contextType: String(metadata.contextType || ''),
      contextId: String(metadata.contextId || ''),
    });

    try {
      await this.ensureSkillsDiscovered(workspace);
    } catch (error) {
      console.warn('[PiChatService] Failed to load skills:', error);
    }

    try {
      const preactivatedSkills = await this.skillManager.preactivateMentionedSkills(content);
      for (const item of preactivatedSkills) {
        this.sendToUI('chat:skill-activated', {
          name: item.skill.name,
          description: item.skill.description,
        });
      }
    } catch (error) {
      console.warn('[PiChatService] Failed to preactivate mentioned skills:', error);
    }

    let redClawProfileBundle: RedClawProfilePromptBundle | null = null;

    if (this.shouldHandleRedClawOnboarding(metadata)) {
      try {
        redClawProfileBundle = await loadRedClawProfilePromptBundle();
        const isFirstRedClawTurn = this.isFirstAssistantTurn(sessionId);
        if (isFirstRedClawTurn) {
          const onboarding = await handleRedClawOnboardingTurn(content);
          if (onboarding.handled) {
            const onboardingResponse = (onboarding.responseText || '').trim();
            if (onboardingResponse) {
              this.emitLocalAssistantResponse(sessionId, onboardingResponse);
            }
            this.abortController = null;
            this.setRuntimeState({ isProcessing: false });
            return;
          }
        } else if (!redClawProfileBundle.onboardingState.completedAt) {
          await ensureRedClawOnboardingCompletedWithDefaults();
        }
        redClawProfileBundle = await loadRedClawProfilePromptBundle();
      } catch (error) {
        console.warn('[PiChatService] RedClaw onboarding/profile failed:', error);
      }
    } else if (metadata.contextType === 'redclaw') {
      try {
        redClawProfileBundle = await loadRedClawProfilePromptBundle();
      } catch (error) {
        console.warn('[PiChatService] Failed to load RedClaw profile bundle for non-primary session:', error);
      }
    }

    if (!apiKey) {
      this.emitDebugLog('error', 'sendMessage:missing-api-key');
      this.abortController = null;
      this.setRuntimeState({ isProcessing: false });
      this.sendToUI('chat:error', {
        message: 'AI 请求失败（API Key 未配置）',
        category: 'auth',
        hint: '请先在设置页填写并保存 API Key。',
        raw: 'API Key 未配置',
      } satisfies ChatErrorPayload);
      return;
    }

    const model = this.createModelWithBaseUrl(modelName, baseURL, settings);
    const redClawCompactTargetTokens = this.getRedClawCompactTargetTokens(settings);
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
    if (metadata.contextType === 'redclaw' && !redClawProfileBundle) {
      try {
        redClawProfileBundle = await loadRedClawProfilePromptBundle();
      } catch (error) {
        console.warn('[PiChatService] Failed to reload RedClaw profile bundle:', error);
      }
    }
    const systemPrompt = this.buildSystemPrompt(
      workspacePaths,
      metadata,
      longTermMemory,
      redClawProjectContext,
      redClawProfileBundle,
    );
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
    this.emitDebugLog('info', 'sendMessage:prepared', {
      modelName,
      baseURL,
      historyCount: history.length,
      isContextBound: Boolean(metadata.isContextBound),
      compacted: Boolean(metadata.compactSummary),
    });

    try {
      this.emitDebugLog('info', 'agent:run:start');
      let runResult = await this.runAgentAttempt({
        model,
        apiKey,
        prompt: systemPrompt,
        history,
        userInput: content,
        signal,
        metadata,
      });

      const finalError = runResult.error || '';
      if (finalError && !signal.aborted) {
        console.error('[PiChatService] Agent completed with error state, falling back to direct completion:', finalError);
        this.emitDebugLog('warn', 'agent:run:error-fallback', { error: finalError });
        const fallbackResult = await this.runDirectCompletionFallback({
          modelName,
          baseURL,
          apiKey,
          systemPrompt,
          history,
          userInput: content,
          signal,
        });
        if (!fallbackResult.error) {
          this.emitDebugLog('info', 'fallback:completion:success', { responseLength: fallbackResult.response.length });
          runResult = fallbackResult;
        } else {
          this.emitDebugLog('error', 'fallback:completion:failed', { error: fallbackResult.error });
          runResult.error = `${finalError}\n\nFallback error: ${fallbackResult.error}`;
        }
      }

      const finalResultError = runResult.error || '';
      if (finalResultError) {
        console.error('[PiChatService] Chat failed after fallback:', finalResultError);
        this.emitDebugLog('error', 'sendMessage:failed', { error: finalResultError });
        this.sendToUI('chat:error', this.buildChatErrorPayload(finalResultError));
        return;
      }

      const fullResponse = runResult.response || '';
      if (fullResponse) {
        this.emitDebugLog('info', 'sendMessage:full-response', {
          streamedChunks: runResult.streamedChunks,
          responseLength: fullResponse.length,
          responsePreview: fullResponse.slice(0, 160),
        });
        if (!runResult.streamedChunks) {
          this.sendToUI('chat:response-chunk', { content: fullResponse });
        }
        this.setRuntimeState({ partialResponse: fullResponse });
        addChatMessage({
          id: `msg_${Date.now()}`,
          session_id: sessionId,
          role: 'assistant',
          content: fullResponse,
        });
      } else {
        console.warn('[PiChatService] Empty assistant response', {
          sessionId,
          streamedChunks: runResult.streamedChunks,
          historyCount: history.length,
        });
        this.emitDebugLog('warn', 'sendMessage:empty-response', {
          streamedChunks: runResult.streamedChunks,
          historyCount: history.length,
        });
      }

      this.emitDebugLog('info', 'sendMessage:success', {
        streamedChunks: runResult.streamedChunks,
        responseLength: fullResponse.length,
      });
      this.sendToUI('chat:response-end', { content: fullResponse });
    } catch (error: unknown) {
      if (!signal.aborted) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[PiChatService] Error:', errorMessage);
        this.emitDebugLog('error', 'sendMessage:exception', { error: errorMessage });
        this.sendToUI('chat:error', this.buildChatErrorPayload(errorMessage));
      }
    } finally {
      this.cleanupAgentSubscription();
      this.abortController = null;
      this.setRuntimeState({
        isProcessing: false,
      });
      this.emitDebugLog('info', 'sendMessage:done');
    }
  }

  private emitLocalAssistantResponse(sessionId: string, content: string) {
    const text = String(content || '').trim();
    if (!text) return;

    this.sendToUI('chat:response-chunk', { content: text });
    this.sendToUI('chat:response-end', { content: text });
    this.setRuntimeState({ partialResponse: text });

    addChatMessage({
      id: `msg_${Date.now()}`,
      session_id: sessionId,
      role: 'assistant',
      content: text,
    });
  }

  private isFirstAssistantTurn(sessionId: string): boolean {
    const history = getChatMessages(sessionId).filter((msg) => msg.role === 'user' || msg.role === 'assistant');
    const assistantCount = history.filter((msg) => msg.role === 'assistant').length;
    return assistantCount === 0 && history.length <= 1;
  }

  private shouldHandleRedClawOnboarding(metadata: SessionMetadata): boolean {
    if (metadata.contextType !== 'redclaw') return false;
    const contextId = String(metadata.contextId || '');
    return contextId.startsWith('redclaw-singleton:');
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
    metadata?: SessionMetadata;
  }): Promise<AgentRunResult> {
    const { model, apiKey, prompt, history, userInput, signal, metadata } = params;
    const runtime = {
      rawResponse: '',
      displayResponse: '',
      streamedChunks: false,
    };
    const toolGuardState = this.createToolGuardState(metadata);
    const appCliCommands = new Map<string, string>();
    const generatedImages: GeneratedImagePreview[] = [];
    let sawAnyToolExecution = false;

    this.agent = this.createAgent(model, apiKey, prompt, history, signal, toolGuardState);
    this.emitDebugLog('info', 'agent:init', {
      modelId: (model as { id?: string }).id || 'unknown',
      historyCount: history.length,
    });

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
            const safeThoughtDelta = this.sanitizeThoughtDelta(event.assistantMessageEvent.delta || '');
            if (safeThoughtDelta) {
              this.sendToUI('chat:thought-delta', { content: safeThoughtDelta });
            }
            break;
          }
          if (event.assistantMessageEvent.type === 'thinking_end') {
            this.sendToUI('chat:thought-end', {});
            break;
          }
          if (event.assistantMessageEvent.type === 'text_delta') {
            const rawDelta = event.assistantMessageEvent.delta || '';
            const normalizedDelta = this.normalizeStreamingTextDelta(rawDelta, runtime.rawResponse);
            this.emitDebugLog('info', 'agent:text-delta', {
              rawLength: rawDelta.length,
              rawPreview: rawDelta.slice(0, 80),
              normalizedLength: normalizedDelta.length,
              normalizedPreview: normalizedDelta.slice(0, 80),
              responseLengthBefore: runtime.rawResponse.length,
            });
            if (normalizedDelta) {
              runtime.rawResponse += normalizedDelta;
              runtime.streamedChunks = true;
              const nextVisibleResponse = this.getUiSafeAssistantText(runtime.rawResponse);
              const visibleDelta = this.diffVisibleResponse(runtime.displayResponse, nextVisibleResponse);
              runtime.displayResponse = nextVisibleResponse;
              this.setRuntimeState({ partialResponse: runtime.displayResponse });
              this.emitDebugLog('info', 'agent:text-delta:applied', {
                appendedLength: normalizedDelta.length,
                responseLengthAfter: runtime.rawResponse.length,
                responsePreview: runtime.rawResponse.slice(0, 120),
              });
              if (visibleDelta) {
                this.sendToUI('chat:response-chunk', { content: visibleDelta });
              }
            }
          }
          break;

        case 'message_end': {
          const msg = event.message as AssistantMessageLike;
          const extractedText = this.extractText(msg.content);
          this.emitDebugLog('info', 'agent:message-end', {
            role: msg.role || 'unknown',
            extractedLength: extractedText.length,
            extractedPreview: extractedText.slice(0, 120),
            existingResponseLength: runtime.rawResponse.length,
            rawContentPreview: this.previewForLog(msg.content, 500),
          });
          if (msg.role === 'assistant' && extractedText) {
            if (!runtime.rawResponse) {
              runtime.rawResponse = extractedText;
              runtime.streamedChunks = true;
              const nextVisibleResponse = this.getUiSafeAssistantText(runtime.rawResponse);
              const visibleDelta = this.diffVisibleResponse(runtime.displayResponse, nextVisibleResponse);
              runtime.displayResponse = nextVisibleResponse;
              this.setRuntimeState({ partialResponse: runtime.displayResponse });
              if (visibleDelta) {
                this.sendToUI('chat:response-chunk', { content: visibleDelta });
              }
            } else {
              const previous = runtime.rawResponse;
              const reconciled = this.reconcileAssistantText(runtime.rawResponse, extractedText);

              if (reconciled !== previous) {
                this.emitDebugLog('info', 'agent:message-end:reconciled', {
                  previousLength: previous.length,
                  reconciledLength: reconciled.length,
                  reconciledPreview: reconciled.slice(0, 160),
                });
                runtime.rawResponse = reconciled;
                runtime.streamedChunks = true;
                const nextVisibleResponse = this.getUiSafeAssistantText(runtime.rawResponse);
                const visibleDelta = this.diffVisibleResponse(runtime.displayResponse, nextVisibleResponse);
                runtime.displayResponse = nextVisibleResponse;
                this.setRuntimeState({ partialResponse: runtime.displayResponse });
                if (visibleDelta) {
                  this.sendToUI('chat:response-chunk', { content: visibleDelta });
                }
              }
            }
          }
          break;
        }

        case 'tool_execution_start':
          sawAnyToolExecution = true;
          if (event.toolName === 'app_cli') {
            const command = typeof (event.args as { command?: unknown } | undefined)?.command === 'string'
              ? String((event.args as { command?: unknown }).command)
              : '';
            if (command) {
              appCliCommands.set(event.toolCallId, command);
            }
          }
          console.log('[PiChatService] tool:start', {
            sessionId: this.sessionId,
            callId: event.toolCallId,
            name: event.toolName,
            args: this.previewForLog(event.args),
          });
          this.emitDebugLog('info', 'tool:start', {
            callId: event.toolCallId,
            name: event.toolName,
            args: event.args,
          });
          this.sendToUI('chat:tool-start', {
            callId: event.toolCallId,
            name: event.toolName,
            input: event.args,
            description: `执行工具: ${event.toolName}`,
          });
          break;

        case 'tool_execution_update': {
          const partialText = this.toolExecutionUpdateToText(event.partialResult);
          if (!partialText) break;
          console.log('[PiChatService] tool:update', {
            sessionId: this.sessionId,
            callId: event.toolCallId,
            name: event.toolName,
            partialPreview: this.previewForLog(partialText),
          });
          this.emitDebugLog('info', 'tool:update', {
            callId: event.toolCallId,
            name: event.toolName,
            partialPreview: partialText,
          });
          this.sendToUI('chat:tool-update', {
            callId: event.toolCallId,
            name: event.toolName,
            partial: partialText,
          });
          break;
        }

        case 'tool_execution_end': {
          const output = this.toolExecutionToOutput(event.result, event.isError);
          const command = appCliCommands.get(event.toolCallId) || '';
          if (!event.isError && command && this.isImageGenerateCommand(command)) {
            generatedImages.push(...this.extractGeneratedImagesFromToolResult(event.result));
          }
          console.log('[PiChatService] tool:end', {
            sessionId: this.sessionId,
            callId: event.toolCallId,
            name: event.toolName,
            isError: event.isError,
            success: output.success,
            outputPreview: this.previewForLog(output.content),
          });
          this.emitDebugLog(event.isError ? 'error' : 'info', 'tool:end', {
            callId: event.toolCallId,
            name: event.toolName,
            isError: event.isError,
            success: output.success,
            output: output.content,
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
            this.emitDebugLog('error', 'turn:end:error', { error: msg.errorMessage });
          }
          break;
        }
      }
    });

    try {
      let needsInitialPrompt = true;
      let textualToolRounds = 0;

      while (true) {
        if (needsInitialPrompt) {
          await this.agent.prompt(userInput);
          needsInitialPrompt = false;
        } else {
          await this.agent.continue();
        }
        await this.agent.waitForIdle();

        const recoveredFromState = this.getLastAssistantMessage(this.agent.state.messages as unknown[]);
        const reconciledFromState = this.reconcileAssistantText(runtime.rawResponse, recoveredFromState);
        if (reconciledFromState !== runtime.rawResponse) {
          this.emitDebugLog('info', 'agent:state:reconciled', {
            previousLength: runtime.rawResponse.length,
            recoveredLength: recoveredFromState.length,
            reconciledLength: reconciledFromState.length,
            recoveredPreview: recoveredFromState.slice(0, 160),
          });
          runtime.rawResponse = reconciledFromState;
          const nextVisibleResponse = this.getUiSafeAssistantText(runtime.rawResponse);
          const visibleDelta = this.diffVisibleResponse(runtime.displayResponse, nextVisibleResponse);
          runtime.displayResponse = nextVisibleResponse;
          this.setRuntimeState({ partialResponse: runtime.displayResponse });
          if (visibleDelta) {
            this.sendToUI('chat:response-chunk', { content: visibleDelta });
          }
        }

        if (!sawAnyToolExecution && textualToolRounds < 4) {
          const textualToolFallback = this.extractTextualToolCalls(runtime.rawResponse);
          if (textualToolFallback.calls.length > 0) {
            textualToolRounds += 1;
            runtime.rawResponse = textualToolFallback.visibleText;
            const nextVisibleResponse = this.getUiSafeAssistantText(runtime.rawResponse);
            runtime.displayResponse = nextVisibleResponse;
            this.setRuntimeState({ partialResponse: runtime.displayResponse });
            this.rewriteLastAssistantMessage(nextVisibleResponse);
            const executedAny = await this.executeTextualToolCalls(textualToolFallback.calls, signal, toolGuardState);
            if (executedAny) {
              sawAnyToolExecution = true;
              runtime.rawResponse = '';
              runtime.displayResponse = '';
              this.setRuntimeState({ partialResponse: '' });
              continue;
            }
          }
        }
        break;
      }

      let finalResponse = runtime.displayResponse;
      if (generatedImages.length > 0) {
        finalResponse = this.appendGeneratedImagesMarkdown(finalResponse, generatedImages);
      }
      const cleaned = this.cleanupLeakedToolMarkup(finalResponse, sawAnyToolExecution);
      if (cleaned.hasLeakedToolMarkup) {
        this.emitDebugLog('warn', 'agent:run:tool-markup-leaked', {
          leakedToolNames: cleaned.leakedToolNames,
          hadToolExecution: sawAnyToolExecution,
        });
        finalResponse = cleaned.cleanedText;
      }

      const stateError = (this.agent.state as { error?: string }).error;
      const assistantError = this.getLastAssistantError(this.agent.state.messages as unknown[]);
      const finalError = assistantError || stateError;
      if (finalError) {
        this.emitDebugLog('warn', 'agent:run:completed-with-error', { error: finalError });
      } else {
        this.emitDebugLog('info', 'agent:run:completed', {
          responseLength: finalResponse.length,
          streamedChunks: runtime.streamedChunks,
        });
      }

      return {
        response: finalResponse,
        error: finalError || undefined,
        streamedChunks: runtime.streamedChunks,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emitDebugLog('error', 'agent:run:exception', { error: message });
      return {
        response: runtime.displayResponse,
        error: message,
        streamedChunks: runtime.streamedChunks,
      };
    }
  }

  private async runDirectCompletionFallback(params: {
    modelName: string;
    baseURL: string;
    apiKey: string;
    systemPrompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }>; timestamp: number }>;
    userInput: string;
    signal: AbortSignal;
  }): Promise<AgentRunResult> {
    const { modelName, baseURL, apiKey, systemPrompt, history, userInput, signal } = params;
    this.emitDebugLog('info', 'fallback:completion:start', {
      modelName,
      baseURL,
      historyCount: history.length,
      userInputLength: userInput.length,
    });
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...history.map((item) => ({
        role: item.role,
        content: this.extractText(item.content),
      })),
      { role: 'user', content: userInput },
    ];

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort);
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(safeUrlJoin(baseURL, '/chat/completions'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature: 0.7,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.emitDebugLog('error', 'fallback:completion:http-error', {
          status: response.status,
          statusText: response.statusText,
          errorText,
        });
        return {
          response: '',
          streamedChunks: false,
          error: `Fallback completion failed (${response.status}): ${errorText || response.statusText}`,
        };
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string; type?: string }> } }>;
      };
      const rawContent = data?.choices?.[0]?.message?.content;
      const text = typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((item) => String(item?.text || '')).join('')
          : '';

      this.emitDebugLog('info', 'fallback:completion:decoded', {
        responseLength: text.length,
        responsePreview: text.slice(0, 160),
      });

      if (!text.trim()) {
        this.emitDebugLog('warn', 'fallback:completion:empty-response');
        return {
          response: '',
          streamedChunks: false,
          error: 'Fallback completion returned empty response',
        };
      }

      return {
        response: text,
        streamedChunks: false,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        this.emitDebugLog('warn', 'fallback:completion:aborted');
        return {
          response: '',
          streamedChunks: false,
          error: 'Fallback completion timeout or aborted',
        };
      }
      this.emitDebugLog('error', 'fallback:completion:exception', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        response: '',
        streamedChunks: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private createAgent(
    model: Model<any>,
    apiKey: string,
    systemPrompt: string,
    history: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }>; timestamp: number }>,
    signal: AbortSignal,
    toolGuardState: ToolGuardState,
  ): Agent {
    const agent = new Agent({
      initialState: {
        model,
        thinkingLevel: 'off',
      },
      sessionId: this.sessionId,
      getApiKey: async () => apiKey,
      convertToLlm: async (messages) => this.convertAgentMessagesToLlm(messages),
      transformContext: async (messages) => messages,
      beforeToolCall: async ({ toolCall, args }): Promise<BeforeToolCallResult | undefined> => {
        return this.guardBeforeToolCall(toolCall?.id || '', toolCall?.name || '', args, toolGuardState);
      },
      afterToolCall: async ({ toolCall, result, isError }): Promise<AfterToolCallResult | undefined> => {
        return this.guardAfterToolCall(toolCall?.name || '', result, isError);
      },
    });

    const agentTools = this.createAgentTools(signal);
    this.emitDebugLog('info', 'agent:tools:registered', {
      pack: 'redclaw',
      count: agentTools.length,
      names: agentTools.map((tool) => tool.name),
    });
    const requiredTools = ['read_file', 'app_cli', 'save_memory'];
    const missingTools = requiredTools.filter((name) => !agentTools.some((tool) => tool.name === name));
    if (!agentTools.length || missingTools.length > 0) {
      this.emitDebugLog('error', 'agent:tools:pack-invalid', {
        pack: 'redclaw',
        count: agentTools.length,
        missingTools,
      });
    }
    agent.setSystemPrompt(systemPrompt);
    agent.setTools(agentTools);
    agent.replaceMessages(history as any[]);

    return agent;
  }

  private convertAgentMessagesToLlm(messages: unknown[]) {
    return messages
      .filter((msg) => {
        const role = (msg as { role?: unknown } | undefined)?.role;
        return role === 'user' || role === 'assistant' || role === 'toolResult';
      })
      .map((msg) => {
        const value = msg as { role?: string; content?: unknown };
        if (value.role === 'user') {
          return {
            ...value,
            content: Array.isArray(value.content)
              ? value.content
              : [{ type: 'text', text: this.extractText(value.content) }],
          };
        }
        return value;
      }) as any[];
  }

  private createToolGuardState(metadata?: SessionMetadata): ToolGuardState {
    const isWindowsRedClaw = process.platform === 'win32' && metadata?.contextType === 'redclaw';
    const blockedTools = new Set<string>([
      'bash',
      'read_file',
      'list_dir',
      'grep',
      'write_file',
      'edit_file',
    ]);

    return {
      totalCalls: 0,
      callsByTool: new Map<string, number>(),
      callsBySignature: new Map<string, number>(),
      restrictToAppCliInRedClaw: isWindowsRedClaw,
      blockedTools,
    };
  }

  private getToolLikeTagNames(): Set<string> {
    const registryNames = this.toolRegistry
      .getAllTools()
      .map((tool) => String(tool.name || '').trim().toLowerCase())
      .filter(Boolean);

    return new Set([
      ...registryNames,
      'read_file',
      'write_file',
      'list_dir',
      'grep',
      'bash',
      'app_cli',
      'save_memory',
      'skill',
      'activate_skill',
    ]);
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private sanitizeThoughtDelta(text: string): string {
    const sanitized = this.sanitizePlainText(text)
      .replace(/<thinking>/gi, '')
      .replace(/<\/thinking>/gi, '');
    return this.getUiSafeAssistantText(sanitized);
  }

  private diffVisibleResponse(previous: string, next: string): string {
    if (!next) return '';
    if (!previous) return next;
    if (next.startsWith(previous)) {
      return next.slice(previous.length);
    }
    return next;
  }

  private getUiSafeAssistantText(text: string): string {
    let visible = String(text || '');
    const toolNames = Array.from(this.getToolLikeTagNames());
    if (toolNames.length === 0 || !visible.includes('<')) {
      return this.sanitizePlainText(visible);
    }

    const alternation = toolNames.map((name) => this.escapeRegex(name)).join('|');
    const completeBlockPattern = new RegExp(`<(${alternation})>([\\s\\S]*?)<\\/\\1>`, 'gi');
    const incompleteStartPattern = new RegExp(`<(${alternation})(?:>|\\s|$)`, 'i');
    if (completeBlockPattern.test(visible) || incompleteStartPattern.test(visible)) {
      return '';
    }
    completeBlockPattern.lastIndex = 0;
    visible = visible.replace(completeBlockPattern, '');

    return this.sanitizePlainText(visible).trim();
  }

  private extractTextualToolCalls(text: string): { visibleText: string; calls: TextualToolCall[] } {
    const raw = String(text || '');
    const toolNames = Array.from(this.getToolLikeTagNames());
    if (!raw.trim() || toolNames.length === 0) {
      return { visibleText: raw, calls: [] };
    }

    const alternation = toolNames.map((name) => this.escapeRegex(name)).join('|');
    const blockPattern = new RegExp(`<(${alternation})>([\\s\\S]*?)<\\/\\1>`, 'gi');
    const calls: TextualToolCall[] = [];
    let visibleText = raw;

    visibleText = visibleText.replace(blockPattern, (full, toolName: string, body: string) => {
      calls.push({
        raw: full,
        name: String(toolName || '').toLowerCase(),
        args: this.parseTextualToolArgs(String(body || '')),
      });
      return '';
    });

    return {
      visibleText: calls.length > 0 ? '' : this.sanitizePlainText(visibleText).trim(),
      calls,
    };
  }

  private parseTextualToolArgs(body: string): Record<string, unknown> {
    const text = String(body || '');
    const args: Record<string, unknown> = {};
    const childPattern = /<([a-z_][a-z0-9_-]*)>([\s\S]*?)<\/\1>/gi;
    const matches = [...text.matchAll(childPattern)];

    if (matches.length === 0) {
      const trimmed = text.trim();
      if (trimmed) {
        args.input = this.coerceTextualToolArgValue(trimmed);
      }
      return args;
    }

    for (const match of matches) {
      const key = String(match[1] || '').trim();
      if (!key) continue;
      const value = this.coerceTextualToolArgValue(String(match[2] || '').trim());
      if (Object.prototype.hasOwnProperty.call(args, key)) {
        const previous = args[key];
        args[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];
      } else {
        args[key] = value;
      }
    }
    return args;
  }

  private coerceTextualToolArgValue(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^(true|false)$/i.test(trimmed)) {
      return trimmed.toLowerCase() === 'true';
    }
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      return Number(trimmed);
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  private rewriteLastAssistantMessage(content: string): void {
    if (!this.agent) return;
    const messages = [...this.agent.state.messages] as unknown as Array<Record<string, unknown>>;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'assistant') {
        messages[i] = {
          ...messages[i],
          content: [{ type: 'text', text: content }],
        };
        this.agent.replaceMessages(messages as any[]);
        return;
      }
    }
  }

  private async executeTextualToolCalls(
    calls: TextualToolCall[],
    signal: AbortSignal,
    toolGuardState: ToolGuardState,
  ): Promise<boolean> {
    if (!this.agent || calls.length === 0) {
      return false;
    }

    let executedAny = false;

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const callId = `textual_tool_${Date.now()}_${index}`;
      const beforeResult = await this.guardBeforeToolCall(callId, call.name, call.args, toolGuardState);

      this.sendToUI('chat:tool-start', {
        callId,
        name: call.name,
        input: call.args,
        description: `执行工具: ${call.name}`,
      });

      let response: ToolCallResponse;
      if (beforeResult?.block) {
        response = {
          callId,
          name: call.name,
          result: {
            success: false,
            error: {
              message: beforeResult.reason || `Tool "${call.name}" blocked`,
            },
            display: beforeResult.reason || `Tool "${call.name}" blocked`,
            llmContent: beforeResult.reason || `Tool "${call.name}" blocked`,
          } as ToolResult,
          durationMs: 0,
        };
      } else {
        response = await this.toolExecutor.execute(
          {
            callId,
            name: call.name,
            params: call.args,
          },
          signal,
          (chunk) => {
            if (chunk) {
              this.sendToUI('chat:tool-update', {
                callId,
                name: call.name,
                partial: chunk,
              });
            }
          },
        );
      }

      const isError = response.result.success === false;
      const afterResult = await this.guardAfterToolCall(call.name, response.result, isError);
      const effectiveResult: ToolResult = afterResult
        ? {
            ...response.result,
            success: afterResult.isError !== undefined ? !afterResult.isError : response.result.success,
            llmContent: Array.isArray(afterResult.content)
              ? afterResult.content
                  .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
                  .join('')
              : response.result.llmContent,
            display: typeof afterResult.details === 'string'
              ? afterResult.details
              : response.result.display,
            data: afterResult.details ?? response.result.data,
          }
        : response.result;

      const output = this.toolExecutionToOutput({ details: effectiveResult }, effectiveResult.success === false);
      this.sendToUI('chat:tool-end', {
        callId,
        name: call.name,
        output,
      });

      this.agent.appendMessage({
        role: 'toolResult',
        toolCallId: callId,
        toolName: call.name,
        content: [{
          type: 'text',
          text: effectiveResult.llmContent || effectiveResult.display || effectiveResult.error?.message || '',
        }],
        details: effectiveResult.data,
        isError: effectiveResult.success === false,
        timestamp: Date.now(),
      } as any);
      executedAny = true;
    }

    return executedAny;
  }

  private async guardBeforeToolCall(
    callId: string,
    toolName: string,
    args: unknown,
    state: ToolGuardState,
  ): Promise<BeforeToolCallResult | undefined> {
    const normalizedToolName = (toolName || 'unknown').trim() || 'unknown';
    state.totalCalls += 1;

    const currentToolCount = (state.callsByTool.get(normalizedToolName) || 0) + 1;
    state.callsByTool.set(normalizedToolName, currentToolCount);

    const signature = this.buildToolCallSignature(normalizedToolName, args);
    const currentSignatureCount = (state.callsBySignature.get(signature) || 0) + 1;
    state.callsBySignature.set(signature, currentSignatureCount);

    let blockReason = '';
    if (state.restrictToAppCliInRedClaw && state.blockedTools.has(normalizedToolName)) {
      blockReason = `Windows RedClaw 模式下已限制 ${normalizedToolName}，请改用 app_cli 或 redclaw_* 工具，避免路径兼容问题。`;
    } else if (state.totalCalls > TOOL_GUARD_MAX_TOTAL_CALLS) {
      blockReason = `Tool 调用次数超过上限(${TOOL_GUARD_MAX_TOTAL_CALLS})，已阻止继续调用。请基于现有结果给出结论。`;
    } else if (currentToolCount > TOOL_GUARD_MAX_CALLS_PER_TOOL) {
      blockReason = `工具 ${normalizedToolName} 调用次数超过上限(${TOOL_GUARD_MAX_CALLS_PER_TOOL})，疑似进入循环。请改为总结已有结果。`;
    } else if (currentSignatureCount > TOOL_GUARD_MAX_REPEAT_SIGNATURE) {
      blockReason = `检测到重复工具调用(${normalizedToolName})参数完全一致，已阻止第 ${currentSignatureCount} 次重复。请先分析已有输出。`;
    }

    if (!blockReason) {
      return undefined;
    }

    console.warn('[PiChatService] tool:guard-blocked', {
      sessionId: this.sessionId,
      callId,
      toolName: normalizedToolName,
      totalCalls: state.totalCalls,
      toolCalls: currentToolCount,
      signatureCalls: currentSignatureCount,
      reason: blockReason,
    });

    this.sendToUI('chat:tool-update', {
      callId,
      name: normalizedToolName,
      partial: `[Guard] ${blockReason}`,
    });

    return {
      block: true,
      reason: blockReason,
    };
  }

  private async guardAfterToolCall(
    toolName: string,
    result: unknown,
    isError: boolean,
  ): Promise<AfterToolCallResult | undefined> {
    const sanitized = this.sanitizeToolHookResult(result);
    if (!sanitized.changed) {
      return undefined;
    }

    console.log('[PiChatService] tool:guard-sanitized', {
      sessionId: this.sessionId,
      toolName,
      isError,
      truncated: true,
      contentPreview: this.previewForLog(sanitized.content),
    });

    return {
      content: sanitized.content,
      details: sanitized.details,
      isError,
    };
  }

  private sanitizeToolHookResult(result: unknown): {
    changed: boolean;
    content?: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
    details?: unknown;
  } {
    const wrapped = (result || {}) as { content?: unknown; details?: unknown };
    let changed = false;

    let nextContent = wrapped.content as Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> | undefined;
    if (Array.isArray(nextContent)) {
      const patched = nextContent.map((block) => {
        if (!block || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') {
          return block;
        }
        const sanitized = this.sanitizePlainText(block.text);
        const trimmed = this.truncateToolText(sanitized, TOOL_RESULT_MAX_TEXT_CHARS, 'tool content');
        if (trimmed !== block.text) {
          changed = true;
          return {
            ...block,
            text: trimmed,
          };
        }
        return block;
      });
      nextContent = patched;
    }

    let nextDetails: unknown = wrapped.details;
    if (wrapped.details && typeof wrapped.details === 'object') {
      const details = wrapped.details as Record<string, unknown>;
      const patched: Record<string, unknown> = { ...details };

      if (typeof patched.llmContent === 'string') {
        const sanitized = this.sanitizePlainText(patched.llmContent);
        const trimmed = this.truncateToolText(sanitized, TOOL_RESULT_MAX_LLM_CHARS, 'llmContent');
        if (trimmed !== patched.llmContent) {
          changed = true;
          patched.llmContent = trimmed;
        }
      }

      if (typeof patched.display === 'string') {
        const sanitized = this.sanitizePlainText(patched.display);
        const trimmed = this.truncateToolText(sanitized, TOOL_RESULT_MAX_DISPLAY_CHARS, 'display');
        if (trimmed !== patched.display) {
          changed = true;
          patched.display = trimmed;
        }
      }

      if (patched.error && typeof patched.error === 'object') {
        const errorObj = { ...(patched.error as Record<string, unknown>) };
        if (typeof errorObj.message === 'string') {
          const sanitized = this.sanitizePlainText(errorObj.message);
          const trimmed = this.truncateToolText(sanitized, TOOL_RESULT_MAX_ERROR_CHARS, 'error');
          if (trimmed !== errorObj.message) {
            changed = true;
            errorObj.message = trimmed;
          }
        }
        patched.error = errorObj;
      }

      nextDetails = patched;
    } else if (typeof wrapped.details === 'string') {
      const sanitized = this.sanitizePlainText(wrapped.details);
      const trimmed = this.truncateToolText(sanitized, TOOL_RESULT_MAX_LLM_CHARS, 'details');
      if (trimmed !== wrapped.details) {
        changed = true;
        nextDetails = trimmed;
      }
    }

    return {
      changed,
      content: nextContent,
      details: nextDetails,
    };
  }

  private sanitizePlainText(text: string): string {
    return String(text || '')
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n');
  }

  private truncateToolText(text: string, maxChars: number, field: string): string {
    if (text.length <= maxChars) {
      return text;
    }
    const omitted = text.length - maxChars;
    return `${text.slice(0, maxChars)}\n\n[${field} 过长，已截断 ${omitted} 字符]`;
  }

  private buildToolCallSignature(toolName: string, args: unknown): string {
    const normalized = this.stableStringifyForSignature(args);
    return `${toolName}:${normalized.slice(0, 800)}`;
  }

  private stableStringifyForSignature(value: unknown, depth = 0): string {
    if (depth > 5) return '"[depth-limit]"';
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    const valueType = typeof value;
    if (valueType === 'string') {
      const text = value as string;
      return JSON.stringify(text.length > 240 ? `${text.slice(0, 240)}...<truncated>` : text);
    }
    if (valueType === 'number' || valueType === 'boolean') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      const items = value.slice(0, 16).map((item) => this.stableStringifyForSignature(item, depth + 1));
      const suffix = value.length > 16 ? ', "...<truncated-array>"' : '';
      return `[${items.join(', ')}${suffix}]`;
    }
    if (valueType === 'object') {
      const objectValue = value as Record<string, unknown>;
      const keys = Object.keys(objectValue).sort();
      const limitedKeys = keys.slice(0, 20);
      const segments = limitedKeys.map((key) => `${JSON.stringify(key)}:${this.stableStringifyForSignature(objectValue[key], depth + 1)}`);
      if (keys.length > 20) {
        segments.push('"...<truncated-object>":true');
      }
      return `{${segments.join(',')}}`;
    }

    return JSON.stringify(String(value));
  }

  private async ensureSkillsDiscovered(workspace: string): Promise<void> {
    await this.skillManager.discoverSkills(workspace);
  }

  private createModelWithBaseUrl(modelName: string, baseURL: string, settings?: Record<string, unknown>): Model<any> {
    const requestedModel = (modelName || 'gpt-4o').trim();
    const resolvedBaseUrl = normalizeApiBaseUrl(baseURL || 'https://api.openai.com/v1', 'https://api.openai.com/v1');
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
    const isDeepSeekFamily = lower.includes('deepseek');
    const maxTokens = resolveChatMaxTokens(settings, isDeepSeekFamily);
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
      maxTokens,
      compat: compat as any,
    } as Model<any>;

    console.log('[PiChatService] model-resolved', {
      mode: 'openai-compatible',
      modelId: customModel.id,
      api: customModel.api,
      baseUrl: customModel.baseUrl,
      maxTokens: customModel.maxTokens,
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

    const executeSkillLoad = async (params: Record<string, unknown>) => {
      const skillName = typeof params.name === 'string' ? params.name : '';
      const activated = skillName ? await this.skillManager.activateSkill(skillName) : null;

      if (activated) {
        const skill = this.skillManager.getSkill(skillName);
        this.sendToUI('chat:skill-activated', {
          name: skill?.name || skillName,
          description: skill?.description || `技能 ${skillName} 已激活`,
        });
        return {
          content: [{ type: 'text' as const, text: activated }],
          details: { success: true },
        };
      }

      const available = this.skillManager.getSkills().map((skill) => skill.name).join(', ');
      return {
        content: [{ type: 'text' as const, text: `Skill "${skillName}" not found or disabled. Available skills: ${available || 'none'}.` }],
        details: { success: false },
      };
    };

    tools.push({
      name: 'skill',
      label: 'Load Skill',
      description: this.skillManager.getSkillToolDescription(),
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      } as any,
      execute: async (_toolCallId: string, params: Record<string, unknown>) => executeSkillLoad(params),
    } as AgentTool);

    tools.push({
      name: 'activate_skill',
      label: 'Activate Skill',
      description: 'Legacy alias for the skill tool. Use this only if explicitly needed; prefer `skill`.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      } as any,
      execute: async (_toolCallId: string, params: Record<string, unknown>) => executeSkillLoad(params),
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

  private toolExecutionUpdateToText(partialResult: unknown): string {
    const output = this.toolExecutionToOutput(partialResult, false).content;
    if (output && output.trim()) return output;
    if (typeof partialResult === 'string') return partialResult;
    return '';
  }

  private isImageGenerateCommand(command: string): boolean {
    return /^image\s+generate\b/i.test(String(command || '').trim());
  }

  private extractGeneratedImagesFromToolResult(result: unknown): GeneratedImagePreview[] {
    const wrapped = result as { details?: ToolResult } | undefined;
    const details = wrapped?.details as (ToolResult & { data?: unknown }) | undefined;
    const data = details?.data as {
      kind?: string;
      assets?: Array<{ id?: string; previewUrl?: string; prompt?: string }>;
    } | undefined;

    if (data?.kind !== 'generated-images' || !Array.isArray(data.assets)) {
      return [];
    }

    return data.assets
      .map((asset) => ({
        id: String(asset?.id || '').trim(),
        previewUrl: String(asset?.previewUrl || '').trim(),
        prompt: typeof asset?.prompt === 'string' ? asset.prompt : undefined,
      }))
      .filter((asset) => asset.id && asset.previewUrl);
  }

  private appendGeneratedImagesMarkdown(content: string, images: GeneratedImagePreview[]): string {
    const normalized = String(content || '').trim();
    const uniqueImages = images.filter((image, index, list) =>
      list.findIndex((item) => item.id === image.id) === index
    );
    if (uniqueImages.length === 0) {
      return normalized;
    }

    const gallery = [
      '## 生成图片',
      ...uniqueImages.map((image, index) => `![generated-${index + 1}](${image.previewUrl})`),
    ].join('\n\n');

    return normalized ? `${normalized}\n\n${gallery}` : gallery;
  }

  private cleanupLeakedToolMarkup(response: string, hadRealToolExecution: boolean): ToolMarkupCleanupResult {
    const text = String(response || '');
    if (!text.trim() || hadRealToolExecution) {
      return { hasLeakedToolMarkup: false, cleanedText: text, leakedToolNames: [] };
    }

    const toolNameSet = new Set(
      this.toolRegistry.getAllTools().map((tool) => String(tool.name || '').trim().toLowerCase()).filter(Boolean)
    );
    const explicitToolLikeTags = new Set([
      'read_file',
      'write_file',
      'list_dir',
      'grep',
      'bash',
      'app_cli',
      'save_memory',
      'skill',
      'activate_skill',
    ]);

    const mergedToolSet = new Set([...toolNameSet, ...explicitToolLikeTags]);
    const leakedToolNames: string[] = [];
    const blockPattern = /<([a-z_][a-z0-9_]*)>([\s\S]*?)<\/\1>/gi;
    const matches = [...text.matchAll(blockPattern)];

    if (matches.length === 0) {
      return { hasLeakedToolMarkup: false, cleanedText: text, leakedToolNames: [] };
    }

    const leakedBlocks = matches.filter((match) => mergedToolSet.has(String(match[1] || '').toLowerCase()));
    if (leakedBlocks.length === 0) {
      return { hasLeakedToolMarkup: false, cleanedText: text, leakedToolNames: [] };
    }

    leakedBlocks.forEach((match) => {
      const toolName = String(match[1] || '').toLowerCase();
      if (toolName && !leakedToolNames.includes(toolName)) {
        leakedToolNames.push(toolName);
      }
    });

    const cleanedText = text.replace(blockPattern, (full, tagName: string) => {
      return mergedToolSet.has(String(tagName || '').toLowerCase()) ? '' : full;
    }).trim();

    if (cleanedText) {
      return {
        hasLeakedToolMarkup: true,
        cleanedText,
        leakedToolNames,
      };
    }

    return {
      hasLeakedToolMarkup: true,
      cleanedText: '当前模型返回了内部工具调用标记，未产出可读结果。请切换到更稳定的工具调用模型后重试（如 DeepSeek / OpenAI / Claude）。',
      leakedToolNames,
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
    return DEFAULT_MODEL_CONTEXT_WINDOW_FALLBACK;
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
    if (force && history.length < 2) {
      return metadata;
    }

    const compactBaseCount = Math.max(0, Math.min(history.length, metadata.compactBaseMessageCount || 0));
    const compactSummaryTokens = metadata.compactSummary ? this.estimateTokenCountFromText(metadata.compactSummary) : 0;
    const activeHistory = history.slice(compactBaseCount);
    const activeHistoryChars = activeHistory.reduce((acc, msg) => acc + String(msg.content || '').length, 0);
    const estimatedTotal = this.estimateTokenCountForHistory(activeHistory) + compactSummaryTokens;
    const compactThreshold = this.getRedClawCompactThreshold(contextWindow, redClawCompactTargetTokens);
    const shouldCompactByTokens = estimatedTotal >= compactThreshold;
    const shouldCompactByMessageCount = activeHistory.length >= 48;
    const shouldCompactByChars = activeHistoryChars >= 28000;

    if (!force && !shouldCompactByTokens && !shouldCompactByMessageCount && !shouldCompactByChars) {
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
    if (deltaMessages.length < (force ? 1 : 6)) {
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
          if (typeof value.delta === 'string') return value.delta;
          return '';
        })
        .join('');
    }

    if (typeof content === 'object') {
      const value = content as Record<string, unknown>;
      if (typeof value.text === 'string') return value.text;
      if (typeof value.content === 'string') return value.content;
      if (typeof value.delta === 'string') return value.delta;
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

  private buildAvailableToolsSummary(): string {
    const tools = this.toolRegistry.getAllTools();
    if (!tools.length) {
      return '- (no tools registered)';
    }
    return tools
      .slice(0, 120)
      .map((tool) => `- ${tool.name}: ${String(tool.description || '').trim() || 'No description'}`)
      .join('\n');
  }

  private buildPiDocumentationSection(
    workspacePaths: ReturnType<typeof getWorkspacePaths>,
    redClawProfileBundle?: RedClawProfilePromptBundle | null,
  ): string {
    const memoryPath = path.join(workspacePaths.base, 'memory', 'MEMORY.md');
    const profileRoot = redClawProfileBundle?.profileRoot || path.join(workspacePaths.redclaw, 'profile');
    const agentPath = path.join(profileRoot, 'Agent.md');
    const soulPath = path.join(profileRoot, 'Soul.md');
    const identityPath = path.join(profileRoot, 'identity.md');
    const userPath = path.join(profileRoot, 'user.md');
    const creatorProfilePath = path.join(profileRoot, 'CreatorProfile.md');
    const appCliPath = path.join(process.cwd(), 'desktop', 'electron', 'core', 'tools', 'appCliTool.ts');
    const promptsLibraryPath = path.join(process.cwd(), 'desktop', 'electron', 'prompts', 'library');

    return [
      `- Main documentation: app_cli tool usage (${appCliPath})`,
      `- Additional docs: prompt library (${promptsLibraryPath})`,
      '- Examples: use `app_cli(command="...")` with concrete subcommands',
      `- Memory document: ${memoryPath}`,
      `- Agent document: ${agentPath}`,
      `- Soul document: ${soulPath}`,
      `- Identity document: ${identityPath}`,
      `- User profile document: ${userPath}`,
      `- Creator strategy document: ${creatorProfilePath}`,
    ].join('\n');
  }

  private buildProjectContextSection(workspacePaths: ReturnType<typeof getWorkspacePaths>): string {
    const candidateDirs = new Set<string>([
      workspacePaths.base,
      workspacePaths.workspaceRoot,
      process.cwd(),
    ]);

    let currentDir = workspacePaths.base;
    for (let i = 0; i < 5; i += 1) {
      candidateDirs.add(currentDir);
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }

    const blocks: string[] = [];
    const seen = new Set<string>();
    for (const dir of candidateDirs) {
      const agentsPath = path.join(dir, 'AGENTS.md');
      if (seen.has(agentsPath)) continue;
      seen.add(agentsPath);
      if (!fs.existsSync(agentsPath)) continue;
      try {
        const content = fs.readFileSync(agentsPath, 'utf-8').trim();
        if (!content) continue;
        blocks.push(`## ${agentsPath}\n${this.truncate(content, 5000)}`);
      } catch (error) {
        blocks.push(`## ${agentsPath}\n(读取失败: ${String(error)})`);
      }
    }

    if (!blocks.length) {
      return '## (No AGENTS.md found in current workspace scope)\nUse default repo and system instructions.';
    }
    return blocks.join('\n\n');
  }

  private buildSkillsSection(skillsXml: string, activeSkillContents: string[]): string {
    const parts: string[] = [];
    if (skillsXml) {
      parts.push('## Available Skills (XML)');
      parts.push(skillsXml);
    }
    if (activeSkillContents.length > 0) {
      parts.push('## Active Skill Instructions');
      for (const skillContent of activeSkillContents) {
        parts.push(skillContent);
      }
    }
    if (!parts.length) {
      parts.push('(No skill metadata available)');
    }
    return parts.join('\n\n');
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
    redClawProjectContext: string,
    redClawProfileBundle?: RedClawProfilePromptBundle | null,
  ): string {
    const workspace = workspacePaths.base;
    const skillsXml = this.skillManager.getSkillsXml();
    const activeSkillContents = this.skillManager.getActiveSkillContents();
    const mcpServers = getMcpServers().filter((server) => server.enabled);

    const promptParts: string[] = [
      renderPrompt(PI_CHAT_SYSTEM_BASE_TEMPLATE, {
        available_tools: this.buildAvailableToolsSummary(),
        pi_documentation: this.buildPiDocumentationSection(workspacePaths, redClawProfileBundle),
        project_context: this.buildProjectContextSection(workspacePaths),
        skills_section: this.buildSkillsSection(skillsXml, activeSkillContents),
        current_date: new Date().toISOString(),
        current_working_directory: workspace,
        workspace,
        platform: process.platform,
        workspace_root: workspacePaths.workspaceRoot,
        current_space_root: workspacePaths.base,
        skills_path: workspacePaths.skills,
        knowledge_path: workspacePaths.knowledge,
        knowledge_redbook_path: workspacePaths.knowledgeRedbook,
        knowledge_youtube_path: workspacePaths.knowledgeYoutube,
        advisors_path: workspacePaths.advisors,
        manuscripts_path: workspacePaths.manuscripts,
        media_path: workspacePaths.media,
        redclaw_path: workspacePaths.redclaw,
        redclaw_profile_path: `${workspacePaths.redclaw}/profile`,
        memory_path: `${workspacePaths.base}/memory`,
      }),
    ];

    if (mcpServers.length > 0) {
      promptParts.push(
        '',
        '## 已配置 MCP 数据源（启用）',
        ...mcpServers.slice(0, 20).map((server) => {
          if (server.transport === 'stdio') {
            return `- ${server.id}: ${server.name} [stdio] command=${server.command || '(missing)'}`;
          }
          return `- ${server.id}: ${server.name} [${server.transport}] url=${server.url || '(missing)'}`;
        }),
        '- 如需使用/检查数据源，优先调用 `app_cli` 的 mcp 子命令。',
      );
    }

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

    if (metadata.contextType === 'redclaw' && redClawProfileBundle) {
      promptParts.push(
        '',
        '## RedClaw 个性化档案（空间隔离）',
        `- ProfileRoot: ${redClawProfileBundle.profileRoot}`,
        '- 档案文件: Agent.md / Soul.md / identity.md / user.md / CreatorProfile.md',
        '<redclaw_agent_md>',
        this.truncate(redClawProfileBundle.files.agent || '', 6000),
        '</redclaw_agent_md>',
        '<redclaw_soul_md>',
        this.truncate(redClawProfileBundle.files.soul || '', 6000),
        '</redclaw_soul_md>',
        '<redclaw_identity_md>',
        this.truncate(redClawProfileBundle.files.identity || '', 4000),
        '</redclaw_identity_md>',
        '<redclaw_user_md>',
        this.truncate(redClawProfileBundle.files.user || '', 8000),
        '</redclaw_user_md>',
        '<redclaw_creator_profile_md>',
        this.truncate(redClawProfileBundle.files.creatorProfile || '', 10000),
        '</redclaw_creator_profile_md>',
        '文档职责与更新规则：',
        '- Agent.md：RedClaw 的工作契约、执行规则、标准流程。只有当用户明确要求修改 RedClaw 的工作方式、流程、约束、职责边界时才更新，避免为临时任务改写。',
        '- Soul.md：RedClaw 的协作语气、反馈风格、人格倾向。用户明确调整沟通风格、批判力度、表达方式时更新。',
        '- user.md：用户稳定画像与长期事实，例如目标、受众、内容赛道、发布节奏、成功指标。用户明确给出新的长期事实时更新。',
        '- CreatorProfile.md：用户长期自媒体定位与策略主档案，包括定位、目标群体、内容风格、商业目标、运营边界。用户明确给出这类长期变化时更新。',
        '- 如果只是一次性任务要求、单篇稿件偏好或临时实验，不要改这些长期文档；优先体现在当前任务执行里，必要时写入普通长期记忆。',
        '- 更新这些文档时，优先使用 `redclaw_update_profile_doc`；若只改 CreatorProfile.md，也可使用 `redclaw_update_creator_profile`。',
      );

      if (!redClawProfileBundle.onboardingState.completedAt && redClawProfileBundle.files.bootstrap) {
        promptParts.push(
          '',
          '## RedClaw 首次设定引导状态',
          `- completed: false`,
          `- stepIndex: ${redClawProfileBundle.onboardingState.stepIndex || 0}`,
          '<redclaw_bootstrap>',
          this.truncate(redClawProfileBundle.files.bootstrap, 3000),
          '</redclaw_bootstrap>',
          '当前空间尚未完成首次设定。优先完成偏好采集后再推进复杂任务。',
        );
      }
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
        '',
        '### RedClaw 自动化能力（强约束）',
        '- 你具备后台自动化能力：可以创建/修改/删除/执行 定时任务、长周期任务、心跳与后台轮询。',
        '- 当用户提出“在某时间提醒/报时/定时执行”这类请求时，禁止回答“我无法定时/无法主动发送消息”。必须通过 `app_cli` 配置自动化任务。',
        '- 标准流程：先 `app_cli(command="redclaw runner-status")` 检查后台状态；若未开启则 `app_cli(command="redclaw runner-start --interval 20")`；然后用 `redclaw schedule-add`/`schedule-update` 完成任务。',
        '- 配置完成后必须回显：任务名、模式、时间（或间隔）、enabled 状态、nextRunAt（若工具有返回）。',
        '- 若任务实际回执可能写入任务会话，仍需在当前会话明确说明结果同步策略，避免用户误判“未执行”。',
      );
    }

    if (metadata.compactSummary) {
      console.log('[PiChatService] compact-memory-injected', {
        sessionId: this.sessionId,
        compactRounds: metadata.compactRounds || 1,
        compactUpdatedAt: metadata.compactUpdatedAt || '',
      });
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

    return promptParts.join('\n');
  }
}

export default PiChatService;
