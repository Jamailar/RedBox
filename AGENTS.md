# RedBox / RedConvert Agent Guide

面向 AI coding assistants 和开发者的仓库级开发指南。目标不是重复 README，而是提供“如何在这个仓库里安全、准确、低回归地改代码”的执行规则。

## Scope And Priority

- 本文件作用于仓库根目录默认范围。
- 如果进入某个子目录存在更近的 `AGENTS.md`，以更近的文件为准。
- `LexBox/` 已有自己的 `AGENTS.md`。除非任务明确涉及它，否则不要把 LexBox 的实现假设套到 RedBox 主产品上。

## Environment Baseline

- Node 版本统一按 `>=22 <23` 处理。
- 根目录声明 `pnpm@10`；桌面端和官网子项目都按 `pnpm` 工作流为准。
- 桌面端是主产品，日常改动默认先检查 `desktop/`。
- 打包、签名、远程 Windows 构建都依赖本地/远程环境，不要在未确认前提下随意调整发布脚本。

## Repository Map

### Core product surfaces

- `desktop/`：主桌面应用，Electron + React + TypeScript。绝大多数产品能力都在这里。
- `Plugin/`：Chrome / Edge 扩展，负责从小红书、YouTube、网页把内容送入桌面端。
- `RedBoxweb/`：官网/发布站点，Next.js 站点，包含少量测试。
- `private/scripts/hybrid-release/`：混合发布链路，本地构建 macOS、远程 Linux 构建 Windows、上传 GitHub Release。

### Desktop app ownership

- `desktop/src/`：React renderer。
- `desktop/src/App.tsx`：页面切换与懒加载入口，当前是全局视图编排中心。
- `desktop/src/pages/`：页面级产品表面，如 `Chat`、`Knowledge`、`RedClaw`、`Manuscripts`、`Wander`、`Advisors`、`Settings`。
- `desktop/src/components/`：复用 UI 组件；页面私有编排不要过早下沉到这里。
- `desktop/src/hooks/`：前端行为型复用逻辑，例如刷新策略、功能开关。
- `desktop/src/utils/`：轻量工具与前端辅助逻辑。
- `desktop/electron/preload.ts`：renderer 和 main 之间的桥。新增宿主能力时，优先扩展这里再给前端使用。
- `desktop/electron/main.ts`：Electron 主进程入口，也是当前巨型 IPC 路由层。可以接线，但不要继续把业务逻辑堆进去。
- `desktop/electron/core/`：主进程核心业务层。AI 运行时、工具系统、知识库、任务、MCP、索引、后台任务等都在这里。
- `desktop/electron/prompts/`：提示词加载与运行时组装。
- `desktop/electron/prompts/library/`：实际提示词资产，包含 `intent`、`planner`、`executor`、`validator`、`wander`、`personas`、`templates`。
- `desktop/electron/builtin-skills/`：内置技能资产，按 `SKILL.md` 约定组织。
- `desktop/shared/`：前后端共享类型与静态配置。
- `desktop/scripts/`：构建准备脚本，例如 prompt library 同步、私有运行时准备、插件运行时准备、ffmpeg 准备。
- `desktop/release-notes/`：版本说明素材。

### Generated or packaged outputs

- `desktop/dist/`、`desktop/dist-electron/`、`desktop/release/`：构建产物，禁止手改。
- `desktop/.private-runtime/`、`desktop/.plugin-runtime/`：准备脚本生成/复制的运行时资源，视为构建期产物。
- `desktop/dist-electron/library` 由 `sync:prompt-library` 从 `desktop/electron/prompts/library` 同步生成，不要直接改产物目录。

### Other important files

- `README.md`：对外说明、更新日志入口，发布脚本也会从这里提取 release notes。
- `private/Docs/` 与 `desktop/Docs/`：局部设计说明/接口资料，改动相应领域时应同步。

## Architecture Map

### Renderer -> Host path

- 页面入口：`desktop/src/main.tsx` -> `desktop/src/App.tsx` -> `desktop/src/pages/*`
- 宿主桥：renderer 通过 `window.ipcRenderer` 调用 `desktop/electron/preload.ts`
- 主进程路由：`desktop/electron/main.ts`
- 业务实现：`desktop/electron/core/*`、`desktop/electron/db.ts`、相关 store/service

默认原则：

- renderer 不直接碰 Node / Electron 原语，优先走 preload 暴露的 API。
- 新增能力时，先扩 `preload.ts` 的命名 API，再在页面里消费；不要在页面中散落裸 `invoke/send` 字符串。
- `main.ts` 保持“路由/装配层”角色；真正逻辑尽量下沉到 `core/*` 或独立 service/store。

### AI runtime path

- 旧式入口仍存在：`AgentExecutor`、`ChatService`、`ai:start-chat` 一类链路仍在仓库里。
- 新运行时能力已经扩展到 session/runtime/task/work abstractions：
  - `desktop/electron/core/agentExecutor.ts`
  - `desktop/electron/core/queryRuntime.ts`
  - `desktop/electron/core/sessionRuntimeStore.ts`
  - `desktop/electron/core/ai/*`
  - `desktop/electron/core/toolRegistry.ts`
  - `desktop/electron/core/tools/*`
  - `desktop/electron/core/mcpRuntime.ts`
- 技能、提示词、工具是 AI 编排主边界。做能力分流时优先改这些边界，而不是在用户消息文本上硬写关键词判断。

### Data and content flow

- 插件采集：`Plugin/` -> 本地 HTTP / IPC 接入桌面端 -> 知识库/索引
- 知识库：`knowledge:*` IPC + `documentKnowledgeStore` / 向量索引 / embedding 服务
- 稿件/媒体：`manuscripts:*`、`media:*`、`cover:*` 相关 store 与共享文件格式
- RedClaw：项目、自动化执行、定时任务、长周期任务、创作者画像等能力由 `redclaw:*` 和相关 core/store 管理
- 后台与计划任务：`backgroundCron.ts`、background task / worker / daemon 相关模块

## Build, Run, And Verification

### Root

- 根目录只有最小 Node 元数据，不是完整 monorepo orchestrator。
- 大多数命令都要进入对应子项目执行。

### Desktop

在 `desktop/` 下：

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm preview`
- `pnpm prepare:private-runtime`
- `pnpm prepare:plugin-runtime`
- `pnpm prepare:ffmpeg`
- `pnpm sync:prompt-library`

说明：

- `pnpm dev` 在启动 Vite 前会准备私有运行时、插件运行时，并同步 prompt library。
- `pnpm build` 会做完整准备、TypeScript 编译、Vite 构建、prompt 同步和 `electron-builder` 打包。
- 改动 `desktop/electron/prompts/library/**` 后，至少执行一次 `pnpm sync:prompt-library` 或完整构建流程。

### Website

在 `RedBoxweb/` 下：

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm test`
- `pnpm sync:release`

### Browser extension

- `Plugin/` 是直接加载的扩展目录，不是独立打包工程。
- 改动后应在 Chrome / Edge 扩展管理页重新加载验证。
- 扩展依赖桌面端本地接口 `http://127.0.0.1:23456`；如果采集链路失效，优先先查桌面端是否已启动、桥接端口是否还在。

### Suggested verification matrix

- 改 renderer 页面：至少打开对应页面并验证切换、已有数据保留、刷新态。
- 改 preload / IPC / main-process：至少验证一次真实 renderer 调用，不要只看类型通过。
- 改 AI runtime / tool / prompt：至少跑一轮真实对话或任务，检查事件流、工具调用、权限确认和最终摘要。
- 改 `Plugin/`：验证 popup、background、页面注入或右键入口的真实浏览器行为。
- 改 `RedBoxweb/`：运行 `pnpm test` 和一次 `pnpm build`。

## Coding Conventions

- TypeScript / TSX 保持现有文件风格；仓库内存在新旧代码混合，不要顺手重排无关内容。
- 优先单引号、保留分号、遵循现有缩进与命名风格。
- React 页面组件使用 `PascalCase` 文件名，页面级逻辑留在 `desktop/src/pages/`，共用模式再提取。
- Tailwind 优先复用现有 utility pattern，不要无必要引入局部 CSS 体系。
- 新 IPC channel 命名保持现有域分组，例如 `chat:*`、`runtime:*`、`knowledge:*`、`redclaw:*`、`subjects:*`、`media:*`。

## AI System Rules

这是一个 AI 系统。AI 交互、编排与工具链改动，遵守以下优先级：

1. skills、prompts、角色配置定义能力边界和决策原则
2. structured metadata / typed payload / explicit runtime mode 承载路由意图
3. tool/runtime 层负责输入校验、安全边界和执行约束

因此：

- 避免通过用户消息里的硬编码关键词/文本片段判断意图，除非没有更结构化的承载方式。
- 如必须加约束，优先使用 typed state、schema、tool contract、role spec、runtime mode。
- 文本启发式只能是最后手段，而且必须窄、显式、可移除。

## UX State Rule

- 已有用户可见数据，不能因为开始刷新就被阻塞式 loading 页面替换。
- 默认使用 stale-while-revalidate：
  - 先渲染缓存/已有数据
  - 后台刷新
  - 只在局部展示刷新状态
- 全页或全面板 loading 只允许用于真正的首次空状态。
- 刷新失败必须保留最后一次成功数据，并以内联错误提示代替清空页面。
- 登录、会话恢复、workspace bootstrap 也遵守同样规则。
- 常规操作优先图标化；不要给语义已经足够清晰的控件再堆说明文字。

## Store Lock Rule

- 全局状态锁必须保持窄范围、仅内存。
- 不要在持锁期间做文件 I/O、目录扫描、workspace hydration、序列化、索引构建或其他慢操作。
- 固定模式：
  - 持锁读取最小快照
  - 释放锁
  - 在锁外完成文件/工作区操作
  - 重新持锁只应用最终内存变更
- 页面激活、聊天响应后维护、workspace 启动、列表加载都默认遵守此规则。

## Common Change Playbooks

### Add or change a page

- 入口通常在 `desktop/src/App.tsx`。
- 先确认现有页面缓存/挂载策略，不要破坏当前按最近访问保留视图的行为。
- 页面切换期间保留已有状态，避免把切页实现成“每次重新冷启动”。

### Add or change an IPC capability

- 先在 `desktop/electron/preload.ts` 扩展桥接 API。
- 再在 `desktop/electron/main.ts` 接上 `ipcMain.handle` / `ipcMain.on`。
- 业务逻辑放进 `desktop/electron/core/*` 或独立 store/service，不要把 `main.ts` 继续做大。
- 如果能力跨多个页面复用，优先暴露结构化 helper，而不是让每个页面自己拼 channel 名。

### Add or change an AI tool

- 工具定义在 `desktop/electron/core/tools/*`。
- 需要在 `desktop/electron/core/tools/index.ts` / `catalog.ts` 注册，确认：
  - 所属 tool pack
  - 可见性 `public/developer/internal`
  - 是否需要上下文依赖
  - 是否需要确认执行
  - 成功/失败信号与产出类型
- 修改工具后，至少验证一次真实运行时调用，而不是只看 schema 编译通过。

### Add or change a prompt or skill

- Prompts 在 `desktop/electron/prompts/library/**`。
- 内置技能在 `desktop/electron/builtin-skills/**/SKILL.md`。
- 改 prompt 后同步 `dist-electron/library`，否则打包运行时可能仍用旧版本。
- 修改 skill/prompt 时，优先调系统边界，不要在宿主代码里复制一份“等效规则”。

### Add or change workspace/file behavior

- 文件系统与工作区装载逻辑应落在专门的 store/service，不要在 renderer 页面直接扫描磁盘。
- 变更稿件、媒体、知识库、归档、主题库时，要验证：
  - 当前空间下立即可见
  - 重启/重载后可恢复
  - 刷新失败时不清空旧数据

### Add or change scheduling/background behavior

- RedClaw 定时、长周期、后台任务和 daemon 都要注意“本地时区”和“进程存活策略”。
- `desktop/electron/core/backgroundCron.ts` 目前只支持有限 cron 子集；不要悄悄扩展 UI/配置而不更新计算逻辑。
- 涉及后台持续运行时，检查无窗口状态、取消逻辑、下次执行时间、失败后的可恢复性。

### Add or change browser extension behavior

- `Plugin/background.js`、`pageObserver.js`、`popup.js` 分别承担后台、页面观察和交互入口。
- 插件只负责采集，不承载桌面端复杂 AI 工作流。
- 不要把知识整理、长链路 AI 决策塞回插件侧。

### Add or change website behavior

- `RedBoxweb/` 是独立 Next.js 子项目，有自己的依赖树和测试。
- 不要把桌面端约束直接拷贝到官网实现里，除非确实共享产品语义。

## Release And Packaging Notes

- 桌面端打包由 `desktop/package.json` 的 `electron-builder` 配置驱动。
- 发布链路在 `private/scripts/hybrid-release/`：
  - 远程 Linux 构建 Windows 包
  - 本地 macOS 构建/签名/可选 notarize
  - 上传到 `Jamailar/RedBox` release
- release notes 默认从 `README.md` 的更新日志提取，缺失时才回退最近提交摘要。
- 改动版本、产物命名、签名、notarize、发布仓库或脚本参数前，必须通读 `private/scripts/hybrid-release/README.md`。

## Security And Configuration

- API key、endpoint、模型配置由用户在设置中填写；禁止硬编码密钥。
- 新文件系统能力必须验证路径边界，尤其是 workspace、media、cover、knowledge 导入、插件导入等链路。
- MCP 相关能力通过 `mcpStore.ts` / `mcpRuntime.ts` 管理；不要在其他模块私自起一个不受控的 stdio 客户端。
- Shell/编辑类工具必须维持工作区边界、确认机制和错误类型，不要绕过现有 tool registry 约束。

## Known Pitfalls

- `desktop/electron/main.ts` 已经很大。除纯路由接线外，新增逻辑优先抽到 `core/*`。
- prompt library 是打包时复制的；只改源目录不做同步，运行时可能读到旧内容。
- 插件依赖桌面端本地接入层；插件“坏了”不一定是插件本身，也可能是桌面端服务未起。
- 旧聊天链路和新 runtime/session/task 链路并存。改 AI 功能前先确认你动的是哪条链，不要只修一半。
- 调度逻辑使用本地时间；涉及 daily/weekly/cron 语义时，不要无视时区与 DST 行为。
- 不要把用户可见页面在刷新时清空成 loading 态。
- 不要在持锁范围内做慢 I/O。

## Documentation Expectations

- 新增或重构重要 IPC/bridge 能力时，更新相应 README / Docs，避免知识只留在 `main.ts` 里。
- 新增重要提示词、技能、运行时模式、工具包时，应在附近补足最小文档，让后续维护者知道入口和职责。
- 如果某次 bug 修复沉淀出新的工程约束，优先把规则加到这里，写得窄、明确、可执行。
