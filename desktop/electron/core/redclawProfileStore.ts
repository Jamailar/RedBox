import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getWorkspacePaths } from '../db';
import { addUserMemoryToFile } from './fileMemoryStore';

interface RedClawOnboardingState {
  version: number;
  startedAt?: string;
  updatedAt: string;
  askedFirstQuestion: boolean;
  stepIndex: number;
  answers: Record<string, string>;
  completedAt?: string;
}

interface OnboardingStep {
  key: string;
  question: string;
  defaultValue: string;
}

export interface RedClawProfilePromptBundle {
  profileRoot: string;
  onboardingState: RedClawOnboardingState;
  files: {
    agent: string;
    soul: string;
    identity: string;
    user: string;
    bootstrap: string;
  };
}

export interface RedClawOnboardingTurnResult {
  handled: boolean;
  responseText?: string;
  completed?: boolean;
}

const PROFILE_DIR = path.join('redclaw', 'profile');
const ONBOARDING_STATE_FILE = 'onboarding-state.json';
const AGENT_FILE = 'Agent.md';
const SOUL_FILE = 'Soul.md';
const IDENTITY_FILE = 'identity.md';
const USER_FILE = 'user.md';
const BOOTSTRAP_FILE = 'BOOTSTRAP.md';

const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: 'assistant_style',
    question: '1/5 先定一下我的协作风格。你希望 RedClaw 在对话里更偏向哪种风格？例如：高执行、强结构、温和陪跑、直接批判。',
    defaultValue: '高执行 + 强结构 + 直接反馈',
  },
  {
    key: 'creator_goal',
    question: '2/5 你的核心创作目标是什么？例如：涨粉、获客、卖课、品牌影响力。可以写主目标 + 次目标。',
    defaultValue: '主目标：稳定涨粉；次目标：建立可信个人品牌',
  },
  {
    key: 'target_audience',
    question: '3/5 你的目标用户是谁？请描述人群画像（年龄/职业/痛点/预算/期待）。',
    defaultValue: '25-35岁的一线和新一线职场人，关注效率、成长和副业机会',
  },
  {
    key: 'content_lane',
    question: '4/5 你主要做哪些内容赛道？以及偏好的笔记结构（如：清单体、教程体、案例体、复盘体）。',
    defaultValue: 'AI效率工具 + 职场成长；偏好教程体和复盘体',
  },
  {
    key: 'tone_and_constraints',
    question: '5/5 最后确认表达风格和边界：你希望文案语气、禁用词、合规边界、发布频率、成功指标分别是什么？',
    defaultValue: '语气真实克制；避免夸张承诺；每周3-5篇；成功指标看收藏率与私信转化',
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function getProfileRoot(): string {
  return path.join(getWorkspacePaths().base, PROFILE_DIR);
}

function getFilePath(fileName: string): string {
  return path.join(getProfileRoot(), fileName);
}

function defaultOnboardingState(): RedClawOnboardingState {
  return {
    version: 1,
    updatedAt: nowIso(),
    askedFirstQuestion: false,
    stepIndex: 0,
    answers: {},
  };
}

function buildDefaultAgentTemplate(): string {
  return [
    '# Agent.md',
    '',
    '你是 RedClaw，服务于 RedConvert 的小红书创作执行 Agent。',
    '',
    '## 启动顺序（每次会话）',
    '1. 读取 Soul.md（你的行为风格）',
    '2. 读取 user.md（用户画像和创作目标）',
    '3. 读取 identity.md（你的身份设定）',
    '4. 读取 memory/MEMORY.md（长期记忆摘要）',
    '',
    '## RedClaw 规则',
    '- 先执行再解释，优先给出可落地动作。',
    '- 涉及本应用能力时优先调用 app_cli。',
    '- 文件操作严格限制在 currentSpaceRoot。',
    '- 对文件数量/列表/状态类事实，必须先工具验证。',
    '- 用户给出长期偏好和约束时，及时写入长期记忆。',
    '',
    '## 创作流程',
    '目标 -> 选题 -> 文案 -> 配图 -> 发布计划 -> 数据复盘 -> 下一轮假设',
  ].join('\n');
}

function buildDefaultSoulTemplate(): string {
  return [
    '# Soul.md',
    '',
    '## 核心人格',
    '- 行动导向，不空谈。',
    '- 对结果负责：每一步都给验收标准。',
    '- 风格务实、直接、尊重用户时间。',
    '',
    '## 表达风格',
    '- 默认中文。',
    '- 先结论后细节。',
    '- 优先给 checklist、步骤和可执行命令。',
  ].join('\n');
}

function buildDefaultIdentityTemplate(): string {
  return [
    '# identity.md',
    '',
    '- Name: RedClaw',
    '- Role: 小红书创作自动化 Agent',
    '- Vibe: 执行型、结构化、结果导向',
    '- Signature: 🦀',
    '- UpdatedAt: ' + nowIso(),
  ].join('\n');
}

function buildDefaultUserTemplate(): string {
  return [
    '# user.md',
    '',
    '## 用户创作档案（持续更新）',
    '- 称呼: （待填写）',
    '- 核心创作目标: （待填写）',
    '- 目标用户画像: （待填写）',
    '- 内容赛道: （待填写）',
    '- 文案风格偏好: （待填写）',
    '- 发布节奏: （待填写）',
    '- 成功指标: （待填写）',
    '',
    '## 备注',
    '- 本文件用于长期个性化，不存放敏感密钥。',
  ].join('\n');
}

function buildDefaultBootstrapTemplate(): string {
  return [
    '# BOOTSTRAP.md',
    '',
    '这是 RedClaw 在当前空间的首次设定引导。',
    '',
    '目标：通过聊天收集用户偏好，完善以下文件：',
    '- identity.md',
    '- user.md',
    '- Soul.md',
    '',
    '完成后删除 BOOTSTRAP.md。',
  ].join('\n');
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  const temp = `${filePath}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(temp, filePath);
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

async function loadOnboardingState(): Promise<RedClawOnboardingState> {
  const filePath = getFilePath(ONBOARDING_STATE_FILE);
  const parsed = await readJson<Partial<RedClawOnboardingState>>(filePath, {});
  return {
    version: Number(parsed.version || 1),
    startedAt: parsed.startedAt,
    updatedAt: parsed.updatedAt || nowIso(),
    askedFirstQuestion: Boolean(parsed.askedFirstQuestion),
    stepIndex: Number.isFinite(Number(parsed.stepIndex)) ? Math.max(0, Math.floor(Number(parsed.stepIndex))) : 0,
    answers: typeof parsed.answers === 'object' && parsed.answers ? parsed.answers as Record<string, string> : {},
    completedAt: parsed.completedAt,
  };
}

async function saveOnboardingState(state: RedClawOnboardingState): Promise<void> {
  await writeJson(getFilePath(ONBOARDING_STATE_FILE), {
    ...state,
    updatedAt: nowIso(),
  });
}

function normalizeAnswer(input: string): string {
  return String(input || '').trim();
}

function isSkipCommand(input: string): boolean {
  const text = normalizeAnswer(input).toLowerCase();
  if (!text) return false;
  return [
    '跳过',
    '先跳过',
    '使用默认',
    '默认',
    '/skip',
    'skip',
  ].includes(text);
}

function getAnswer(state: RedClawOnboardingState, key: string, fallback: string): string {
  const value = normalizeAnswer(state.answers[key] || '');
  return value || fallback;
}

async function finalizeOnboarding(state: RedClawOnboardingState): Promise<void> {
  const style = getAnswer(state, 'assistant_style', ONBOARDING_STEPS[0].defaultValue);
  const goal = getAnswer(state, 'creator_goal', ONBOARDING_STEPS[1].defaultValue);
  const audience = getAnswer(state, 'target_audience', ONBOARDING_STEPS[2].defaultValue);
  const lane = getAnswer(state, 'content_lane', ONBOARDING_STEPS[3].defaultValue);
  const constraints = getAnswer(state, 'tone_and_constraints', ONBOARDING_STEPS[4].defaultValue);

  const identity = [
    '# identity.md',
    '',
    '- Name: RedClaw',
    '- Role: 小红书创作自动化 Agent',
    `- Vibe: ${style}`,
    '- Signature: 🦀',
    `- UpdatedAt: ${nowIso()}`,
  ].join('\n');

  const user = [
    '# user.md',
    '',
    '## 用户创作档案',
    `- 核心创作目标: ${goal}`,
    `- 目标用户画像: ${audience}`,
    `- 内容赛道与结构偏好: ${lane}`,
    `- 语气/边界/节奏/指标: ${constraints}`,
    '',
    '## 更新原则',
    '- 当用户提出新的长期偏好时，及时覆盖旧偏好。',
    '- 当用户临时任务与长期偏好冲突，以用户最新明确指令优先。',
  ].join('\n');

  const soul = [
    '# Soul.md',
    '',
    '## 当前人格与协作偏好（来自首次设定）',
    `- 协作风格: ${style}`,
    '',
    '## 执行原则',
    '- 先明确目标，再拆解步骤。',
    '- 每一步要有“产物”和“下一步动作”。',
    '- 对小红书创作要关注内容价值、可传播性、合规性。',
    '- 不臆测文件状态；先工具验证再回答。',
  ].join('\n');

  await Promise.all([
    fs.writeFile(getFilePath(IDENTITY_FILE), identity, 'utf-8'),
    fs.writeFile(getFilePath(USER_FILE), user, 'utf-8'),
    fs.writeFile(getFilePath(SOUL_FILE), soul, 'utf-8'),
  ]);

  try {
    await fs.unlink(getFilePath(BOOTSTRAP_FILE));
  } catch {
    // ignore
  }

  state.completedAt = nowIso();
  await saveOnboardingState(state);

  try {
    await addUserMemoryToFile(`用户RedClaw协作偏好: ${style}`, 'preference', ['redclaw', 'onboarding']);
    await addUserMemoryToFile(`用户小红书创作主目标: ${goal}`, 'fact', ['redclaw', 'goal']);
    await addUserMemoryToFile(`用户目标受众: ${audience}`, 'fact', ['redclaw', 'audience']);
    await addUserMemoryToFile(`用户内容赛道偏好: ${lane}`, 'preference', ['redclaw', 'content-lane']);
    await addUserMemoryToFile(`用户语气与边界: ${constraints}`, 'preference', ['redclaw', 'constraints']);
  } catch (error) {
    console.warn('[redclawProfileStore] Failed to write onboarding memories:', error);
  }
}

export async function ensureRedClawProfileFiles(): Promise<void> {
  const profileRoot = getProfileRoot();
  await fs.mkdir(profileRoot, { recursive: true });

  await Promise.all([
    ensureFile(getFilePath(AGENT_FILE), buildDefaultAgentTemplate()),
    ensureFile(getFilePath(SOUL_FILE), buildDefaultSoulTemplate()),
    ensureFile(getFilePath(IDENTITY_FILE), buildDefaultIdentityTemplate()),
    ensureFile(getFilePath(USER_FILE), buildDefaultUserTemplate()),
  ]);

  const onboardingPath = getFilePath(ONBOARDING_STATE_FILE);
  await ensureFile(onboardingPath, JSON.stringify(defaultOnboardingState(), null, 2));
  const state = await loadOnboardingState();

  if (state.completedAt) {
    try {
      await fs.unlink(getFilePath(BOOTSTRAP_FILE));
    } catch {
      // ignore
    }
  } else {
    await ensureFile(getFilePath(BOOTSTRAP_FILE), buildDefaultBootstrapTemplate());
  }
}

export async function loadRedClawProfilePromptBundle(): Promise<RedClawProfilePromptBundle> {
  await ensureRedClawProfileFiles();
  const onboardingState = await loadOnboardingState();

  return {
    profileRoot: getProfileRoot(),
    onboardingState,
    files: {
      agent: await readText(getFilePath(AGENT_FILE)),
      soul: await readText(getFilePath(SOUL_FILE)),
      identity: await readText(getFilePath(IDENTITY_FILE)),
      user: await readText(getFilePath(USER_FILE)),
      bootstrap: await readText(getFilePath(BOOTSTRAP_FILE)),
    },
  };
}

export async function handleRedClawOnboardingTurn(userInput: string): Promise<RedClawOnboardingTurnResult> {
  await ensureRedClawProfileFiles();

  const state = await loadOnboardingState();
  if (state.completedAt) {
    return { handled: false };
  }

  if (!state.askedFirstQuestion) {
    state.askedFirstQuestion = true;
    state.startedAt = state.startedAt || nowIso();
    state.stepIndex = 0;
    await saveOnboardingState(state);

    return {
      handled: true,
      responseText: [
        '在开始创作前，我们先做一次 RedClaw 个性化设定（只需 1-2 分钟）。',
        ONBOARDING_STEPS[0].question,
        '',
        '你也可以回复“跳过”使用默认配置，后续随时可再改。',
      ].join('\n'),
    };
  }

  const normalized = normalizeAnswer(userInput);
  if (!normalized) {
    const step = ONBOARDING_STEPS[Math.min(state.stepIndex, ONBOARDING_STEPS.length - 1)];
    return {
      handled: true,
      responseText: `我需要你先回答这个设定问题：\n${step.question}`,
    };
  }

  if (isSkipCommand(normalized)) {
    for (const step of ONBOARDING_STEPS) {
      if (!normalizeAnswer(state.answers[step.key])) {
        state.answers[step.key] = step.defaultValue;
      }
    }
    state.stepIndex = ONBOARDING_STEPS.length;
    await finalizeOnboarding(state);

    return {
      handled: true,
      completed: true,
      responseText: '已按默认配置完成 RedClaw 设定，并写入当前空间档案与长期记忆。现在可以直接给我创作目标。',
    };
  }

  const currentStep = ONBOARDING_STEPS[Math.min(state.stepIndex, ONBOARDING_STEPS.length - 1)];
  state.answers[currentStep.key] = normalized;
  state.stepIndex += 1;

  if (state.stepIndex >= ONBOARDING_STEPS.length) {
    await finalizeOnboarding(state);
    return {
      handled: true,
      completed: true,
      responseText: '设定完成。我已经更新了 Agent/Soul/identity/user 档案，并把关键信息写入长期记忆。接下来直接告诉我你的创作目标即可。',
    };
  }

  await saveOnboardingState(state);
  const next = ONBOARDING_STEPS[state.stepIndex];
  return {
    handled: true,
    responseText: [
      `已记录（${state.stepIndex}/${ONBOARDING_STEPS.length}）。`,
      next.question,
      '',
      '如果你想快速完成，也可以回复“跳过”。',
    ].join('\n'),
  };
}

export async function ensureRedClawOnboardingCompletedWithDefaults(): Promise<boolean> {
  await ensureRedClawProfileFiles();
  const state = await loadOnboardingState();
  if (state.completedAt) {
    return false;
  }

  for (const step of ONBOARDING_STEPS) {
    if (!normalizeAnswer(state.answers[step.key])) {
      state.answers[step.key] = step.defaultValue;
    }
  }
  state.askedFirstQuestion = true;
  state.stepIndex = ONBOARDING_STEPS.length;
  state.completedAt = nowIso();
  await saveOnboardingState(state);

  try {
    await fs.unlink(getFilePath(BOOTSTRAP_FILE));
  } catch {
    // ignore
  }

  return true;
}
