# OpenCode「AI 思维链」实现说明（中文版）

> 代码位置：`desktop/opencode-dev/packages/opencode`。以下说明以源码为准，概述工作流里的角色、定义方式、循环机制与结束条件。

## 1. 思维链（Reasoning）是如何产生与提取的

- **模型输出中使用 `<think>...</think>` 作为“思维链”标记**。在流式生成时，`LLM.stream()` 会挂载 `extractReasoningMiddleware({ tagName: "think" })`，将 `<think>` 片段抽取成结构化的 reasoning part。  
  位置：`packages/opencode/src/session/llm.ts`
- 这意味着：
  - 模型若输出 `<think>` 标签内容，会被独立为 “reasoning” 类型 part；
  - 正文内容仍作为最终回答（text part）输出；
  - 前端或上层可以选择是否展示 reasoning。  

## 2. 角色（Agents）有哪些、怎么定义

OpenCode 把 AI 角色抽象为 **Agent**：

- Agent 定义结构：`Agent.Info`（Zod schema）  
  位置：`packages/opencode/src/agent/agent.ts`
- 关键字段：
  - `name`：角色名（如 `plan`, `build`, `general`, `explore`, `compaction`, `summary`, `title`）
  - `mode`：`primary` / `subagent` / `all`
  - `permission`：权限规则（读写、工具调用、外部目录等）
  - `prompt` / `options` / `model` / `steps` 等

### 常见角色（示例）
- **plan**：规划角色，进入 plan 模式后只能编辑计划文件，严格限制写操作
- **build**：执行角色，用于具体实现与改动
- **general**：通用子代理，用于多子任务并行处理
- **explore**：探索子代理，用于 Phase 1 的代码/结构调研
- **title / summary / compaction**：系统用途的内置 agent

定义位置：`packages/opencode/src/agent/agent.ts`

## 3. 在一个工作流中如何“循环执行”

OpenCode 的循环核心在 **Session Processor**，它对一次消息生成进行多阶段流式处理：

- `Session.process()` 会不断处理 LLM 输出的事件流（文本、工具调用、步骤开始/结束等）
- 每个 step 会写入 `step-start` / `step-finish` parts，并更新 token/cost 统计
- 若工具出错或用户拒绝权限，会影响是否终止循环

关键逻辑位置：`packages/opencode/src/session/processor.ts`

## 4. 结束条件与停止判断

在 `processor.ts` 的结尾，返回值用于控制会话流程走向：

- **`return "continue"`**：继续下一轮（可继续对话或执行）
- **`return "stop"`**：停止（权限拒绝、错误、被阻塞等）
- **`return "compact"`**：触发压缩（token 超限）

主要判断逻辑：
- 工具调用拒绝 / 询问被拒绝 -> `blocked = true` -> stop
- assistant message 出错 -> stop
- token 超限 -> compact

位置：`packages/opencode/src/session/processor.ts`

## 5. Plan 工作流中的“角色循环”与阶段推进

Plan 模式由系统提示词控制，分成 5 个阶段：

1. **Phase 1**：使用 `explore` 子代理并行探索代码库
2. **Phase 2**：使用 `plan` agent 生成方案草案
3. **Phase 3**：回顾与校验
4. **Phase 4**：写最终 plan 文件
5. **Phase 5**：调用 `plan_exit` 结束

这些阶段是在 `prompt.ts` 中通过 `<system-reminder>` 注入到用户消息的逻辑进行驱动。  
位置：`packages/opencode/src/session/prompt.ts`

## 6. 子任务与循环调用

- 当用户或系统触发命令 / 子任务时，`prompt.ts` 会构造 `subtask` part，
  由子代理执行后再回到主 agent 流程。
- 这允许“角色循环”：**主 agent → 子 agent → 结果回写 → 主 agent继续**。

相关逻辑：`packages/opencode/src/session/prompt.ts`（subtask 分支）

---

## 总结（简版）

- 思维链通过 `<think>` 标签输出，并在 `LLM.stream` 中被抽取为 reasoning part。
- 角色（Agent）通过 `Agent.Info` 定义，区分 primary / subagent。
- 循环与结束由 `Session Processor` 控制：`continue / stop / compact`。
- Plan 模式工作流由 `prompt.ts` 注入阶段化系统提示词驱动。

如果你希望我补充：
- “思维链如何在 UI 展示/隐藏”的实现路径
- “plan/build/general 的具体调用链”
- 或把这份文档拆成开发者指南 + 架构图

告诉我即可。
