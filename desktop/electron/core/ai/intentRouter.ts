import type { IntentName, IntentRoute, RoleId, RuntimeContext } from './types';

const containsAny = (text: string, parts: string[]): boolean => parts.some((part) => text.includes(part));

const deriveIntent = (normalized: string, contextType: string): IntentName => {
  if (containsAny(normalized, ['角色生成', 'persona', '人设', '智囊团角色', '角色文档'])) {
    return 'advisor_persona';
  }
  if (containsAny(normalized, ['封面', 'cover'])) {
    return 'cover_generation';
  }
  if (containsAny(normalized, ['配图', '生图', '图片', '海报', '插图'])) {
    return 'image_creation';
  }
  if (containsAny(normalized, ['稿件', '文案', '写一篇', '写篇', '开始创作', '标题包', '正文'])) {
    return 'manuscript_creation';
  }
  if (containsAny(normalized, ['自动化', '定时', '提醒', '后台', '心跳', '轮询', 'schedule', 'runner'])) {
    return 'automation';
  }
  if (containsAny(normalized, ['记忆', 'memory', '总结偏好', '长期偏好'])) {
    return 'memory_maintenance';
  }
  if (containsAny(normalized, ['知识库', '检索', '查资料', '找资料', '研究', '分析素材'])) {
    return 'knowledge_retrieval';
  }
  if (containsAny(normalized, ['讨论', '辩论', '群聊', '六顶思考帽'])) {
    return 'discussion';
  }
  if (containsAny(normalized, ['长时间', '持续', '一直做', '长期推进', '多轮执行'])) {
    return 'long_running_task';
  }
  if (containsAny(normalized, ['保存', '写入文件', '修改文件', '编辑文件', '打开文件'])) {
    return 'file_operation';
  }
  if (contextType === 'redclaw' && normalized.length > 0) {
    return 'manuscript_creation';
  }
  return 'direct_answer';
};

const recommendedRoleForIntent = (intent: IntentName): RoleId => {
  switch (intent) {
    case 'knowledge_retrieval':
    case 'advisor_persona':
      return 'researcher';
    case 'image_creation':
    case 'cover_generation':
      return 'image-director';
    case 'automation':
    case 'long_running_task':
    case 'memory_maintenance':
      return 'ops-coordinator';
    case 'manuscript_creation':
      return 'copywriter';
    case 'discussion':
      return 'planner';
    case 'file_operation':
    case 'direct_answer':
    default:
      return 'planner';
  }
};

export const routeIntent = (context: RuntimeContext): IntentRoute => {
  const input = String(context.userInput || '').trim();
  const normalized = input.toLowerCase();
  const contextType = String((context.metadata?.contextType as string) || '').trim().toLowerCase();
  const intent = deriveIntent(normalized, contextType);
  const recommendedRole = recommendedRoleForIntent(intent);

  const requiresLongRunningTask = intent === 'long_running_task'
    || intent === 'automation'
    || (intent === 'manuscript_creation' && containsAny(normalized, ['完整', '从头到尾', '整套', '规划到发布']));

  const requiresMultiAgent = intent === 'advisor_persona'
    || intent === 'cover_generation'
    || (intent === 'manuscript_creation' && containsAny(normalized, ['调研', '研究', '拆解', '复盘', '策略']));

  const requiresHumanApproval = containsAny(normalized, ['删除', '覆盖', '批量', '清空', '重置']);

  const requiredCapabilities = (() => {
    switch (intent) {
      case 'manuscript_creation':
        return ['planning', 'writing', 'artifact-save'];
      case 'image_creation':
      case 'cover_generation':
        return ['planning', 'image-generation', 'artifact-save'];
      case 'knowledge_retrieval':
      case 'advisor_persona':
        return ['knowledge-retrieval', 'evidence-synthesis'];
      case 'automation':
      case 'long_running_task':
        return ['task-graph', 'background-runner', 'artifact-save'];
      case 'memory_maintenance':
        return ['memory-read', 'memory-write', 'profile-doc'];
      case 'discussion':
        return ['multi-agent-discussion'];
      case 'file_operation':
        return ['file-read-write'];
      default:
        return ['direct-answer'];
    }
  })();

  const goal = input || '处理当前用户请求';
  const confidence = intent === 'direct_answer' ? 0.55 : 0.82;
  const reasoning = `intent=${intent}; contextType=${contextType || 'none'}; role=${recommendedRole}`;

  return {
    intent,
    goal,
    requiredCapabilities,
    recommendedRole,
    requiresLongRunningTask,
    requiresMultiAgent,
    requiresHumanApproval,
    confidence,
    reasoning,
  };
};
