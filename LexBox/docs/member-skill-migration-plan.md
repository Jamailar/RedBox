# 成员技能化与知识检索迁移计划

更新时间：2026-04-18

## 1. 文档目标

本文定义 LexBox 当前 `advisor + knowledge + skills + runtime + tools` 体系向“成员技能化系统”迁移的完整计划。

目标不是一次性推翻现有实现，而是在现有骨架上逐步升级为：

- 每个成员都可被蒸馏为一个可落盘、可版本化的 `Member Skill Package`
- 每个成员都能基于自己的知识库进行语言感知检索
- 每个成员不仅能发言，还能在明确边界内调用工具执行动作
- 每一阶段上线后都具备明确的性能收益、验收标准、风险边界和回滚路径

本文是执行计划，不是概念说明。默认按“逐步迁移、逐步调试、逐步扩大灰度”执行。

## 2. 当前系统基础

当前仓库已经具备迁移所需的关键基础设施：

- 技能运行时已经是一等对象，而非静态 prompt 片段：`docs/skill-runtime-v2.md`
- 知识库写入已是 workspace-first：`src-tauri/src/knowledge.rs`
- advisor 已有 `personality / system_prompt / knowledge_language / knowledge_files` 数据结构：`src-tauri/src/commands/advisor_ops.rs`
- runtime 上下文已改为 section-based context bundle：`docs/runtime-context-bundle.md`
- 技能可影响工具可见性与运行时 capability set：`src-tauri/src/skills/runtime.rs`、`src-tauri/src/skills/permissions.rs`
- 工具调用已有 guardrails 与 audit：`docs/runtime-capability-guardrails.md`

当前缺失的系统层能力主要有：

- 自动语言识别尚未成为知识库 ingest 的统一元数据层
- advisor 的 persona 仍偏向“单段 prompt 产物”，不是“可编译技能包”
- 成员知识检索缺少语言感知与成员作用域路由
- 成员工具权限仍主要依附 runtimeMode/tool pack，而非成员本体
- 缺少“新知识 -> 蒸馏候选 -> 成员技能版本升级”的闭环

## 3. 最终目标架构

迁移完成后，每个成员应具备以下统一结构：

```text
Member Skill Package
├── SKILL.md
├── member.json
├── persona.json
├── heuristics.jsonl
├── workflow.json
├── retrieval_scope.json
├── tool_policy.json
├── references/
├── examples/
└── scripts/
```

其中：

- `SKILL.md`
  - 运行时入口
  - 仅保留 Identity、核心规则、沟通风格、决策风格、工具摘要、检索说明
- `member.json`
  - 成员基础元数据、版本、来源、更新时间
- `persona.json`
  - 风格参数、态度张力、解释倾向、回答密度
- `heuristics.jsonl`
  - 决策启发式、问题拆解模式、判断顺序、反模式
- `workflow.json`
  - SOP、步骤图、常见任务的稳定执行路径
- `retrieval_scope.json`
  - 检索域、语言优先级、成员/项目/团队作用域过滤规则
- `tool_policy.json`
  - 允许工具、禁用工具、审批等级、工具优先顺序

## 4. 总体迁移原则

### 4.1 基本原则

- 先兼容旧 `advisor` 体系，再逐步内化成 `member package`
- 先做“蒸馏”和“自动识别”，再做“运行时接入”，最后做“自动演化”
- 先让成员“像这个人”，再让成员“查得对”，最后让成员“能安全地做事”
- 先保留 embedding lane，后续再评估压缩或替换，不在前两阶段直接删掉

### 4.2 迁移顺序

建议顺序如下：

1. 阶段 0：基线与观测补全
2. 阶段 1：蒸馏技能与自动语言识别
3. 阶段 2：成员技能包接入运行时
4. 阶段 3：语言感知检索系统
5. 阶段 4：成员工具能力成员化
6. 阶段 5：持续蒸馏与自动更新闭环

### 4.3 灰度与开关

每阶段必须挂 feature flag：

- `memberSkillDistillation`
- `autoKnowledgeLanguageDetection`
- `memberRuntimeOverlay`
- `languageAwareRetrieval`
- `memberToolPolicy`
- `memberSkillAutoRefresh`

启用顺序：

1. diagnostics only
2. 单成员灰度
3. advisor 单聊
4. creative chat / advisor discussion
5. 默认开启

## 5. 核心子系统设计

### 5.1 Member Distillation

新增内置技能：

- `builtin-skills/member-skill-distiller/SKILL.md`

职责：

- 读取成员知识文件、历史对话、历史样例、会议转写、规则文档
- 抽取：
  - Work Skill
  - Persona
  - Decision Heuristics
  - Workflow
  - Retrieval Scope
  - Tool Policy Draft
- 输出结构化技能包草案

注意：

- 技能负责“抽取与组织建议”
- 真正落盘、校验、版本升级、覆盖保护由 Rust host command 执行
- 不允许模型直接绕过 host 任意写文件

### 5.2 Language Detection

知识库语言识别不应再依赖手动填写。

推荐实现：

- Rust 侧离线识别，首选 `lingua-rs`
- 转写链路仍保留 Whisper 的 `auto-detect`
- 宿主统一维护语言元数据，不把 Whisper 的 UI 设置直接当知识语言真相源

语言识别粒度：

- `document_language`
- `chunk_language`
- `corpus_primary_language`
- `corpus_secondary_languages`
- `mixed_language`
- `language_confidence`

### 5.3 Retrieval

推荐最终检索形态：

- 规则 / heuristics / workflow：结构化检索 + BM25
- 文档 / 笔记 / 字幕 / 案例：Hybrid retrieval
  - BM25 / FTS
  - semantic retrieval
  - metadata filtering
  - reranking
- 复杂跨文档关系：Graph lane，仅作补充通道

语言感知检索规则：

1. 先按 query language 命中同语言 chunk
2. 再按成员主语言优先
3. 再回退跨语言 chunk
4. 混合语料允许多语言召回，但排序中增加 `language_match_score`

### 5.4 Tool Policy

每个成员技能包必须自带工具边界：

- 允许工具
- 禁用工具
- 审批级别
- 优先工具顺序
- 只读 / 轻写 / 高风险分类

不允许成员默认拿到全量 MCP 权限。

## 6. 阶段计划

## 阶段 0：基线与观测补全

### 目标

先把当前系统行为测清楚，为后续每一阶段提供对照基线。

### 变更范围

- 为 advisor 生成 persona、knowledge ingest、runtime query、skills invoke、tool call 增加 timing 与 audit
- diagnostics 展示：
  - 平均 prompt chars
  - active skill 数
  - 检索耗时
  - 检索命中来源
  - 工具调用成功率
  - advisor 生成 persona 的耗时

### 主要改动文件

- `src-tauri/src/commands/advisor_ops.rs`
- `src-tauri/src/commands/runtime_query.rs`
- `src-tauri/src/skills/runtime.rs`
- `src-tauri/src/tools/guards.rs`
- diagnostics 对应前端面板

### 性能目标

- 埋点本身增加的单轮额外耗时 `< 10ms`

### 验收标准

- 能按 `advisorId` 看到：
  - persona 生成平均耗时
  - 平均 prompt chars
  - 平均检索耗时
  - 工具调用成功率
- diagnostics 面板中能看到最近 100 次的分布

### 回滚条件

- 若埋点导致明显交互卡顿或日志污染，关闭 diagnostics flag 即回退

## 阶段 1：蒸馏技能与自动语言识别

### 目标

把成员知识库从“原始文件集合”升级成“可蒸馏成员技能包”，并让知识语言自动识别成为系统元数据。

### 交付物

- 内置技能：`member-skill-distiller`
- 新命令：
  - `members:distill-skill`
  - `members:preview-distillation`
  - `members:detect-knowledge-language`
- 新落盘结构：
  - `skills/members/<advisor-slug>/...`
- advisor 新增自动语言字段：
  - `detectedKnowledgeLanguage`
  - `languageDetectionStatus`
  - `languageConfidence`

### 功能内容

1. 上传知识文件后自动启动后台语言识别
2. 允许手动触发“蒸馏技能”
3. 蒸馏结果预览后再落盘
4. `knowledgeLanguage` 从“用户输入”升级成“自动结果 + 人工覆盖”

### 主要改动文件

- 新增：
  - `src-tauri/src/member_skill/distill.rs`
  - `src-tauri/src/member_skill/language.rs`
  - `src-tauri/src/member_skill/package.rs`
  - `builtin-skills/member-skill-distiller/SKILL.md`
- 修改：
  - `src-tauri/src/commands/advisor_ops.rs`
  - `src-tauri/src/workspace_loaders.rs`
  - `src/pages/Advisors.tsx`

### 必须使用的现成库

- `lingua-rs`

### 必须自研的部分

- 语言聚合策略
- 技能包落盘结构
- 蒸馏候选预览与确认流程

### 性能目标

- 小型知识库语言识别 `< 1s`
- 中型知识库语言识别 `< 5s`
- 蒸馏预览生成：
  - 小型知识库 `< 3s`
  - 中型知识库 `< 10s`
- 全部走后台任务，不阻塞页面首次渲染

### 明确收益

- 减少手动设错知识语言导致的 persona 偏差
- 为后续语言感知检索奠定统一元数据层
- 成员 persona 不再只是单段 prompt，而开始成为可版本化技能包

### 验收标准

- 上传知识库后，UI 30 秒内能显示自动识别语言
- 支持“自动值 / 手动覆盖值 / 覆盖原因”三态
- 触发蒸馏后，`skills:list` 能发现新成员技能
- 生成的技能包目录完整，包含结构化文件，不只有 `SKILL.md`

### 回滚策略

- 若蒸馏链路不稳定，保留旧 advisor prompt 生成功能
- 若自动语言识别异常，退回手动覆盖模式

## 阶段 2：成员技能包接入运行时

### 目标

让成员技能包真正进入 runtime context assembly，而不是停留在静态文件层。

### 交付物

- runtime 可基于 `advisorId` 自动激活对应成员技能
- 成员技能参与 `ContextBundle`
- 旧 `personality / system_prompt` 退为 fallback

### 功能内容

- 为 advisor 会话新增 `memberSkillName` 或 `memberSkillRef`
- `runtime:query` 组包时注入：
  - 成员身份摘要
  - 核心风格
  - 核心规则
  - 工具摘要
- 只在命中需要时补充 heuristics 与 references

### 主要改动文件

- `src-tauri/src/skills/runtime.rs`
- `src-tauri/src/commands/runtime_query.rs`
- `src-tauri/src/chat_helpers.rs`
- `src-tauri/src/interactive_runtime_shared.rs`
- `prompts/library/runtime/advisors/*`

### 性能目标

- advisor 场景平均 `renderedPromptChars` 下降 `>= 20%`
- 首 token 时间不劣化超过 `5%`
- 激活成员技能的运行时额外开销 `< 30ms`

### 明确收益

- 人格漂移下降
- prompt 更短、更稳定
- 成员风格跨轮保持更一致

### 验收标准

- diagnostics 中可看到当前激活的成员技能
- 同一成员连续 10 轮对话的人格一致性明显提升
- 禁用成员技能后系统能无错误回退到旧 advisor prompt

### 回滚策略

- 关闭 `memberRuntimeOverlay` 后恢复旧 advisor 链路

## 阶段 3：语言感知检索系统

### 目标

让成员能够按语言、作用域、证据权重检索到更正确的知识内容。

### 交付物

- 规则检索：结构化 + BM25
- 文档检索：Hybrid retrieval
- chunk 级语言元数据生效
- 成员作用域检索：
  - personal
  - project
  - team
  - global

### 实施策略

短期过渡：

- 规则层与小规模全文层：`SQLite FTS5`
- 语义 lane：保留现有 embedding

中期目标：

- 文档主索引迁移到 `Tantivy`
- 中文分词接 `tantivy-jieba`

### 排序公式

```text
final_score =
0.30 * bm25 +
0.20 * semantic +
0.20 * rerank +
0.15 * scope +
0.10 * language_match +
0.05 * freshness
```

### 主要改动文件

- 新增：
  - `src-tauri/src/member_skill/retrieval_scope.rs`
  - `src-tauri/src/search/*`
- 修改：
  - `src-tauri/src/knowledge.rs`
  - `src-tauri/src/commands/runtime_query.rs`
  - `src-tauri/src/commands/workspace_data.rs`
  - `src/pages/Advisors.tsx` 或相关检索预览页

### 性能目标

- 本地小中型知识库平均检索耗时 `< 250ms`
- 大型知识库平均检索耗时 `< 600ms`
- 同语言 top-5 命中准确率提升 `>= 25%`
- 无效召回率下降 `>= 30%`

### 明确收益

- 中英混合、双语文档、字幕语料下命中更稳
- 精确术语和规范规则更容易命中
- 成员更容易检索到“自己的证据”而不是全局噪音

### 验收标准

- 中文 query 优先命中中文 chunk
- 英文 query 优先命中英文 chunk
- UI 能展示命中 chunk 的语言与命中原因
- 作用域过滤正确：成员私有知识不会误串给其他成员

### 回滚策略

- 保留旧 embedding-only lane 作为 fallback
- `languageAwareRetrieval=false` 时恢复旧检索策略

## 阶段 4：成员工具能力成员化

### 目标

让成员不仅能按风格说话，还能在权限边界内调用工具做事。

### 交付物

- 每个成员技能包包含 `tool_policy.json`
- runtime 能根据成员技能收窄工具集
- 高风险工具继续走现有 capability guardrails

### 工具分层

- `read-only`
  - docs search
  - file read
  - log query
  - metrics query
- `light-write`
  - create draft
  - create ticket
  - write summary
- `high-risk`
  - repo write
  - MCP write actions
  - deploy / publish / destructive actions

### 主要改动文件

- `src-tauri/src/skills/permissions.rs`
- `src-tauri/src/tools/packs.rs`
- `src-tauri/src/tools/guards.rs`
- `src-tauri/src/commands/mcp_tools.rs`
- `src-tauri/src/runtime/*`

### 性能目标

- 工具误选率下降 `>= 40%`
- 工具调用成功率 `>= 85%`
- 高风险误触发 `= 0`
- 平均工具规划步数下降 `>= 20%`

### 明确收益

- 角色更像真实岗位成员
- 工具面更干净，模型决策更快
- 安全边界更清晰

### 验收标准

- 不同成员激活后看到的工具集合不同
- 被禁工具调用会进入 capability audit 并给出明确 reason
- 背景任务与子代理默认仍比交互式更严格

### 回滚策略

- 关闭 `memberToolPolicy` 后回退为 runtimeMode 默认工具包

## 阶段 5：持续蒸馏与自动更新闭环

### 目标

让成员技能包能够随新知识和新行为持续进化，但不失控。

### 交付物

- 新素材进入后台蒸馏队列
- 生成“蒸馏候选”
- 支持人工审核后合并
- 技能包版本化、可回滚、可对比

### 新增能力

- `members:enqueue-distillation`
- `members:list-distillation-candidates`
- `members:approve-distillation`
- `members:rollback-skill-version`
- `members:evaluate-skill`

### 主要改动文件

- 新增：
  - `src-tauri/src/member_skill/versioning.rs`
  - `src-tauri/src/member_skill/eval.rs`
  - `src-tauri/src/member_skill/background.rs`
- 修改：
  - scheduler/background runtime
  - diagnostics / settings / advisors UI

### 性能目标

- 新知识文件进入可检索状态 `<= 5 分钟`
- 新知识进入下一版蒸馏候选 `<= 30 分钟`
- 回归评测单次批处理可在后台运行，不阻塞交互

### 明确收益

- 成员不再需要频繁手工重写 prompt
- 新知识与新经验会逐步沉淀进成员技能
- 有版本、有审计、有回滚

### 验收标准

- 新上传会议纪要后，成员能在下一版技能中体现新规则或新事实
- 每次版本升级都能看到：
  - 新增规则
  - 变更 heuristics
  - 来源证据
  - 审核人
- 可回滚到上一稳定版本

### 回滚策略

- 关闭 `memberSkillAutoRefresh`
- 停留在最近稳定版本，不影响在线回答

## 7. 必须使用现成库 vs 必须自研

### 必须使用现成库

- 语言识别：`lingua-rs`
- 短期全文检索：`SQLite FTS5`
- 中期全文检索：`Tantivy`
- 中文分词：`tantivy-jieba`
- 音频转写：Whisper 现有链路
- 说话人分离：后续若接会议人格蒸馏，可接 `pyannote`

### 必须自研

- 成员技能包 schema
- 蒸馏候选生成与审核流
- 语言聚合策略
- 作用域检索排序
- 成员工具权限模型
- 版本治理与评测体系

## 8. 评测体系

每阶段都必须跑最小评测集。建议建立固定 eval 数据集：

- 风格一致性问题集
- 规则遵守问题集
- 多语言知识检索问题集
- 工具调用安全问题集
- 历史案例复现问题集

建议最少跟踪以下指标：

- `persona_consistency_score`
- `rule_adherence_score`
- `retrieval_hit_at_5`
- `language_match_precision`
- `tool_success_rate`
- `unsafe_tool_attempts`
- `avg_prompt_chars`
- `avg_retrieval_latency_ms`
- `avg_first_token_ms`

## 9. 风险清单

### 风险 1：蒸馏结果过拟合风格，牺牲事实性

控制：

- Persona 与 Knowledge 分层
- 规则与风格分开存
- 回答必须优先引用证据

### 风险 2：语言检测误判导致错误检索路由

控制：

- 保留人工覆盖
- 记录 confidence
- 低置信度时允许多语言并行检索

### 风险 3：成员技能包过大，反而增加 prompt 开销

控制：

- SKILL.md 只放最小必要内容
- heuristics / references 按需加载
- 使用 section budget 控制注入体积

### 风险 4：工具能力成员化后误触高风险动作

控制：

- 继续复用 capability guardrails
- 成员工具策略只负责“收窄”，不负责绕过审批

## 10. 推荐执行顺序

推荐的落地顺序：

1. 阶段 0：补齐观测
2. 阶段 1：蒸馏技能 + 语言识别
3. 阶段 2：成员技能进入 runtime
4. 阶段 3：语言感知检索
5. 阶段 4：成员工具能力
6. 阶段 5：自动更新闭环

如果资源有限，最先保证：

- 阶段 1 全量完成
- 阶段 2 至少完成 advisor 单聊接入
- 阶段 3 先完成语言过滤 + 规则全文检索

这三步完成后，系统就已经具备可用的“成员技能化”主链路。

## 11. 近期实施建议

建议把最近两周的工作收敛成三个可交付里程碑：

### 里程碑 A

- 建立阶段 0 观测
- 完成 `member-skill-distiller` 的最小落盘链路
- 完成自动语言识别基础版

### 里程碑 B

- 成员技能包接入 advisor runtime
- UI 可预览当前激活成员技能
- 保留旧 advisor fallback

### 里程碑 C

- 上线语言感知检索
- 完成成员工具白名单第一版
- 建立最小评测集

## 12. 完成定义

当以下条件全部满足时，可认为该迁移完成：

- 每个成员都能从知识库蒸馏出可版本化技能包
- 知识库语言可自动识别并进入检索/蒸馏/运行时链路
- runtime 能按成员激活技能，而不是只读一段 advisor prompt
- 检索支持语言感知与成员作用域
- 成员具备受控工具能力
- 技能升级具备审计、评测、回滚

在达到上述条件前，不应删除旧 advisor fallback 链路。
