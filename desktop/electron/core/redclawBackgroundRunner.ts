import { EventEmitter } from 'events';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  addChatMessage,
  createChatSession,
  getChatSessionByContext,
  getSettings,
  getWorkspacePaths,
} from '../db';
import { getRedClawProject, listRedClawProjects } from './redclawStore';
import { PiChatService } from '../pi/PiChatService';

type RunResult = 'success' | 'error' | 'skipped';

export interface RedClawBackgroundProjectState {
  projectId: string;
  enabled: boolean;
  prompt?: string;
  lastRunAt?: string;
  lastResult?: RunResult;
  lastError?: string;
}

interface RedClawBackgroundConfig {
  enabled: boolean;
  intervalMinutes: number;
  keepAliveWhenNoWindow: boolean;
  maxProjectsPerTick: number;
  projectStates: Record<string, RedClawBackgroundProjectState>;
}

export interface RedClawBackgroundRunnerStatus {
  enabled: boolean;
  intervalMinutes: number;
  keepAliveWhenNoWindow: boolean;
  maxProjectsPerTick: number;
  isTicking: boolean;
  currentProjectId: string | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastError: string | null;
  projectStates: Record<string, RedClawBackgroundProjectState>;
}

const DEFAULT_CONFIG: RedClawBackgroundConfig = {
  enabled: false,
  intervalMinutes: 20,
  keepAliveWhenNoWindow: true,
  maxProjectsPerTick: 2,
  projectStates: {},
};

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeIntervalMinutes(value: number | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.intervalMinutes;
  return Math.max(1, Math.min(180, Math.round(n)));
}

function sanitizeMaxProjectsPerTick(value: number | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.maxProjectsPerTick;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function normalizeConfig(raw: Partial<RedClawBackgroundConfig> | null | undefined): RedClawBackgroundConfig {
  const projectStates = raw?.projectStates || {};
  const normalizedProjectStates: Record<string, RedClawBackgroundProjectState> = {};
  for (const [projectId, state] of Object.entries(projectStates)) {
    const id = String(projectId || '').trim();
    if (!id) continue;
    normalizedProjectStates[id] = {
      projectId: id,
      enabled: Boolean(state?.enabled),
      prompt: typeof state?.prompt === 'string' && state.prompt.trim() ? state.prompt.trim() : undefined,
      lastRunAt: typeof state?.lastRunAt === 'string' ? state.lastRunAt : undefined,
      lastResult: state?.lastResult,
      lastError: typeof state?.lastError === 'string' ? state.lastError : undefined,
    };
  }

  return {
    enabled: Boolean(raw?.enabled),
    intervalMinutes: sanitizeIntervalMinutes(raw?.intervalMinutes),
    keepAliveWhenNoWindow: raw?.keepAliveWhenNoWindow !== false,
    maxProjectsPerTick: sanitizeMaxProjectsPerTick(raw?.maxProjectsPerTick),
    projectStates: normalizedProjectStates,
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildBackgroundPrompt(params: {
  projectId: string;
  goal: string;
  hasCopyPack: boolean;
  hasImagePack: boolean;
  customPrompt?: string;
}): { message: string; shouldRun: boolean } {
  if (params.customPrompt) {
    return {
      shouldRun: true,
      message: [
        '[RedClaw 后台任务]',
        `项目ID: ${params.projectId}`,
        `目标: ${params.goal}`,
        '',
        params.customPrompt,
      ].join('\n'),
    };
  }

  if (!params.hasCopyPack) {
    return {
      shouldRun: true,
      message: [
        '[RedClaw 后台任务]',
        `项目ID: ${params.projectId}`,
        `目标: ${params.goal}`,
        '',
        '请推进项目到“文案包已保存”状态：',
        '1) 先读取当前项目信息（优先 app_cli: redclaw get --project-id ...）。',
        '2) 生成标题候选、正文、标签、封面文案、发布计划。',
        '3) 调用 redclaw_save_copy_pack（或 app_cli redclaw save-copy）落盘。',
        '4) 返回一句简要执行结果。',
      ].join('\n'),
    };
  }

  if (!params.hasImagePack) {
    return {
      shouldRun: true,
      message: [
        '[RedClaw 后台任务]',
        `项目ID: ${params.projectId}`,
        `目标: ${params.goal}`,
        '',
        '请推进项目到“配图包已保存”状态：',
        '1) 读取项目和已有文案。',
        '2) 生成封面与配图提示词。',
        '3) 调用 redclaw_save_image_pack（或 app_cli redclaw save-image）落盘。',
        '4) 返回一句简要执行结果。',
      ].join('\n'),
    };
  }

  return {
    shouldRun: false,
    message: '',
  };
}

export class RedClawBackgroundRunner extends EventEmitter {
  private config: RedClawBackgroundConfig = { ...DEFAULT_CONFIG };
  private isLoaded = false;
  private isTicking = false;
  private timer: NodeJS.Timeout | null = null;
  private currentProjectId: string | null = null;
  private lastTickAt: string | null = null;
  private nextTickAt: string | null = null;
  private lastError: string | null = null;
  private currentService: PiChatService | null = null;

  private getConfigPath(): string {
    return path.join(getWorkspacePaths().redclaw, 'background-runner.json');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded) return;
    await this.loadConfig();
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  private async loadConfig(): Promise<void> {
    const configPath = this.getConfigPath();
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      this.config = normalizeConfig(JSON.parse(raw) as Partial<RedClawBackgroundConfig>);
    } catch {
      this.config = { ...DEFAULT_CONFIG, projectStates: {} };
      await this.persistConfig();
    }
    this.isLoaded = true;
    this.emitStatus();
  }

  private async persistConfig(): Promise<void> {
    const configPath = this.getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  private scheduleNextTick(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.config.enabled) {
      this.nextTickAt = null;
      this.emitStatus();
      return;
    }

    const delayMs = this.config.intervalMinutes * 60 * 1000;
    this.nextTickAt = new Date(Date.now() + delayMs).toISOString();
    this.timer = setTimeout(() => {
      void this.runTick('scheduled');
    }, delayMs);
    this.emitStatus();
  }

  async init(): Promise<void> {
    await this.ensureLoaded();
    if (this.config.enabled) {
      this.scheduleNextTick();
      void this.runTick('init');
    }
  }

  async reloadForWorkspaceChange(): Promise<void> {
    await this.stop({ persist: false });
    this.isLoaded = false;
    await this.ensureLoaded();
    if (this.config.enabled) {
      this.scheduleNextTick();
      void this.runTick('workspace-change');
    } else {
      this.emitStatus();
    }
  }

  getStatus(): RedClawBackgroundRunnerStatus {
    return {
      enabled: this.config.enabled,
      intervalMinutes: this.config.intervalMinutes,
      keepAliveWhenNoWindow: this.config.keepAliveWhenNoWindow,
      maxProjectsPerTick: this.config.maxProjectsPerTick,
      isTicking: this.isTicking,
      currentProjectId: this.currentProjectId,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.nextTickAt,
      lastError: this.lastError,
      projectStates: this.config.projectStates,
    };
  }

  async setRunnerConfig(input: {
    enabled?: boolean;
    intervalMinutes?: number;
    keepAliveWhenNoWindow?: boolean;
    maxProjectsPerTick?: number;
  }): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    if (typeof input.enabled === 'boolean') {
      this.config.enabled = input.enabled;
    }
    if (typeof input.intervalMinutes === 'number') {
      this.config.intervalMinutes = sanitizeIntervalMinutes(input.intervalMinutes);
    }
    if (typeof input.keepAliveWhenNoWindow === 'boolean') {
      this.config.keepAliveWhenNoWindow = input.keepAliveWhenNoWindow;
    }
    if (typeof input.maxProjectsPerTick === 'number') {
      this.config.maxProjectsPerTick = sanitizeMaxProjectsPerTick(input.maxProjectsPerTick);
    }
    await this.persistConfig();

    if (this.config.enabled) {
      this.scheduleNextTick();
    } else {
      await this.stop({ persist: false });
    }
    return this.getStatus();
  }

  async setProjectState(input: {
    projectId: string;
    enabled: boolean;
    prompt?: string;
  }): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    const projectId = String(input.projectId || '').trim();
    if (!projectId) throw new Error('projectId is required');

    const prev = this.config.projectStates[projectId] || {
      projectId,
      enabled: false,
    };

    this.config.projectStates[projectId] = {
      ...prev,
      projectId,
      enabled: Boolean(input.enabled),
      prompt: typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt.trim() : prev.prompt,
      lastError: input.enabled ? undefined : prev.lastError,
    };

    await this.persistConfig();
    this.emitStatus();
    return this.getStatus();
  }

  async start(input?: {
    intervalMinutes?: number;
    keepAliveWhenNoWindow?: boolean;
    maxProjectsPerTick?: number;
  }): Promise<RedClawBackgroundRunnerStatus> {
    return this.setRunnerConfig({
      enabled: true,
      intervalMinutes: input?.intervalMinutes,
      keepAliveWhenNoWindow: input?.keepAliveWhenNoWindow,
      maxProjectsPerTick: input?.maxProjectsPerTick,
    });
  }

  async stop(options?: { persist?: boolean }): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextTickAt = null;

    if (this.currentService) {
      this.currentService.abort();
      this.currentService = null;
    }

    if (options?.persist !== false) {
      this.config.enabled = false;
      await this.persistConfig();
    }

    this.emitStatus();
    return this.getStatus();
  }

  async runNow(projectId?: string): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    await this.runTick('manual', projectId);
    return this.getStatus();
  }

  async shouldKeepAliveWhenNoWindow(): Promise<boolean> {
    await this.ensureLoaded();
    return this.config.enabled && this.config.keepAliveWhenNoWindow;
  }

  private updateProjectRunResult(projectId: string, result: RunResult, error?: string): void {
    const prev = this.config.projectStates[projectId] || {
      projectId,
      enabled: true,
    };
    this.config.projectStates[projectId] = {
      ...prev,
      projectId,
      lastRunAt: nowIso(),
      lastResult: result,
      lastError: error || undefined,
    };
  }

  private async runProject(projectId: string): Promise<void> {
    const projectState = this.config.projectStates[projectId];
    if (!projectState?.enabled) return;

    const { project, projectDir } = await getRedClawProject(projectId);
    if (project.status === 'reviewed' && !projectState.prompt) {
      this.updateProjectRunResult(projectId, 'skipped');
      return;
    }

    const hasCopyPack = await exists(path.join(projectDir, 'copy-pack.json'));
    const hasImagePack = await exists(path.join(projectDir, 'image-pack.json'));
    const prompt = buildBackgroundPrompt({
      projectId,
      goal: project.goal,
      hasCopyPack,
      hasImagePack,
      customPrompt: projectState.prompt,
    });

    if (!prompt.shouldRun) {
      this.updateProjectRunResult(projectId, 'skipped');
      return;
    }

    const contextId = `redclaw-bg-${projectId}`;
    const contextType = 'redclaw';
    let session = getChatSessionByContext(contextId, contextType);
    if (!session) {
      const sid = `session_redclaw_bg_${projectId}`;
      session = createChatSession(sid, `RedClaw BG ${project.goal.slice(0, 24)}`, {
        contextId,
        contextType,
        contextContent: [
          `后台项目: ${projectId}`,
          `目标: ${project.goal}`,
          '这是后台自动推进会话，不依赖前台界面。',
        ].join('\n'),
        isContextBound: true,
      });
    }

    addChatMessage({
      id: `msg_bg_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      session_id: session.id,
      role: 'user',
      content: prompt.message,
      display_content: '[后台自动推进]',
    });

    this.currentService = new PiChatService();
    await this.currentService.sendMessage(prompt.message, session.id);
    this.currentService = null;
    this.updateProjectRunResult(projectId, 'success');
  }

  private async runTick(reason: 'scheduled' | 'manual' | 'init' | 'workspace-change', onlyProjectId?: string): Promise<void> {
    await this.ensureLoaded();
    if (this.isTicking) return;

    const settings = (getSettings() || {}) as Record<string, unknown>;
    const apiKey = (settings.api_key as string) || (settings.openaiApiKey as string) || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      this.lastError = 'API Key 未配置，后台任务未执行。';
      this.emit('log', { level: 'warn', message: this.lastError, reason, at: nowIso() });
      this.emitStatus();
      this.scheduleNextTick();
      return;
    }

    this.isTicking = true;
    this.lastError = null;
    this.emitStatus();

    try {
      const projects = await listRedClawProjects(100);
      const enabledIds = Object.values(this.config.projectStates)
        .filter((state) => state.enabled)
        .map((state) => state.projectId);

      const targets = onlyProjectId
        ? [onlyProjectId]
        : enabledIds.filter((id) => projects.some((project) => project.id === id)).slice(0, this.config.maxProjectsPerTick);

      for (const projectId of targets) {
        this.currentProjectId = projectId;
        this.emitStatus();
        try {
          await this.runProject(projectId);
          this.emit('log', { level: 'info', message: `Background run completed for ${projectId}`, reason, at: nowIso() });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.updateProjectRunResult(projectId, 'error', message);
          this.lastError = message;
          this.emit('log', { level: 'error', message: `Background run failed for ${projectId}: ${message}`, reason, at: nowIso() });
        }
      }

      await this.persistConfig();
      this.lastTickAt = nowIso();
    } finally {
      this.isTicking = false;
      this.currentProjectId = null;
      this.emitStatus();
      this.scheduleNextTick();
    }
  }
}

let globalRunner: RedClawBackgroundRunner | null = null;

export function getRedClawBackgroundRunner(): RedClawBackgroundRunner {
  if (!globalRunner) {
    globalRunner = new RedClawBackgroundRunner();
  }
  return globalRunner;
}

