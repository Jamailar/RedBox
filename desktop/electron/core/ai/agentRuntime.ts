import { assembleRuntimeSystemPrompt } from './contextAssembler';
import { routeIntent } from './intentRouter';
import { getRoleSpec } from './roleRegistry';
import { getTaskGraphRuntime } from './taskGraphRuntime';
import type {
  PreparedRuntimeExecution,
  RuntimeContext,
  RuntimeMode,
  ThinkingBudget,
} from './types';

const resolveThinkingBudget = (runtimeMode: RuntimeMode, route: ReturnType<typeof routeIntent>): ThinkingBudget => {
  if (route.requiresMultiAgent) return 'medium';
  if (route.requiresLongRunningTask) return 'high';
  if (runtimeMode === 'redclaw' && route.intent === 'manuscript_creation') return 'medium';
  if (route.intent === 'direct_answer') return 'minimal';
  return 'low';
};

export class AgentRuntime {
  prepareExecution(params: {
    runtimeContext: RuntimeContext;
    baseSystemPrompt: string;
  }): PreparedRuntimeExecution {
    const route = routeIntent(params.runtimeContext);
    const role = getRoleSpec(route.recommendedRole);
    const task = getTaskGraphRuntime().createInteractiveTask({
      runtimeMode: params.runtimeContext.runtimeMode,
      ownerSessionId: params.runtimeContext.sessionId,
      userInput: params.runtimeContext.userInput,
      route,
      roleId: role.roleId,
      metadata: params.runtimeContext.metadata,
    });

    getTaskGraphRuntime().startNode(task.id, 'route', route.reasoning);
    getTaskGraphRuntime().completeNode(task.id, 'route', route.reasoning);
    getTaskGraphRuntime().startNode(task.id, 'plan', `role=${role.roleId}`);
    getTaskGraphRuntime().completeNode(task.id, 'plan', `role=${role.roleId}; confidence=${route.confidence}`);
    if (task.graph.some((node) => node.type === 'execute_tools')) {
      getTaskGraphRuntime().startNode(task.id, 'execute_tools', '准备执行主代理');
    }

    const systemPrompt = assembleRuntimeSystemPrompt({
      baseSystemPrompt: params.baseSystemPrompt,
      runtimeMode: params.runtimeContext.runtimeMode,
      route,
      role,
      task,
    });

    const thinkingBudget = resolveThinkingBudget(params.runtimeContext.runtimeMode, route);
    getTaskGraphRuntime().addTrace(task.id, 'runtime.prepared', {
      route,
      roleId: role.roleId,
      thinkingBudget,
      runtimeMode: params.runtimeContext.runtimeMode,
    });

    return {
      task,
      route,
      role,
      systemPrompt,
      thinkingBudget,
    };
  }

  completeExecution(taskId: string, payload?: unknown) {
    const runtime = getTaskGraphRuntime();
    runtime.completeNode(taskId, 'execute_tools', '主代理执行完成');
    if (runtime.getTask(taskId)?.graph.some((node) => node.type === 'review')) {
      runtime.startNode(taskId, 'review', '检查执行结果');
      runtime.completeNode(taskId, 'review', '执行结果已写入 trace');
    }
    if (runtime.getTask(taskId)?.graph.some((node) => node.type === 'save_artifact')) {
      const hasArtifacts = (runtime.getTask(taskId)?.artifacts.length || 0) > 0;
      if (hasArtifacts) {
        runtime.completeNode(taskId, 'save_artifact', '检测到已保存产物');
      } else {
        runtime.skipNode(taskId, 'save_artifact', '本次执行未检测到结构化产物');
      }
    }
    runtime.completeTask(taskId, typeof payload === 'string' ? payload : '执行完成');
  }

  failExecution(taskId: string, error: string) {
    getTaskGraphRuntime().failTask(taskId, error, 'execute_tools');
  }
}

let agentRuntime: AgentRuntime | null = null;

export const getAgentRuntime = (): AgentRuntime => {
  if (!agentRuntime) {
    agentRuntime = new AgentRuntime();
  }
  return agentRuntime;
};
