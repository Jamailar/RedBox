/**
 * Built-in Tools - 内置工具导出
 */

// 导出所有内置工具
// 文件操作工具
export { WriteFileTool } from './writeFileTool';
export { EditTool } from './editTool';
export { ReadFileTool } from './readFileTool';
export { GrepTool } from './grepTool';
export { BashTool } from './bashTool';
export { AppCliTool } from './appCliTool';
// 辅助工具
export { CalculatorTool } from './calculatorTool';
export { ListDirTool } from './listDirTool'; // Legacy list
export { ExploreWorkspaceTool } from './exploreWorkspaceTool';
export { SaveMemoryTool } from './memoryTool';
export {
    RedClawCreateProjectTool,
    RedClawSaveCopyPackTool,
    RedClawSaveImagePackTool,
    RedClawSaveRetrospectiveTool,
    RedClawListProjectsTool,
} from './redclawTool';
export { LspTool } from './lspTool';
export { TodoWriteTool, TodoReadTool } from './todoTool';
export { PlanModeEnterTool, PlanModeExitTool } from './planTool';
export { SkillManageTool, SkillInstallTool } from './skillTool';

// 导入工具类型
import { type ToolDefinition, type ToolResult, ToolKind } from '../toolRegistry';

// Legacy / Other tools imports
import { CalculatorTool } from './calculatorTool';
import { ListDirTool } from './listDirTool';
import { ExploreWorkspaceTool } from './exploreWorkspaceTool';
import { SaveMemoryTool } from './memoryTool';
import {
    RedClawCreateProjectTool,
    RedClawSaveCopyPackTool,
    RedClawSaveImagePackTool,
    RedClawSaveRetrospectiveTool,
    RedClawListProjectsTool,
} from './redclawTool';
import { LspTool } from './lspTool';
import { TodoWriteTool, TodoReadTool } from './todoTool';
import { PlanModeEnterTool, PlanModeExitTool } from './planTool';
import { SkillManageTool, SkillInstallTool } from './skillTool';
import { WriteFileTool } from './writeFileTool';
import { EditTool } from './editTool';
import { ReadFileTool } from './readFileTool';
import { GrepTool } from './grepTool';
import { BashTool } from './bashTool';
import { AppCliTool } from './appCliTool';

/**
 * 创建所有内置工具实例
 * 注意：核心文件操作工具 (read, write, list 等) 现在由 ChatServiceV2 内部的 Vercel AI SDK 工具处理
 */
export function createBuiltinTools(chatService?: any): ToolDefinition<unknown, ToolResult>[] {
    const tools: ToolDefinition<unknown, ToolResult>[] = [
        // 文件操作工具
        new WriteFileTool(),
        new EditTool(),
        new ReadFileTool(),
        new GrepTool(),
        new BashTool(),
        new AppCliTool(),
        new ListDirTool(),

        // 辅助工具
        new CalculatorTool(),
        new SaveMemoryTool(),
        new RedClawCreateProjectTool(),
        new RedClawSaveCopyPackTool(),
        new RedClawSaveImagePackTool(),
        new RedClawSaveRetrospectiveTool(),
        new RedClawListProjectsTool(),

        // 其他工具
        new ExploreWorkspaceTool(),
        new LspTool(),
        new TodoWriteTool(),
        new TodoReadTool(),
        new PlanModeEnterTool(),
        new PlanModeExitTool(),
    ];

    if (chatService) {
        tools.push(new SkillManageTool(chatService));
        tools.push(new SkillInstallTool(chatService));
    }

    return tools;
}

/**
 * 内置工具名称列表
 */
export const BUILTIN_TOOL_NAMES = [
    'write_file',
    'edit_file',
    'read_file',
    'grep',
    'bash',
    'app_cli',
    'list_dir',
    'calculator',
    'save_memory',
    'redclaw_create_project',
    'redclaw_save_copy_pack',
    'redclaw_save_image_pack',
    'redclaw_save_retrospective',
    'redclaw_list_projects',
    'explore_workspace',
    'lsp',
    'todo_write',
    'todo_read',
    'plan_mode_enter',
    'plan_mode_exit',
    'skill_manage',
    'skill_install',
] as const;

export type BuiltinToolName = typeof BUILTIN_TOOL_NAMES[number];
