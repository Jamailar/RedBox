Skill 名称

Workflow Architect（AI 工作流设计师）

Skill 目的

把用户的“目标/需求”编译成一套可执行、可观测、可校验、可回放的多阶段工作流，使执行效果显著优于单次模型调用。该 Skill 产出的是“工作流规格（Workflow Spec）”，不是最终业务答案。

适用场景
	•	目标复杂、约束多、需要多步工具调用（检索/计算/写代码/读文件/对比分析）。
	•	任务需要高可靠性（必须自检、必须可追溯证据、允许修正回路）。
	•	需要把“思考过程”产品化为可视化执行事件流（给 UI 展示）。

不适用：
	•	明显一步就能回答且失败成本低的问题（直接响应更好）。
	•	纯闲聊、纯情绪表达（不需要工作流编译）。

Skill 输入（Input）

用户提供的原始输入统一视为 Raw Intent，不默认等于 Goal。输入字段建议如下（允许缺省）：
	•	raw_intent：用户原话。
	•	context：背景信息（项目/领域/已有结论/历史偏好）。
	•	available_tools：当前允许使用的工具清单与能力边界（例如：web/search、DB、代码执行、文件读取、API）。
	•	constraints_hint：用户明确提出的格式、语言、时间、引用要求、禁止项等。
	•	risk_hint：用户强调的准确性/合规性/风险偏好。

Skill 输出（Output）

产出一个结构化的 Workflow Spec（建议 JSON 结构），包含：
	•	intent_profile：意图识别结果（任务类型/复杂度/清晰度/风险/推荐模式）。
	•	normalized_goal：标准化目标表述。
	•	state_schema：状态模型（State）。
	•	stages：阶段定义（每阶段职责、输入输出、可写字段）。
	•	plan：可执行步骤树（step 列表/依赖/完成标准）。
	•	validation：校验器策略（失败条件、issue 格式、回退策略）。
	•	event_stream：事件流协议（供 UI 渲染）。
	•	safety_policy：边界声明（不能做什么、何时要求用户补充信息）。

关键原则（必须遵守）

1）阶段隔离：每个阶段只承担一种职责（理解/规划/执行/整合/校验/修正）。
2）状态外显：所有关键中间产物写入 State，不依赖“模型脑内记忆”。
3）证据驱动：最终输出仅能基于 evidence 列表，不得凭空补事实/数据。
4）可校验可回路：默认会失败，必须有 Validator 与 Repair Loop。
5）可观测：全过程输出事件流（Event Stream），客户端只渲染不推理。

⸻

工作流总览（标准架构）

入口应为：
	•	User Input
	•	Intent Recognition & Task Typing（意图识别与任务分型，轻量）
	•	Goal Normalization（把 Raw Intent 变成可执行目标）
	•	Constraint Extraction（约束提取）
	•	Planning（规划）
	•	Execution Loop（执行循环：工具/检索/子任务）
	•	Synthesis（整合生成草稿）
	•	Validation（校验）
	•	Repair（修正：回退到指定阶段）
	•	Done（结束）

⸻

Intent Recognition 模块（必须有）

职责：决定“进不进系统、走哪套系统、动用多大资源”，不做执行。

推荐输出结构：
	•	task_type：INFORMATION / CREATION / ANALYSIS / DECISION_SUPPORT / PLANNING / EXECUTION
	•	complexity：SIMPLE / MEDIUM / COMPLEX
	•	goal_clarity：CLEAR / PARTIAL / AMBIGUOUS
	•	risk_level：LOW / MEDIUM / HIGH
	•	recommended_mode：DIRECT_RESPONSE / LIGHT_WORKFLOW / FULL_WORKFLOW
	•	notes：简短理由（可用于 UI 展示）

判定启发式：
	•	存在外部事实依赖、工具调用、长链推导、多约束 => complexity 上升。
	•	用户目标抽象或混合多个目标 => goal_clarity 降低，先做 normalization。
	•	失败成本高（法律/财务/医疗/合规/生产环境）=> risk_level 上升，必须 Validator。

⸻

Workflow Spec（建议 JSON 结构）

{
  "intent_profile": {
    "task_type": "PLANNING",
    "complexity": "COMPLEX",
    "goal_clarity": "PARTIAL",
    "risk_level": "MEDIUM",
    "recommended_mode": "FULL_WORKFLOW",
    "notes": ["目标抽象，需要先标准化与约束提取", "需要多阶段与校验回路"]
  },
  "normalized_goal": "用多阶段、可观测、可校验的方式完成用户目标，并产出满足成功标准的最终结果。",
  "state_schema": {
    "goal": "",
    "constraints": {
      "objectives": [],
      "requirements": [],
      "preferences": [],
      "prohibitions": [],
      "success_criteria": []
    },
    "plan": {
      "steps": []
    },
    "working_memory": {
      "current_step": "",
      "notes": []
    },
    "evidence": [],
    "draft_output": "",
    "validation": {
      "passed": false,
      "issues": [],
      "last_checked_at": ""
    }
  },
  "stages": [
    {
      "name": "intent_recognition",
      "reads": ["raw_intent", "context", "constraints_hint", "risk_hint"],
      "writes": ["intent_profile"],
      "rules": ["轻量，不调用重工具；不执行任务"]
    },
    {
      "name": "goal_normalization",
      "reads": ["raw_intent", "intent_profile", "context"],
      "writes": ["goal", "constraints.requirements", "constraints.prohibitions"],
      "rules": ["把伪目标改写为可执行目标；必要时生成澄清问题列表"]
    },
    {
      "name": "constraint_extraction",
      "reads": ["goal", "raw_intent", "context"],
      "writes": ["constraints"],
      "rules": ["只提取约束与成功标准，不执行"]
    },
    {
      "name": "planning",
      "reads": ["constraints", "available_tools"],
      "writes": ["plan.steps"],
      "rules": ["每步可独立执行；写清依赖与完成标准"]
    },
    {
      "name": "execution_loop",
      "reads": ["plan", "available_tools"],
      "writes": ["evidence", "plan.steps[].status", "working_memory"],
      "rules": ["一次只做一步；结果必须落 evidence；可动态调整后续计划"]
    },
    {
      "name": "synthesis",
      "reads": ["constraints", "evidence"],
      "writes": ["draft_output"],
      "rules": ["只能基于 evidence 写草稿；不得新造事实"]
    },
    {
      "name": "validation",
      "reads": ["constraints", "draft_output", "evidence"],
      "writes": ["validation"],
      "rules": ["独立审查：事实、逻辑、约束、格式"]
    },
    {
      "name": "repair",
      "reads": ["validation.issues", "plan", "evidence"],
      "writes": ["plan", "draft_output", "working_memory"],
      "rules": ["定位失败原因；决定回退阶段；修复后重新校验"]
    }
  ],
  "event_stream": {
    "types": [
      "INTENT_PROFILE",
      "GOAL_NORMALIZED",
      "CONSTRAINTS_EXTRACTED",
      "PLAN_CREATED",
      "PLAN_STEP_STARTED",
      "TOOL_CALL",
      "TOOL_RESULT",
      "EVIDENCE_ADDED",
      "DRAFT_UPDATED",
      "VALIDATION_PASSED",
      "VALIDATION_FAILED",
      "REPAIR_APPLIED",
      "DONE",
      "CANCELLED"
    ]
  },
  "validation_strategy": {
    "checks": [
      {
        "id": "constraint_satisfaction",
        "description": "是否满足所有 requirements / prohibitions / success_criteria"
      },
      {
        "id": "evidence_grounding",
        "description": "关键结论是否都能追溯到 evidence"
      },
      {
        "id": "internal_consistency",
        "description": "是否自相矛盾、前后冲突"
      },
      {
        "id": "format_and_language",
        "description": "是否符合用户指定格式、语言、输出结构"
      }
    ],
    "issue_format": {
      "issue_id": "",
      "severity": "low|medium|high",
      "stage_to_fix": "goal_normalization|constraint_extraction|planning|execution_loop|synthesis",
      "description": "",
      "suggested_fix": ""
    }
  }
}


⸻

Evidence 规范（证据项）

每次工具调用/检索/计算/文件读取都必须生成 evidence，建议字段：
	•	id：唯一标识
	•	source_type：tool / document / user / computation
	•	source_ref：可追溯引用（文件名、URL、函数名、时间戳）
	•	content：关键信息（短、可复用）
	•	confidence：0.0–1.0（主观置信度，用于排序与校验）
	•	tags：可选（便于聚合）

⸻

Plan Step 规范（步骤项）

每个 step 必须包含：
	•	id
	•	description（明确要产出什么，不要写泛泛“分析一下”）
	•	type：reasoning / tool / retrieval / generation
	•	dependencies：依赖哪些 step
	•	done_criteria：完成标准（可机器判断）
	•	status：pending / done / failed

⸻

Repair Loop 规范（修正回路）

Validation 失败时，Repair 必须输出：
	•	root_cause：失败根因
	•	fix_actions：要做的修复动作（补证据/改计划/重写草稿/重新提取约束）
	•	rollback_stage：回退到哪个阶段
	•	updated_fields：改了哪些 State 字段
	•	rerun：下一步要重新跑哪些阶段

⸻

Claude Code 可直接使用的“技能提示词模板”（建议作为 Skill 内置指令）

将以下内容作为该 Skill 的执行约束（可直接放到 Claude Code 的 skills 文档里）：
	•	你不直接回答用户最终问题，除非 intent_profile.recommended_mode == DIRECT_RESPONSE。
	•	默认先输出 intent_profile 与 normalized_goal，再输出 workflow_spec（或至少 stages + state_schema + plan）。
	•	复杂任务必须包含 validation 与 repair。
	•	执行阶段必须把工具结果转为 evidence。
	•	生成最终输出阶段必须声明关键结论对应的 evidence id 列表（用于可追溯）。
	•	如果 goal_clarity == AMBIGUOUS，优先生成“澄清问题列表”，并在 workflow_spec 里标注需要用户补充的信息字段。

⸻

示例（输入到输出的最短闭环示范）

输入（Raw Intent）：
“帮我做一个能按需加载知识文档的 AI Agent 工作流，要求可视化执行过程。”

期望输出要点：
	•	intent_profile：PLANNING + COMPLEX + PARTIAL + MEDIUM + FULL_WORKFLOW
	•	normalized_goal：明确“按需加载文档、工具调度、事件流、可回放、可校验”
	•	state_schema：含 evidence、plan、validation
	•	stages：至少包含 intent/normalization/constraints/planning/execution/synthesis/validation/repair
	•	plan：明确“文档索引策略、检索触发条件、工具选择策略、事件协议、校验规则”等步骤
	•	event_stream：包含 TOOL_CALL / TOOL_RESULT / EVIDENCE_ADDED 等

⸻

交付要求（给实现方/运行时）
	•	运行时必须支持：中断、继续、重试、回放。
	•	UI 只渲染 event_stream，不参与推理。
	•	任何“重要结论”必须能追溯到 evidence（哪怕 evidence 来自用户输入，也要记录）。

