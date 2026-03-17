/**
 * Skill Loader - 技能文件加载器
 * 
 * 负责从 SKILL.md 文件解析技能定义
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 技能定义
 */
export interface SkillDefinition {
    /** 技能名称 */
    name: string;
    /** 技能描述 */
    description: string;
    /** 技能文件路径 */
    location: string;
    /** 技能指令内容 */
    body: string;
    /** 是否为内置技能 */
    isBuiltin?: boolean;
    /** 是否禁用 */
    disabled?: boolean;
}

/**
 * YAML Frontmatter 正则表达式
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?/;

/**
 * 解析 Frontmatter
 * 使用简单的 key-value 解析，避免外部 YAML 依赖
 */
function parseFrontmatter(content: string): { name: string; description: string } | null {
    const lines = content.split(/\r?\n/);
    let name: string | undefined;
    let description: string | undefined;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 匹配 name: value
        const nameMatch = line.match(/^\s*name:\s*(.*)$/);
        if (nameMatch) {
            name = nameMatch[1].trim().replace(/^["']|["']$/g, ''); // 移除引号
            continue;
        }

        // 匹配 description: value
        const descMatch = line.match(/^\s*description:\s*(.*)$/);
        if (descMatch) {
            const descLines = [descMatch[1].trim().replace(/^["']|["']$/g, '')];

            // 检查多行描述（缩进续行）
            while (i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                if (nextLine.match(/^[ \t]+\S/)) {
                    descLines.push(nextLine.trim());
                    i++;
                } else {
                    break;
                }
            }

            description = descLines.filter(Boolean).join(' ');
            continue;
        }
    }

    if (name !== undefined && description !== undefined) {
        return { name, description };
    }
    return null;
}

/**
 * 从文件加载单个技能
 */
export async function loadSkillFromFile(filePath: string): Promise<SkillDefinition | null> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const match = content.match(FRONTMATTER_REGEX);

        if (!match) {
            console.warn(`Invalid skill file (no frontmatter): ${filePath}`);
            return null;
        }

        const frontmatter = parseFrontmatter(match[1]);
        if (!frontmatter) {
            console.warn(`Invalid skill frontmatter: ${filePath}`);
            return null;
        }

        return {
            name: frontmatter.name,
            description: frontmatter.description,
            location: filePath,
            body: match[2]?.trim() ?? '',
        };
    } catch (error) {
        console.error(`Error loading skill from ${filePath}:`, error);
        return null;
    }
}

/**
 * 从目录加载所有技能
 * 支持两种结构：
 * 1. dir/*.md (任何带 frontmatter 的 .md 文件)
 * 2. dir/skill-name/SKILL.md
 */
export async function loadSkillsFromDir(dir: string): Promise<SkillDefinition[]> {
    const skills: SkillDefinition[] = [];

    try {
        const absolutePath = path.resolve(dir);
        const stats = await fs.stat(absolutePath).catch(() => null);

        if (!stats || !stats.isDirectory()) {
            return [];
        }

        const entries = await fs.readdir(absolutePath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(absolutePath, entry.name);

            if (entry.isFile() && entry.name.endsWith('.md')) {
                // 任何 .md 文件都尝试作为技能加载
                const skill = await loadSkillFromFile(entryPath);
                if (skill) {
                    skills.push(skill);
                }
            } else if (entry.isDirectory()) {
                // 子目录中的 SKILL.md
                const skillFilePath = path.join(entryPath, 'SKILL.md');
                const skill = await loadSkillFromFile(skillFilePath);
                if (skill) {
                    skills.push(skill);
                }
            }
        }
    } catch (error) {
        console.error(`Error discovering skills in ${dir}:`, error);
    }

    return skills;
}

/**
 * 获取用户技能目录
 */
export function getUserSkillsDir(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homeDir, '.redconvert', 'skills');
}

/**
 * 获取项目技能目录
 * 优先顺序: .gemini/skills > .opencode/skills > .agent/skills
 */
export async function getProjectSkillsDir(projectRoot: string): Promise<string[]> {
    const candidates = [
        path.join(projectRoot, '.gemini', 'skills'),
        path.join(projectRoot, '.opencode', 'skills'),
        path.join(projectRoot, '.agent', 'skills'),
    ];
    
    // 返回所有存在的目录
    const dirs: string[] = [];
    for (const dir of candidates) {
        try {
            const stats = await fs.stat(dir);
            if (stats.isDirectory()) {
                dirs.push(dir);
            }
        } catch {
            // ignore
        }
    }
    return dirs;
}

/**
 * 确保目录存在
 */
export async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}
