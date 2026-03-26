import { EventEmitter } from 'events';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  addChatMessage,
  createChatSession,
  getActiveSpaceId,
  getChatMessages,
  getChatSessionByContext,
  getSettings,
  getWorkspacePaths,
} from '../db';
import { getRedClawProject, listRedClawProjects } from './redclawStore';
import { PiChatService } from '../pi/PiChatService';

type RunResult = 'success' | 'error' | 'skipped';
type ScheduleMode = 'interval' | 'daily' | 'weekly' | 'once';
type LongCycleStatus = 'running' | 'paused' | 'completed';

export interface RedClawBackgroundProjectState {
  projectId: string;
  enabled: boolean;
  prompt?: string;
  lastRunAt?: string;
  lastResult?: RunResult;
  lastError?: string;
}

export interface RedClawScheduledTask {
  id: string;
  name: string;
  enabled: boolean;
  mode: ScheduleMode;
  prompt: string;
  projectId?: string;
  intervalMinutes?: number;
  time?: string;
  weekdays?: number[];
  runAt?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastResult?: RunResult;
  lastError?: string;
  nextRunAt?: string;
}

export interface RedClawLongCycleTask {
  id: string;
  name: string;
  enabled: boolean;
  status: LongCycleStatus;
  objective: string;
  stepPrompt: string;
  projectId?: string;
  intervalMinutes: number;
  totalRounds: number;
  completedRounds: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastResult?: RunResult;
  lastError?: string;
  nextRunAt?: string;
}

export interface RedClawHeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
  suppressEmptyReport: boolean;
  reportToMainSession: boolean;
  prompt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  lastDigest?: string;
}

interface RedClawBackgroundConfig {
  enabled: boolean;
  intervalMinutes: number;
  keepAliveWhenNoWindow: boolean;
  maxProjectsPerTick: number;
  maxAutomationPerTick: number;
  projectStates: Record<string, RedClawBackgroundProjectState>;
  heartbeat: RedClawHeartbeatConfig;
  scheduledTasks: Record<string, RedClawScheduledTask>;
  longCycleTasks: Record<string, RedClawLongCycleTask>;
}

export interface RedClawBackgroundRunnerStatus {
  enabled: boolean;
  intervalMinutes: number;
  keepAliveWhenNoWindow: boolean;
  maxProjectsPerTick: number;
  maxAutomationPerTick: number;
  isTicking: boolean;
  currentProjectId: string | null;
  currentAutomationTaskId: string | null;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastError: string | null;
  nextMaintenanceAt: string | null;
  projectStates: Record<string, RedClawBackgroundProjectState>;
  heartbeat: RedClawHeartbeatConfig;
  scheduledTasks: Record<string, RedClawScheduledTask>;
  longCycleTasks: Record<string, RedClawLongCycleTask>;
}

const DEFAULT_HEARTBEAT: RedClawHeartbeatConfig = {
  enabled: true,
  intervalMinutes: 30,
  suppressEmptyReport: true,
  reportToMainSession: true,
};

const DEFAULT_CONFIG: RedClawBackgroundConfig = {
  enabled: false,
  intervalMinutes: 20,
  keepAliveWhenNoWindow: true,
  maxProjectsPerTick: 2,
  maxAutomationPerTick: 2,
  projectStates: {},
  heartbeat: { ...DEFAULT_HEARTBEAT },
  scheduledTasks: {},
  longCycleTasks: {},
};

const MAINTENANCE_CHECK_MS = 30 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function parseIsoMs(value?: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sanitizeIntervalMinutes(value: number | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.intervalMinutes;
  return Math.max(1, Math.min(180, Math.round(n)));
}

function sanitizeHeartbeatIntervalMinutes(value: number | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return DEFAULT_HEARTBEAT.intervalMinutes;
  return Math.max(5, Math.min(360, Math.round(n)));
}

function sanitizeMaxProjectsPerTick(value: number | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.maxProjectsPerTick;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function sanitizeMaxAutomationPerTick(value: number | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return DEFAULT_CONFIG.maxAutomationPerTick;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function sanitizeLongCycleRounds(value: number | undefined): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 8;
  return Math.max(1, Math.min(200, Math.round(n)));
}

function sanitizeWeekdays(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  const set = new Set<number>();
  for (const item of list) {
    const n = Number(item);
    if (!Number.isFinite(n)) continue;
    const day = Math.max(0, Math.min(6, Math.floor(n)));
    set.add(day);
  }
  return Array.from(set.values()).sort((a, b) => a - b);
}

function sanitizeTimeHHmm(value: unknown): string | undefined {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimeHHmm(value?: string): { hour: number; minute: number } | null {
  const normalized = sanitizeTimeHHmm(value);
  if (!normalized) return null;
  const [h, m] = normalized.split(':');
  return {
    hour: Number(h),
    minute: Number(m),
  };
}

function nextIsoFromMinutes(baseMs: number, minutes: number): string {
  return new Date(baseMs + minutes * 60 * 1000).toISOString();
}

function generateTaskId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeScheduledTask(
  taskId: string,
  raw: Partial<RedClawScheduledTask> | undefined,
  now: string,
): RedClawScheduledTask | null {
  const id = String(taskId || raw?.id || '').trim();
  if (!id) return null;
  const prompt = String(raw?.prompt || '').trim();
  if (!prompt) return null;

  const modeRaw = String(raw?.mode || 'interval').trim().toLowerCase();
  const mode: ScheduleMode = modeRaw === 'daily' || modeRaw === 'weekly' || modeRaw === 'once'
    ? modeRaw
    : 'interval';

  const createdAt = typeof raw?.createdAt === 'string' && raw.createdAt ? raw.createdAt : now;
  const updatedAt = typeof raw?.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now;
  const intervalMinutes = sanitizeIntervalMinutes(Number(raw?.intervalMinutes || 60));
  const weekdays = sanitizeWeekdays(raw?.weekdays);
  const time = sanitizeTimeHHmm(raw?.time);

  const normalized: RedClawScheduledTask = {
    id,
    name: String(raw?.name || id).trim() || id,
    enabled: Boolean(raw?.enabled),
    mode,
    prompt,
    projectId: typeof raw?.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : undefined,
    intervalMinutes: mode === 'interval' ? intervalMinutes : undefined,
    time: mode === 'daily' || mode === 'weekly' ? time : undefined,
    weekdays: mode === 'weekly' ? (weekdays.length > 0 ? weekdays : [1]) : undefined,
    runAt: mode === 'once' && typeof raw?.runAt === 'string' ? raw.runAt : undefined,
    createdAt,
    updatedAt,
    lastRunAt: typeof raw?.lastRunAt === 'string' ? raw.lastRunAt : undefined,
    lastResult: raw?.lastResult,
    lastError: typeof raw?.lastError === 'string' ? raw.lastError : undefined,
    nextRunAt: typeof raw?.nextRunAt === 'string' ? raw.nextRunAt : undefined,
  };

  return normalized;
}

function normalizeLongCycleTask(
  taskId: string,
  raw: Partial<RedClawLongCycleTask> | undefined,
  now: string,
): RedClawLongCycleTask | null {
  const id = String(taskId || raw?.id || '').trim();
  if (!id) return null;
  const objective = String(raw?.objective || '').trim();
  const stepPrompt = String(raw?.stepPrompt || '').trim();
  if (!objective || !stepPrompt) return null;

  const createdAt = typeof raw?.createdAt === 'string' && raw.createdAt ? raw.createdAt : now;
  const completedRounds = Math.max(0, Math.floor(Number(raw?.completedRounds || 0)));
  const totalRounds = sanitizeLongCycleRounds(Number(raw?.totalRounds || 8));
  let status: LongCycleStatus = 'running';
  if (raw?.status === 'paused') {
    status = 'paused';
  } else if (raw?.status === 'completed' || completedRounds >= totalRounds) {
    status = 'completed';
  }

  return {
    id,
    name: String(raw?.name || id).trim() || id,
    enabled: raw?.enabled !== false,
    status,
    objective,
    stepPrompt,
    projectId: typeof raw?.projectId === 'string' && raw.projectId.trim() ? raw.projectId.trim() : undefined,
    intervalMinutes: sanitizeIntervalMinutes(Number(raw?.intervalMinutes || 30)),
    totalRounds,
    completedRounds,
    createdAt,
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now,
    lastRunAt: typeof raw?.lastRunAt === 'string' ? raw.lastRunAt : undefined,
    lastResult: raw?.lastResult,
    lastError: typeof raw?.lastError === 'string' ? raw.lastError : undefined,
    nextRunAt: typeof raw?.nextRunAt === 'string' ? raw.nextRunAt : undefined,
  };
}

function normalizeConfig(raw: Partial<RedClawBackgroundConfig> | null | undefined): RedClawBackgroundConfig {
  const now = nowIso();

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

  const scheduledTasksRaw = raw?.scheduledTasks || {};
  const normalizedScheduledTasks: Record<string, RedClawScheduledTask> = {};
  for (const [taskId, taskRaw] of Object.entries(scheduledTasksRaw)) {
    const normalized = normalizeScheduledTask(taskId, taskRaw, now);
    if (!normalized) continue;
    normalizedScheduledTasks[normalized.id] = normalized;
  }

  const longCycleTasksRaw = raw?.longCycleTasks || {};
  const normalizedLongCycleTasks: Record<string, RedClawLongCycleTask> = {};
  for (const [taskId, taskRaw] of Object.entries(longCycleTasksRaw)) {
    const normalized = normalizeLongCycleTask(taskId, taskRaw, now);
    if (!normalized) continue;
    normalizedLongCycleTasks[normalized.id] = normalized;
  }

  const heartbeatRaw = (raw?.heartbeat || {}) as Partial<RedClawHeartbeatConfig>;
  const heartbeat: RedClawHeartbeatConfig = {
    enabled: heartbeatRaw.enabled !== false,
    intervalMinutes: sanitizeHeartbeatIntervalMinutes(Number(heartbeatRaw.intervalMinutes || DEFAULT_HEARTBEAT.intervalMinutes)),
    suppressEmptyReport: heartbeatRaw.suppressEmptyReport !== false,
    reportToMainSession: heartbeatRaw.reportToMainSession !== false,
    prompt: typeof heartbeatRaw.prompt === 'string' && heartbeatRaw.prompt.trim() ? heartbeatRaw.prompt.trim() : undefined,
    lastRunAt: typeof heartbeatRaw.lastRunAt === 'string' ? heartbeatRaw.lastRunAt : undefined,
    nextRunAt: typeof heartbeatRaw.nextRunAt === 'string' ? heartbeatRaw.nextRunAt : undefined,
    lastDigest: typeof heartbeatRaw.lastDigest === 'string' ? heartbeatRaw.lastDigest : undefined,
  };

  return {
    enabled: Boolean(raw?.enabled),
    intervalMinutes: sanitizeIntervalMinutes(raw?.intervalMinutes),
    keepAliveWhenNoWindow: raw?.keepAliveWhenNoWindow !== false,
    maxProjectsPerTick: sanitizeMaxProjectsPerTick(raw?.maxProjectsPerTick),
    maxAutomationPerTick: sanitizeMaxAutomationPerTick(raw?.maxAutomationPerTick),
    projectStates: normalizedProjectStates,
    heartbeat,
    scheduledTasks: normalizedScheduledTasks,
    longCycleTasks: normalizedLongCycleTasks,
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

function computeNextRunForScheduledTask(task: RedClawScheduledTask, referenceMs: number): string | null {
  const mode = task.mode;

  if (mode === 'interval') {
    const interval = sanitizeIntervalMinutes(task.intervalMinutes || 60);
    return nextIsoFromMinutes(referenceMs, interval);
  }

  if (mode === 'once') {
    if (task.lastRunAt) return null;
    const runAtMs = parseIsoMs(task.runAt);
    if (runAtMs === null) return null;
    return new Date(runAtMs).toISOString();
  }

  const time = parseTimeHHmm(task.time);
  if (!time) return null;

  const now = new Date(referenceMs);

  if (mode === 'daily') {
    const candidate = new Date(referenceMs);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (candidate.getTime() <= referenceMs) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  const weekdays = sanitizeWeekdays(task.weekdays);
  const days = weekdays.length > 0 ? weekdays : [1];
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (!days.includes(candidate.getDay())) continue;
    if (candidate.getTime() <= referenceMs) continue;
    return candidate.toISOString();
  }

  return null;
}

function ensureScheduledTaskNextRun(task: RedClawScheduledTask, nowMs: number): void {
  if (task.nextRunAt && parseIsoMs(task.nextRunAt) !== null) {
    return;
  }

  if (task.lastRunAt) {
    const lastMs = parseIsoMs(task.lastRunAt);
    const nextIso = computeNextRunForScheduledTask(task, lastMs || nowMs);
    task.nextRunAt = nextIso || undefined;
    return;
  }

  const createdMs = parseIsoMs(task.createdAt) || nowMs;
  const nextIso = computeNextRunForScheduledTask(task, createdMs);
  task.nextRunAt = nextIso || undefined;
}

function isScheduledTaskDue(task: RedClawScheduledTask, nowMs: number): boolean {
  if (!task.enabled) return false;

  const nextRunMs = parseIsoMs(task.nextRunAt || '');
  if (nextRunMs === null) return false;

  return nowMs >= nextRunMs;
}

function ensureLongCycleNextRun(task: RedClawLongCycleTask, nowMs: number): void {
  if (task.status === 'completed' || !task.enabled) {
    task.nextRunAt = undefined;
    return;
  }

  if (task.completedRounds >= task.totalRounds) {
    task.status = 'completed';
    task.enabled = false;
    task.nextRunAt = undefined;
    return;
  }

  if (task.nextRunAt && parseIsoMs(task.nextRunAt) !== null) {
    return;
  }

  if (task.lastRunAt) {
    const baseMs = parseIsoMs(task.lastRunAt) || nowMs;
    task.nextRunAt = nextIsoFromMinutes(baseMs, sanitizeIntervalMinutes(task.intervalMinutes));
    return;
  }

  task.nextRunAt = new Date(nowMs).toISOString();
}

function isLongCycleTaskDue(task: RedClawLongCycleTask, nowMs: number): boolean {
  if (!task.enabled) return false;
  if (task.status !== 'running') return false;
  if (task.completedRounds >= task.totalRounds) return false;

  const nextRunMs = parseIsoMs(task.nextRunAt || '');
  if (nextRunMs === null) return false;
  return nowMs >= nextRunMs;
}

export class RedClawBackgroundRunner extends EventEmitter {
  private config: RedClawBackgroundConfig = { ...DEFAULT_CONFIG };
  private isLoaded = false;
  private isTicking = false;
  private timer: NodeJS.Timeout | null = null;
  private maintenanceTimer: NodeJS.Timeout | null = null;
  private currentProjectId: string | null = null;
  private currentAutomationTaskId: string | null = null;
  private lastTickAt: string | null = null;
  private nextTickAt: string | null = null;
  private nextMaintenanceAt: string | null = null;
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

  private normalizeSchedules(nowMs: number): void {
    for (const task of Object.values(this.config.scheduledTasks)) {
      ensureScheduledTaskNextRun(task, nowMs);
    }
    for (const task of Object.values(this.config.longCycleTasks)) {
      ensureLongCycleNextRun(task, nowMs);
    }

    const heartbeat = this.config.heartbeat;
    if (heartbeat.enabled) {
      if (!heartbeat.nextRunAt || parseIsoMs(heartbeat.nextRunAt) === null) {
        heartbeat.nextRunAt = heartbeat.lastRunAt
          ? nextIsoFromMinutes(parseIsoMs(heartbeat.lastRunAt) || nowMs, heartbeat.intervalMinutes)
          : new Date(nowMs).toISOString();
      }
    } else {
      heartbeat.nextRunAt = undefined;
    }
  }

  private async loadConfig(): Promise<void> {
    const configPath = this.getConfigPath();
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      this.config = normalizeConfig(JSON.parse(raw) as Partial<RedClawBackgroundConfig>);
    } catch {
      this.config = normalizeConfig(DEFAULT_CONFIG);
      this.normalizeSchedules(Date.now());
      await this.persistConfig();
    }

    this.normalizeSchedules(Date.now());
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
      void this.runProjectTick('scheduled');
    }, delayMs);
    this.emitStatus();
  }

  private scheduleMaintenanceCheck(): void {
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }

    if (!this.config.enabled) {
      this.nextMaintenanceAt = null;
      this.emitStatus();
      return;
    }

    this.nextMaintenanceAt = new Date(Date.now() + MAINTENANCE_CHECK_MS).toISOString();
    this.maintenanceTimer = setTimeout(() => {
      void this.runMaintenanceTick('scheduled');
    }, MAINTENANCE_CHECK_MS);
    this.emitStatus();
  }

  private isBusy(): boolean {
    return this.isTicking;
  }

  private setBusy(value: boolean): void {
    this.isTicking = value;
    this.emitStatus();
  }

  async init(): Promise<void> {
    await this.ensureLoaded();
    if (this.config.enabled) {
      this.scheduleNextTick();
      this.scheduleMaintenanceCheck();
      void this.runProjectTick('init');
      void this.runMaintenanceTick('init');
    }
  }

  async reloadForWorkspaceChange(): Promise<void> {
    await this.stop({ persist: false });
    this.isLoaded = false;
    await this.ensureLoaded();
    if (this.config.enabled) {
      this.scheduleNextTick();
      this.scheduleMaintenanceCheck();
      void this.runProjectTick('workspace-change');
      void this.runMaintenanceTick('workspace-change');
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
      maxAutomationPerTick: this.config.maxAutomationPerTick,
      isTicking: this.isTicking,
      currentProjectId: this.currentProjectId,
      currentAutomationTaskId: this.currentAutomationTaskId,
      lastTickAt: this.lastTickAt,
      nextTickAt: this.nextTickAt,
      lastError: this.lastError,
      nextMaintenanceAt: this.nextMaintenanceAt,
      projectStates: this.config.projectStates,
      heartbeat: this.config.heartbeat,
      scheduledTasks: this.config.scheduledTasks,
      longCycleTasks: this.config.longCycleTasks,
    };
  }

  async setRunnerConfig(input: {
    enabled?: boolean;
    intervalMinutes?: number;
    keepAliveWhenNoWindow?: boolean;
    maxProjectsPerTick?: number;
    maxAutomationPerTick?: number;
    heartbeatEnabled?: boolean;
    heartbeatIntervalMinutes?: number;
    heartbeatSuppressEmptyReport?: boolean;
    heartbeatReportToMainSession?: boolean;
    heartbeatPrompt?: string;
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
    if (typeof input.maxAutomationPerTick === 'number') {
      this.config.maxAutomationPerTick = sanitizeMaxAutomationPerTick(input.maxAutomationPerTick);
    }
    if (typeof input.heartbeatEnabled === 'boolean') {
      this.config.heartbeat.enabled = input.heartbeatEnabled;
    }
    if (typeof input.heartbeatIntervalMinutes === 'number') {
      this.config.heartbeat.intervalMinutes = sanitizeHeartbeatIntervalMinutes(input.heartbeatIntervalMinutes);
    }
    if (typeof input.heartbeatSuppressEmptyReport === 'boolean') {
      this.config.heartbeat.suppressEmptyReport = input.heartbeatSuppressEmptyReport;
    }
    if (typeof input.heartbeatReportToMainSession === 'boolean') {
      this.config.heartbeat.reportToMainSession = input.heartbeatReportToMainSession;
    }
    if (typeof input.heartbeatPrompt === 'string') {
      const text = input.heartbeatPrompt.trim();
      this.config.heartbeat.prompt = text || undefined;
    }

    this.normalizeSchedules(Date.now());
    await this.persistConfig();

    if (this.config.enabled) {
      this.scheduleNextTick();
      this.scheduleMaintenanceCheck();
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

  listScheduledTasks(): RedClawScheduledTask[] {
    const nowMs = Date.now();
    const tasks = Object.values(this.config.scheduledTasks).map((task) => {
      ensureScheduledTaskNextRun(task, nowMs);
      return task;
    });

    return tasks.sort((a, b) => {
      const at = parseIsoMs(a.nextRunAt || '') || Number.MAX_SAFE_INTEGER;
      const bt = parseIsoMs(b.nextRunAt || '') || Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
  }

  async addScheduledTask(input: {
    name: string;
    mode: ScheduleMode;
    prompt: string;
    projectId?: string;
    intervalMinutes?: number;
    time?: string;
    weekdays?: number[];
    runAt?: string;
    enabled?: boolean;
  }): Promise<RedClawScheduledTask> {
    await this.ensureLoaded();
    const mode = String(input.mode || 'interval').trim().toLowerCase() as ScheduleMode;
    if (!['interval', 'daily', 'weekly', 'once'].includes(mode)) {
      throw new Error('mode must be one of interval/daily/weekly/once');
    }

    const prompt = String(input.prompt || '').trim();
    if (!prompt) {
      throw new Error('prompt is required');
    }

    const now = nowIso();
    const task: RedClawScheduledTask = {
      id: generateTaskId('sched'),
      name: String(input.name || 'Scheduled Task').trim() || 'Scheduled Task',
      enabled: input.enabled !== false,
      mode,
      prompt,
      projectId: typeof input.projectId === 'string' && input.projectId.trim() ? input.projectId.trim() : undefined,
      intervalMinutes: mode === 'interval' ? sanitizeIntervalMinutes(input.intervalMinutes || 60) : undefined,
      time: mode === 'daily' || mode === 'weekly' ? sanitizeTimeHHmm(input.time) : undefined,
      weekdays: mode === 'weekly' ? sanitizeWeekdays(input.weekdays) : undefined,
      runAt: mode === 'once' ? String(input.runAt || '').trim() || undefined : undefined,
      createdAt: now,
      updatedAt: now,
      nextRunAt: undefined,
    };

    if (mode === 'daily' || mode === 'weekly') {
      if (!task.time) {
        throw new Error('time is required for daily/weekly task, format HH:mm');
      }
    }
    if (mode === 'weekly') {
      if (!task.weekdays || task.weekdays.length === 0) {
        task.weekdays = [1];
      }
    }
    if (mode === 'once') {
      if (!task.runAt || parseIsoMs(task.runAt) === null) {
        throw new Error('runAt is required for once task (ISO datetime)');
      }
    }

    ensureScheduledTaskNextRun(task, Date.now());
    this.config.scheduledTasks[task.id] = task;
    await this.persistConfig();
    this.emitStatus();
    return task;
  }

  async updateScheduledTask(taskId: string, input: {
    name?: string;
    mode?: ScheduleMode;
    prompt?: string;
    projectId?: string | null;
    intervalMinutes?: number;
    time?: string;
    weekdays?: number[];
    runAt?: string;
    enabled?: boolean;
  }): Promise<RedClawScheduledTask> {
    await this.ensureLoaded();
    const id = String(taskId || '').trim();
    if (!id) throw new Error('taskId is required');
    const current = this.config.scheduledTasks[id];
    if (!current) throw new Error('Scheduled task not found');

    const mode = input.mode ? String(input.mode).trim().toLowerCase() as ScheduleMode : current.mode;
    if (!['interval', 'daily', 'weekly', 'once'].includes(mode)) {
      throw new Error('mode must be one of interval/daily/weekly/once');
    }

    const name = input.name !== undefined
      ? (String(input.name || '').trim() || current.name)
      : current.name;
    const prompt = input.prompt !== undefined
      ? String(input.prompt || '').trim()
      : current.prompt;
    if (!prompt) {
      throw new Error('prompt is required');
    }

    const projectId = input.projectId !== undefined
      ? (typeof input.projectId === 'string' && input.projectId.trim() ? input.projectId.trim() : undefined)
      : current.projectId;
    const intervalMinutes = mode === 'interval'
      ? sanitizeIntervalMinutes(input.intervalMinutes ?? current.intervalMinutes ?? 60)
      : undefined;
    const time = mode === 'daily' || mode === 'weekly'
      ? sanitizeTimeHHmm(input.time ?? current.time)
      : undefined;
    const weekdays = mode === 'weekly'
      ? sanitizeWeekdays(input.weekdays ?? current.weekdays)
      : undefined;
    const runAt = mode === 'once'
      ? String(input.runAt ?? current.runAt ?? '').trim() || undefined
      : undefined;

    if ((mode === 'daily' || mode === 'weekly') && !time) {
      throw new Error('time is required for daily/weekly task, format HH:mm');
    }
    if (mode === 'weekly' && (!weekdays || weekdays.length === 0)) {
      throw new Error('weekdays is required for weekly task');
    }
    if (mode === 'once') {
      if (!runAt || parseIsoMs(runAt) === null) {
        throw new Error('runAt is required for once task (ISO datetime)');
      }
    }

    current.name = name;
    current.mode = mode;
    current.prompt = prompt;
    current.projectId = projectId;
    current.intervalMinutes = intervalMinutes;
    current.time = time;
    current.weekdays = weekdays;
    current.runAt = runAt;
    if (typeof input.enabled === 'boolean') {
      current.enabled = input.enabled;
    }
    if (mode === 'once' && input.runAt !== undefined) {
      current.lastRunAt = undefined;
      current.lastResult = undefined;
      current.lastError = undefined;
    }
    current.updatedAt = nowIso();
    current.nextRunAt = undefined;
    ensureScheduledTaskNextRun(current, Date.now());

    await this.persistConfig();
    this.emitStatus();
    return current;
  }

  async removeScheduledTask(taskId: string): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    const id = String(taskId || '').trim();
    if (!id) throw new Error('taskId is required');
    delete this.config.scheduledTasks[id];
    await this.persistConfig();
    this.emitStatus();
    return this.getStatus();
  }

  async setScheduledTaskEnabled(taskId: string, enabled: boolean): Promise<RedClawScheduledTask> {
    await this.ensureLoaded();
    const id = String(taskId || '').trim();
    if (!id) throw new Error('taskId is required');
    const task = this.config.scheduledTasks[id];
    if (!task) throw new Error('Scheduled task not found');
    task.enabled = Boolean(enabled);
    task.updatedAt = nowIso();
    if (task.enabled) {
      ensureScheduledTaskNextRun(task, Date.now());
    }
    await this.persistConfig();
    this.emitStatus();
    return task;
  }

  listLongCycleTasks(): RedClawLongCycleTask[] {
    const nowMs = Date.now();
    const tasks = Object.values(this.config.longCycleTasks).map((task) => {
      ensureLongCycleNextRun(task, nowMs);
      return task;
    });

    return tasks.sort((a, b) => {
      const at = parseIsoMs(a.nextRunAt || '') || Number.MAX_SAFE_INTEGER;
      const bt = parseIsoMs(b.nextRunAt || '') || Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
  }

  async addLongCycleTask(input: {
    name: string;
    objective: string;
    stepPrompt: string;
    projectId?: string;
    intervalMinutes?: number;
    totalRounds?: number;
    enabled?: boolean;
  }): Promise<RedClawLongCycleTask> {
    await this.ensureLoaded();
    const objective = String(input.objective || '').trim();
    const stepPrompt = String(input.stepPrompt || '').trim();
    if (!objective) throw new Error('objective is required');
    if (!stepPrompt) throw new Error('stepPrompt is required');

    const now = nowIso();
    const task: RedClawLongCycleTask = {
      id: generateTaskId('long'),
      name: String(input.name || 'Long Cycle Task').trim() || 'Long Cycle Task',
      enabled: input.enabled !== false,
      status: 'running',
      objective,
      stepPrompt,
      projectId: typeof input.projectId === 'string' && input.projectId.trim() ? input.projectId.trim() : undefined,
      intervalMinutes: sanitizeIntervalMinutes(input.intervalMinutes || this.config.intervalMinutes),
      totalRounds: sanitizeLongCycleRounds(input.totalRounds || 8),
      completedRounds: 0,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
    };

    this.config.longCycleTasks[task.id] = task;
    await this.persistConfig();
    this.emitStatus();
    return task;
  }

  async updateLongCycleTask(taskId: string, input: {
    name?: string;
    objective?: string;
    stepPrompt?: string;
    projectId?: string | null;
    intervalMinutes?: number;
    totalRounds?: number;
    enabled?: boolean;
  }): Promise<RedClawLongCycleTask> {
    await this.ensureLoaded();
    const id = String(taskId || '').trim();
    if (!id) throw new Error('taskId is required');
    const current = this.config.longCycleTasks[id];
    if (!current) throw new Error('Long cycle task not found');

    if (input.name !== undefined) {
      current.name = String(input.name || '').trim() || current.name;
    }
    if (input.objective !== undefined) {
      const text = String(input.objective || '').trim();
      if (!text) throw new Error('objective cannot be empty');
      current.objective = text;
    }
    if (input.stepPrompt !== undefined) {
      const text = String(input.stepPrompt || '').trim();
      if (!text) throw new Error('stepPrompt cannot be empty');
      current.stepPrompt = text;
    }
    if (input.projectId !== undefined) {
      current.projectId = typeof input.projectId === 'string' && input.projectId.trim()
        ? input.projectId.trim()
        : undefined;
    }
    if (typeof input.intervalMinutes === 'number') {
      current.intervalMinutes = sanitizeIntervalMinutes(input.intervalMinutes);
      current.nextRunAt = undefined;
    }
    if (typeof input.totalRounds === 'number') {
      current.totalRounds = sanitizeLongCycleRounds(input.totalRounds);
      current.completedRounds = Math.min(current.completedRounds, current.totalRounds);
      if (current.completedRounds >= current.totalRounds) {
        current.status = 'completed';
        current.enabled = false;
      }
    }
    if (typeof input.enabled === 'boolean') {
      current.enabled = input.enabled;
      current.status = input.enabled
        ? (current.completedRounds >= current.totalRounds ? 'completed' : 'running')
        : (current.completedRounds >= current.totalRounds ? 'completed' : 'paused');
      if (input.enabled) {
        current.nextRunAt = undefined;
      }
    }
    current.updatedAt = nowIso();
    ensureLongCycleNextRun(current, Date.now());

    await this.persistConfig();
    this.emitStatus();
    return current;
  }

  async removeLongCycleTask(taskId: string): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    const id = String(taskId || '').trim();
    if (!id) throw new Error('taskId is required');
    delete this.config.longCycleTasks[id];
    await this.persistConfig();
    this.emitStatus();
    return this.getStatus();
  }

  async setLongCycleTaskEnabled(taskId: string, enabled: boolean): Promise<RedClawLongCycleTask> {
    await this.ensureLoaded();
    const id = String(taskId || '').trim();
    if (!id) throw new Error('taskId is required');
    const task = this.config.longCycleTasks[id];
    if (!task) throw new Error('Long cycle task not found');

    task.enabled = Boolean(enabled);
    task.status = enabled
      ? (task.completedRounds >= task.totalRounds ? 'completed' : 'running')
      : (task.completedRounds >= task.totalRounds ? 'completed' : 'paused');
    task.updatedAt = nowIso();
    if (task.enabled && task.status !== 'completed') {
      ensureLongCycleNextRun(task, Date.now());
    }
    await this.persistConfig();
    this.emitStatus();
    return task;
  }

  async start(input?: {
    intervalMinutes?: number;
    keepAliveWhenNoWindow?: boolean;
    maxProjectsPerTick?: number;
    maxAutomationPerTick?: number;
    heartbeatEnabled?: boolean;
    heartbeatIntervalMinutes?: number;
  }): Promise<RedClawBackgroundRunnerStatus> {
    return this.setRunnerConfig({
      enabled: true,
      intervalMinutes: input?.intervalMinutes,
      keepAliveWhenNoWindow: input?.keepAliveWhenNoWindow,
      maxProjectsPerTick: input?.maxProjectsPerTick,
      maxAutomationPerTick: input?.maxAutomationPerTick,
      heartbeatEnabled: input?.heartbeatEnabled,
      heartbeatIntervalMinutes: input?.heartbeatIntervalMinutes,
    });
  }

  async stop(options?: { persist?: boolean }): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }

    this.nextTickAt = null;
    this.nextMaintenanceAt = null;

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
    await this.runProjectTick('manual', projectId);
    await this.runMaintenanceTick('manual');
    return this.getStatus();
  }

  async runScheduledTaskNow(taskId: string): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    await this.executeScheduledTask(taskId, 'manual');
    await this.persistConfig();
    this.emitStatus();
    return this.getStatus();
  }

  async runLongCycleTaskNow(taskId: string): Promise<RedClawBackgroundRunnerStatus> {
    await this.ensureLoaded();
    await this.executeLongCycleTask(taskId, 'manual');
    await this.persistConfig();
    this.emitStatus();
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

  private async runAgentPrompt(params: {
    contextId: string;
    title: string;
    prompt: string;
    contextContent: string;
    displayContent?: string;
  }): Promise<{ sessionId: string }> {
    const contextType = 'redclaw';
    let session = getChatSessionByContext(params.contextId, contextType);
    if (!session) {
      const sid = `session_${params.contextId.replace(/[^a-zA-Z0-9_:-]/g, '_')}`;
      session = createChatSession(sid, params.title, {
        contextId: params.contextId,
        contextType,
        contextContent: params.contextContent,
        isContextBound: true,
      });
    }

    addChatMessage({
      id: `msg_bg_user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      session_id: session.id,
      role: 'user',
      content: params.prompt,
      display_content: params.displayContent || '[后台自动任务]',
    });

    const service = new PiChatService();
    this.currentService = service;
    try {
      await service.sendMessage(params.prompt, session.id);
      return { sessionId: session.id };
    } finally {
      if (this.currentService === service) {
        this.currentService = null;
      }
    }
  }

  private mirrorLatestAssistantToMainSession(sourceSessionId: string, displayContent: string): void {
    try {
      const sourceMessages = getChatMessages(sourceSessionId);
      const latestAssistant = [...sourceMessages].reverse().find((msg) => msg.role === 'assistant' && String(msg.content || '').trim());
      if (!latestAssistant) return;

      const mainSession = this.ensureMainRedClawSession();
      addChatMessage({
        id: `msg_redclaw_auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        session_id: mainSession.id,
        role: 'assistant',
        content: String(latestAssistant.content || ''),
        display_content: displayContent,
      });
      this.emit('message', {
        sessionId: mainSession.id,
        displayContent,
        source: 'automation',
        at: nowIso(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('log', { level: 'warn', message: `Mirror task result failed: ${message}`, reason: 'scheduled', at: nowIso() });
    }
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

    await this.runAgentPrompt({
      contextId: `redclaw-bg-${projectId}`,
      title: `RedClaw BG ${project.goal.slice(0, 24)}`,
      contextContent: [
        `后台项目: ${projectId}`,
        `目标: ${project.goal}`,
        '这是后台自动推进会话，不依赖前台界面。',
      ].join('\n'),
      prompt: prompt.message,
      displayContent: '[后台项目推进]',
    });

    this.updateProjectRunResult(projectId, 'success');
  }

  private async runProjectTick(reason: 'scheduled' | 'manual' | 'init' | 'workspace-change', onlyProjectId?: string): Promise<void> {
    await this.ensureLoaded();
    if (this.isBusy()) return;

    const settings = (getSettings() || {}) as Record<string, unknown>;
    const apiKey = (settings.api_key as string) || (settings.openaiApiKey as string) || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      this.lastError = 'API Key 未配置，后台任务未执行。';
      this.emit('log', { level: 'warn', message: this.lastError, reason, at: nowIso() });
      this.emitStatus();
      this.scheduleNextTick();
      return;
    }

    this.setBusy(true);
    this.lastError = null;

    try {
      const projects = await listRedClawProjects(100);
      const enabledIds = Object.values(this.config.projectStates)
        .filter((state) => state.enabled)
        .map((state) => state.projectId);

      const targets = onlyProjectId
        ? [onlyProjectId]
        : enabledIds
            .filter((id) => projects.some((project) => project.id === id))
            .slice(0, this.config.maxProjectsPerTick);

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

      this.normalizeSchedules(Date.now());
      await this.persistConfig();
      this.lastTickAt = nowIso();
    } finally {
      this.currentProjectId = null;
      this.setBusy(false);
      this.scheduleNextTick();
      this.scheduleMaintenanceCheck();
    }
  }

  private buildScheduledTaskPrompt(task: RedClawScheduledTask): string {
    const nowLocal = new Date().toLocaleString('zh-CN', {
      hour12: false,
      timeZone: 'Asia/Shanghai',
    });
    return [
      '[RedClaw 定时任务]',
      `任务ID: ${task.id}`,
      `任务名: ${task.name}`,
      `调度模式: ${task.mode}`,
      `触发时间(北京时间): ${nowLocal}`,
      task.projectId ? `关联项目: ${task.projectId}` : '关联项目: (无)',
      '',
      '请在当前空间内执行以下任务，并给出简短结果。',
      '报时时请优先使用上方“触发时间(北京时间)”作为基准，避免时区错误：',
      task.prompt,
      '',
      '如果涉及稿件/媒体/项目操作，优先调用 app_cli。',
    ].join('\n');
  }

  private async executeScheduledTask(taskId: string, reason: 'scheduled' | 'manual'): Promise<void> {
    const task = this.config.scheduledTasks[taskId];
    if (!task) throw new Error('Scheduled task not found');

    this.currentAutomationTaskId = task.id;
    this.emitStatus();

    try {
      if (!task.enabled) {
        task.lastResult = 'skipped';
        return;
      }

      const result = await this.runAgentPrompt({
        contextId: `redclaw-schedule-${task.id}`,
        title: `RedClaw Schedule ${task.name}`,
        contextContent: [
          `定时任务ID: ${task.id}`,
          `名称: ${task.name}`,
          `模式: ${task.mode}`,
        ].join('\n'),
        prompt: this.buildScheduledTaskPrompt(task),
        displayContent: `[定时任务:${task.name}]`,
      });
      this.mirrorLatestAssistantToMainSession(result.sessionId, `[定时任务结果:${task.name}]`);

      task.lastRunAt = nowIso();
      task.lastResult = 'success';
      task.lastError = undefined;

      const nowMs = Date.now();
      if (task.mode === 'once') {
        task.enabled = false;
        task.nextRunAt = undefined;
      } else {
        task.nextRunAt = computeNextRunForScheduledTask(task, nowMs) || undefined;
      }
      task.updatedAt = nowIso();
      this.emit('log', { level: 'info', message: `Scheduled task completed: ${task.id}`, reason, at: nowIso() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task.lastRunAt = nowIso();
      task.lastResult = 'error';
      task.lastError = message;
      task.updatedAt = nowIso();
      if (task.mode !== 'once') {
        task.nextRunAt = computeNextRunForScheduledTask(task, Date.now()) || undefined;
      }
      this.lastError = message;
      this.emit('log', { level: 'error', message: `Scheduled task failed: ${task.id}: ${message}`, reason, at: nowIso() });
    } finally {
      this.currentAutomationTaskId = null;
      this.emitStatus();
    }
  }

  private buildLongCyclePrompt(task: RedClawLongCycleTask): string {
    return [
      '[RedClaw 长周期任务]',
      `任务ID: ${task.id}`,
      `任务名: ${task.name}`,
      task.projectId ? `关联项目: ${task.projectId}` : '关联项目: (无)',
      `当前进度: ${task.completedRounds}/${task.totalRounds}`,
      '',
      `长期目标: ${task.objective}`,
      '',
      '请只推进“本轮一个最小可验证步骤”，并给出可验证产物。',
      task.stepPrompt,
      '',
      '如果任务已达到完成条件，请在回复中包含：LONG_CYCLE_DONE。',
    ].join('\n');
  }

  private async executeLongCycleTask(taskId: string, reason: 'scheduled' | 'manual'): Promise<void> {
    const task = this.config.longCycleTasks[taskId];
    if (!task) throw new Error('Long cycle task not found');

    this.currentAutomationTaskId = task.id;
    this.emitStatus();

    try {
      ensureLongCycleNextRun(task, Date.now());

      if (!task.enabled || task.status !== 'running') {
        task.lastResult = 'skipped';
        return;
      }

      if (task.completedRounds >= task.totalRounds) {
        task.status = 'completed';
        task.enabled = false;
        task.nextRunAt = undefined;
        task.lastResult = 'skipped';
        return;
      }

      const result = await this.runAgentPrompt({
        contextId: `redclaw-long-${task.id}`,
        title: `RedClaw Long ${task.name}`,
        contextContent: [
          `长周期任务ID: ${task.id}`,
          `名称: ${task.name}`,
          `目标: ${task.objective}`,
        ].join('\n'),
        prompt: this.buildLongCyclePrompt(task),
        displayContent: `[长周期任务:${task.name}]`,
      });
      this.mirrorLatestAssistantToMainSession(result.sessionId, `[长周期任务结果:${task.name}]`);

      task.completedRounds += 1;
      task.lastRunAt = nowIso();
      task.lastResult = 'success';
      task.lastError = undefined;

      if (task.completedRounds >= task.totalRounds) {
        task.status = 'completed';
        task.enabled = false;
        task.nextRunAt = undefined;
      } else {
        task.nextRunAt = nextIsoFromMinutes(Date.now(), sanitizeIntervalMinutes(task.intervalMinutes));
      }
      task.updatedAt = nowIso();
      this.emit('log', { level: 'info', message: `Long-cycle task progressed: ${task.id} (${task.completedRounds}/${task.totalRounds})`, reason, at: nowIso() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      task.lastRunAt = nowIso();
      task.lastResult = 'error';
      task.lastError = message;
      task.nextRunAt = nextIsoFromMinutes(Date.now(), sanitizeIntervalMinutes(task.intervalMinutes));
      task.updatedAt = nowIso();
      this.lastError = message;
      this.emit('log', { level: 'error', message: `Long-cycle task failed: ${task.id}: ${message}`, reason, at: nowIso() });
    } finally {
      this.currentAutomationTaskId = null;
      this.emitStatus();
    }
  }

  private buildHeartbeatSummary(now: string): { summary: string; digest: string } {
    const enabledProjects = Object.values(this.config.projectStates).filter((item) => item.enabled);
    const projectFailed = enabledProjects.filter((item) => item.lastResult === 'error').length;
    const projectSuccess = enabledProjects.filter((item) => item.lastResult === 'success').length;

    const scheduledAll = Object.values(this.config.scheduledTasks);
    const scheduledEnabled = scheduledAll.filter((item) => item.enabled);
    const scheduledFailed = scheduledAll.filter((item) => item.lastResult === 'error').length;

    const longAll = Object.values(this.config.longCycleTasks);
    const longRunning = longAll.filter((item) => item.enabled && item.status === 'running');
    const longCompleted = longAll.filter((item) => item.status === 'completed').length;

    const digestPayload = {
      t: now.slice(0, 16),
      project: enabledProjects.map((item) => ({ id: item.projectId, result: item.lastResult || '', run: item.lastRunAt || '' })),
      scheduled: scheduledAll.map((item) => ({ id: item.id, result: item.lastResult || '', next: item.nextRunAt || '', enabled: item.enabled })),
      long: longAll.map((item) => ({ id: item.id, status: item.status, round: `${item.completedRounds}/${item.totalRounds}` })),
      lastError: this.lastError || '',
    };

    const summaryLines = [
      '[RedClaw 心跳汇报]',
      `时间: ${now}`,
      `项目推进: 已启用 ${enabledProjects.length} 个，最近成功 ${projectSuccess}，失败 ${projectFailed}`,
      `定时任务: 总计 ${scheduledAll.length}，启用 ${scheduledEnabled.length}，失败 ${scheduledFailed}`,
      `长周期任务: 运行中 ${longRunning.length}，已完成 ${longCompleted}`,
    ];

    if (this.lastError) {
      summaryLines.push(`最近错误: ${this.lastError}`);
    }

    if (longRunning.length > 0) {
      const progress = longRunning
        .slice(0, 3)
        .map((item) => `${item.name}(${item.completedRounds}/${item.totalRounds})`)
        .join('，');
      summaryLines.push(`长周期进度: ${progress}`);
    }

    return {
      summary: summaryLines.join('\n'),
      digest: JSON.stringify(digestPayload),
    };
  }

  private ensureMainRedClawSession() {
    const activeSpaceId = getActiveSpaceId();
    const contextId = `redclaw-singleton:${activeSpaceId}`;
    const contextType = 'redclaw';

    let session = getChatSessionByContext(contextId, contextType);
    if (!session) {
      session = createChatSession(
        `session_redclaw_main_${activeSpaceId}`,
        `RedClaw · ${activeSpaceId}`,
        {
          contextId,
          contextType,
          contextContent: `RedClaw 主会话（空间：${activeSpaceId}）`,
          isContextBound: true,
        },
      );
    }

    return session;
  }

  private async runHeartbeat(reason: 'scheduled' | 'manual' | 'init' | 'workspace-change'): Promise<void> {
    const heartbeat = this.config.heartbeat;
    if (!heartbeat.enabled) {
      return;
    }

    const now = nowIso();
    const { summary, digest } = this.buildHeartbeatSummary(now);
    const shouldSuppress = heartbeat.suppressEmptyReport && heartbeat.lastDigest === digest;

    heartbeat.lastRunAt = now;
    heartbeat.nextRunAt = nextIsoFromMinutes(Date.now(), heartbeat.intervalMinutes);

    if (shouldSuppress) {
      this.emit('log', { level: 'info', message: 'HEARTBEAT_OK', reason, at: now });
      return;
    }

    heartbeat.lastDigest = digest;

    if (heartbeat.prompt) {
      const prompt = [
        '[RedClaw 心跳任务]',
        summary,
        '',
        '请基于以上状态输出简要运营汇报，要求：',
        '1) 如果无异常且无需人工关注，回复 HEARTBEAT_OK。',
        '2) 如果有风险，输出“风险 + 建议动作 + 优先级”。',
        '',
        heartbeat.prompt,
      ].join('\n');

      await this.runAgentPrompt({
        contextId: `redclaw-heartbeat:${getWorkspacePaths().activeSpaceId}`,
        title: 'RedClaw Heartbeat',
        contextContent: '这是 RedClaw 的后台心跳汇报会话。',
        prompt,
        displayContent: '[后台心跳任务]',
      });
      this.emit('log', { level: 'info', message: 'Heartbeat completed via AI prompt', reason, at: now });
      return;
    }

    if (heartbeat.reportToMainSession) {
      const session = this.ensureMainRedClawSession();
      addChatMessage({
        id: `msg_redclaw_hb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        session_id: session.id,
        role: 'assistant',
        content: summary,
        display_content: '[后台心跳汇报]',
      });
      this.emit('message', {
        sessionId: session.id,
        displayContent: '[后台心跳汇报]',
        source: 'heartbeat',
        at: now,
      });
    }

    this.emit('log', { level: 'info', message: 'Heartbeat report emitted', reason, at: now, summary });
  }

  private async runMaintenanceTick(reason: 'scheduled' | 'manual' | 'init' | 'workspace-change'): Promise<void> {
    await this.ensureLoaded();
    if (!this.config.enabled) {
      this.scheduleMaintenanceCheck();
      return;
    }

    if (this.isBusy()) {
      this.scheduleMaintenanceCheck();
      return;
    }

    this.setBusy(true);

    try {
      const nowMs = Date.now();
      this.normalizeSchedules(nowMs);

      const dueScheduled = Object.values(this.config.scheduledTasks)
        .filter((task) => {
          ensureScheduledTaskNextRun(task, nowMs);
          return isScheduledTaskDue(task, nowMs);
        })
        .sort((a, b) => (parseIsoMs(a.nextRunAt || '') || 0) - (parseIsoMs(b.nextRunAt || '') || 0));

      const dueLongCycle = Object.values(this.config.longCycleTasks)
        .filter((task) => {
          ensureLongCycleNextRun(task, nowMs);
          return isLongCycleTaskDue(task, nowMs);
        })
        .sort((a, b) => (parseIsoMs(a.nextRunAt || '') || 0) - (parseIsoMs(b.nextRunAt || '') || 0));

      let automationBudget = this.config.maxAutomationPerTick;

      for (const task of dueScheduled) {
        if (automationBudget <= 0) break;
        await this.executeScheduledTask(task.id, reason === 'manual' ? 'manual' : 'scheduled');
        automationBudget -= 1;
      }

      for (const task of dueLongCycle) {
        if (automationBudget <= 0) break;
        await this.executeLongCycleTask(task.id, reason === 'manual' ? 'manual' : 'scheduled');
        automationBudget -= 1;
      }

      const heartbeat = this.config.heartbeat;
      const heartbeatDue = heartbeat.enabled && (() => {
        const nextMs = parseIsoMs(heartbeat.nextRunAt || '');
        if (nextMs === null) return true;
        return nowMs >= nextMs;
      })();

      if (heartbeatDue) {
        await this.runHeartbeat(reason);
      }

      await this.persistConfig();
      this.lastTickAt = nowIso();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.emit('log', { level: 'error', message: `Maintenance tick failed: ${message}`, reason, at: nowIso() });
    } finally {
      this.setBusy(false);
      this.scheduleMaintenanceCheck();
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
