# OpenCode 工具调用流程说明（desktop/opencode-dev）

> 代码位置：`desktop/opencode-dev/packages/opencode`。以下为“工具调用”在 OpenCode 中的主流程与关键节点说明。

## 1. 工具定义与描述（description）

### 工具的定义方式
- 每个工具通过 `Tool.define(id, init)` 定义：
  - `id`: 工具名
  - `init()`: 返回 `{ description, parameters, execute, ... }`
  - `description`: **就是模型看到的工具描述**
  - `parameters`: Zod schema（用于参数校验 & 生成 JSON Schema）

位置：`packages/opencode/src/tool/tool.ts`

### description 的样式特征
- 是 **纯文本说明**，通常描述“做什么 + 关键约束 + 输入期望”。
- 由具体工具在 `init()` 中返回：
  - 例如 `bash` / `read` / `write` / `edit` / `websearch` 等
- 工具注册时会被直接传给模型：
  - `ToolRegistry.tools(...)` -> `tool({ description: item.description, inputSchema: ... })`

位置：
- 工具注册：`packages/opencode/src/tool/registry.ts`
- 工具暴露给模型：`packages/opencode/src/session/prompt.ts`（`resolveTools`）

> 如果任务很长，通常会借助 `task` 工具（子任务），其 `description` 仍是普通文本，但会在工具输入中附带 `prompt/description/subagent_type` 等字段。

## 2. 工具调用的主流程（从模型到执行）

### 步骤 1：工具集合准备
- 根据模型与 agent，`ToolRegistry.tools()` 收集工具：内置 + 插件 + MCP。
- tool 描述 + schema 经过 ProviderTransform 适配后生成可用工具列表。

位置：
- `packages/opencode/src/tool/registry.ts`
- `packages/opencode/src/session/prompt.ts`（`resolveTools`）

### 步骤 2：LLM 流式输出工具调用
- `LLM.stream()` 会把可用工具传给模型（`activeTools`, `tools`）。
- 模型产出 `tool-call` 事件。

位置：`packages/opencode/src/session/llm.ts`

### 步骤 3：SessionProcessor 监听并记录工具调用
- `SessionProcessor.process()` 处理流式事件：
  - `tool-input-start` -> 创建 ToolPart（pending）
  - `tool-call` -> 标记运行中
  - `tool-result` / `tool-error` -> 写入结果或错误
- 内置 **doom loop** 防护：连续重复 3 次相同 tool+input 会触发权限确认。

位置：`packages/opencode/src/session/processor.ts`

### 步骤 4：执行具体工具
- `resolveTools()` 在 `prompt.ts` 中把工具包装成 AI SDK `tool()`。
- 调用链：
  - `tool.execute(args, options)` -> 构造 `Tool.Context` -> `item.execute()`
  - `tool.execute.before` / `tool.execute.after` 插件钩子
  - `PermissionNext.ask()` 根据 agent 权限规则进行确认

位置：`packages/opencode/src/session/prompt.ts`

---

## 3. 复杂任务 / 长流程的循环机制

OpenCode 的“长流程”不是单次工具调用，而是多轮消息循环：

1. **每轮**由 `SessionProcessor.process()` 驱动一次 LLM 生成。
2. 执行工具、返回结果后，继续下一轮。
3. 通过 `Agent.steps` 控制最大循环步数（默认为无限）。
4. Token 超限会触发 `SessionCompaction` 压缩历史。

位置：
- 主循环与 stop/continue：`packages/opencode/src/session/processor.ts`
- 循环入口：`packages/opencode/src/session/prompt.ts`
- Agent steps：`packages/opencode/src/agent/agent.ts`
- 历史压缩：`packages/opencode/src/session/compaction.ts`

### 结束条件（简化）
- **stop**：工具/权限拒绝、助手错误
- **compact**：token 超限
- **continue**：正常完成一轮并进入下一轮

## 4. Task 工具（长任务常用）

- `task` 工具用于“子代理执行子任务”，适合长流程拆分。
- 调用后会创建单独的 assistant message + tool part，并执行子 agent。
- 执行结果会写入 tool part，主流程再继续。

位置：`packages/opencode/src/session/prompt.ts`（task 分支）

---

## 5. 简要时序图（文字版）

1) User message -> `prompt.ts` 选择 agent & 工具  
2) `LLM.stream()` -> 工具调用事件  
3) `SessionProcessor` 记录 tool-call  
4) `resolveTools` 执行工具 -> 输出 tool-result  
5) 保存结果 -> 继续循环 / 或 stop  

---

## 6. 你可以重点关注的源码入口

- 工具定义：`packages/opencode/src/tool/*`
- 工具注册：`packages/opencode/src/tool/registry.ts`
- 执行包装：`packages/opencode/src/session/prompt.ts` -> `resolveTools()`
- 事件处理：`packages/opencode/src/session/processor.ts`
- 流式模型：`packages/opencode/src/session/llm.ts`

---

如需我补充：
- 具体某个工具的 description 示例（比如 bash/read/write）
- MCP 工具如何接入与权限处理
- “tool-output 被截断/压缩”的规则说明

告诉我，我可以继续补一份更细版本。
