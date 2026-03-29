import { assembleRuntimeSystemPrompt } from './contextAssembler';
import { getRoleSpec } from './roleRegistry';
import { runSubagentOrchestration } from './subagentRuntime';
import { getTaskGraphRuntime } from './taskGraphRuntime';
import type {
  IntentRoute,
  PreparedRuntimeExecution,
  RuntimeContext,
  RuntimeMode,
  RoleId,
  ThinkingBudget,
} from './types';

const MULTI_AGENT_TRIGGER_PARTS = [
  '多角色',
  '多智能体',
  '多 agent',
  '多agent',
  'multiagent',
  'multi-agent',
  'subagent',
  '子agent',
  '分角色',
  '协作执行',
  '多人协作',
];

const DANGEROUS_ACTION_PARTS = ['删除', '覆盖', '批量', '清空', '重置'];

const DEFAULT_INTENT_BY_MODE: Record<RuntimeMode, IntentRoute['intent']> = {
  redclaw: 'manuscript_creation',
  knowledge: 'knowledge_retrieval',
  chatroom: 'discussion',
  'advisor-discussion': 'discussion',
  'background-maintenance': 'automation',
};

const DEFAULT_ROLE_BY_MODE: Record<RuntimeMode, RoleId> = {
  redclaw: 'copywriter',
  knowledge: 'researcher',
  chatroom: 'planner',
  'advisor-discussion': 'planner',
  'background-maintenance': 'ops-coordinator',
};

const DEFAULT_CAPABILITIES_BY_MODE: Record<RuntimeMode, string[]> = {
  redclaw: ['planning', 'writing', 'artifact-save'],
  knowledge: ['knowledge-retrieval', 'evidence-synthesis'],
  chatroom: ['multi-agent-discussion'],
  'advisor-discussion': ['multi-agent-discussion'],
  'background-maintenance': ['task-graph', 'background-runner', 'artifact-save'],
};

const containsAny = (text: string, parts: string[]): boolean => parts.some((part) => text.includes(part));

const buildDirectRoute = (context: RuntimeContext): IntentRoute => {
  const normalizedInput = String(context.userInput || '').toLowerCase();
  const runtimeMode = context.runtimeMode;
  const requiresMultiAgent = runtimeMode === 'advisor-discussion' || containsAny(normalizedInput, MULTI_AGENT_TRIGGER_PARTS);
  const requiresLongRunningTask = runtimeMode === 'background-maintenance';
  return {
    intent: DEFAULT_INTENT_BY_MODE[runtimeMode],
    secondaryIntents: [],
    goal: String(context.userInput || '').trim() || '处理当前用户请求',
    deliverables: [],
    requiredCapabilities: DEFAULT_CAPABILITIES_BY_MODE[runtimeMode],
    recommendedRole: DEFAULT_ROLE_BY_MODE[runtimeMode],
    requiresLongRunningTask,
    requiresMultiAgent,
    requiresHumanApproval: containsAny(normalizedInput, DANGEROUS_ACTION_PARTS),
    confidence: 1,
    reasoning: `runtime-mode-default:${runtimeMode}`,
    source: 'rule',
  };
};

const resolveThinkingBudget = (runtimeMode: RuntimeMode, route: IntentRoute): ThinkingBudget => {
  if (route.requiresMultiAgent) return 'medium';
  if (route.requiresLongRunningTask) return 'high';
  if (runtimeMode === 'redclaw') return 'medium';
  if (runtimeMode === 'knowledge') return 'medium';
  if (runtimeMode === 'advisor-discussion') return 'medium';
  return 'low';
};

const shouldRunSubagentOrchestration = (params: {
  runtimeMode: RuntimeMode;
  userInput: string;
  route: IntentRoute;
}): boolean => {
  if (params.runtimeMode === 'advisor-discussion') {
    return true;
  }

  const normalized = String(params.userInput || '').toLowerCase();
  return containsAny(normalized, MULTI_AGENT_TRIGGER_PARTS);
};

export class AgentRuntime {
  async prepareExecution(params: {
    runtimeContext: RuntimeContext;
    baseSystemPrompt: string;
    llm?: {
      apiKey: string;
      baseURL: string;
      model: string;
      timeoutMs?: number;
    };
  }): Promise<PreparedRuntimeExecution> {
    const route = buildDirectRoute(params.runtimeContext);
    const role = getRoleSpec(route.recommendedRole);
    const runtime = getTaskGraphRuntime();
    const task = runtime.createInteractiveTask({
      runtimeMode: params.runtimeContext.runtimeMode,
      ownerSessionId: params.runtimeContext.sessionId,
      userInput: params.runtimeContext.userInput,
      route,
      roleId: role.roleId,
      metadata: params.runtimeContext.metadata,
    });

    runtime.startNode(task.id, 'route', route.reasoning);
    runtime.completeNode(task.id, 'route', route.reasoning);
    runtime.startNode(task.id, 'plan', `role=${role.roleId}`);
    runtime.completeNode(task.id, 'plan', `role=${role.roleId}; confidence=${route.confidence}`);

    let orchestration: PreparedRuntimeExecution['orchestration'] = null;
    let orchestrationSection = '';
    const orchestrationEnabled = shouldRunSubagentOrchestration({
      runtimeMode: params.runtimeContext.runtimeMode,
      userInput: params.runtimeContext.userInput,
      route,
    });
    console.log('[AgentRuntime] prepared-route', {
      sessionId: params.runtimeContext.sessionId,
      runtimeMode: params.runtimeContext.runtimeMode,
      intent: route.intent,
      routeSource: route.source || 'rule',
      roleId: role.roleId,
      requiresMultiAgent: route.requiresMultiAgent,
      orchestrationEnabled,
    });

    if (orchestrationEnabled && params.llm?.apiKey && params.llm?.baseURL && params.llm?.model) {
      try {
        runtime.addTrace(task.id, 'runtime.orchestration_start', {
          intent: route.intent,
          roleId: role.roleId,
        }, 'spawn_agents');
        const orchestrationResult = await runSubagentOrchestration({
          llm: params.llm,
          route,
          runtimeMode: params.runtimeContext.runtimeMode,
          taskId: task.id,
          userInput: params.runtimeContext.userInput,
        });
        if (orchestrationResult) {
          orchestrationSection = orchestrationResult.promptSection;
          orchestration = {
            outputs: orchestrationResult.outputs,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtime.addTrace(task.id, 'runtime.orchestration_failed', { error: message }, 'spawn_agents');
      }
    } else if (task.graph.some((node) => node.type === 'spawn_agents')) {
      runtime.skipNode(
        task.id,
        'spawn_agents',
        orchestrationEnabled
          ? '当前未配置可用的协作 LLM，上游 orchestration 跳过'
          : '当前请求未显式要求多角色协作，默认由主代理直接执行',
      );
      if (task.graph.some((node) => node.type === 'handoff')) {
        runtime.skipNode(
          task.id,
          'handoff',
          orchestrationEnabled ? '未生成子角色 handoff' : '当前请求未启用 subagent handoff',
        );
      }
    }

    if (runtime.getTask(task.id)?.graph.some((node) => node.type === 'execute_tools')) {
      runtime.startNode(task.id, 'execute_tools', '准备执行主代理');
    }

    const systemPrompt = assembleRuntimeSystemPrompt({
      baseSystemPrompt: params.baseSystemPrompt,
      runtimeMode: params.runtimeContext.runtimeMode,
      route,
      role,
      task,
    });

    const systemPromptWithOrchestration = orchestrationSection
      ? `${systemPrompt}\n\n${orchestrationSection}`
      : systemPrompt;
    const thinkingBudget = resolveThinkingBudget(params.runtimeContext.runtimeMode, route);
    runtime.addTrace(task.id, 'runtime.prepared', {
      route,
      roleId: role.roleId,
      thinkingBudget,
      runtimeMode: params.runtimeContext.runtimeMode,
      orchestrationRoles: orchestration?.outputs.map((item) => item.roleId) || [],
    });

    return {
      task,
      route,
      role,
      systemPrompt: systemPromptWithOrchestration,
      thinkingBudget,
      orchestration,
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
