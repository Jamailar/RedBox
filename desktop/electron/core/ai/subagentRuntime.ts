import { loadAndRenderPrompt } from '../../prompts/runtime';
import { normalizeApiBaseUrl, safeUrlJoin } from '../urlUtils';
import { getTaskGraphRuntime } from './taskGraphRuntime';
import { getRoleSpec } from './roleRegistry';
import type { IntentRoute, RoleId, RuntimeMode } from './types';

type RuntimeLlmConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
};

type SubagentOutput = {
  roleId: RoleId;
  summary: string;
  artifact?: string;
  handoff?: string;
  risks?: string[];
  raw?: unknown;
};

type SubagentOrchestrationResult = {
  outputs: SubagentOutput[];
  promptSection: string;
};

const ORCHESTRATION_PROMPT_PATH = 'runtime/ai/subagent_orchestrator.txt';

const ROLE_SEQUENCE_BY_INTENT: Record<string, RoleId[]> = {
  manuscript_creation: ['planner', 'researcher', 'copywriter', 'reviewer'],
  advisor_persona: ['planner', 'researcher', 'copywriter', 'reviewer'],
  cover_generation: ['planner', 'researcher', 'image-director', 'reviewer'],
  image_creation: ['planner', 'researcher', 'image-director', 'reviewer'],
  knowledge_retrieval: ['planner', 'researcher', 'reviewer'],
  long_running_task: ['planner', 'ops-coordinator', 'reviewer'],
  automation: ['planner', 'ops-coordinator', 'reviewer'],
};

const DEFAULT_TIMEOUT_MS = 30000;

function parseStructuredContent(raw: string): Record<string, unknown> {
  const text = String(raw || '').trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      summary: text,
    };
  }
}

function sanitizeOutput(roleId: RoleId, parsed: Record<string, unknown>): SubagentOutput {
  const risks = Array.isArray(parsed.risks)
    ? parsed.risks.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    roleId,
    summary: String(parsed.summary || '').trim() || `role=${roleId}`,
    artifact: typeof parsed.artifact === 'string' ? parsed.artifact.trim() : undefined,
    handoff: typeof parsed.handoff === 'string' ? parsed.handoff.trim() : undefined,
    risks,
    raw: parsed,
  };
}

async function callSubagentLlm(input: {
  llm: RuntimeLlmConfig;
  roleId: RoleId;
  route: IntentRoute;
  runtimeMode: RuntimeMode;
  taskId: string;
  userInput: string;
  priorOutputs: SubagentOutput[];
}): Promise<SubagentOutput> {
  const role = getRoleSpec(input.roleId);
  console.log('[SubagentRuntime] start', {
    taskId: input.taskId,
    roleId: input.roleId,
    intent: input.route.intent,
    runtimeMode: input.runtimeMode,
    model: input.llm.model,
  });
  const systemPrompt = loadAndRenderPrompt(ORCHESTRATION_PROMPT_PATH, {
    role_id: role.roleId,
    role_purpose: role.purpose,
    role_directive: role.systemPrompt,
    role_handoff: role.handoffContract,
    role_output_schema: role.outputSchema,
    runtime_mode: input.runtimeMode,
    task_id: input.taskId,
    intent: input.route.intent,
    goal: input.route.goal,
    required_capabilities: input.route.requiredCapabilities.join(', '),
    previous_outputs_json: JSON.stringify(input.priorOutputs, null, 2),
  }, role.systemPrompt);

  const payload = {
    model: input.llm.model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          `用户请求：${input.userInput}`,
          `任务目标：${input.route.goal}`,
          '请输出严格 JSON，字段允许包含 summary / artifact / handoff / risks。',
        ].join('\n'),
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(15000, Number(input.llm.timeoutMs || DEFAULT_TIMEOUT_MS)));
  try {
    const response = await fetch(safeUrlJoin(normalizeApiBaseUrl(input.llm.baseURL), '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.llm.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const rawText = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`subagent ${input.roleId} failed (${response.status}): ${rawText || response.statusText}`);
    }
    const parsedOuter = JSON.parse(rawText) as any;
    const content = String(parsedOuter?.choices?.[0]?.message?.content || '').trim();
    const parsed = parseStructuredContent(content);
    const sanitized = sanitizeOutput(input.roleId, parsed);
    console.log('[SubagentRuntime] completed', {
      taskId: input.taskId,
      roleId: input.roleId,
      summary: sanitized.summary.slice(0, 160),
    });
    return sanitized;
  } finally {
    clearTimeout(timeout);
  }
}

export async function runSubagentOrchestration(input: {
  llm: RuntimeLlmConfig;
  route: IntentRoute;
  runtimeMode: RuntimeMode;
  taskId: string;
  userInput: string;
}): Promise<SubagentOrchestrationResult | null> {
  const roleSequence = ROLE_SEQUENCE_BY_INTENT[input.route.intent] || [];
  if (roleSequence.length === 0) {
    return null;
  }

  const runtime = getTaskGraphRuntime();
  runtime.startNode(input.taskId, 'spawn_agents', roleSequence.join(' -> '));
  const outputs: SubagentOutput[] = [];

  try {
    for (const roleId of roleSequence) {
      runtime.addTrace(input.taskId, 'subagent.start', { roleId, priorOutputs: outputs.length }, 'spawn_agents');
      const output = await callSubagentLlm({
        llm: input.llm,
        roleId,
        route: input.route,
        runtimeMode: input.runtimeMode,
        taskId: input.taskId,
        userInput: input.userInput,
        priorOutputs: outputs,
      });
      outputs.push(output);
      runtime.addCheckpoint(input.taskId, 'spawn_agents', `${roleId}: ${output.summary}`, output);
      runtime.addTrace(input.taskId, 'subagent.completed', {
        roleId,
        summary: output.summary,
        handoff: output.handoff,
        artifact: output.artifact,
      }, 'spawn_agents');
    }

    runtime.completeNode(input.taskId, 'spawn_agents', `subagents=${outputs.map((item) => item.roleId).join(',')}`);
    runtime.startNode(input.taskId, 'handoff', '生成角色交接上下文');
    const promptSection = [
      '## Multi-Agent Orchestration',
      '以下是受控子角色协作产出的结构化结果。主代理必须继承这些结论，不得无故偏离：',
      ...outputs.map((item) => {
        const lines = [
          `### ${item.roleId}`,
          `- summary: ${item.summary}`,
        ];
        if (item.artifact) lines.push(`- artifact: ${item.artifact}`);
        if (item.handoff) lines.push(`- handoff: ${item.handoff}`);
        if (item.risks?.length) lines.push(`- risks: ${item.risks.join('；')}`);
        return lines.join('\n');
      }),
    ].join('\n');
    runtime.completeNode(input.taskId, 'handoff', 'subagent handoff prepared');
    return {
      outputs,
      promptSection,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SubagentRuntime] failed', {
      taskId: input.taskId,
      intent: input.route.intent,
      error: message,
    });
    runtime.addTrace(input.taskId, 'subagent.failed', { error: message }, 'spawn_agents');
    runtime.failTask(input.taskId, message, 'spawn_agents');
    throw error;
  }
}
