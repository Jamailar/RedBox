import type { AgentTaskSnapshot, IntentRoute, RoleSpec, RuntimeMode } from './types';

export const assembleRuntimeSystemPrompt = (params: {
  baseSystemPrompt: string;
  runtimeMode: RuntimeMode;
  route: IntentRoute;
  role: RoleSpec;
  task: AgentTaskSnapshot;
}): string => {
  const sections = [
    params.baseSystemPrompt.trim(),
    '',
    '## Runtime Execution Context',
    `- runtimeMode: ${params.runtimeMode}`,
    `- taskId: ${params.task.id}`,
    `- taskType: ${params.task.taskType}`,
    `- currentStatus: ${params.task.status}`,
    `- intent: ${params.route.intent}`,
    `- routeSource: ${params.route.source || 'rule'}`,
    `- secondaryIntents: ${params.route.secondaryIntents?.join(', ') || 'none'}`,
    `- goal: ${params.route.goal}`,
    `- deliverables: ${params.route.deliverables?.join(', ') || 'none'}`,
    `- requiredCapabilities: ${params.route.requiredCapabilities.join(', ') || 'none'}`,
    `- requiresLongRunningTask: ${params.route.requiresLongRunningTask ? 'true' : 'false'}`,
    `- requiresMultiAgent: ${params.route.requiresMultiAgent ? 'true' : 'false'}`,
    `- requiresHumanApproval: ${params.route.requiresHumanApproval ? 'true' : 'false'}`,
    '',
    '## Active Role',
    `- roleId: ${params.role.roleId}`,
    `- purpose: ${params.role.purpose}`,
    `- handoff: ${params.role.handoffContract}`,
    `- artifactTypes: ${params.role.artifactTypes.join(', ') || 'none'}`,
    '',
    '## Role Directive',
    params.role.systemPrompt,
    '',
    '## Execution Rules',
    '- 先按当前 runtimeMode 和 role 完成你的职责，不要把所有事情混在一起。',
    '- 如果任务需要长期执行或多角色协作，先产出阶段计划，再推进当前最关键的一步。',
    '- 当工具成功回执不足时，不得宣称任务已完成。',
    '- 如果已经形成可交付产物，必须推动保存并在回复中引用真实工具回执。',
    '- 如果需要把工作交给下一角色，回复中应明确当前产物、缺口和下一步。',
    '',
    '## Task Graph Nodes',
    ...params.task.graph.map((node) => `- ${node.type}: ${node.status}${node.summary ? ` | ${node.summary}` : ''}`),
  ];

  return sections.join('\n');
};
