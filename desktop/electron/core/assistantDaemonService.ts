import { EventEmitter } from 'events';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { app } from 'electron';
import * as lark from '@larksuiteoapi/node-sdk';
import { getWorkspacePaths } from '../db';
import { getBackgroundTaskRegistry } from './backgroundTaskRegistry';
import { getHeadlessAgentRunner } from './headlessAgentRunner';
import {
  releaseBackgroundRuntimeLock,
  tryAcquireBackgroundRuntimeLock,
} from './backgroundRuntimeLock';

type AssistantChannelProvider = 'feishu' | 'weixin' | 'relay';
type DaemonLockState = 'owner' | 'passive';

type AssistantDaemonIngressMessage = {
  provider: AssistantChannelProvider;
  accountId?: string;
  peerId: string;
  userId?: string;
  userName?: string;
  messageId?: string;
  text: string;
  waitForReply?: boolean;
  metadata?: Record<string, unknown>;
};

type AssistantDaemonProcessResult = {
  taskId: string;
  sessionId: string;
  response: string;
};

type WeixinExecutionStrategy = {
  mode: 'simple' | 'delegated';
  forcedIntent: 'direct_answer' | 'knowledge_retrieval' | 'manuscript_creation' | 'image_creation' | 'long_running_task';
  forceMultiAgent: boolean;
  subagentRoles?: Array<'planner' | 'researcher' | 'copywriter' | 'image-director' | 'reviewer' | 'ops-coordinator'>;
  summary: string;
};

type WeixinOutboundMessage = {
  id: string;
  accountId?: string;
  peerId: string;
  text: string;
  createdAt: string;
  contextToken?: string;
  taskId?: string;
  kind?: 'ack' | 'progress' | 'final' | 'error';
};

type FeishuDaemonConfig = {
  enabled: boolean;
  receiveMode: 'webhook' | 'websocket';
  endpointPath: string;
  verificationToken?: string;
  encryptKey?: string;
  appId?: string;
  appSecret?: string;
  replyUsingChatId: boolean;
};

type RelayDaemonConfig = {
  enabled: boolean;
  endpointPath: string;
  authToken?: string;
};

type WeixinDaemonConfig = {
  enabled: boolean;
  endpointPath: string;
  authToken?: string;
  accountId?: string;
  autoStartSidecar: boolean;
  cursorFile?: string;
  sidecarCommand?: string;
  sidecarArgs?: string[];
  sidecarCwd?: string;
  sidecarEnv?: Record<string, string>;
};

type AssistantDaemonConfig = {
  enabled: boolean;
  autoStart: boolean;
  keepAliveWhenNoWindow: boolean;
  host: string;
  port: number;
  feishu: FeishuDaemonConfig;
  relay: RelayDaemonConfig;
  weixin: WeixinDaemonConfig;
};

export type AssistantDaemonConfigPatch = {
  enabled?: boolean;
  autoStart?: boolean;
  keepAliveWhenNoWindow?: boolean;
  host?: string;
  port?: number;
  feishu?: Partial<FeishuDaemonConfig>;
  relay?: Partial<RelayDaemonConfig>;
  weixin?: Partial<WeixinDaemonConfig>;
};

export type AssistantDaemonStatus = {
  enabled: boolean;
  autoStart: boolean;
  keepAliveWhenNoWindow: boolean;
  host: string;
  port: number;
  listening: boolean;
  lockState: DaemonLockState;
  blockedBy: string | null;
  lastError: string | null;
  activeTaskCount: number;
  queuedPeerCount: number;
  inFlightKeys: string[];
  feishu: FeishuDaemonConfig & { webhookUrl: string; websocketRunning: boolean; websocketReconnectAt?: string | null };
  relay: RelayDaemonConfig & { webhookUrl: string };
  weixin: WeixinDaemonConfig & {
    webhookUrl: string;
    sidecarRunning: boolean;
    sidecarPid?: number;
    connected: boolean;
    userId?: string;
    stateDir: string;
    availableAccountIds: string[];
  };
};

export type AssistantDaemonWeixinLoginStartResult = {
  success: boolean;
  sessionKey?: string;
  qrcodeUrl?: string;
  message: string;
  stateDir: string;
};

export type AssistantDaemonWeixinLoginWaitResult = {
  success: boolean;
  connected: boolean;
  message: string;
  accountId?: string;
  userId?: string;
};

const DEFAULT_CONFIG: AssistantDaemonConfig = {
  enabled: false,
  autoStart: true,
  keepAliveWhenNoWindow: true,
  host: '127.0.0.1',
  port: 31937,
  feishu: {
    enabled: false,
    receiveMode: 'webhook',
    endpointPath: '/hooks/feishu/events',
    replyUsingChatId: true,
  },
  relay: {
    enabled: true,
    endpointPath: '/hooks/channel/relay',
  },
  weixin: {
    enabled: false,
    endpointPath: '/hooks/weixin/relay',
    autoStartSidecar: false,
  },
};

const LOCK_PROBE_INTERVAL_MS = 5_000;
const MESSAGE_DEDUPE_TTL_MS = 15 * 60 * 1000;
const MAX_RECENT_MESSAGE_IDS = 2000;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const WEIXIN_THOUGHT_MIN_INTERVAL_MS = 3_000;
const WEIXIN_HEARTBEAT_INTERVAL_MS = 15_000;
const WEIXIN_PHASE_UPDATE_MIN_INTERVAL_MS = 4_000;

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizePort(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CONFIG.port;
  return Math.max(1024, Math.min(65535, Math.round(parsed)));
}

function sanitizeHost(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return DEFAULT_CONFIG.host;
  return text;
}

function sanitizeEndpointPath(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.startsWith('/') ? text : `/${text}`;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function sanitizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) continue;
    next[normalizedKey] = String(raw ?? '');
  }
  return next;
}

function normalizeWeixinAccountId(value: unknown): string | undefined {
  const text = String(value || '').trim();
  if (!text) return undefined;
  return text.replace(/[@.]/g, '-');
}

function normalizeConfig(input?: AssistantDaemonConfigPatch | null): AssistantDaemonConfig {
  const feishuInput: Partial<FeishuDaemonConfig> = input?.feishu || {};
  const relayInput: Partial<RelayDaemonConfig> = input?.relay || {};
  const weixinInput: Partial<WeixinDaemonConfig> = input?.weixin || {};
  return {
    enabled: Boolean(input?.enabled),
    autoStart: input?.autoStart === undefined ? DEFAULT_CONFIG.autoStart : Boolean(input.autoStart),
    keepAliveWhenNoWindow: input?.keepAliveWhenNoWindow === undefined
      ? DEFAULT_CONFIG.keepAliveWhenNoWindow
      : Boolean(input.keepAliveWhenNoWindow),
    host: sanitizeHost(input?.host),
    port: sanitizePort(input?.port),
    feishu: {
      enabled: Boolean(feishuInput.enabled),
      receiveMode: feishuInput.receiveMode === 'websocket' ? 'websocket' : 'webhook',
      endpointPath: sanitizeEndpointPath(feishuInput.endpointPath, DEFAULT_CONFIG.feishu.endpointPath),
      verificationToken: String(feishuInput.verificationToken || '').trim() || undefined,
      encryptKey: String(feishuInput.encryptKey || '').trim() || undefined,
      appId: String(feishuInput.appId || '').trim() || undefined,
      appSecret: String(feishuInput.appSecret || '').trim() || undefined,
      replyUsingChatId: feishuInput.replyUsingChatId === undefined
        ? DEFAULT_CONFIG.feishu.replyUsingChatId
        : Boolean(feishuInput.replyUsingChatId),
    },
    relay: {
      enabled: relayInput.enabled === undefined ? DEFAULT_CONFIG.relay.enabled : Boolean(relayInput.enabled),
      endpointPath: sanitizeEndpointPath(relayInput.endpointPath, DEFAULT_CONFIG.relay.endpointPath),
      authToken: String(relayInput.authToken || '').trim() || undefined,
    },
    weixin: {
      enabled: Boolean(weixinInput.enabled),
      endpointPath: sanitizeEndpointPath(weixinInput.endpointPath, DEFAULT_CONFIG.weixin.endpointPath),
      authToken: String(weixinInput.authToken || '').trim() || undefined,
      accountId: normalizeWeixinAccountId(weixinInput.accountId),
      autoStartSidecar: Boolean(weixinInput.autoStartSidecar),
      cursorFile: String(weixinInput.cursorFile || '').trim() || undefined,
      sidecarCommand: String(weixinInput.sidecarCommand || '').trim() || undefined,
      sidecarArgs: sanitizeStringArray(weixinInput.sidecarArgs),
      sidecarCwd: String(weixinInput.sidecarCwd || '').trim() || undefined,
      sidecarEnv: sanitizeStringRecord(weixinInput.sidecarEnv),
    },
  };
}

function mergeConfig(base: AssistantDaemonConfig, patch?: AssistantDaemonConfigPatch | null): AssistantDaemonConfig {
  if (!patch) {
    return normalizeConfig(base);
  }
  return normalizeConfig({
    ...base,
    ...patch,
    feishu: {
      ...base.feishu,
      ...(patch.feishu || {}),
    },
    relay: {
      ...base.relay,
      ...(patch.relay || {}),
    },
    weixin: {
      ...base.weixin,
      ...(patch.weixin || {}),
    },
  });
}

function createWebhookUrl(host: string, port: number, endpointPath: string): string {
  return `http://${host}:${port}${endpointPath}`;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'unknown error');
}

function humanizeWeixinLoginMessage(message: string): string {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) {
    return '微信连接失败，请稍后重试。';
  }
  if (lower.includes('fetch failed') || lower.includes('econnreset') || lower.includes('tls')) {
    return '微信二维码获取失败：当前网络无法连接腾讯 iLink 网关。请检查外网连通性，或先在设置里开启全局代理后重试。';
  }
  return text;
}

async function readRequestBody(req: http.IncomingMessage): Promise<{ raw: string; json: Record<string, unknown> }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += next.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new Error('Request body too large');
    }
    chunks.push(next);
  }
  if (!chunks.length) return { raw: '', json: {} };
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return { raw: '', json: {} };
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { raw, json: {} };
  }
  return {
    raw,
    json: parsed as Record<string, unknown>,
  };
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(body);
}

function parseFeishuTextContent(content: unknown): string {
  const raw = String(content || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { text?: unknown };
    return String(parsed?.text || '').trim();
  } catch {
    return raw;
  }
}

function buildRelayPrompt(message: AssistantDaemonIngressMessage): string {
  if (message.provider === 'weixin') {
    return buildWeixinRelayPrompt(message, resolveWeixinExecutionStrategy(message.text));
  }
  const lines = [
    '你现在是 RedConvert 的长期在线后台助理，正在通过外部消息渠道接收用户指令。',
    `渠道: ${message.provider}`,
    `会话键: ${message.accountId ? `${message.accountId}:` : ''}${message.peerId}`,
  ];
  if (message.userName || message.userId) {
    lines.push(`发送者: ${message.userName || message.userId}`);
  }
  lines.push('输出要求:');
  lines.push('- 直接回答用户，不要暴露系统实现。');
  lines.push('- 默认输出适合聊天软件发送的纯文本。');
  lines.push('- 除非用户要求，不要输出 Markdown 表格。');
  lines.push('用户消息:');
  lines.push(message.text);
  return lines.join('\n');
}

function buildWeixinRelayPrompt(message: AssistantDaemonIngressMessage, strategy: WeixinExecutionStrategy): string {
  const lines = [
    '你现在是 RedBox 里的自媒体运营助手，负责通过微信和用户沟通。',
    '你处理的是微信私聊消息，回复必须适合直接发送到微信文本消息。',
    `会话键: ${message.accountId ? `${message.accountId}:` : ''}${message.peerId}`,
  ];
  if (message.userName || message.userId) {
    lines.push(`发送者: ${message.userName || message.userId}`);
  }
  lines.push('微信回复规则:');
  lines.push('- 只能输出纯文本，不要输出 Markdown、HTML、XML、表格、代码块。');
  lines.push('- 不要使用富文本格式，不要返回工具日志、思维过程、结构化标签。');
  lines.push('- 除非用户明确要求长文，否则优先简洁直接。');
  lines.push('- 如果你原本想返回列表，请改成纯文本分行。');
  lines.push('- 如果用户要求无法在微信纯文本里良好表达，先用纯文本解释限制，再给出最可用的纯文本版本。');
  lines.push('- 你的角色是自媒体运营助手，擅长选题、内容策划、标题优化、文案建议、发布安排、复盘建议。');
  lines.push('- 你是前台秘书，不是埋头执行的大工位。你的主要职责是接单、分派、催办、检查结果、向用户同步进展。');
  lines.push('- 简单查询、简单判断、简短建议可以由你直接完成。');
  lines.push('- 复杂任务必须交给子角色处理，你自己只负责说明安排、检查进度、汇报结果，不要亲自承担整条长链执行。');
  lines.push('- 你可以使用当前微信会话的历史消息来理解上下文，不要把每一轮都当成全新的独立问题。');
  lines.push(`- 当前任务策略: ${strategy.mode === 'delegated' ? `复杂任务，优先分派给子角色。建议分派链路：${(strategy.subagentRoles || []).join(' -> ') || 'planner -> ops-coordinator -> reviewer'}` : '简单任务，可以直接回复，但仍要保持秘书式口吻。'}`);
  lines.push('用户消息:');
  lines.push(message.text);
  return lines.join('\n');
}

function previewText(value: string, limit = 160): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function humanizeBackgroundPhase(phase: string | undefined): string {
  switch (String(phase || '').trim()) {
    case 'starting':
      return '准备处理中';
    case 'thinking':
      return '正在思考';
    case 'tooling':
      return '正在调用工具';
    case 'responding':
      return '正在整理回复';
    case 'updating':
      return '正在同步进展';
    default:
      return '处理中';
  }
}

function humanizeWorkerState(workerState: string | undefined): string {
  switch (String(workerState || '').trim()) {
    case 'starting':
      return '子任务启动中';
    case 'running':
      return '子任务执行中';
    case 'retry_wait':
      return '等待重试';
    case 'timed_out':
      return '等待超时恢复';
    case 'stopping':
      return '收尾中';
    default:
      return '';
  }
}

function buildWeixinHeartbeatText(task: {
  phase?: string;
  latestText?: string;
  workerState?: string;
  workerLastHeartbeatAt?: string;
}, strategy?: WeixinExecutionStrategy): string {
  const phaseLabel = humanizeBackgroundPhase(task.phase);
  const workerLabel = humanizeWorkerState(task.workerState);
  const latestText = previewText(String(task.latestText || '').trim(), 80);
  const parts = [
    strategy?.mode === 'delegated'
      ? `进展同步：我正在跟进子任务，当前阶段：${phaseLabel}。`
      : `进展同步：我还在处理，当前阶段：${phaseLabel}。`,
  ];
  if (latestText && !/^(收到|输出回复：)/.test(latestText)) {
    parts.push(`最近动作：${latestText}。`);
  } else if (workerLabel) {
    parts.push(`当前状态：${workerLabel}。`);
  }
  if (task.workerLastHeartbeatAt) {
    const heartbeatAgeMs = Date.now() - new Date(task.workerLastHeartbeatAt).getTime();
    if (Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs > 45_000) {
      parts.push('我还在等待后台子任务回报。');
    }
  }
  return sanitizeWeixinReplyText(parts.join(' '));
}

function sanitizeWeixinReplyText(input: string): string {
  let text = String(input || '').trim();
  if (!text) return '';

  text = text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 $2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function finalizeRelayResponse(message: AssistantDaemonIngressMessage, response: string): string {
  if (message.provider !== 'weixin') {
    return String(response || '').trim();
  }
  const sanitized = sanitizeWeixinReplyText(response);
  return sanitized || '已收到你的消息，但当前没有生成可发送的纯文本回复。请稍后再试。';
}

function shouldUseWeixinSubagents(text: string): boolean {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length >= 80) return true;
  return [
    '帮我',
    '请你',
    '方案',
    '计划',
    '写一篇',
    '做一个',
    '分析',
    '调研',
    '整理',
    '自动',
    '持续',
    '后台',
    '长期',
    '执行',
    '一步一步',
    '完整',
    '详细',
  ].some((part) => normalized.includes(part));
}

function resolveWeixinExecutionStrategy(text: string): WeixinExecutionStrategy {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) {
    return {
      mode: 'simple',
      forcedIntent: 'direct_answer',
      forceMultiAgent: false,
      summary: 'empty',
    };
  }

  const contentParts = ['小红书', '公众号', '标题', '正文', '文案', '脚本', '选题', '封面', '发布', '复盘', '口播'];
  const imageParts = ['封面图', '海报', '配图', '图片', '视觉'];
  const researchParts = ['调研', '研究', '分析', '检索', '查一下', '找资料', '总结', '拆解', '对比'];
  const complexParts = [
    '帮我',
    '请你',
    '方案',
    '计划',
    '完整',
    '详细',
    '整理',
    '写一篇',
    '做一个',
    '执行',
    '跟进',
    '持续',
    '长期',
    '自动',
    '一步一步',
    '全流程',
    '从0到1',
  ];
  const hasContentIntent = contentParts.some((part) => normalized.includes(part));
  const hasImageIntent = imageParts.some((part) => normalized.includes(part));
  const hasResearchIntent = researchParts.some((part) => normalized.includes(part));
  const isComplex = shouldUseWeixinSubagents(normalized)
    || complexParts.some((part) => normalized.includes(part))
    || normalized.includes('\n')
    || (hasContentIntent && normalized.length >= 12)
    || (hasResearchIntent && normalized.length >= 16);

  if (!isComplex) {
    return {
      mode: 'simple',
      forcedIntent: 'direct_answer',
      forceMultiAgent: false,
      summary: hasResearchIntent ? 'simple-research' : 'simple-direct-answer',
    };
  }

  if (hasImageIntent) {
    return {
      mode: 'delegated',
      forcedIntent: 'image_creation',
      forceMultiAgent: true,
      subagentRoles: ['planner', 'researcher', 'image-director', 'reviewer'],
      summary: 'delegated-image',
    };
  }
  if (hasContentIntent) {
    return {
      mode: 'delegated',
      forcedIntent: 'manuscript_creation',
      forceMultiAgent: true,
      subagentRoles: ['planner', 'researcher', 'copywriter', 'reviewer'],
      summary: 'delegated-content',
    };
  }
  if (hasResearchIntent) {
    return {
      mode: 'delegated',
      forcedIntent: 'knowledge_retrieval',
      forceMultiAgent: true,
      subagentRoles: ['planner', 'researcher', 'reviewer'],
      summary: 'delegated-research',
    };
  }
  return {
    mode: 'delegated',
    forcedIntent: 'long_running_task',
    forceMultiAgent: true,
    subagentRoles: ['planner', 'ops-coordinator', 'reviewer'],
    summary: 'delegated-generic',
  };
}

type WeixinAccountRuntimeStatus = {
  accountId?: string;
  connected: boolean;
  userId?: string;
  availableAccountIds: string[];
  stateDir: string;
};

export class AssistantDaemonService extends EventEmitter {
  private config: AssistantDaemonConfig = { ...DEFAULT_CONFIG };
  private isLoaded = false;
  private readonly lockOwnerId = `assistant-daemon:${process.pid}:${Date.now().toString(36)}`;
  private lockState: DaemonLockState = 'passive';
  private blockedBy: string | null = null;
  private server: http.Server | null = null;
  private listening = false;
  private lastError: string | null = null;
  private lockProbeTimer: NodeJS.Timeout | null = null;
  private readonly peerQueues = new Map<string, Promise<AssistantDaemonProcessResult>>();
  private readonly inFlightKeys = new Set<string>();
  private readonly recentMessageIds = new Map<string, number>();
  private feishuClient: lark.Client | null = null;
  private feishuEventDispatcher: lark.EventDispatcher | null = null;
  private feishuWsClient: lark.WSClient | null = null;
  private weixinSidecar: ChildProcessWithoutNullStreams | null = null;

  private getConfigPath(): string {
    return path.join(getWorkspacePaths().redclaw, 'assistant-daemon.json');
  }

  private getLockPath(): string {
    return path.join(getWorkspacePaths().redclaw, 'assistant-daemon.lock');
  }

  private getWeixinCursorPath(): string {
    return this.config.weixin.cursorFile
      || path.join(getWorkspacePaths().redclaw, 'weixin-sidecar.cursor.json');
  }

  private getWeixinStateRoot(): string {
    return path.join(getWorkspacePaths().redclaw, 'weixin-claw-state');
  }

  private getWeixinBridgeStateDir(): string {
    return path.join(this.getWeixinStateRoot(), 'weixin-bridge');
  }

  private getWeixinOutboxDir(): string {
    return path.join(this.getWeixinStateRoot(), 'outbox');
  }

  private getWeixinAccountsIndexPath(): string {
    return path.join(this.getWeixinBridgeStateDir(), 'accounts.json');
  }

  private getWeixinAccountFilePath(accountId: string): string {
    return path.join(this.getWeixinBridgeStateDir(), 'accounts', `${normalizeWeixinAccountId(accountId) || accountId}.json`);
  }

  private readWeixinIndexedAccountIds(): string[] {
    try {
      const raw = fsSync.readFileSync(this.getWeixinAccountsIndexPath(), 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => normalizeWeixinAccountId(item))
        .filter((item): item is string => Boolean(item));
    } catch {
      return [];
    }
  }

  private readWeixinAccountRuntimeStatus(): WeixinAccountRuntimeStatus {
    const availableAccountIds = this.readWeixinIndexedAccountIds();
    const selectedAccountId = normalizeWeixinAccountId(this.config.weixin.accountId) || availableAccountIds[0];
    if (!selectedAccountId) {
      return {
        connected: false,
        availableAccountIds,
        stateDir: this.getWeixinStateRoot(),
      };
    }
    try {
      const raw = fsSync.readFileSync(this.getWeixinAccountFilePath(selectedAccountId), 'utf-8');
      const parsed = JSON.parse(raw) as { token?: string; userId?: string };
      return {
        accountId: selectedAccountId,
        connected: Boolean(String(parsed?.token || '').trim()),
        userId: String(parsed?.userId || '').trim() || undefined,
        availableAccountIds,
        stateDir: this.getWeixinStateRoot(),
      };
    } catch {
      return {
        accountId: selectedAccountId,
        connected: false,
        availableAccountIds,
        stateDir: this.getWeixinStateRoot(),
      };
    }
  }

  private async withWeixinStateDir<T>(handler: () => Promise<T>): Promise<T> {
    const previous = process.env.WEIXIN_BRIDGE_STATE_DIR;
    process.env.WEIXIN_BRIDGE_STATE_DIR = this.getWeixinStateRoot();
    try {
      return await handler();
    } finally {
      if (previous === undefined) {
        delete process.env.WEIXIN_BRIDGE_STATE_DIR;
      } else {
        process.env.WEIXIN_BRIDGE_STATE_DIR = previous;
      }
    }
  }

  private async enqueueWeixinOutboundMessage(message: WeixinOutboundMessage): Promise<void> {
    const text = sanitizeWeixinReplyText(message.text);
    if (!text) return;
    const outboxDir = this.getWeixinOutboxDir();
    await fs.mkdir(outboxDir, { recursive: true });
    const filePath = path.join(
      outboxDir,
      `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${message.id}.json`,
    );
    await fs.writeFile(filePath, JSON.stringify({
      ...message,
      text,
    }, null, 2), 'utf-8');
    this.emitLog('info', 'Queued weixin outbound message.', {
      peerId: message.peerId,
      accountId: message.accountId,
      taskId: message.taskId,
      kind: message.kind,
      preview: previewText(text),
    });
  }

  private getWeixinBootstrapScriptPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'start-weixin-sidecar.cjs');
    }
    return path.join(app.getAppPath(), 'scripts', 'start-weixin-sidecar.cjs');
  }

  async init(): Promise<void> {
    await this.ensureLoaded();
    if (this.config.enabled && this.config.autoStart) {
      await this.startServerIfNeeded();
    }
    this.emitStatus();
  }

  async reloadForWorkspaceChange(): Promise<void> {
    await this.stopServerInternals();
    this.isLoaded = false;
    this.lockState = 'passive';
    this.blockedBy = null;
    this.lastError = null;
    this.feishuClient = null;
    this.feishuEventDispatcher = null;
    await this.init();
  }

  async dispose(): Promise<void> {
    await this.stopServerInternals();
    this.clearLockProbe();
    this.feishuClient = null;
    this.feishuEventDispatcher = null;
    this.lastError = null;
    this.emitStatus();
  }

  async shouldKeepAliveWhenNoWindow(): Promise<boolean> {
    await this.ensureLoaded();
    return this.config.enabled && this.config.keepAliveWhenNoWindow && this.lockState === 'owner';
  }

  getStatus(): AssistantDaemonStatus {
    const weixinRuntimeStatus = this.readWeixinAccountRuntimeStatus();
    return {
      enabled: this.config.enabled,
      autoStart: this.config.autoStart,
      keepAliveWhenNoWindow: this.config.keepAliveWhenNoWindow,
      host: this.config.host,
      port: this.config.port,
      listening: this.listening,
      lockState: this.lockState,
      blockedBy: this.blockedBy,
      lastError: this.lastError,
      activeTaskCount: this.inFlightKeys.size,
      queuedPeerCount: this.peerQueues.size,
      inFlightKeys: Array.from(this.inFlightKeys.values()),
      feishu: {
        ...this.config.feishu,
        webhookUrl: createWebhookUrl(this.config.host, this.config.port, this.config.feishu.endpointPath),
        websocketRunning: Boolean(this.feishuWsClient),
        websocketReconnectAt: this.feishuWsClient
          ? (() => {
              const info = this.feishuWsClient?.getReconnectInfo();
              if (!info?.nextConnectTime) return null;
              return new Date(info.nextConnectTime).toISOString();
            })()
          : null,
      },
      relay: {
        ...this.config.relay,
        webhookUrl: createWebhookUrl(this.config.host, this.config.port, this.config.relay.endpointPath),
      },
      weixin: {
        ...this.config.weixin,
        webhookUrl: createWebhookUrl(this.config.host, this.config.port, this.config.weixin.endpointPath),
        sidecarRunning: Boolean(this.weixinSidecar && !this.weixinSidecar.killed),
        sidecarPid: this.weixinSidecar?.pid,
        connected: weixinRuntimeStatus.connected,
        accountId: weixinRuntimeStatus.accountId || this.config.weixin.accountId,
        userId: weixinRuntimeStatus.userId,
        stateDir: weixinRuntimeStatus.stateDir,
        availableAccountIds: weixinRuntimeStatus.availableAccountIds,
      },
    };
  }

  async start(input?: AssistantDaemonConfigPatch): Promise<AssistantDaemonStatus> {
    await this.ensureLoaded();
    this.config = mergeConfig(this.config, input);
    this.config.enabled = true;
    this.feishuClient = null;
    this.feishuEventDispatcher = null;
    await this.persistConfig();
    await this.startServerIfNeeded();
    this.emitStatus();
    return this.getStatus();
  }

  async stop(): Promise<AssistantDaemonStatus> {
    await this.ensureLoaded();
    this.config.enabled = false;
    await this.persistConfig();
    await this.stopServerInternals();
    this.emitStatus();
    return this.getStatus();
  }

  async setConfig(input?: AssistantDaemonConfigPatch): Promise<AssistantDaemonStatus> {
    await this.ensureLoaded();
    const previousListeningAddress = `${this.config.host}:${this.config.port}`;
    this.config = mergeConfig(this.config, input);
    this.feishuClient = null;
    this.feishuEventDispatcher = null;
    await this.persistConfig();
    const nextListeningAddress = `${this.config.host}:${this.config.port}`;
    if (!this.config.enabled) {
      await this.stopServerInternals();
    } else if (this.listening && previousListeningAddress !== nextListeningAddress) {
      await this.stopServerInternals({ preserveEnabledState: true });
      await this.startServerIfNeeded();
    } else if (this.config.enabled && !this.listening) {
      await this.startServerIfNeeded();
    }
    await this.syncFeishuTransport();
    await this.syncWeixinSidecar();
    this.emitStatus();
    return this.getStatus();
  }

  async startWeixinLogin(input?: { accountId?: string; force?: boolean }): Promise<AssistantDaemonWeixinLoginStartResult> {
    await this.ensureLoaded();
    return this.withWeixinStateDir(async () => {
      const { startWeixinLoginWithQr } = await import(
        /* @vite-ignore */ '@weixin-claw/core/auth/login-qr'
      );
      const result = await startWeixinLoginWithQr({
        accountId: normalizeWeixinAccountId(input?.accountId || this.config.weixin.accountId),
        apiBaseUrl: 'https://ilinkai.weixin.qq.com',
        force: input?.force !== false,
      });
      const success = Boolean(result?.sessionKey && result?.qrcodeUrl);
      return {
        success,
        sessionKey: result?.sessionKey,
        qrcodeUrl: result?.qrcodeUrl,
        message: humanizeWeixinLoginMessage(String(result?.message || '')),
        stateDir: this.getWeixinStateRoot(),
      };
    });
  }

  async waitForWeixinLogin(input: { sessionKey?: string; timeoutMs?: number }): Promise<AssistantDaemonWeixinLoginWaitResult> {
    await this.ensureLoaded();
    const sessionKey = String(input?.sessionKey || '').trim();
    if (!sessionKey) {
      return {
        success: false,
        connected: false,
        message: '缺少 sessionKey，无法检查微信登录状态。',
      };
    }
    return this.withWeixinStateDir(async () => {
      const [{ waitForWeixinLogin }, { registerWeixinAccountId, saveWeixinAccount }] = await Promise.all([
        import(/* @vite-ignore */ '@weixin-claw/core/auth/login-qr'),
        import(/* @vite-ignore */ '@weixin-claw/core/auth/accounts'),
      ]);
      const result = await waitForWeixinLogin({
        sessionKey,
        timeoutMs: Math.max(1_000, Number(input?.timeoutMs || 1_000)),
        apiBaseUrl: 'https://ilinkai.weixin.qq.com',
      });
      if (!result.connected || !result.accountId || !result.botToken) {
        return {
          success: false,
          connected: false,
          message: String(result?.message || '微信尚未完成登录。'),
        };
      }
      const accountId = normalizeWeixinAccountId(result.accountId) || result.accountId;
      registerWeixinAccountId(accountId);
      saveWeixinAccount(accountId, {
        token: result.botToken,
        baseUrl: result.baseUrl,
        userId: result.userId,
      });
      this.config.weixin.enabled = true;
      this.config.weixin.autoStartSidecar = true;
      this.config.weixin.accountId = accountId;
      await this.persistConfig();
      await this.syncWeixinSidecar();
      this.emitStatus();
      return {
        success: true,
        connected: true,
        message: humanizeWeixinLoginMessage(String(result.message || '微信登录成功。')),
        accountId,
        userId: String(result.userId || '').trim() || undefined,
      };
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    await this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      const raw = await fs.readFile(this.getConfigPath(), 'utf-8');
      this.config = normalizeConfig(JSON.parse(raw) as AssistantDaemonConfigPatch);
    } catch {
      this.config = normalizeConfig(DEFAULT_CONFIG);
      await this.persistConfig();
    }
    this.isLoaded = true;
  }

  private async persistConfig(): Promise<void> {
    const configPath = this.getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>): void {
    this.emit('log', {
      at: nowIso(),
      level,
      message,
      details: details || {},
    });
  }

  private clearLockProbe(): void {
    if (!this.lockProbeTimer) return;
    clearTimeout(this.lockProbeTimer);
    this.lockProbeTimer = null;
  }

  private scheduleLockProbe(): void {
    this.clearLockProbe();
    if (!this.config.enabled || this.lockState === 'owner') {
      return;
    }
    this.lockProbeTimer = setTimeout(() => {
      void this.tryBecomeOwnerFromPassive();
    }, LOCK_PROBE_INTERVAL_MS);
  }

  private async acquireOwnership(): Promise<boolean> {
    const result = await tryAcquireBackgroundRuntimeLock(this.getLockPath(), this.lockOwnerId);
    if (result.acquired) {
      this.lockState = 'owner';
      this.blockedBy = null;
      this.clearLockProbe();
      return true;
    }
    this.lockState = 'passive';
    this.blockedBy = result.blockedBy || null;
    this.scheduleLockProbe();
    return false;
  }

  private async releaseOwnership(): Promise<void> {
    this.clearLockProbe();
    await releaseBackgroundRuntimeLock(this.getLockPath(), this.lockOwnerId);
    this.lockState = 'passive';
    this.blockedBy = null;
  }

  private async tryBecomeOwnerFromPassive(): Promise<void> {
    if (!this.config.enabled || this.lockState === 'owner') {
      return;
    }
    try {
      const acquired = await this.acquireOwnership();
      if (!acquired) {
        this.emitStatus();
        return;
      }
      this.emitLog('info', 'Assistant daemon acquired ownership after passive wait.');
      await this.startServerIfNeeded();
    } catch (error) {
      this.lastError = extractErrorMessage(error);
      this.emitLog('error', 'Assistant daemon failed to acquire ownership.', {
        error: this.lastError,
      });
    }
    this.emitStatus();
  }

  private cleanupRecentMessageIds(): void {
    const now = Date.now();
    for (const [key, at] of this.recentMessageIds.entries()) {
      if (now - at > MESSAGE_DEDUPE_TTL_MS) {
        this.recentMessageIds.delete(key);
      }
    }
    if (this.recentMessageIds.size <= MAX_RECENT_MESSAGE_IDS) {
      return;
    }
    const entries = Array.from(this.recentMessageIds.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, this.recentMessageIds.size - MAX_RECENT_MESSAGE_IDS);
    for (const [key] of entries) {
      this.recentMessageIds.delete(key);
    }
  }

  private isDuplicateMessage(provider: AssistantChannelProvider, messageId?: string): boolean {
    const normalized = String(messageId || '').trim();
    if (!normalized) return false;
    this.cleanupRecentMessageIds();
    const key = `${provider}:${normalized}`;
    if (this.recentMessageIds.has(key)) {
      return true;
    }
    this.recentMessageIds.set(key, Date.now());
    return false;
  }

  private getFeishuClient(): lark.Client {
    if (this.feishuClient) {
      return this.feishuClient;
    }
    if (!this.config.feishu.appId || !this.config.feishu.appSecret) {
      throw new Error('Feishu appId/appSecret is not configured');
    }
    this.feishuClient = new lark.Client({
      appId: this.config.feishu.appId,
      appSecret: this.config.feishu.appSecret,
    });
    return this.feishuClient;
  }

  private getFeishuEventDispatcher(): lark.EventDispatcher {
    if (this.feishuEventDispatcher) {
      return this.feishuEventDispatcher;
    }
    const dispatcher = new lark.EventDispatcher({
      verificationToken: this.config.feishu.verificationToken,
      encryptKey: this.config.feishu.encryptKey,
      loggerLevel: lark.LoggerLevel.warn,
    }).register({
      'im.message.receive_v1': async (data: any) => {
        await this.handleFeishuMessageEvent(data);
      },
    });
    this.feishuEventDispatcher = dispatcher;
    return dispatcher;
  }

  private async syncFeishuTransport(): Promise<void> {
    if (!this.config.enabled || this.lockState !== 'owner') {
      this.stopFeishuLongConnection();
      return;
    }
    const shouldRunWs = this.config.feishu.enabled
      && this.config.feishu.receiveMode === 'websocket'
      && Boolean(this.config.feishu.appId && this.config.feishu.appSecret);
    if (!shouldRunWs) {
      this.stopFeishuLongConnection();
      return;
    }
    if (this.feishuWsClient) {
      return;
    }
    const wsClient = new lark.WSClient({
      appId: this.config.feishu.appId as string,
      appSecret: this.config.feishu.appSecret as string,
      loggerLevel: lark.LoggerLevel.warn,
      autoReconnect: true,
    });
    this.feishuWsClient = wsClient;
    await wsClient.start({
      eventDispatcher: this.getFeishuEventDispatcher(),
    });
    this.emitLog('info', 'Feishu websocket listener started.', {
      mode: this.config.feishu.receiveMode,
    });
  }

  private stopFeishuLongConnection(): void {
    if (!this.feishuWsClient) return;
    try {
      this.feishuWsClient.close({ force: true });
    } catch {
      // ignore close failures
    }
    this.feishuWsClient = null;
  }

  private async startServerIfNeeded(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    if (this.server && this.listening) {
      await this.syncFeishuTransport();
      await this.syncWeixinSidecar();
      return;
    }
    const acquired = await this.acquireOwnership();
    if (!acquired) {
      this.emitLog('warn', 'Assistant daemon is passive because another owner is active.', {
        blockedBy: this.blockedBy,
      });
      this.emitStatus();
      return;
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('Assistant daemon server missing'));
        return;
      }
      server.once('error', reject);
      server.listen(this.config.port, this.config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.listening = true;
    this.lastError = null;
    await this.syncFeishuTransport();
    await this.syncWeixinSidecar();
    this.emitLog('info', 'Assistant daemon listening.', {
      host: this.config.host,
      port: this.config.port,
    });
  }

  private async stopServerInternals(options?: { preserveEnabledState?: boolean }): Promise<void> {
    this.stopFeishuLongConnection();
    await this.stopWeixinSidecar();
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    this.listening = false;
    if (!options?.preserveEnabledState) {
      await this.releaseOwnership();
    }
  }

  private async syncWeixinSidecar(): Promise<void> {
    if (!this.config.enabled || !this.listening || this.lockState !== 'owner') {
      this.emitLog('info', 'Weixin sidecar not running because daemon is not active owner.', {
        daemonEnabled: this.config.enabled,
        listening: this.listening,
        lockState: this.lockState,
      });
      await this.stopWeixinSidecar();
      return;
    }
    const weixinRuntimeStatus = this.readWeixinAccountRuntimeStatus();
    const command = this.config.weixin.sidecarCommand || process.execPath;
    const args = this.config.weixin.sidecarArgs?.length
      ? this.config.weixin.sidecarArgs
      : [this.getWeixinBootstrapScriptPath()];
    const shouldRun = this.config.weixin.enabled
      && this.config.weixin.autoStartSidecar
      && Boolean(command)
      && weixinRuntimeStatus.connected
      && Boolean(weixinRuntimeStatus.accountId);
    if (!shouldRun) {
      this.emitLog('info', 'Weixin sidecar not started.', {
        weixinEnabled: this.config.weixin.enabled,
        autoStartSidecar: this.config.weixin.autoStartSidecar,
        command,
        connected: weixinRuntimeStatus.connected,
        accountId: weixinRuntimeStatus.accountId,
      });
      await this.stopWeixinSidecar();
      return;
    }
    if (this.weixinSidecar && !this.weixinSidecar.killed) {
      return;
    }

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || '1',
      REDCONVERT_RELAY_URL: createWebhookUrl(this.config.host, this.config.port, this.config.weixin.endpointPath),
      REDCONVERT_RELAY_TOKEN: this.config.weixin.authToken || this.config.relay.authToken || '',
      WEIXIN_CLAW_CURSOR_FILE: this.getWeixinCursorPath(),
      WEIXIN_CLAW_ACCOUNT_ID: weixinRuntimeStatus.accountId || '',
      WEIXIN_BRIDGE_STATE_DIR: this.getWeixinStateRoot(),
      WEIXIN_OUTBOX_DIR: this.getWeixinOutboxDir(),
      ...this.config.weixin.sidecarEnv,
    };
    const child = spawn(command, args, {
      cwd: this.config.weixin.sidecarCwd || path.dirname(this.getWeixinBootstrapScriptPath()),
      env,
      stdio: 'pipe',
    });
    this.weixinSidecar = child;
    child.stdout.on('data', (chunk) => {
      this.emitLog('info', '[weixin-sidecar] stdout', { chunk: String(chunk).trim() });
    });
    child.stderr.on('data', (chunk) => {
      this.emitLog('warn', '[weixin-sidecar] stderr', { chunk: String(chunk).trim() });
    });
    child.once('exit', (code, signal) => {
      const wasTracked = this.weixinSidecar === child;
      if (wasTracked) {
        this.weixinSidecar = null;
      }
      this.emitLog(code === 0 ? 'info' : 'warn', '[weixin-sidecar] exited', {
        code,
        signal,
      });
      this.emitStatus();
    });
    this.emitLog('info', 'Started weixin sidecar process.', {
      pid: child.pid,
      command,
      args,
    });
  }

  private async stopWeixinSidecar(): Promise<void> {
    const child = this.weixinSidecar;
    if (!child) return;
    this.weixinSidecar = null;
    if (child.killed) return;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const url = new URL(req.url || '/', `http://${this.config.host}:${this.config.port}`);
      if (method === 'GET' && url.pathname === '/healthz') {
        sendJson(res, 200, {
          ok: true,
          status: this.getStatus(),
        });
        return;
      }

      if (method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'Method not allowed' });
        return;
      }

      if (url.pathname === this.config.feishu.endpointPath && this.config.feishu.enabled) {
        const body = await readRequestBody(req);
        await this.handleFeishuEvent(body, req, res);
        return;
      }

      if (url.pathname === this.config.relay.endpointPath && this.config.relay.enabled) {
        const body = await readRequestBody(req);
        await this.handleRelayIngress(body.json, res, 'relay');
        return;
      }

      if (url.pathname === this.config.weixin.endpointPath && this.config.weixin.enabled) {
        const body = await readRequestBody(req);
        await this.handleRelayIngress(body.json, res, 'weixin');
        return;
      }

      sendJson(res, 404, { success: false, error: 'Not found' });
    } catch (error) {
      this.lastError = extractErrorMessage(error);
      this.emitLog('error', 'Assistant daemon request failed.', {
        error: this.lastError,
      });
      sendJson(res, 500, { success: false, error: this.lastError });
    } finally {
      this.emitStatus();
    }
  }

  private async handleFeishuEvent(
    body: { raw: string; json: Record<string, unknown> },
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const challenge = lark.generateChallenge(body.json, {
      encryptKey: this.config.feishu.encryptKey || '',
    });
    if (challenge.isChallenge) {
      sendJson(res, 200, challenge.challenge);
      return;
    }

    const assigned = Object.assign(Object.create({ headers: req.headers }), body.json);
    await this.getFeishuEventDispatcher().invoke(assigned);
    sendJson(res, 200, { success: true, accepted: true });
  }

  private resolveRelayAuthToken(provider: 'relay' | 'weixin'): string | undefined {
    if (provider === 'weixin') {
      return this.config.weixin.authToken || this.config.relay.authToken;
    }
    return this.config.relay.authToken;
  }

  private async handleRelayIngress(
    body: Record<string, unknown>,
    res: http.ServerResponse,
    provider: 'relay' | 'weixin',
  ): Promise<void> {
    const expectedToken = this.resolveRelayAuthToken(provider);
    const authToken = String(body.authToken || '').trim();
    if (expectedToken && authToken !== expectedToken) {
      sendJson(res, 403, { success: false, error: 'Invalid relay token' });
      return;
    }

    const inbound: AssistantDaemonIngressMessage = {
      provider: provider === 'weixin' ? 'weixin' : (String(body.provider || 'relay').trim() as AssistantChannelProvider),
      accountId: String(body.accountId || '').trim() || undefined,
      peerId: String(body.peerId || '').trim(),
      userId: String(body.userId || '').trim() || undefined,
      userName: String(body.userName || '').trim() || undefined,
      messageId: String(body.messageId || '').trim() || undefined,
      text: String(body.text || '').trim(),
      waitForReply: Boolean(body.waitForReply),
      metadata: (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata))
        ? body.metadata as Record<string, unknown>
        : undefined,
    };

    if (!inbound.peerId || !inbound.text) {
      sendJson(res, 400, { success: false, error: 'peerId and text are required' });
      return;
    }
    this.emitLog('info', 'Relay inbound accepted.', {
      provider: inbound.provider,
      peerId: inbound.peerId,
      accountId: inbound.accountId,
      messageId: inbound.messageId,
      waitForReply: inbound.waitForReply,
      textPreview: previewText(inbound.text),
    });
    if (this.isDuplicateMessage(inbound.provider, inbound.messageId)) {
      this.emitLog('info', 'Relay inbound ignored as duplicate.', {
        provider: inbound.provider,
        peerId: inbound.peerId,
        messageId: inbound.messageId,
      });
      sendJson(res, 200, { success: true, ignored: true, reason: 'duplicate' });
      return;
    }

    if (inbound.provider === 'weixin' && inbound.waitForReply) {
      const processing = this.enqueueInboundMessage(inbound).catch((error) => {
        this.emitLog('error', 'Failed to process relay inbound message.', {
          error: extractErrorMessage(error),
          provider: inbound.provider,
        });
      });
      sendJson(res, 200, {
        success: true,
        accepted: true,
        response: '收到，RedClaw正在思考',
      });
      void processing;
      return;
    }

    if (!inbound.waitForReply) {
      sendJson(res, 202, { success: true, accepted: true });
      void this.enqueueInboundMessage(inbound).catch((error) => {
        this.emitLog('error', 'Failed to process relay inbound message.', {
          error: extractErrorMessage(error),
          provider: inbound.provider,
        });
      });
      return;
    }

    try {
      const result = await this.enqueueInboundMessage(inbound);
      sendJson(res, 200, {
        success: true,
        taskId: result.taskId,
        sessionId: result.sessionId,
        response: result.response,
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      sendJson(res, 500, { success: false, error: message });
    }
  }

  private async enqueueInboundMessage(message: AssistantDaemonIngressMessage): Promise<AssistantDaemonProcessResult> {
    const queueKey = `${message.provider}:${message.accountId || 'default'}:${message.peerId}`;
    const previous = this.peerQueues.get(queueKey) || Promise.resolve({
      taskId: '',
      sessionId: '',
      response: '',
    });
    const next = previous
      .catch(() => ({ taskId: '', sessionId: '', response: '' }))
      .then(() => this.processInboundMessage(queueKey, message));
    this.peerQueues.set(queueKey, next);
    try {
      return await next;
    } finally {
      if (this.peerQueues.get(queueKey) === next) {
        this.peerQueues.delete(queueKey);
      }
      this.emitStatus();
    }
  }

  private async processInboundMessage(
    queueKey: string,
    message: AssistantDaemonIngressMessage,
  ): Promise<AssistantDaemonProcessResult> {
    this.inFlightKeys.add(queueKey);
    this.emitStatus();

    const task = await getBackgroundTaskRegistry().registerTask({
      kind: 'external-message',
      title: `${message.provider} message ${message.userId || message.peerId}`,
      contextId: queueKey,
    });
    if (message.provider !== 'weixin') {
      await getBackgroundTaskRegistry().appendTurn(task.id, {
        source: 'system',
        text: `收到 ${message.provider} 消息：${previewText(message.text)}`,
      });
    }
    this.emitLog('info', 'External message queued for agent.', {
      provider: message.provider,
      taskId: task.id,
      queueKey,
      peerId: message.peerId,
      accountId: message.accountId,
      textPreview: previewText(message.text),
    });

    const contextId = `external:${queueKey}`;
    const weixinStrategy = message.provider === 'weixin'
      ? resolveWeixinExecutionStrategy(message.text)
      : null;
    const contextContent = [
      `provider=${message.provider}`,
      `accountId=${message.accountId || ''}`,
      `peerId=${message.peerId}`,
      `userId=${message.userId || ''}`,
    ].join('\n');
    const registry = getBackgroundTaskRegistry();
    const unsubscribeWeixinProgress = this.attachWeixinProgressReporter(task.id, message, weixinStrategy || undefined);
    const runtimeMetadata = message.provider === 'weixin'
      ? {
          channelProvider: 'weixin',
          intent: weixinStrategy?.forcedIntent || 'direct_answer',
          preferredRole: 'ops-coordinator',
          forceMultiAgent: Boolean(weixinStrategy?.forceMultiAgent),
          forceLongRunningTask: false,
          weixinFastReply: true,
          weixinSecretaryMode: true,
          weixinDelegationMode: weixinStrategy?.mode || 'simple',
          subagentRoles: weixinStrategy?.subagentRoles || [],
        }
      : undefined;
    if (weixinStrategy) {
      this.emitLog('info', 'Weixin execution strategy resolved.', {
        taskId: task.id,
        strategy: weixinStrategy.summary,
        mode: weixinStrategy.mode,
        forcedIntent: weixinStrategy.forcedIntent,
        subagentRoles: weixinStrategy.subagentRoles || [],
      });
    }

    try {
      const result = await getHeadlessAgentRunner().runRedClawTask({
        taskId: task.id,
        title: `${message.provider.toUpperCase()} ${message.userId || message.peerId}`,
        contextId,
        contextContent,
        prompt: buildRelayPrompt(message),
        displayContent: `[${message.provider}] ${message.text}`,
        historyUserContent: message.text,
        runtimeMode: 'redclaw',
        contextType: message.provider === 'weixin' ? 'weixin' : 'redclaw',
        metadata: runtimeMetadata,
      });
      const finalResponse = finalizeRelayResponse(message, result.response);
      await registry.appendTurn(task.id, {
        source: 'response',
        text: `输出回复：${previewText(finalResponse)}`,
      });
      if (message.provider === 'weixin') {
        await this.enqueueWeixinOutboundMessage({
          id: `wx_final_${task.id}`,
          accountId: message.accountId,
          peerId: message.peerId,
          text: finalResponse,
          createdAt: nowIso(),
          contextToken: String(message.metadata?.contextToken || '').trim() || undefined,
          taskId: task.id,
          kind: 'final',
        });
      }
      this.emitLog('info', 'External message handled by agent.', {
        provider: message.provider,
        taskId: task.id,
        sessionId: result.sessionId,
        responseLength: finalResponse.length,
        responsePreview: previewText(finalResponse),
      });
      const summary = `Handled ${message.provider} message from ${message.userId || message.peerId}`;
      await getBackgroundTaskRegistry().completeTask(task.id, summary);
      return {
        taskId: task.id,
        sessionId: result.sessionId,
        response: finalResponse,
      };
    } catch (error) {
      const messageText = extractErrorMessage(error);
      this.emitLog('error', 'External message handling failed.', {
        provider: message.provider,
        taskId: task.id,
        error: messageText,
      });
      if (message.provider === 'weixin') {
        await this.enqueueWeixinOutboundMessage({
          id: `wx_error_${task.id}`,
          accountId: message.accountId,
          peerId: message.peerId,
          text: `处理中断了：${messageText}`,
          createdAt: nowIso(),
          contextToken: String(message.metadata?.contextToken || '').trim() || undefined,
          taskId: task.id,
          kind: 'error',
        });
      }
      await registry.failTask(task.id, messageText);
      throw error;
    } finally {
      unsubscribeWeixinProgress();
      this.inFlightKeys.delete(queueKey);
      this.emitStatus();
    }
  }

  private attachWeixinProgressReporter(
    taskId: string,
    message: AssistantDaemonIngressMessage,
    strategy?: WeixinExecutionStrategy,
  ): () => void {
    if (message.provider !== 'weixin') {
      return () => {};
    }
    const registry = getBackgroundTaskRegistry();
    const seenTurnIds = new Set<string>();
    let lastThoughtSentAt = 0;
    let lastOutboundAt = Date.now();
    let lastPhaseSentAt = 0;
    let lastPhase = '';
    let stopped = false;
    let latestTaskSnapshot: {
      id: string;
      status?: string;
      turns?: Array<{ id: string; source: string; text: string }>;
      phase?: string;
      latestText?: string;
      workerState?: string;
      workerLastHeartbeatAt?: string;
    } | null = null;
    const enqueueProgress = (idSuffix: string, outboundText: string) => {
      lastOutboundAt = Date.now();
      void this.enqueueWeixinOutboundMessage({
        id: `wx_progress_${taskId}_${idSuffix}`,
        accountId: message.accountId,
        peerId: message.peerId,
        text: outboundText,
        createdAt: nowIso(),
        contextToken: String(message.metadata?.contextToken || '').trim() || undefined,
        taskId,
        kind: 'progress',
      }).then(() => {
        this.emitLog('info', 'Queued weixin progress update.', {
          taskId,
          kind: 'progress',
          preview: previewText(outboundText, 100),
        });
      }).catch((error) => {
        this.emitLog('warn', 'Failed to enqueue weixin progress update.', {
          taskId,
          error: extractErrorMessage(error),
        });
      });
    };
    const handler = (task: {
      id: string;
      status?: string;
      turns?: Array<{ id: string; source: string; text: string }>;
      phase?: string;
      latestText?: string;
      workerState?: string;
      workerLastHeartbeatAt?: string;
    }) => {
      if (!task || task.id !== taskId || !Array.isArray(task.turns)) return;
      latestTaskSnapshot = task;
      const phase = String(task.phase || '').trim();
      const now = Date.now();
      if (
        phase
        && phase !== lastPhase
        && phase !== 'starting'
        && phase !== 'completed'
        && phase !== 'failed'
        && phase !== 'cancelled'
        && now - lastPhaseSentAt >= WEIXIN_PHASE_UPDATE_MIN_INTERVAL_MS
      ) {
        lastPhase = phase;
        lastPhaseSentAt = now;
        enqueueProgress(`phase_${phase}_${now}`, `进展同步：当前阶段已切换为${humanizeBackgroundPhase(phase)}。`);
      } else if (phase) {
        lastPhase = phase;
      }
      for (const turn of task.turns) {
        if (!turn?.id || seenTurnIds.has(turn.id)) continue;
        seenTurnIds.add(turn.id);
        const source = String(turn.source || '');
        const text = String(turn.text || '').trim();
        if (!text) continue;
        let outboundText = '';
        if (source === 'thought') {
          if (now - lastThoughtSentAt < WEIXIN_THOUGHT_MIN_INTERVAL_MS) continue;
          lastThoughtSentAt = now;
          outboundText = `思考中：${previewText(text, 120)}`;
        } else if (source === 'tool') {
          outboundText = `处理中：${previewText(text, 120)}`;
        } else if (source === 'system' && /错误|失败|排队|处理中|等待/.test(text)) {
          outboundText = `状态：${previewText(text, 120)}`;
        }
        if (!outboundText) continue;
        enqueueProgress(turn.id, outboundText);
      }
    };
    const heartbeatTimer = setInterval(() => {
      if (stopped) {
        return;
      }
      void (async () => {
        const task = latestTaskSnapshot || await registry.getTask(taskId);
        if (!task || task.id !== taskId || task.status !== 'running') {
          return;
        }
        latestTaskSnapshot = task;
        if (Date.now() - lastOutboundAt < WEIXIN_HEARTBEAT_INTERVAL_MS) {
          return;
        }
        const heartbeatText = buildWeixinHeartbeatText(task, strategy);
        if (!heartbeatText) {
          return;
        }
        enqueueProgress(`heartbeat_${Date.now()}`, heartbeatText);
        this.emitLog('info', 'Queued weixin heartbeat update.', {
          taskId,
          phase: task.phase,
          workerState: task.workerState,
          preview: previewText(heartbeatText, 100),
        });
      })().catch((error) => {
        this.emitLog('warn', 'Failed to build weixin heartbeat update.', {
          taskId,
          error: extractErrorMessage(error),
        });
      });
    }, WEIXIN_HEARTBEAT_INTERVAL_MS);
    registry.on('task-updated', handler);
    return () => {
      stopped = true;
      clearInterval(heartbeatTimer);
      registry.off('task-updated', handler);
    };
  }

  private async handleFeishuMessageEvent(data: any): Promise<void> {
    const message = (data?.message && typeof data.message === 'object') ? data.message as Record<string, unknown> : {};
    const sender = (data?.sender && typeof data.sender === 'object') ? data.sender as Record<string, unknown> : {};
    const senderId = (sender.sender_id && typeof sender.sender_id === 'object')
      ? sender.sender_id as Record<string, unknown>
      : {};
    const messageType = String(message.message_type || '').trim();
    const text = parseFeishuTextContent(message.content);
    const messageId = String(message.message_id || '').trim() || undefined;
    if (messageType !== 'text' || !text) {
      return;
    }
    if (this.isDuplicateMessage('feishu', messageId)) {
      return;
    }

    const inbound: AssistantDaemonIngressMessage = {
      provider: 'feishu',
      peerId: String(message.chat_id || senderId.open_id || senderId.user_id || 'feishu-chat').trim(),
      userId: String(senderId.user_id || senderId.open_id || '').trim() || undefined,
      userName: String(sender.name || sender.sender_type || '').trim() || undefined,
      messageId,
      text,
      waitForReply: false,
      metadata: {
        chatId: String(message.chat_id || '').trim() || undefined,
        openId: String(senderId.open_id || '').trim() || undefined,
        userId: String(senderId.user_id || '').trim() || undefined,
        messageId,
      },
    };

    void this.enqueueInboundMessage(inbound).then(async (result) => {
      try {
        await this.sendFeishuReply(inbound, result.response);
      } catch (error) {
        const messageText = extractErrorMessage(error);
        this.emitLog('error', 'Failed to send Feishu reply.', {
          error: messageText,
          chatId: inbound.metadata?.chatId,
        });
      }
    }).catch((error) => {
      this.emitLog('error', 'Failed to process Feishu inbound message.', {
        error: extractErrorMessage(error),
      });
    });
  }

  private async sendFeishuReply(message: AssistantDaemonIngressMessage, responseText: string): Promise<void> {
    const chatId = String(message.metadata?.chatId || '').trim();
    const openId = String(message.metadata?.openId || '').trim();
    const userId = String(message.metadata?.userId || '').trim();
    const receiveIdType = this.config.feishu.replyUsingChatId
      ? 'chat_id'
      : (openId ? 'open_id' : (userId ? 'user_id' : 'chat_id'));
    const receiveId = receiveIdType === 'open_id'
      ? openId
      : receiveIdType === 'user_id'
        ? userId
        : chatId;
    if (!receiveId) {
      throw new Error('Feishu receive_id is missing');
    }
    const client = this.getFeishuClient();
    await client.im.v1.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({
          text: responseText,
        }),
        uuid: randomUUID(),
      },
    });
  }
}

let assistantDaemonService: AssistantDaemonService | null = null;

export function getAssistantDaemonService(): AssistantDaemonService {
  if (!assistantDaemonService) {
    assistantDaemonService = new AssistantDaemonService();
  }
  return assistantDaemonService;
}
