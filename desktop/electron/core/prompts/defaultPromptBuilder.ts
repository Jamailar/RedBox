import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getWorkspacePaths } from '../../db';
import { createBuiltinTools } from '../tools';
import type { BuiltinToolPack } from '../tools/catalog';
import { getCoreSystemPrompt, type SystemPromptOptions } from './systemPrompt';

const execFileAsync = promisify(execFile);
const CONTEXT_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;
const MAX_CONTEXT_FILE_CHARS = 8_000;
const MAX_MEMORY_CHARS = 6_000;
const MAX_GIT_STATUS_CHARS = 2_000;

type WorkspacePaths = ReturnType<typeof getWorkspacePaths>;

type BuildDefaultSystemPromptOptions = Omit<SystemPromptOptions, 'projectContextContent' | 'gitStatusContent' | 'workspacePaths'> & {
  workspacePaths?: WorkspacePaths;
};

const truncateText = (value: string, limit: number): string => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated: original ${text.length} chars]`;
};

const normalizeDisplayPath = (filePath: string, workspacePaths: WorkspacePaths): string => {
  const normalized = path.resolve(filePath);
  const roots = [workspacePaths.base, workspacePaths.workspaceRoot, process.cwd()]
    .map((item) => path.resolve(item))
    .sort((left, right) => right.length - left.length);

  for (const root of roots) {
    if (normalized === root) return path.basename(normalized);
    if (normalized.startsWith(`${root}${path.sep}`)) {
      return path.relative(root, normalized) || path.basename(normalized);
    }
  }
  return normalized;
};

const buildCandidateDirs = (workspacePaths: WorkspacePaths): string[] => {
  const seen = new Set<string>();
  const dirs: string[] = [];
  const push = (value: string) => {
    const normalized = path.resolve(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    dirs.push(normalized);
  };

  push(workspacePaths.base);
  let current = path.resolve(workspacePaths.base);
  const workspaceRoot = path.resolve(workspacePaths.workspaceRoot);
  for (let depth = 0; depth < 8; depth += 1) {
    push(current);
    if (current === workspaceRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  push(workspaceRoot);
  push(process.cwd());
  return dirs;
};

const readIfExists = async (filePath: string, maxChars: number): Promise<string> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return truncateText(content, maxChars);
  } catch {
    return '';
  }
};

export async function buildProjectContextContent(
  workspacePaths: WorkspacePaths = getWorkspacePaths(),
): Promise<string> {
  const sections: string[] = [];
  const seenFiles = new Set<string>();

  for (const dir of buildCandidateDirs(workspacePaths)) {
    for (const fileName of CONTEXT_FILE_NAMES) {
      const filePath = path.join(dir, fileName);
      const resolvedPath = path.resolve(filePath);
      if (seenFiles.has(resolvedPath)) continue;
      seenFiles.add(resolvedPath);
      const content = await readIfExists(resolvedPath, MAX_CONTEXT_FILE_CHARS);
      if (!content) continue;
      sections.push(`## ${normalizeDisplayPath(resolvedPath, workspacePaths)}\n${content}`);
    }
  }

  const memoryPath = path.join(workspacePaths.base, 'memory', 'MEMORY.md');
  const memoryContent = await readIfExists(memoryPath, MAX_MEMORY_CHARS);
  if (memoryContent) {
    sections.push([
      '## Memory Operating Notes',
      '- `memory/MEMORY.md` is the current long-term memory summary for this workspace.',
      '- Use it for stable user preferences, durable facts, and ongoing project constraints.',
      '- Latest explicit user instructions override remembered preferences or older summaries.',
      '- Do not infer that a memory is still true if fresh tool results or repository state disagree.',
      '- Never store or repeat secrets, tokens, passwords, or API keys in long-term memory.',
      '- If a new instruction clearly updates an existing preference or fact, prefer updating that memory instead of creating a duplicate conceptually.',
    ].join('\n'));
    sections.push(`## ${normalizeDisplayPath(memoryPath, workspacePaths)}\n${memoryContent}`);
  }

  if (!sections.length) {
    return '';
  }

  return sections.join('\n\n');
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return String(stdout || '').trim();
}

export async function buildGitSnapshotContent(
  workspacePaths: WorkspacePaths = getWorkspacePaths(),
): Promise<string> {
  const cwd = path.resolve(workspacePaths.base);
  try {
    const insideGit = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    if (insideGit !== 'true') {
      return '';
    }
  } catch {
    return '';
  }

  try {
    const [branch, status, recentCommits, gitUser, mainBranch] = await Promise.all([
      runGit(['branch', '--show-current'], cwd).catch(() => ''),
      runGit(['--no-optional-locks', 'status', '--short'], cwd).catch(() => ''),
      runGit(['--no-optional-locks', 'log', '--oneline', '-n', '5'], cwd).catch(() => ''),
      runGit(['config', 'user.name'], cwd).catch(() => ''),
      runGit(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd)
        .then((value) => value.replace(/^origin\//, ''))
        .catch(() => ''),
    ]);

    const statusText = truncateText(status || '(clean)', MAX_GIT_STATUS_CHARS);
    const lines = [
      'This is the git status snapshot captured at the start of the current run. It may become stale later in the conversation.',
      `Current branch: ${branch || '(unknown)'}`,
      mainBranch ? `Main branch: ${mainBranch}` : '',
      gitUser ? `Git user: ${gitUser}` : '',
      '',
      `Status:\n${statusText}`,
      recentCommits ? `\nRecent commits:\n${recentCommits}` : '',
    ].filter(Boolean);

    return lines.join('\n');
  } catch {
    return '';
  }
}

export async function buildDefaultSystemPrompt(
  options: BuildDefaultSystemPromptOptions,
): Promise<string> {
  const workspacePaths = options.workspacePaths || getWorkspacePaths();
  const [projectContextContent, gitStatusContent] = await Promise.all([
    buildProjectContextContent(workspacePaths),
    buildGitSnapshotContent(workspacePaths),
  ]);

  return getCoreSystemPrompt({
    ...options,
    workspacePaths,
    projectContextContent,
    gitStatusContent,
  });
}

const resolveBuiltinToolPack = (runtimeMode?: string): BuiltinToolPack => {
  if (runtimeMode === 'knowledge') return 'knowledge';
  if (runtimeMode === 'chatroom' || runtimeMode === 'advisor-discussion') return 'chatroom';
  if (runtimeMode === 'diagnostics') return 'diagnostics';
  return 'redclaw';
};

export async function buildRuntimeBaseSystemPrompt(params?: {
  runtimeMode?: string;
  interactive?: boolean;
  customRules?: string;
  workspacePaths?: WorkspacePaths;
}): Promise<string> {
  const toolPack = resolveBuiltinToolPack(params?.runtimeMode);
  return buildDefaultSystemPrompt({
    skills: [],
    tools: createBuiltinTools({ pack: toolPack }),
    interactive: params?.interactive ?? true,
    customRules: params?.customRules,
    workspacePaths: params?.workspacePaths,
  });
}
