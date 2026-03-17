/**
 * Skill Manager - 技能管理器
 * 
 * 管理技能的发现、加载、激活
 */


import * as fs from 'fs/promises';
import * as path from 'path';
import {
    type SkillDefinition,
    loadSkillsFromDir,
    getUserSkillsDir,
    getProjectSkillsDir,
} from './skillLoader';

/**
 * 技能管理器
 */
export class SkillManager {
    private skills: SkillDefinition[] = [];
    private activeSkillNames: Set<string> = new Set();
    private disabledSkillNames: Set<string> = new Set();
    private settingsPath: string;

    constructor() {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        this.settingsPath = path.join(homeDir, '.redconvert', 'skill-settings.json');
    }

    /**
     * 发现并加载所有技能
     * 优先级：内置 < 用户 < 项目
     */
    async discoverSkills(projectRoot?: string): Promise<void> {
        this.skills = [];

        // 1. 加载内置技能（从应用目录）
        const builtinSkills = await this.discoverBuiltinSkills();
        this.addSkillsWithPrecedence(builtinSkills.map(s => ({ ...s, isBuiltin: true })));

        // 2. 加载用户技能
        const userSkillsDir = getUserSkillsDir();
        const userSkills = await loadSkillsFromDir(userSkillsDir);
        this.addSkillsWithPrecedence(userSkills);

        // 3. 加载项目技能（如果指定了项目目录）
        if (projectRoot) {
            const projectSkillsDirs = await getProjectSkillsDir(projectRoot);
            for (const dir of projectSkillsDirs) {
                const projectSkills = await loadSkillsFromDir(dir);
                this.addSkillsWithPrecedence(projectSkills);
            }
        }

        // 加载持久化的禁用状态
        await this.loadDisabledState();

        // 应用禁用设置
        for (const skill of this.skills) {
            skill.disabled = this.disabledSkillNames.has(skill.name.toLowerCase());
        }
    }

    /**
     * 发现内置技能
     */
    private async discoverBuiltinSkills(): Promise<SkillDefinition[]> {
        // 内置技能可以从应用包中加载
        // 这里先返回空数组，后续可以添加内置技能
        return [];
    }

    /**
     * 添加技能（后添加的覆盖先添加的同名技能）
     */
    private addSkillsWithPrecedence(newSkills: SkillDefinition[]): void {
        const skillMap = new Map<string, SkillDefinition>(
            this.skills.map(s => [s.name.toLowerCase(), s])
        );

        for (const newSkill of newSkills) {
            const key = newSkill.name.toLowerCase();
            const existingSkill = skillMap.get(key);

            if (existingSkill && existingSkill.location !== newSkill.location) {
                console.log(
                    `Skill "${newSkill.name}" from "${newSkill.location}" ` +
                    `is overriding the skill from "${existingSkill.location}".`
                );
            }

            skillMap.set(key, newSkill);
        }

        this.skills = Array.from(skillMap.values());
    }

    /**
     * 获取所有启用的技能
     */
    getSkills(): SkillDefinition[] {
        return this.skills.filter(s => !s.disabled);
    }

    /**
     * 获取所有技能（包括禁用的）
     */
    getAllSkills(): SkillDefinition[] {
        return this.skills;
    }

    /**
     * 获取单个技能
     */
    getSkill(name: string): SkillDefinition | null {
        const lowerName = name.toLowerCase();
        return this.skills.find(s => s.name.toLowerCase() === lowerName) ?? null;
    }

    /**
     * 激活技能
     * @returns 技能的指令内容，如果技能不存在则返回 null
     */
    activateSkill(name: string): string | null {
        const skill = this.getSkill(name);
        if (!skill || skill.disabled) {
            return null;
        }

        this.activeSkillNames.add(name.toLowerCase());

        // 返回包装后的技能内容
        return `<activated_skill name="${skill.name}">
<description>${skill.description}</description>
<location>${skill.location}</location>
<instructions>
${skill.body}
</instructions>
</activated_skill>`;
    }

    /**
     * 检查技能是否已激活
     */
    isSkillActive(name: string): boolean {
        return this.activeSkillNames.has(name.toLowerCase());
    }

    /**
     * 获取已激活的技能列表
     */
    getActiveSkills(): SkillDefinition[] {
        return this.skills.filter(s => this.activeSkillNames.has(s.name.toLowerCase()));
    }

    /**
     * 重置激活状态
     */
    resetActiveSkills(): void {
        this.activeSkillNames.clear();
    }

    /**
     * 设置禁用的技能列表
     */
    async setDisabledSkills(disabledNames: string[]): Promise<void> {
        this.disabledSkillNames = new Set(disabledNames.map(n => n.toLowerCase()));

        // 更新技能禁用状态
        for (const skill of this.skills) {
            skill.disabled = this.disabledSkillNames.has(skill.name.toLowerCase());
        }

        await this.saveDisabledState();
    }

    /**
     * 启用技能
     */
    async enableSkill(name: string): Promise<boolean> {
        const lowerName = name.toLowerCase();
        if (this.disabledSkillNames.has(lowerName)) {
            this.disabledSkillNames.delete(lowerName);
            await this.setDisabledSkills(Array.from(this.disabledSkillNames));
            return true;
        }
        return false;
    }

    /**
     * 禁用技能
     */
    async disableSkill(name: string): Promise<boolean> {
        const lowerName = name.toLowerCase();
        if (!this.disabledSkillNames.has(lowerName)) {
            this.disabledSkillNames.add(lowerName);
            await this.setDisabledSkills(Array.from(this.disabledSkillNames));
            return true;
        }
        return false;
    }

    /**
     * 加载禁用状态
     */
    private async loadDisabledState(): Promise<void> {
        try {
            const content = await fs.readFile(this.settingsPath, 'utf-8');
            const settings = JSON.parse(content);
            if (Array.isArray(settings.disabledSkills)) {
                this.disabledSkillNames = new Set(settings.disabledSkills.map((n: string) => n.toLowerCase()));
            }
        } catch {
            // Ignore error (file not found or invalid JSON)
        }
    }

    /**
     * 保存禁用状态
     */
    private async saveDisabledState(): Promise<void> {
        try {
            const settings = {
                disabledSkills: Array.from(this.disabledSkillNames)
            };
            const dir = path.dirname(this.settingsPath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        } catch (error) {
            console.error('Failed to save skill settings:', error);
        }
    }

    /**
     * 生成技能列表的 XML（用于系统提示词）
     */
    getSkillsXml(): string {
        const enabledSkills = this.getSkills();
        if (enabledSkills.length === 0) {
            return '';
        }

        const skillsXml = enabledSkills
            .map(skill => `  <skill>
    <name>${skill.name}</name>
    <description>${skill.description}</description>
    <location>${skill.location}</location>
  </skill>`)
            .join('\n');

        return `
# Available Agent Skills

You have access to the following specialized skills. To activate a skill and receive its detailed instructions, you can call the \`activate_skill\` tool with the skill's name.

<available_skills>
${skillsXml}
</available_skills>
`;
    }
}

// 导出类型
export { SkillDefinition };
