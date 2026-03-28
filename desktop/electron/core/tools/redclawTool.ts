import { z } from 'zod';
import {
  DeclarativeTool,
  ToolKind,
  type ToolResult,
  createErrorResult,
  createSuccessResult,
} from '../toolRegistry';
import {
  createRedClawProject,
  listRedClawProjects,
  saveRedClawCopyPack,
  saveRedClawImagePack,
  saveRedClawRetrospective,
} from '../redclawStore';

const RedClawProjectCreateParamsSchema = z.object({
  goal: z.string().min(1).describe('User goal for this Xiaohongshu content project.'),
  targetAudience: z.string().optional().describe('Target audience profile.'),
  tone: z.string().optional().describe('Desired writing tone/style.'),
  successCriteria: z.string().optional().describe('How success should be measured.'),
  tags: z.array(z.string()).optional().describe('Project tags for later retrieval.'),
});

type RedClawProjectCreateParams = z.infer<typeof RedClawProjectCreateParamsSchema>;

const RedClawCopyPackParamsSchema = z.object({
  projectId: z.string().min(1).describe('RedClaw project id.'),
  titleOptions: z.array(z.string()).min(1).describe('Candidate titles for this post.'),
  finalTitle: z.string().optional().describe('Final title selected for publishing.'),
  content: z.string().min(1).describe('Final post body content.'),
  hashtags: z.array(z.string()).optional().describe('Hashtag list.'),
  coverTexts: z.array(z.string()).optional().describe('Cover text options.'),
  publishPlan: z.string().optional().describe('Publishing timing and action plan.'),
});

type RedClawCopyPackParams = z.infer<typeof RedClawCopyPackParamsSchema>;

const RedClawImagePackParamsSchema = z.object({
  projectId: z.string().min(1).describe('RedClaw project id.'),
  coverPrompt: z.string().optional().describe('Prompt for cover image generation.'),
  notes: z.string().optional().describe('Additional notes for image generation workflow.'),
  images: z.array(
    z.object({
      purpose: z.string().optional().describe('Usage goal for this image.'),
      prompt: z.string().min(1).describe('Image generation prompt.'),
      style: z.string().optional().describe('Style direction.'),
      ratio: z.string().optional().describe('Aspect ratio, e.g. 3:4, 1:1.'),
    })
  ).min(1).describe('Image prompt list.'),
});

type RedClawImagePackParams = z.infer<typeof RedClawImagePackParamsSchema>;

const RedClawRetrospectiveParamsSchema = z.object({
  projectId: z.string().min(1).describe('RedClaw project id.'),
  metrics: z.object({
    views: z.number().optional(),
    likes: z.number().optional(),
    comments: z.number().optional(),
    collects: z.number().optional(),
    shares: z.number().optional(),
    follows: z.number().optional(),
  }).optional(),
  whatWorked: z.string().optional().describe('What worked well in this run.'),
  whatFailed: z.string().optional().describe('What did not work as expected.'),
  nextHypotheses: z.array(z.string()).optional().describe('Hypotheses for next iteration.'),
  nextActions: z.array(z.string()).optional().describe('Action list for next iteration.'),
});

type RedClawRetrospectiveParams = z.infer<typeof RedClawRetrospectiveParamsSchema>;

const RedClawListProjectsParamsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().describe('How many recent projects to list.'),
});

type RedClawListProjectsParams = z.infer<typeof RedClawListProjectsParamsSchema>;

export class RedClawCreateProjectTool extends DeclarativeTool<typeof RedClawProjectCreateParamsSchema> {
  readonly name = 'redclaw_create_project';
  readonly displayName = 'RedClaw Create Project';
  readonly description =
    'Create a structured RedClaw project for Xiaohongshu creation. Use this before generating copy/images.';
  readonly kind = ToolKind.Other;
  readonly parameterSchema = RedClawProjectCreateParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: RedClawProjectCreateParams): string {
    return `Create RedClaw project for goal: ${params.goal}`;
  }

  async execute(params: RedClawProjectCreateParams): Promise<ToolResult> {
    try {
      const result = await createRedClawProject(params);
      const response = createSuccessResult(
        `Project created: ${result.project.id}\nGoal: ${result.project.goal}\nPath: ${result.projectDir}`,
        `已创建项目 ${result.project.id}`
      );
      response.data = {
        projectId: result.project.id,
        projectDir: result.projectDir,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to create RedClaw project: ${String(error)}`);
    }
  }
}

export class RedClawSaveCopyPackTool extends DeclarativeTool<typeof RedClawCopyPackParamsSchema> {
  readonly name = 'redclaw_save_copy_pack';
  readonly displayName = 'RedClaw Save Copy Pack';
  readonly description =
    'Save Xiaohongshu copy artifacts (titles/content/hashtags/cover texts/publish plan) into project files.';
  readonly kind = ToolKind.Edit;
  readonly parameterSchema = RedClawCopyPackParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: RedClawCopyPackParams): string {
    return `Save copy pack for project: ${params.projectId}`;
  }

  async execute(params: RedClawCopyPackParams): Promise<ToolResult> {
    try {
      const result = await saveRedClawCopyPack(params);
      const response = createSuccessResult(
        `Copy pack saved: ${result.filePath}\nProject: ${result.project.id}\nStatus: ${result.project.status}\nManuscript: manuscripts/${result.manuscriptPath}`,
        `文案包已保存（${result.project.id}）`
      );
      response.data = {
        projectId: result.project.id,
        filePath: result.filePath,
        manuscriptPath: result.manuscriptPath,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to save copy pack: ${String(error)}`);
    }
  }
}

export class RedClawSaveImagePackTool extends DeclarativeTool<typeof RedClawImagePackParamsSchema> {
  readonly name = 'redclaw_save_image_pack';
  readonly displayName = 'RedClaw Save Image Pack';
  readonly description =
    'Save Xiaohongshu image strategy and generation prompts into project files.';
  readonly kind = ToolKind.Edit;
  readonly parameterSchema = RedClawImagePackParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: RedClawImagePackParams): string {
    return `Save image pack for project: ${params.projectId}`;
  }

  async execute(params: RedClawImagePackParams): Promise<ToolResult> {
    try {
      const result = await saveRedClawImagePack(params);
      const response = createSuccessResult(
        `Image pack saved: ${result.filePath}\nProject: ${result.project.id}\nStatus: ${result.project.status}\nPlanned media assets created: ${result.plannedAssetCount}`,
        `配图包已保存（${result.project.id}）`
      );
      response.data = {
        projectId: result.project.id,
        filePath: result.filePath,
        plannedAssetCount: result.plannedAssetCount,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to save image pack: ${String(error)}`);
    }
  }
}

export class RedClawSaveRetrospectiveTool extends DeclarativeTool<typeof RedClawRetrospectiveParamsSchema> {
  readonly name = 'redclaw_save_retrospective';
  readonly displayName = 'RedClaw Save Retrospective';
  readonly description =
    'Save retrospective summary and metrics after publishing, including action items for next iteration.';
  readonly kind = ToolKind.Edit;
  readonly parameterSchema = RedClawRetrospectiveParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: RedClawRetrospectiveParams): string {
    return `Save retrospective for project: ${params.projectId}`;
  }

  async execute(params: RedClawRetrospectiveParams): Promise<ToolResult> {
    try {
      const result = await saveRedClawRetrospective(params);
      const response = createSuccessResult(
        `Retrospective saved: ${result.filePath}\nProject: ${result.project.id}\nStatus: ${result.project.status}`,
        `复盘已保存（${result.project.id}）`
      );
      response.data = {
        projectId: result.project.id,
        filePath: result.filePath,
        project: result.project,
      };
      return response;
    } catch (error) {
      return createErrorResult(`Failed to save retrospective: ${String(error)}`);
    }
  }
}

export class RedClawListProjectsTool extends DeclarativeTool<typeof RedClawListProjectsParamsSchema> {
  readonly name = 'redclaw_list_projects';
  readonly displayName = 'RedClaw List Projects';
  readonly description = 'List recent RedClaw projects and statuses so you can continue an existing creation task.';
  readonly kind = ToolKind.Read;
  readonly parameterSchema = RedClawListProjectsParamsSchema;
  readonly requiresConfirmation = false;

  getDescription(params: RedClawListProjectsParams): string {
    return `List recent RedClaw projects (limit=${params.limit || 20})`;
  }

  async execute(params: RedClawListProjectsParams): Promise<ToolResult> {
    try {
      const projects = await listRedClawProjects(params.limit || 20);
      if (projects.length === 0) {
        return createSuccessResult('No RedClaw projects found.', '暂无项目');
      }

      const lines = projects.map((project) =>
        `- ${project.id} | ${project.status} | ${project.goal} | ${project.updatedAt}`
      );
      return createSuccessResult(
        `Recent RedClaw projects:\n${lines.join('\n')}`,
        `已找到 ${projects.length} 个项目`
      );
    } catch (error) {
      return createErrorResult(`Failed to list RedClaw projects: ${String(error)}`);
    }
  }
}
