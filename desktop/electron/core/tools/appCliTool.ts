import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import matter from 'gray-matter';
import { ulid } from 'ulid';
import {
    DeclarativeTool,
    ToolKind,
    type ToolResult,
    createSuccessResult,
    createErrorResult,
    ToolErrorType,
} from '../toolRegistry';
import {
    getWorkspacePaths,
    listSpaces,
    createSpace,
    renameSpace,
    setActiveSpace,
    getActiveSpaceId,
    getSettings,
    saveSettings,
    listArchiveProfiles,
    createArchiveProfile,
    updateArchiveProfile,
    deleteArchiveProfile,
    listArchiveSamples,
    createArchiveSample,
    updateArchiveSample,
    deleteArchiveSample,
    listWanderHistory,
    getWanderHistory,
    saveWanderHistory,
    deleteWanderHistory,
} from '../../db';
import {
    listUserMemoriesFromFile,
    addUserMemoryToFile,
    deleteUserMemoryFromFile,
    updateUserMemoryInFile,
} from '../fileMemoryStore';
import {
    createRedClawProject,
    getRedClawProject,
    listRedClawProjects,
    saveRedClawCopyPack,
    saveRedClawImagePack,
    saveRedClawRetrospective,
    type RedClawImagePrompt,
} from '../redclawStore';
import {
    listMediaAssets,
    bindMediaAssetToManuscript,
    updateMediaAssetMetadata,
    getAbsoluteMediaPath,
} from '../mediaLibraryStore';
import { generateImagesToMediaLibrary } from '../imageGenerationService';
import { SkillManager } from '../skillManager';

const AppCliParamsSchema = z.object({
    command: z.string().min(1).describe('CLI command. Example: "redclaw list --limit 20"'),
    payload: z.record(z.any()).optional().describe('Optional structured payload for complex commands.'),
});

type AppCliParams = z.infer<typeof AppCliParamsSchema>;

type FlagValue = string | boolean;

interface ParsedCommand {
    namespace: string;
    action: string;
    flags: Record<string, FlagValue>;
    args: string[];
}

function toPrettyJson(data: unknown): string {
    return JSON.stringify(data, null, 2);
}

function tokenize(input: string): string[] {
    const tokens: string[] = [];
    const regex = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
        const quotedDouble = match[1];
        const quotedSingle = match[2];
        const plain = match[3];
        const token = quotedDouble !== undefined
            ? quotedDouble.replace(/\\"/g, '"')
            : quotedSingle !== undefined
              ? quotedSingle.replace(/\\'/g, '\'')
              : plain;
        tokens.push(token);
    }
    return tokens;
}

function parseCommand(command: string): ParsedCommand {
    const tokens = tokenize(command.trim());
    if (tokens.length === 0) {
        return { namespace: 'help', action: 'show', flags: {}, args: [] };
    }

    while (tokens.length > 0 && ['app-cli', 'app_cli', 'redconvert', 'redconvert-cli'].includes(tokens[0].toLowerCase())) {
        tokens.shift();
    }

    if (tokens.length === 0) {
        return { namespace: 'help', action: 'show', flags: {}, args: [] };
    }

    const namespace = (tokens.shift() || 'help').toLowerCase();
    const actionCandidate = tokens[0] && !tokens[0].startsWith('--') ? tokens.shift() : undefined;
    const action = (actionCandidate || 'list').toLowerCase();

    const flags: Record<string, FlagValue> = {};
    const args: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.startsWith('--')) {
            const key = token.slice(2).toLowerCase();
            const next = tokens[i + 1];
            if (next && !next.startsWith('--')) {
                flags[key] = next;
                i += 1;
            } else {
                flags[key] = true;
            }
            continue;
        }
        args.push(token);
    }

    return { namespace, action, flags, args };
}

function readFlag(flags: Record<string, FlagValue>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = flags[key];
        if (typeof value === 'string') {
            return value;
        }
        if (value === true) {
            return 'true';
        }
    }
    return undefined;
}

function parseNumber(input: unknown): number | undefined {
    if (input === undefined || input === null || input === '') return undefined;
    const value = Number(input);
    if (Number.isNaN(value)) return undefined;
    return value;
}

function parseBoolean(input: unknown): boolean | undefined {
    if (input === undefined || input === null || input === '') return undefined;
    if (typeof input === 'boolean') return input;
    const raw = String(input).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(raw)) return false;
    return undefined;
}

function parseList(input: unknown): string[] {
    if (Array.isArray(input)) {
        return input.map((item) => String(item || '').trim()).filter(Boolean);
    }
    const raw = String(input || '').trim();
    if (!raw) return [];

    if ((raw.startsWith('[') && raw.endsWith(']'))) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean);
            }
        } catch {
            // ignore
        }
    }

    const delimiter = raw.includes('|') ? '|' : ',';
    return raw.split(delimiter).map((item) => item.trim()).filter(Boolean);
}

function requireString(value: unknown, fieldName: string): string {
    const text = String(value || '').trim();
    if (!text) {
        throw new Error(`${fieldName} is required`);
    }
    return text;
}

function normalizeRelativePath(input: string): string {
    const normalized = path.normalize(String(input || '')).replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (!normalized || normalized === '.' || normalized === '..') {
        throw new Error('Invalid relative path');
    }
    if (normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error('Path traversal is not allowed');
    }
    return normalized;
}

function helpText(): string {
    return [
        'App CLI - 命令一览',
        '',
        '命令结构: <namespace> <action> [--flags]',
        '',
        '常用示例:',
        '- spaces list',
        '- spaces create --name "民宿空间"',
        '- manuscripts list',
        '- knowledge list --source redbook',
        '- advisors list',
        '- manuscripts read --path "redclaw/xxx.md"',
        '- manuscripts organize --dry-run true',
        '- manuscripts write --path "redclaw/xxx.md" --content "...markdown..."',
        '- redclaw create --goal "做一条民宿选题"',
        '- redclaw save-copy --project-id rc_xxx --titles "标题A|标题B" --content "正文..."',
        '- redclaw save-image --project-id rc_xxx --prompts "提示词1|提示词2"',
        '- redclaw runner-status',
        '- redclaw runner-start --interval 20',
        '- redclaw runner-enable-project --project-id rc_xxx',
        '- media list --limit 100',
        '- media bind --asset-id media_xxx --manuscript-path "redclaw/rc_xxx.md"',
        '- image generate --prompt "..." --project-id rc_xxx --count 2',
        '- archives profiles',
        '- wander list',
        '',
        '规则: 新增功能页必须同步新增 app_cli 子命令。',
    ].join('\n');
}

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
    { category: '01_AI科技', keywords: ['ai', 'gpt', 'agent', '模型', '大模型', '自动化', '提示词', '技术', '算法'] },
    { category: '02_职场成长', keywords: ['职场', '面试', '简历', '效率', '副业', '管理', '成长', '学习', '复盘'] },
    { category: '03_生活美学', keywords: ['民宿', '家居', '旅行', '生活', '日常', '美学', '摄影', '收纳', '早餐'] },
    { category: '04_个人IP', keywords: ['个人ip', '人设', '观点', '故事', '表达', '品牌', '创业', '定位'] },
];

function detectManuscriptCategory(text: string): string {
    const lower = text.toLowerCase();
    let best: { category: string; score: number } = { category: '99_未分类', score: 0 };
    for (const rule of CATEGORY_RULES) {
        let score = 0;
        for (const keyword of rule.keywords) {
            if (lower.includes(keyword.toLowerCase())) {
                score += 1;
            }
        }
        if (score > best.score) {
            best = { category: rule.category, score };
        }
    }
    return best.category;
}

async function listManuscripts(root: string): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const absolute = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute);
                continue;
            }
            if (entry.name.endsWith('.md')) {
                results.push(path.relative(root, absolute).replace(/\\/g, '/'));
            }
        }
    };
    await fs.mkdir(root, { recursive: true });
    await walk(root);
    return results.sort((a, b) => a.localeCompare(b));
}

export class AppCliTool extends DeclarativeTool<typeof AppCliParamsSchema> {
    readonly name = 'app_cli';
    readonly displayName = 'App CLI';
    readonly description = 'CLI-style app control layer. Manage spaces/manuscripts/redclaw/media/image/settings/skills/memory with terminal-like commands.';
    readonly kind = ToolKind.Execute;
    readonly parameterSchema = AppCliParamsSchema;
    readonly requiresConfirmation = false;

    getDescription(params: AppCliParams): string {
        return `app_cli: ${params.command}`;
    }

    async execute(params: AppCliParams): Promise<ToolResult> {
        try {
            const payload = (params.payload || {}) as Record<string, unknown>;
            const parsed = parseCommand(params.command);
            const paths = getWorkspacePaths();
            console.log('[app_cli] execute', {
                command: params.command,
                namespace: parsed.namespace,
                action: parsed.action,
                activeSpaceId: getActiveSpaceId(),
                workspaceBase: paths.base,
                manuscriptsRoot: paths.manuscripts,
            });

            if (parsed.namespace === 'help') {
                return createSuccessResult(helpText(), 'app_cli help');
            }

            const result = await this.dispatch(parsed, payload);
            if (parsed.namespace === 'manuscripts' && parsed.action === 'list') {
                const info = result as { count?: number; files?: string[] };
                console.log('[app_cli] manuscripts:list result', {
                    count: info?.count ?? null,
                    sample: Array.isArray(info?.files) ? info.files.slice(0, 5) : [],
                });
            }
            return createSuccessResult(toPrettyJson(result), `${parsed.namespace} ${parsed.action}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[app_cli] execute failed', {
                command: params.command,
                error: message,
            });
            return createErrorResult(`app_cli failed: ${message}`, ToolErrorType.EXECUTION_FAILED);
        }
    }

    private async dispatch(parsed: ParsedCommand, payload: Record<string, unknown>): Promise<unknown> {
        switch (parsed.namespace) {
            case 'workspace':
                return {
                    activeSpaceId: getActiveSpaceId(),
                    paths: getWorkspacePaths(),
                };
            case 'spaces':
                return this.handleSpaces(parsed, payload);
            case 'manuscripts':
                return this.handleManuscripts(parsed, payload);
            case 'knowledge':
                return this.handleKnowledge(parsed, payload);
            case 'advisors':
                return this.handleAdvisors(parsed, payload);
            case 'memory':
                return this.handleMemory(parsed, payload);
            case 'redclaw':
                return this.handleRedclaw(parsed, payload);
            case 'media':
                return this.handleMedia(parsed, payload);
            case 'image':
                return this.handleImage(parsed, payload);
            case 'settings':
                return this.handleSettings(parsed, payload);
            case 'skills':
                return this.handleSkills(parsed, payload);
            case 'archives':
                return this.handleArchives(parsed, payload);
            case 'wander':
                return this.handleWander(parsed, payload);
            default:
                throw new Error(`Unknown namespace: ${parsed.namespace}`);
        }
    }

    private async handleSpaces(parsed: ParsedCommand, _payload: Record<string, unknown>) {
        const action = parsed.action;
        if (action === 'list') {
            return {
                activeSpaceId: getActiveSpaceId(),
                spaces: listSpaces(),
            };
        }
        if (action === 'create') {
            const name = requireString(readFlag(parsed.flags, 'name') || parsed.args[0], 'name');
            return { space: createSpace(name) };
        }
        if (action === 'rename') {
            const id = requireString(readFlag(parsed.flags, 'id', 'space-id') || parsed.args[0], 'id');
            const name = requireString(readFlag(parsed.flags, 'name') || parsed.args[1], 'name');
            return { space: renameSpace(id, name) };
        }
        if (action === 'switch') {
            const id = requireString(readFlag(parsed.flags, 'id', 'space-id') || parsed.args[0], 'id');
            return { space: setActiveSpace(id), paths: getWorkspacePaths() };
        }
        throw new Error(`Unsupported spaces action: ${action}`);
    }

    private async handleManuscripts(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const manuscriptsRoot = getWorkspacePaths().manuscripts;
        await fs.mkdir(manuscriptsRoot, { recursive: true });
        const action = parsed.action;

        if (action === 'list') {
            console.log('[app_cli] manuscripts:list scanning', { manuscriptsRoot });
            const files = await listManuscripts(manuscriptsRoot);
            return { count: files.length, files };
        }

        if (action === 'organize') {
            const dryRun = String(readFlag(parsed.flags, 'dry-run') || payload.dryRun || 'false') === 'true';
            const files = await listManuscripts(manuscriptsRoot);
            const report: Array<{ from: string; to: string; category: string }> = [];

            for (const relPath of files) {
                if (relPath.startsWith('_drafts/') || relPath.startsWith('_published/')) continue;
                const absolute = path.join(manuscriptsRoot, relPath);
                const raw = await fs.readFile(absolute, 'utf-8');
                const parsedMatter = matter(raw);
                const joinedText = [
                    String((parsedMatter.data as Record<string, unknown>).title || ''),
                    parsedMatter.content || '',
                ].join('\n');
                const category = detectManuscriptCategory(joinedText);
                const targetDir = path.join(manuscriptsRoot, category);
                const ext = path.extname(relPath);
                const baseName = path.basename(relPath, ext);
                let candidate = path.join(category, `${baseName}${ext}`).replace(/\\/g, '/');
                let index = 2;
                while (candidate !== relPath) {
                    try {
                        await fs.access(path.join(manuscriptsRoot, candidate));
                        candidate = path.join(category, `${baseName}-${index}${ext}`).replace(/\\/g, '/');
                        index += 1;
                    } catch {
                        break;
                    }
                }

                if (candidate === relPath) continue;
                report.push({ from: relPath, to: candidate, category });
                if (!dryRun) {
                    await fs.mkdir(targetDir, { recursive: true });
                    await fs.rename(absolute, path.join(manuscriptsRoot, candidate));
                }
            }

            return {
                dryRun,
                totalFiles: files.length,
                moved: report.length,
                report,
            };
        }

        if (action === 'read') {
            const relPath = normalizeRelativePath(requireString(readFlag(parsed.flags, 'path') || payload.path, 'path'));
            const absolute = path.join(manuscriptsRoot, relPath);
            const raw = await fs.readFile(absolute, 'utf-8');
            const parsedMatter = matter(raw);
            return {
                path: relPath,
                content: parsedMatter.content,
                metadata: parsedMatter.data || {},
            };
        }

        if (action === 'write' || action === 'create') {
            const relPathInput = requireString(readFlag(parsed.flags, 'path') || payload.path, 'path');
            const relPath = normalizeRelativePath(relPathInput.endsWith('.md') ? relPathInput : `${relPathInput}.md`);
            const absolute = path.join(manuscriptsRoot, relPath);
            await fs.mkdir(path.dirname(absolute), { recursive: true });

            const content = String(
                readFlag(parsed.flags, 'content')
                || payload.content
                || ''
            );

            let metadataInput = payload.metadata as Record<string, unknown> | undefined;
            const metadataRaw = readFlag(parsed.flags, 'metadata');
            if (!metadataInput && metadataRaw) {
                try {
                    metadataInput = JSON.parse(metadataRaw) as Record<string, unknown>;
                } catch {
                    throw new Error('metadata must be valid JSON');
                }
            }

            let currentMeta: Record<string, unknown> = {};
            let currentContent = '';
            try {
                const existingRaw = await fs.readFile(absolute, 'utf-8');
                const existing = matter(existingRaw);
                currentMeta = (existing.data || {}) as Record<string, unknown>;
                currentContent = existing.content || '';
            } catch {
                currentMeta = {};
            }

            const nextMeta: Record<string, unknown> = {
                ...currentMeta,
                ...(metadataInput || {}),
                id: currentMeta.id || ulid(),
                createdAt: currentMeta.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            const nextContent = content || currentContent;
            await fs.writeFile(absolute, matter.stringify(nextContent, nextMeta), 'utf-8');
            return { success: true, path: relPath };
        }

        if (action === 'mkdir') {
            const relPath = normalizeRelativePath(requireString(readFlag(parsed.flags, 'path') || payload.path, 'path'));
            await fs.mkdir(path.join(manuscriptsRoot, relPath), { recursive: true });
            return { success: true, path: relPath };
        }

        if (action === 'delete') {
            const relPath = normalizeRelativePath(requireString(readFlag(parsed.flags, 'path') || payload.path, 'path'));
            await fs.rm(path.join(manuscriptsRoot, relPath), { recursive: true, force: true });
            return { success: true, path: relPath };
        }

        if (action === 'rename') {
            const oldPath = normalizeRelativePath(requireString(readFlag(parsed.flags, 'path') || payload.path, 'path'));
            const newName = requireString(readFlag(parsed.flags, 'name') || payload.name, 'name');
            const oldAbsolute = path.join(manuscriptsRoot, oldPath);
            const newAbsolute = path.join(path.dirname(oldAbsolute), newName);
            await fs.rename(oldAbsolute, newAbsolute);
            return { success: true, newPath: path.relative(manuscriptsRoot, newAbsolute).replace(/\\/g, '/') };
        }

        if (action === 'move') {
            const source = normalizeRelativePath(requireString(readFlag(parsed.flags, 'path', 'source') || payload.path || payload.source, 'source'));
            const targetDir = normalizeRelativePath(requireString(readFlag(parsed.flags, 'to', 'target-dir') || payload.targetDir, 'targetDir'));
            const sourceAbsolute = path.join(manuscriptsRoot, source);
            const targetAbsolute = path.join(manuscriptsRoot, targetDir, path.basename(sourceAbsolute));
            await fs.mkdir(path.dirname(targetAbsolute), { recursive: true });
            await fs.rename(sourceAbsolute, targetAbsolute);
            return { success: true, newPath: path.relative(manuscriptsRoot, targetAbsolute).replace(/\\/g, '/') };
        }

        throw new Error(`Unsupported manuscripts action: ${action}`);
    }

    private async handleKnowledge(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const paths = getWorkspacePaths();
        const source = (readFlag(parsed.flags, 'source') || payload.source || 'all') as 'all' | 'redbook' | 'youtube';
        const resolveRoots = (): Array<{ source: 'redbook' | 'youtube'; root: string }> => {
            if (source === 'redbook') return [{ source: 'redbook', root: paths.knowledgeRedbook }];
            if (source === 'youtube') return [{ source: 'youtube', root: paths.knowledgeYoutube }];
            return [
                { source: 'redbook', root: paths.knowledgeRedbook },
                { source: 'youtube', root: paths.knowledgeYoutube },
            ];
        };

        const action = parsed.action;
        if (action === 'list') {
            const result: Record<string, string[]> = {};
            for (const item of resolveRoots()) {
                await fs.mkdir(item.root, { recursive: true });
                const entries = await fs.readdir(item.root, { withFileTypes: true });
                result[item.source] = entries
                    .filter((entry) => entry.isDirectory())
                    .map((entry) => entry.name)
                    .sort((a, b) => a.localeCompare(b));
            }
            return result;
        }

        if (action === 'read') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            const fileName = String(readFlag(parsed.flags, 'file') || payload.file || 'content.md');
            const roots = resolveRoots();
            for (const item of roots) {
                const target = path.join(item.root, id, fileName);
                try {
                    const content = await fs.readFile(target, 'utf-8');
                    return { source: item.source, id, file: fileName, content };
                } catch {
                    // try next root
                }
            }
            throw new Error(`Knowledge item not found: ${id}/${fileName}`);
        }

        if (action === 'search') {
            const query = requireString(readFlag(parsed.flags, 'query') || payload.query, 'query').toLowerCase();
            const hits: Array<{ source: string; id: string; file: string }> = [];
            for (const item of resolveRoots()) {
                await fs.mkdir(item.root, { recursive: true });
                const entries = await fs.readdir(item.root, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    const id = entry.name;
                    for (const file of ['content.md', 'meta.json']) {
                        const fullPath = path.join(item.root, id, file);
                        try {
                            const content = (await fs.readFile(fullPath, 'utf-8')).toLowerCase();
                            if (content.includes(query)) {
                                hits.push({ source: item.source, id, file });
                            }
                        } catch {
                            // ignore missing file
                        }
                    }
                }
            }
            return { query, count: hits.length, hits };
        }

        throw new Error(`Unsupported knowledge action: ${action}`);
    }

    private async handleAdvisors(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const advisorsRoot = getWorkspacePaths().advisors;
        await fs.mkdir(advisorsRoot, { recursive: true });
        const action = parsed.action;

        if (action === 'list') {
            const entries = await fs.readdir(advisorsRoot, { withFileTypes: true });
            const advisors: Array<{ id: string; name?: string }> = [];
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const id = entry.name;
                const configPath = path.join(advisorsRoot, id, 'config.json');
                try {
                    const config = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { name?: string };
                    advisors.push({ id, name: config.name });
                } catch {
                    advisors.push({ id });
                }
            }
            return advisors.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
        }

        if (action === 'read') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            const configPath = path.join(advisorsRoot, id, 'config.json');
            const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
            return { id, config };
        }

        throw new Error(`Unsupported advisors action: ${action}`);
    }

    private async handleMemory(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const action = parsed.action;
        if (action === 'list') {
            const limit = parseNumber(readFlag(parsed.flags, 'limit')) || 100;
            const memories = await listUserMemoriesFromFile();
            return { count: memories.length, memories: memories.slice(0, Math.max(1, limit)) };
        }
        if (action === 'add') {
            const content = requireString(readFlag(parsed.flags, 'content') || payload.content, 'content');
            const type = (readFlag(parsed.flags, 'type') || payload.type || 'general') as 'general' | 'preference' | 'fact';
            const tags = parseList(readFlag(parsed.flags, 'tags') || payload.tags);
            return addUserMemoryToFile(content, type, tags);
        }
        if (action === 'delete') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            await deleteUserMemoryFromFile(id);
            return { success: true, id };
        }
        if (action === 'update') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            const content = readFlag(parsed.flags, 'content') || payload.content;
            const type = readFlag(parsed.flags, 'type') || payload.type;
            const tags = readFlag(parsed.flags, 'tags') || payload.tags;
            await updateUserMemoryInFile(id, {
                content: typeof content === 'string' ? content : undefined,
                type: typeof type === 'string' ? type as 'general' | 'preference' | 'fact' : undefined,
                tags: tags !== undefined ? parseList(tags) : undefined,
            });
            return { success: true, id };
        }
        throw new Error(`Unsupported memory action: ${action}`);
    }

    private async handleRedclaw(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const action = parsed.action;
        const getRunner = async () => {
            const mod = await import('../redclawBackgroundRunner');
            return mod.getRedClawBackgroundRunner();
        };
        if (action === 'list') {
            const limit = parseNumber(readFlag(parsed.flags, 'limit') || payload.limit) || 20;
            return listRedClawProjects(limit);
        }
        if (action === 'create') {
            const goal = requireString(readFlag(parsed.flags, 'goal') || payload.goal, 'goal');
            return createRedClawProject({
                goal,
                targetAudience: readFlag(parsed.flags, 'audience', 'target-audience') || (payload.targetAudience as string | undefined),
                tone: readFlag(parsed.flags, 'tone') || (payload.tone as string | undefined),
                successCriteria: readFlag(parsed.flags, 'success', 'success-criteria') || (payload.successCriteria as string | undefined),
                tags: parseList(readFlag(parsed.flags, 'tags') || payload.tags),
            });
        }
        if (action === 'get') {
            const projectId = requireString(readFlag(parsed.flags, 'project-id', 'projectid') || payload.projectId, 'projectId');
            return getRedClawProject(projectId);
        }
        if (action === 'save-copy') {
            const projectId = requireString(readFlag(parsed.flags, 'project-id', 'projectid') || payload.projectId, 'projectId');
            const titleOptions = parseList(readFlag(parsed.flags, 'titles', 'title-options') || payload.titleOptions);
            const content = requireString(readFlag(parsed.flags, 'content') || payload.content, 'content');
            return saveRedClawCopyPack({
                projectId,
                titleOptions: titleOptions.length > 0 ? titleOptions : ['默认标题'],
                finalTitle: readFlag(parsed.flags, 'final-title') || (payload.finalTitle as string | undefined),
                content,
                hashtags: parseList(readFlag(parsed.flags, 'hashtags') || payload.hashtags),
                coverTexts: parseList(readFlag(parsed.flags, 'cover-texts') || payload.coverTexts),
                publishPlan: readFlag(parsed.flags, 'publish-plan') || (payload.publishPlan as string | undefined),
            });
        }
        if (action === 'save-image') {
            const projectId = requireString(readFlag(parsed.flags, 'project-id', 'projectid') || payload.projectId, 'projectId');
            let images = (payload.images as RedClawImagePrompt[] | undefined) || [];
            if (!Array.isArray(images) || images.length === 0) {
                const prompts = parseList(readFlag(parsed.flags, 'prompts') || payload.prompts);
                images = prompts.map((prompt) => ({ prompt }));
            }
            if (!images.length) {
                throw new Error('images/prompts is required');
            }
            return saveRedClawImagePack({
                projectId,
                coverPrompt: readFlag(parsed.flags, 'cover-prompt') || (payload.coverPrompt as string | undefined),
                notes: readFlag(parsed.flags, 'notes') || (payload.notes as string | undefined),
                images,
            });
        }
        if (action === 'save-retro') {
            const projectId = requireString(readFlag(parsed.flags, 'project-id', 'projectid') || payload.projectId, 'projectId');
            return saveRedClawRetrospective({
                projectId,
                metrics: {
                    views: parseNumber(readFlag(parsed.flags, 'views') || (payload.metrics as any)?.views),
                    likes: parseNumber(readFlag(parsed.flags, 'likes') || (payload.metrics as any)?.likes),
                    comments: parseNumber(readFlag(parsed.flags, 'comments') || (payload.metrics as any)?.comments),
                    collects: parseNumber(readFlag(parsed.flags, 'collects') || (payload.metrics as any)?.collects),
                    shares: parseNumber(readFlag(parsed.flags, 'shares') || (payload.metrics as any)?.shares),
                    follows: parseNumber(readFlag(parsed.flags, 'follows') || (payload.metrics as any)?.follows),
                },
                whatWorked: readFlag(parsed.flags, 'worked') || (payload.whatWorked as string | undefined),
                whatFailed: readFlag(parsed.flags, 'failed') || (payload.whatFailed as string | undefined),
                nextHypotheses: parseList(readFlag(parsed.flags, 'hypotheses') || payload.nextHypotheses),
                nextActions: parseList(readFlag(parsed.flags, 'actions') || payload.nextActions),
            });
        }
        if (action === 'runner-status') {
            const runner = await getRunner();
            return runner.getStatus();
        }
        if (action === 'runner-start') {
            const runner = await getRunner();
            return runner.start({
                intervalMinutes: parseNumber(readFlag(parsed.flags, 'interval', 'interval-minutes') || payload.intervalMinutes),
                keepAliveWhenNoWindow: parseBoolean(readFlag(parsed.flags, 'keep-alive') || payload.keepAliveWhenNoWindow),
                maxProjectsPerTick: parseNumber(readFlag(parsed.flags, 'max-projects', 'max-projects-per-tick') || payload.maxProjectsPerTick),
            });
        }
        if (action === 'runner-stop') {
            const runner = await getRunner();
            return runner.stop();
        }
        if (action === 'runner-run-now') {
            const runner = await getRunner();
            const projectId = readFlag(parsed.flags, 'project-id', 'projectid') || (payload.projectId as string | undefined);
            return runner.runNow(projectId);
        }
        if (action === 'runner-set-config') {
            const runner = await getRunner();
            return runner.setRunnerConfig({
                intervalMinutes: parseNumber(readFlag(parsed.flags, 'interval', 'interval-minutes') || payload.intervalMinutes),
                keepAliveWhenNoWindow: parseBoolean(readFlag(parsed.flags, 'keep-alive') || payload.keepAliveWhenNoWindow),
                maxProjectsPerTick: parseNumber(readFlag(parsed.flags, 'max-projects', 'max-projects-per-tick') || payload.maxProjectsPerTick),
            });
        }
        if (action === 'runner-enable-project' || action === 'runner-disable-project' || action === 'runner-set-project') {
            const runner = await getRunner();
            const projectId = requireString(readFlag(parsed.flags, 'project-id', 'projectid') || payload.projectId, 'projectId');
            let enabled: boolean;
            if (action === 'runner-enable-project') {
                enabled = true;
            } else if (action === 'runner-disable-project') {
                enabled = false;
            } else {
                const parsedEnabled = parseBoolean(readFlag(parsed.flags, 'enabled') || payload.enabled);
                if (parsedEnabled === undefined) {
                    throw new Error('enabled is required for runner-set-project');
                }
                enabled = parsedEnabled;
            }
            return runner.setProjectState({
                projectId,
                enabled,
                prompt: readFlag(parsed.flags, 'prompt') || (payload.prompt as string | undefined),
            });
        }
        throw new Error(`Unsupported redclaw action: ${action}`);
    }

    private async handleMedia(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const action = parsed.action;
        if (action === 'list') {
            const limit = parseNumber(readFlag(parsed.flags, 'limit') || payload.limit) || 200;
            const assets = await listMediaAssets(limit);
            return { count: assets.length, assets };
        }
        if (action === 'update') {
            const assetId = requireString(readFlag(parsed.flags, 'asset-id', 'assetid') || payload.assetId, 'assetId');
            const updated = await updateMediaAssetMetadata({
                assetId,
                projectId: readFlag(parsed.flags, 'project-id') || (payload.projectId as string | undefined),
                title: readFlag(parsed.flags, 'title') || (payload.title as string | undefined),
                prompt: readFlag(parsed.flags, 'prompt') || (payload.prompt as string | undefined),
            });
            return updated;
        }
        if (action === 'bind') {
            const assetId = requireString(readFlag(parsed.flags, 'asset-id', 'assetid') || payload.assetId, 'assetId');
            const manuscriptPath = normalizeRelativePath(requireString(readFlag(parsed.flags, 'manuscript-path') || payload.manuscriptPath, 'manuscriptPath'));
            return bindMediaAssetToManuscript({ assetId, manuscriptPath });
        }
        if (action === 'path') {
            const assetId = requireString(readFlag(parsed.flags, 'asset-id', 'assetid') || payload.assetId, 'assetId');
            const assets = await listMediaAssets(5000);
            const asset = assets.find((item) => item.id === assetId);
            if (!asset) throw new Error('Media asset not found');
            return {
                assetId,
                relativePath: asset.relativePath || null,
                absolutePath: asset.relativePath ? getAbsoluteMediaPath(asset.relativePath) : null,
            };
        }
        if (action === 'stats') {
            const assets = await listMediaAssets(5000);
            return {
                total: assets.length,
                generated: assets.filter((a) => a.source === 'generated').length,
                planned: assets.filter((a) => a.source === 'planned').length,
                imported: assets.filter((a) => a.source === 'imported').length,
            };
        }
        throw new Error(`Unsupported media action: ${action}`);
    }

    private async handleImage(parsed: ParsedCommand, payload: Record<string, unknown>) {
        if (parsed.action !== 'generate') {
            throw new Error(`Unsupported image action: ${parsed.action}`);
        }
        const prompt = requireString(readFlag(parsed.flags, 'prompt') || payload.prompt, 'prompt');
        const result = await generateImagesToMediaLibrary({
            prompt,
            projectId: readFlag(parsed.flags, 'project-id') || (payload.projectId as string | undefined),
            title: readFlag(parsed.flags, 'title') || (payload.title as string | undefined),
            count: parseNumber(readFlag(parsed.flags, 'count') || payload.count),
            model: readFlag(parsed.flags, 'model') || (payload.model as string | undefined),
            size: readFlag(parsed.flags, 'size') || (payload.size as string | undefined),
            quality: readFlag(parsed.flags, 'quality') || (payload.quality as string | undefined),
        });
        return {
            provider: result.provider,
            model: result.model,
            size: result.size,
            quality: result.quality,
            count: result.assets.length,
            assets: result.assets.map((asset) => ({
                id: asset.id,
                projectId: asset.projectId,
                relativePath: asset.relativePath,
                prompt: asset.prompt,
                createdAt: asset.createdAt,
            })),
        };
    }

    private async handleSettings(parsed: ParsedCommand, payload: Record<string, unknown>) {
        if (parsed.action === 'get') {
            const settings = (getSettings() || {}) as Record<string, unknown>;
            const key = readFlag(parsed.flags, 'key') || (payload.key as string | undefined);
            if (key) {
                return { key, value: settings[key] };
            }
            return settings;
        }

        if (parsed.action === 'set') {
            const key = requireString(readFlag(parsed.flags, 'key') || payload.key, 'key');
            const value = readFlag(parsed.flags, 'value') || payload.value;
            const current = (getSettings() || {}) as Record<string, unknown>;
            const next: Record<string, unknown> = { ...current };
            next[key] = value;
            saveSettings({
                api_endpoint: String(next.api_endpoint || ''),
                api_key: String(next.api_key || ''),
                model_name: String(next.model_name || ''),
                role_mapping: typeof next.role_mapping === 'string' ? next.role_mapping : JSON.stringify(next.role_mapping || {}),
                workspace_dir: String(next.workspace_dir || ''),
                active_space_id: String(next.active_space_id || ''),
                transcription_model: String(next.transcription_model || ''),
                transcription_endpoint: String(next.transcription_endpoint || ''),
                transcription_key: String(next.transcription_key || ''),
                embedding_endpoint: String(next.embedding_endpoint || ''),
                embedding_key: String(next.embedding_key || ''),
                embedding_model: String(next.embedding_model || ''),
                image_provider: String(next.image_provider || ''),
                image_endpoint: String(next.image_endpoint || ''),
                image_api_key: String(next.image_api_key || ''),
                image_model: String(next.image_model || ''),
                image_size: String(next.image_size || ''),
                image_quality: String(next.image_quality || ''),
            });
            return { success: true, key, value };
        }

        throw new Error(`Unsupported settings action: ${parsed.action}`);
    }

    private async handleSkills(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const manager = new SkillManager();
        await manager.discoverSkills(getWorkspacePaths().base);

        if (parsed.action === 'list') {
            return manager.getAllSkills().map((skill) => ({
                name: skill.name,
                description: skill.description,
                disabled: Boolean(skill.disabled),
                location: skill.location,
            }));
        }
        if (parsed.action === 'enable') {
            const name = requireString(readFlag(parsed.flags, 'name') || payload.name, 'name');
            const changed = await manager.enableSkill(name);
            return { success: true, changed };
        }
        if (parsed.action === 'disable') {
            const name = requireString(readFlag(parsed.flags, 'name') || payload.name, 'name');
            const changed = await manager.disableSkill(name);
            return { success: true, changed };
        }
        throw new Error(`Unsupported skills action: ${parsed.action}`);
    }

    private async handleArchives(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const action = parsed.action;
        if (action === 'profiles' || action === 'list-profiles') {
            return listArchiveProfiles();
        }
        if (action === 'create-profile') {
            const profile = (payload.profile || payload) as Record<string, unknown>;
            return createArchiveProfile({
                id: requireString(profile.id, 'profile.id'),
                name: requireString(profile.name, 'profile.name'),
                platform: String(profile.platform || ''),
                goal: String(profile.goal || ''),
                domain: String(profile.domain || ''),
                audience: String(profile.audience || ''),
                tone_tags: Array.isArray(profile.tone_tags) ? profile.tone_tags as string[] : parseList(profile.tone_tags),
            });
        }
        if (action === 'update-profile') {
            const profile = (payload.profile || payload) as Record<string, unknown>;
            return updateArchiveProfile({
                id: requireString(profile.id, 'profile.id'),
                name: requireString(profile.name, 'profile.name'),
                platform: String(profile.platform || ''),
                goal: String(profile.goal || ''),
                domain: String(profile.domain || ''),
                audience: String(profile.audience || ''),
                tone_tags: Array.isArray(profile.tone_tags) ? profile.tone_tags as string[] : parseList(profile.tone_tags),
            });
        }
        if (action === 'delete-profile') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            deleteArchiveProfile(id);
            return { success: true, id };
        }
        if (action === 'samples') {
            const profileId = requireString(readFlag(parsed.flags, 'profile-id') || payload.profileId, 'profileId');
            return listArchiveSamples(profileId);
        }
        if (action === 'create-sample') {
            const sample = (payload.sample || payload) as Record<string, unknown>;
            return createArchiveSample({
                id: requireString(sample.id, 'sample.id'),
                profile_id: requireString(sample.profile_id || sample.profileId, 'sample.profile_id'),
                title: String(sample.title || ''),
                content: String(sample.content || ''),
                excerpt: String(sample.excerpt || ''),
                tags: Array.isArray(sample.tags) ? sample.tags as string[] : parseList(sample.tags),
                images: Array.isArray(sample.images) ? sample.images as string[] : parseList(sample.images),
                platform: String(sample.platform || ''),
                source_url: String(sample.source_url || sample.sourceUrl || ''),
                sample_date: String(sample.sample_date || sample.sampleDate || ''),
                is_featured: Number(sample.is_featured || sample.isFeatured || 0) ? 1 : 0,
            });
        }
        if (action === 'update-sample') {
            const sample = (payload.sample || payload) as Record<string, unknown>;
            return updateArchiveSample({
                id: requireString(sample.id, 'sample.id'),
                profile_id: requireString(sample.profile_id || sample.profileId, 'sample.profile_id'),
                title: String(sample.title || ''),
                content: String(sample.content || ''),
                excerpt: String(sample.excerpt || ''),
                tags: Array.isArray(sample.tags) ? sample.tags as string[] : parseList(sample.tags),
                images: Array.isArray(sample.images) ? sample.images as string[] : parseList(sample.images),
                platform: String(sample.platform || ''),
                source_url: String(sample.source_url || sample.sourceUrl || ''),
                sample_date: String(sample.sample_date || sample.sampleDate || ''),
                is_featured: Number(sample.is_featured || sample.isFeatured || 0) ? 1 : 0,
            });
        }
        if (action === 'delete-sample') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            deleteArchiveSample(id);
            return { success: true, id };
        }
        throw new Error(`Unsupported archives action: ${action}`);
    }

    private async handleWander(parsed: ParsedCommand, payload: Record<string, unknown>) {
        const action = parsed.action;
        if (action === 'list') {
            return listWanderHistory();
        }
        if (action === 'get') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            return getWanderHistory(id);
        }
        if (action === 'save') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            const items = Array.isArray(payload.items) ? payload.items : [];
            const result = payload.result;
            return saveWanderHistory(id, items as any[], result as any);
        }
        if (action === 'delete') {
            const id = requireString(readFlag(parsed.flags, 'id') || payload.id, 'id');
            deleteWanderHistory(id);
            return { success: true, id };
        }
        throw new Error(`Unsupported wander action: ${action}`);
    }
}
