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
export { RedClawUpdateProfileDocTool, RedClawUpdateCreatorProfileTool } from './creatorProfileTool';
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
export { WebSearchTool } from './searchTool';

// 导入工具类型
import { type ToolDefinition, type ToolResult, ToolKind } from '../toolRegistry';

// Legacy / Other tools imports
import { CalculatorTool } from './calculatorTool';
import { ListDirTool } from './listDirTool';
import { ExploreWorkspaceTool } from './exploreWorkspaceTool';
import { SaveMemoryTool } from './memoryTool';
import { RedClawUpdateCreatorProfileTool, RedClawUpdateProfileDocTool } from './creatorProfileTool';
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
import { WebSearchTool } from './searchTool';
import { WriteFileTool } from './writeFileTool';
import { EditTool } from './editTool';
import { ReadFileTool } from './readFileTool';
import { GrepTool } from './grepTool';
import { BashTool } from './bashTool';
import { AppCliTool } from './appCliTool';
import {
    createBuiltinToolInstances,
    type BuiltinToolPack,
    listBuiltinToolDescriptors,
    registerBuiltinToolDescriptor,
} from './catalog';

let builtinToolsRegistered = false;

const ensureBuiltinToolDescriptorsRegistered = (): void => {
    if (builtinToolsRegistered) {
        return;
    }
    builtinToolsRegistered = true;

    const publicAllContexts: BuiltinToolPack[] = ['redclaw', 'knowledge', 'chatroom', 'diagnostics'];
    const developerOnlyContexts: BuiltinToolPack[] = ['diagnostics'];
    const compactRedClawContexts: BuiltinToolPack[] = ['redclaw', 'diagnostics'];
    const nonRedClawPublicContexts: BuiltinToolPack[] = ['knowledge', 'chatroom', 'diagnostics'];
    const register = (descriptor: Parameters<typeof registerBuiltinToolDescriptor>[0]) => {
        registerBuiltinToolDescriptor(descriptor);
    };

    registerBuiltinToolDescriptor({
        name: 'write_file',
        displayName: 'Write File',
        description: 'Write content to a file. Creates the file if it does not exist.',
        kind: ToolKind.Edit,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['path must be inside workspace'],
        successSignal: 'file written successfully',
        failureSignal: 'path blocked or write failed',
        artifactOutput: ['file'],
        retryPolicy: 'manual',
        create: () => new WriteFileTool(),
    });
    register({
        name: 'edit_file',
        displayName: 'Edit File',
        description: 'Edit a file by replacing a specific string with a new string.',
        kind: ToolKind.Edit,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['target file must be inside workspace'],
        successSignal: 'replacement applied',
        failureSignal: 'target text not found or path invalid',
        artifactOutput: ['file'],
        retryPolicy: 'manual',
        create: () => new EditTool(),
    });
    register({
        name: 'read_file',
        displayName: 'Read File',
        description: 'Read the contents of a file, with chunking for large files.',
        kind: ToolKind.Read,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['path must be inside workspace'],
        successSignal: 'file content returned',
        failureSignal: 'file not found or blocked',
        artifactOutput: ['read-result'],
        retryPolicy: 'safe-retry',
        create: () => new ReadFileTool(),
    });
    register({
        name: 'grep',
        displayName: 'Grep Search',
        description: 'Search for patterns in files using ripgrep or grep.',
        kind: ToolKind.Read,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['search path must be inside workspace'],
        successSignal: 'matching files returned',
        failureSignal: 'search failed or path invalid',
        artifactOutput: ['search-result'],
        retryPolicy: 'safe-retry',
        create: () => new GrepTool(),
    });
    register({
        name: 'bash',
        displayName: 'Bash Shell',
        description: 'Execute shell commands within the workspace directory only.',
        kind: ToolKind.Execute,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['cwd must be inside workspace', 'dangerous commands may require confirmation'],
        successSignal: 'command completed',
        failureSignal: 'command blocked or failed',
        artifactOutput: ['command-output'],
        retryPolicy: 'manual',
        create: () => new BashTool(),
    });
    register({
        name: 'app_cli',
        displayName: 'App CLI',
        description: 'CLI-style app control layer for spaces, manuscripts, media, RedClaw and settings.',
        kind: ToolKind.Execute,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['command must use supported namespace/action'],
        successSignal: 'structured app result returned',
        failureSignal: 'namespace/action invalid or command failed',
        artifactOutput: ['manuscript', 'image', 'project', 'config'],
        retryPolicy: 'manual',
        create: () => new AppCliTool(),
    });
    register({
        name: 'list_dir',
        displayName: 'List Directory',
        description: 'List files and directories in a given path.',
        kind: ToolKind.Read,
        contexts: ['knowledge', 'chatroom', 'diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new ListDirTool(),
    });
    register({
        name: 'web_search',
        displayName: 'Web Search',
        description: 'Search the web for current information and resources.',
        kind: ToolKind.Search,
        contexts: publicAllContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['query must be non-empty'],
        successSignal: 'search results returned',
        failureSignal: 'search request failed',
        artifactOutput: ['web-results'],
        retryPolicy: 'safe-retry',
        create: () => new WebSearchTool(),
    });
    register({
        name: 'calculator',
        displayName: 'Calculator',
        description: 'Evaluate mathematical expressions.',
        kind: ToolKind.Other,
        contexts: nonRedClawPublicContexts,
        visibility: 'public',
        requiresContext: null,
        create: () => new CalculatorTool(),
    });
    register({
        name: 'save_memory',
        displayName: 'Save Memory',
        description: 'Save a piece of user information to long-term memory.',
        kind: ToolKind.Other,
        contexts: compactRedClawContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['content must be long-term useful'],
        successSignal: 'memory persisted',
        failureSignal: 'memory write rejected',
        artifactOutput: ['memory'],
        retryPolicy: 'manual',
        create: () => new SaveMemoryTool(),
    });
    register({
        name: 'redclaw_update_profile_doc',
        displayName: 'RedClaw Update Profile Document',
        description: 'Update Agent.md, Soul.md, user.md, or CreatorProfile.md.',
        kind: ToolKind.Edit,
        contexts: compactRedClawContexts,
        visibility: 'public',
        requiresContext: null,
        preconditions: ['document type must be valid'],
        successSignal: 'profile document updated',
        failureSignal: 'document update failed',
        artifactOutput: ['profile-doc'],
        retryPolicy: 'manual',
        create: () => new RedClawUpdateProfileDocTool(),
    });
    register({
        name: 'redclaw_update_creator_profile',
        displayName: 'RedClaw Update Creator Profile',
        description: 'Update CreatorProfile.md, the long-term creator strategy document.',
        kind: ToolKind.Edit,
        contexts: ['knowledge', 'diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new RedClawUpdateCreatorProfileTool(),
    });
    register({
        name: 'redclaw_create_project',
        displayName: 'RedClaw Create Project',
        description: 'Create a RedClaw content project.',
        kind: ToolKind.Edit,
        contexts: ['diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new RedClawCreateProjectTool(),
    });
    register({
        name: 'redclaw_save_copy_pack',
        displayName: 'RedClaw Save Copy Pack',
        description: 'Save a RedClaw manuscript/copy pack to a project.',
        kind: ToolKind.Edit,
        contexts: ['diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new RedClawSaveCopyPackTool(),
    });
    register({
        name: 'redclaw_save_image_pack',
        displayName: 'RedClaw Save Image Pack',
        description: 'Save a RedClaw image pack to a project.',
        kind: ToolKind.Edit,
        contexts: ['diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new RedClawSaveImagePackTool(),
    });
    register({
        name: 'redclaw_save_retrospective',
        displayName: 'RedClaw Save Retrospective',
        description: 'Save a RedClaw project retrospective.',
        kind: ToolKind.Edit,
        contexts: ['diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new RedClawSaveRetrospectiveTool(),
    });
    register({
        name: 'redclaw_list_projects',
        displayName: 'RedClaw List Projects',
        description: 'List recent RedClaw projects.',
        kind: ToolKind.Read,
        contexts: ['diagnostics'],
        visibility: 'public',
        requiresContext: null,
        create: () => new RedClawListProjectsTool(),
    });
    register({
        name: 'explore_workspace',
        displayName: 'Explore Workspace',
        description: 'Analyze and summarize a workspace directory.',
        kind: ToolKind.Read,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new ExploreWorkspaceTool(),
    });
    register({
        name: 'lsp',
        displayName: 'LSP',
        description: 'Use language server features like symbol lookup or definitions.',
        kind: ToolKind.LSP,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new LspTool(),
    });
    register({
        name: 'todo_write',
        displayName: 'Todo Write',
        description: 'Write structured todo items.',
        kind: ToolKind.Edit,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new TodoWriteTool(),
    });
    register({
        name: 'todo_read',
        displayName: 'Todo Read',
        description: 'Read current todo items.',
        kind: ToolKind.Read,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new TodoReadTool(),
    });
    register({
        name: 'plan_mode_enter',
        displayName: 'Plan Mode Enter',
        description: 'Enter plan mode for structured execution.',
        kind: ToolKind.Other,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new PlanModeEnterTool(),
    });
    register({
        name: 'plan_mode_exit',
        displayName: 'Plan Mode Exit',
        description: 'Exit plan mode and return to default execution.',
        kind: ToolKind.Other,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: null,
        create: () => new PlanModeExitTool(),
    });
    register({
        name: 'skill_manage',
        displayName: 'Skill Manage',
        description: 'Manage installed skills and their lifecycle.',
        kind: ToolKind.Other,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: 'chatService',
        create: ({ chatService }) => (chatService ? new SkillManageTool(chatService) : null),
    });
    register({
        name: 'skill_install',
        displayName: 'Skill Install',
        description: 'Install a skill into the current environment.',
        kind: ToolKind.Other,
        contexts: developerOnlyContexts,
        visibility: 'developer',
        requiresContext: 'chatService',
        create: ({ chatService }) => (chatService ? new SkillInstallTool(chatService) : null),
    });
};

/**
 * 创建所有内置工具实例
 * 注意：核心文件操作工具 (read, write, list 等) 现在由 ChatServiceV2 内部的 Vercel AI SDK 工具处理
 */
export function createBuiltinTools(options: { chatService?: any; pack?: BuiltinToolPack } = {}): ToolDefinition<unknown, ToolResult>[] {
    ensureBuiltinToolDescriptorsRegistered();
    return createBuiltinToolInstances(options);
}

export function getRegisteredBuiltinTools() {
    ensureBuiltinToolDescriptorsRegistered();
    return listBuiltinToolDescriptors();
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
    'web_search',
    'calculator',
    'save_memory',
    'redclaw_update_profile_doc',
    'redclaw_update_creator_profile',
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
