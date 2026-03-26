import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';
import { getWorkspacePaths } from '../db';
import { ensurePlannedMediaAssetsForProject } from './mediaLibraryStore';

type RedClawProjectStatus = 'planning' | 'drafted' | 'reviewed';

export interface RedClawProject {
  id: string;
  goal: string;
  targetAudience?: string;
  tone?: string;
  successCriteria?: string;
  tags: string[];
  status: RedClawProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RedClawImagePrompt {
  purpose?: string;
  prompt: string;
  style?: string;
  ratio?: string;
}

export interface RedClawRetrospectiveMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  collects?: number;
  shares?: number;
  follows?: number;
}

const REDCLAW_DIR_NAME = 'redclaw';
const PROJECTS_DIR_NAME = 'projects';

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-\u4e00-\u9fa5]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'project';
}

function buildProjectId(goal: string): string {
  const ts = Date.now();
  return `rc_${ts}_${slugify(goal).slice(0, 36)}`;
}

function normalizeProjectId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const matched = raw.match(/rc_[a-z0-9_-]+/i);
  return (matched ? matched[0] : raw).trim();
}

function resolveRedClawRoot(): string {
  return path.join(getWorkspacePaths().base, REDCLAW_DIR_NAME);
}

function resolveProjectsDir(): string {
  return path.join(resolveRedClawRoot(), PROJECTS_DIR_NAME);
}

function resolveProjectDir(projectId: string): string {
  return path.join(resolveProjectsDir(), projectId);
}

function resolveProjectJsonPath(projectId: string): string {
  return path.join(resolveProjectDir(projectId), 'project.json');
}

async function ensureDirStructure(): Promise<void> {
  await fs.mkdir(resolveProjectsDir(), { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return value;
}

export async function createRedClawProject(input: {
  goal: string;
  targetAudience?: string;
  tone?: string;
  successCriteria?: string;
  tags?: string[];
}): Promise<{ project: RedClawProject; projectDir: string }> {
  await ensureDirStructure();

  const projectId = buildProjectId(input.goal);
  const projectDir = resolveProjectDir(projectId);
  await fs.mkdir(projectDir, { recursive: true });

  const project: RedClawProject = {
    id: projectId,
    goal: input.goal.trim(),
    targetAudience: input.targetAudience?.trim() || undefined,
    tone: input.tone?.trim() || undefined,
    successCriteria: input.successCriteria?.trim() || undefined,
    tags: Array.from(new Set((input.tags || []).map((tag) => tag.trim()).filter(Boolean))),
    status: 'planning',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await writeJson(resolveProjectJsonPath(projectId), project);

  const overview = [
    '# RedClaw Project',
    '',
    `- Project ID: ${project.id}`,
    `- Goal: ${project.goal}`,
    `- Audience: ${project.targetAudience || '(未设置)'}`,
    `- Tone: ${project.tone || '(未设置)'}`,
    `- Success Criteria: ${project.successCriteria || '(未设置)'}`,
    `- Status: ${project.status}`,
    `- Created At: ${project.createdAt}`,
    '',
    '## Files',
    '- `project.json` 项目元数据',
    '- `copy-pack.md/.json` 文案包',
    '- `image-pack.md/.json` 配图包',
    '- `retrospective.md/.json` 复盘记录',
  ].join('\n');
  await fs.writeFile(path.join(projectDir, 'README.md'), overview, 'utf-8');

  return { project, projectDir };
}

export async function getRedClawProject(projectId: string): Promise<{ project: RedClawProject; projectDir: string }> {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    throw new Error('projectId is required');
  }

  const projectPath = resolveProjectJsonPath(normalizedProjectId);
  let raw = '';
  try {
    raw = await fs.readFile(projectPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Project not found: ${normalizedProjectId} (${projectPath}) - ${message}`);
  }
  return {
    project: JSON.parse(raw) as RedClawProject,
    projectDir: resolveProjectDir(normalizedProjectId),
  };
}

async function saveProject(project: RedClawProject): Promise<void> {
  await writeJson(resolveProjectJsonPath(project.id), project);
}

async function updateProjectStatus(projectId: string, status: RedClawProjectStatus): Promise<RedClawProject> {
  const { project } = await getRedClawProject(projectId);
  const next = {
    ...project,
    status,
    updatedAt: nowIso(),
  };
  await saveProject(next);
  return next;
}

export async function listRedClawProjects(limit = 20): Promise<Array<RedClawProject & { projectDir: string }>> {
  await ensureDirStructure();
  const entries = await fs.readdir(resolveProjectsDir(), { withFileTypes: true });
  const projects: Array<RedClawProject & { projectDir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectId = entry.name;
    try {
      const { project, projectDir } = await getRedClawProject(projectId);
      projects.push({ ...project, projectDir });
    } catch {
      // ignore broken project folders
    }
  }

  projects.sort((a, b) => {
    const at = new Date(a.updatedAt).getTime();
    const bt = new Date(b.updatedAt).getTime();
    return bt - at;
  });

  return projects.slice(0, Math.max(1, limit));
}

export async function saveRedClawCopyPack(input: {
  projectId: string;
  titleOptions: string[];
  finalTitle?: string;
  content: string;
  hashtags?: string[];
  coverTexts?: string[];
  publishPlan?: string;
}): Promise<{ project: RedClawProject; filePath: string; manuscriptPath: string }> {
  const normalizedProjectId = normalizeProjectId(input.projectId);
  const { projectDir, project } = await getRedClawProject(normalizedProjectId);
  const hashtags = (input.hashtags || []).map((tag) => tag.trim()).filter(Boolean);
  const coverTexts = (input.coverTexts || []).map((text) => text.trim()).filter(Boolean);
  const titleOptions = input.titleOptions.map((text) => text.trim()).filter(Boolean);

  const payload = {
    titleOptions,
    finalTitle: input.finalTitle?.trim() || undefined,
    content: input.content.trim(),
    hashtags,
    coverTexts,
    publishPlan: input.publishPlan?.trim() || undefined,
    updatedAt: nowIso(),
  };

  const jsonPath = path.join(projectDir, 'copy-pack.json');
  await writeJson(jsonPath, payload);

  const markdown = [
    '# 小红书文案包',
    '',
    '## 标题候选',
    ...titleOptions.map((title, index) => `${index + 1}. ${title}`),
    '',
    '## 最终标题',
    payload.finalTitle || '(待定)',
    '',
    '## 正文',
    payload.content || '(空)',
    '',
    '## 话题标签',
    hashtags.length > 0 ? hashtags.map((tag) => `- ${tag}`).join('\n') : '(无)',
    '',
    '## 封面文案',
    coverTexts.length > 0 ? coverTexts.map((text) => `- ${text}`).join('\n') : '(无)',
    '',
    '## 发布计划',
    payload.publishPlan || '(无)',
  ].join('\n');
  await fs.writeFile(path.join(projectDir, 'copy-pack.md'), markdown, 'utf-8');

  const manuscriptsDir = getWorkspacePaths().manuscripts;
  const manuscriptPath = path.join('redclaw', `${project.id}.md`).replace(/\\/g, '/');
  const manuscriptAbsolutePath = path.join(manuscriptsDir, manuscriptPath);
  await fs.mkdir(path.dirname(manuscriptAbsolutePath), { recursive: true });

  let currentMetadata: Record<string, unknown> = {};
  try {
    const existing = await fs.readFile(manuscriptAbsolutePath, 'utf-8');
    currentMetadata = matter(existing).data || {};
  } catch {
    currentMetadata = {};
  }

  const manuscriptMetadata: Record<string, unknown> = {
    ...currentMetadata,
    title: payload.finalTitle || titleOptions[0] || project.goal,
    status: currentMetadata.status || 'writing',
    source: 'redclaw',
    redclawProjectId: project.id,
    redclawUpdatedAt: payload.updatedAt,
    tags: hashtags,
    createdAt: currentMetadata.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  const manuscriptBody = [
    '# 标题候选',
    ...(titleOptions.length > 0 ? titleOptions.map((title, index) => `${index + 1}. ${title}`) : ['(无)']),
    '',
    '## 最终标题',
    payload.finalTitle || '(待定)',
    '',
    '## 正文',
    payload.content || '(空)',
    '',
    '## 话题标签',
    hashtags.length > 0 ? hashtags.map((tag) => `- ${tag}`).join('\n') : '(无)',
    '',
    '## 封面文案',
    coverTexts.length > 0 ? coverTexts.map((text) => `- ${text}`).join('\n') : '(无)',
    '',
    '## 发布计划',
    payload.publishPlan || '(无)',
    '',
    '> 该稿件由 RedClaw 自动生成，可在稿件工作台继续编辑。',
  ].join('\n');

  await fs.writeFile(manuscriptAbsolutePath, matter.stringify(manuscriptBody, manuscriptMetadata), 'utf-8');

  const nextProject = await updateProjectStatus(normalizedProjectId, 'drafted');
  return { project: nextProject, filePath: jsonPath, manuscriptPath };
}

export async function saveRedClawImagePack(input: {
  projectId: string;
  images: RedClawImagePrompt[];
  coverPrompt?: string;
  notes?: string;
}): Promise<{ project: RedClawProject; filePath: string; plannedAssetCount: number }> {
  const normalizedProjectId = normalizeProjectId(input.projectId);
  const { projectDir } = await getRedClawProject(normalizedProjectId);
  const images = input.images
    .map((item) => ({
      purpose: item.purpose?.trim() || undefined,
      prompt: item.prompt.trim(),
      style: item.style?.trim() || undefined,
      ratio: item.ratio?.trim() || undefined,
    }))
    .filter((item) => item.prompt);

  const payload = {
    coverPrompt: input.coverPrompt?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    images,
    updatedAt: nowIso(),
  };

  const jsonPath = path.join(projectDir, 'image-pack.json');
  await writeJson(jsonPath, payload);

  const markdown = [
    '# 小红书配图包',
    '',
    '## 封面图提示词',
    payload.coverPrompt || '(无)',
    '',
    '## 配图列表',
    ...(images.length > 0
      ? images.flatMap((image, index) => [
          `### 图 ${index + 1}`,
          `- 用途: ${image.purpose || '(未标注)'}`,
          `- 比例: ${image.ratio || '(未标注)'}`,
          `- 风格: ${image.style || '(未标注)'}`,
          '- 提示词:',
          image.prompt,
          '',
        ])
      : ['(无)']),
    '## 备注',
    payload.notes || '(无)',
  ].join('\n');
  await fs.writeFile(path.join(projectDir, 'image-pack.md'), markdown, 'utf-8');

  const created = await ensurePlannedMediaAssetsForProject({
    projectId: normalizedProjectId,
    coverPrompt: payload.coverPrompt,
    prompts: images.map((image) => image.prompt),
  });

  const nextProject = await updateProjectStatus(normalizedProjectId, 'drafted');
  return { project: nextProject, filePath: jsonPath, plannedAssetCount: created.length };
}

function percent(numerator?: number, denominator?: number): string {
  const a = safeNumber(numerator);
  const b = safeNumber(denominator);
  if (!a || !b || b <= 0) return '-';
  return `${((a / b) * 100).toFixed(2)}%`;
}

export async function saveRedClawRetrospective(input: {
  projectId: string;
  metrics?: RedClawRetrospectiveMetrics;
  whatWorked?: string;
  whatFailed?: string;
  nextHypotheses?: string[];
  nextActions?: string[];
}): Promise<{ project: RedClawProject; filePath: string }> {
  const normalizedProjectId = normalizeProjectId(input.projectId);
  const { projectDir } = await getRedClawProject(normalizedProjectId);
  const metrics = input.metrics || {};
  const likes = safeNumber(metrics.likes) || 0;
  const comments = safeNumber(metrics.comments) || 0;
  const collects = safeNumber(metrics.collects) || 0;
  const shares = safeNumber(metrics.shares) || 0;
  const follows = safeNumber(metrics.follows) || 0;
  const views = safeNumber(metrics.views) || 0;

  const payload = {
    metrics: {
      views,
      likes,
      comments,
      collects,
      shares,
      follows,
      engagementRate: percent(likes + comments + collects + shares, views),
      followRate: percent(follows, views),
      collectRate: percent(collects, views),
    },
    whatWorked: input.whatWorked?.trim() || '',
    whatFailed: input.whatFailed?.trim() || '',
    nextHypotheses: (input.nextHypotheses || []).map((item) => item.trim()).filter(Boolean),
    nextActions: (input.nextActions || []).map((item) => item.trim()).filter(Boolean),
    updatedAt: nowIso(),
  };

  const jsonPath = path.join(projectDir, 'retrospective.json');
  await writeJson(jsonPath, payload);

  const markdown = [
    '# RedClaw 复盘',
    '',
    '## 核心指标',
    `- 浏览: ${views || '-'}`,
    `- 点赞: ${likes || '-'}`,
    `- 评论: ${comments || '-'}`,
    `- 收藏: ${collects || '-'}`,
    `- 分享: ${shares || '-'}`,
    `- 关注: ${follows || '-'}`,
    `- 互动率: ${payload.metrics.engagementRate}`,
    `- 关注转化率: ${payload.metrics.followRate}`,
    `- 收藏率: ${payload.metrics.collectRate}`,
    '',
    '## 做得好的点',
    payload.whatWorked || '(待补充)',
    '',
    '## 待改进点',
    payload.whatFailed || '(待补充)',
    '',
    '## 下一轮假设',
    payload.nextHypotheses.length > 0 ? payload.nextHypotheses.map((item) => `- ${item}`).join('\n') : '(无)',
    '',
    '## 下一轮动作',
    payload.nextActions.length > 0 ? payload.nextActions.map((item) => `- ${item}`).join('\n') : '(无)',
  ].join('\n');
  await fs.writeFile(path.join(projectDir, 'retrospective.md'), markdown, 'utf-8');

  const nextProject = await updateProjectStatus(normalizedProjectId, 'reviewed');
  return { project: nextProject, filePath: jsonPath };
}

export async function getRedClawProjectContextPrompt(limit = 8): Promise<string> {
  const projects = await listRedClawProjects(limit);
  if (projects.length === 0) return '';

  const lines: string[] = [];
  for (const project of projects) {
    lines.push(
      `- [${project.id}] status=${project.status}; goal=${project.goal}; audience=${project.targetAudience || '-'}; updatedAt=${project.updatedAt}`
    );
  }
  return lines.join('\n');
}
