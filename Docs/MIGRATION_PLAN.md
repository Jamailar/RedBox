# 迁移计划：用 OpenCode 重构 RedConvert AI 核心

## 1. 目标与愿景
**目标**：彻底移除 LangChain 依赖，将 `desktop/opencode-dev` 的核心代码集成到 `RedConvert` 的 Electron 主进程中，作为唯一的 AI 驱动引擎。
**愿景**：构建一个轻量、透明、完全可控的 Agent 系统，解决工具调用死循环、Schema 不匹配和流式输出不可控的问题。

## 2. 核心架构变更

| 模块 | 当前状态 (LangChain) | 目标状态 (OpenCode Engine) | 优势 |
| :--- | :--- | :--- | :--- |
| **Agent 核心** | `AgentExecutor` / `ChatOpenAI` | `OpenCode Agent` 类 (自定义循环) | 逻辑透明，无黑盒 |
| **工具定义** | `StructuredTool` / Zod 转换 | `Tool.define` (原生 OpenCode 风格) | 零转换损耗，精准 Schema |
| **工具调用** | `bindTools` (自动但不可控) | `Manual Function Calling` (手动构建) | 彻底解决参数为空/幻觉问题 |
| **交互层** | CLI / Console 日志 | `Host` 接口适配器 (IPC Bridge) | 完美支持 Electron 前端交互 |

## 3. 实施步骤

### 第一阶段：环境准备与代码搬运 (Phase 1: Setup)
- [ ] **1.1 分析 OpenCode 结构**
    - 扫描 `desktop/opencode-dev`，识别核心类：`Agent`, `Context`, `Host`, `Tool`。
    - 确定依赖项（确保没有 Electron 不支持的 native 模块）。
- [ ] **1.2 建立核心目录**
    - 在 `desktop/electron/core` 下创建 `engine/` 目录。
    - 将 `opencode-dev` 的核心逻辑代码复制/移动到 `engine/` 中。
- [ ] **1.3 清理依赖**
    - 检查 `package.json`，确保 OpenCode 需要的依赖（如 `tiktoken` 等）已安装。

### 第二阶段：适配器层开发 (Phase 2: Adapter Implementation)
*这是最关键的一步。OpenCode 通常是为 CLI 设计的，我们需要把它“骗”进 Electron 里。*

- [ ] **2.1 实现 `RedConvertHost`**
    - 继承 OpenCode 的 `Host` 接口。
    - **重写输出**：将 `log`, `info`, `error` 重定向到 Electron 的日志系统。
    - **重写交互**：将 `askUser` (确认/输入) 重定向到 IPC 通道，发送给 React 前端，并 `await` 前端的响应。
- [ ] **2.2 改造 `ChatService`**
    - 废弃 `ChatService` 中的 LangChain 代码。
    - 实例化 OpenCode `Agent`，传入 `RedConvertHost`。
    - 实现 `sendMessage` 方法，将其转发给 Agent 的 `run` 或 `chat` 方法。

### 第三阶段：工具系统迁移 (Phase 3: Tool Migration)
- [ ] **3.1 工具接口标准化**
    - 确保 `desktop/electron/core/tool/*.ts` 中的工具定义完全符合 OpenCode 的 `Tool.define` 标准（目前已经很接近，可能需要微调类型定义）。
- [ ] **3.2 注册中心重构**
    - 更新 `ToolRegistry`，使其直接管理 OpenCode 的 Tool 对象，移除 `toLangChain()` 等兼容代码。
- [ ] **3.3 迁移核心工具**
    - 确保 `web_search`, `read_file`, `explore_workspace` 等核心工具在各架构下正常工作。

### 第四阶段：UI/IPC 桥接 (Phase 4: Bridging)
- [ ] **4.1 流式输出适配**
    - 监听 OpenCode Agent 的 Token 事件。
    - 通过 `chat:stream` IPC 通道将 Token 实时推送到前端。
- [ ] **4.2 工具状态同步**
    - 当 Agent 处于“思考中”、“调用工具中”、“等待确认中”时，发送状态事件给前端，让 UI 显示对应的 Loading/Card 状态。
- [ ] **4.3 前端交互适配**
    - 确保前端的“批准/拒绝”按钮能正确通过 IPC 解除主进程 `await` 的阻塞状态。

### 第五阶段：清理与验证 (Phase 5: Cleanup)
- [ ] **5.1 移除 LangChain**
    - 卸载 `@langchain/openai`, `@langchain/core` 等依赖。
    - 删除所有兼容层代码。
- [ ] **5.2 全链路测试**
    - 测试长对话上下文记忆。
    - 测试工具调用的死循环保护。
    - 测试中断与恢复（Human-in-the-loop）。

## 4. 风险控制
- **风险**：OpenCode 可能依赖 CLI 独有的 `inquirer` 或 `tty`。
- **对策**：在 `RedConvertHost` 中彻底 Mock 掉这些交互，转为异步的 IPC 通信。

## 5. 立即执行动作
我们将从 **Phase 1** 开始，首先分析 `desktop/opencode-dev` 的代码结构。
