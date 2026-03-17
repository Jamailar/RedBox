一、设计目标与总体原则

1. 设计目标

本应用的视觉目标是：极简、克制、理性、去装饰化。

整体风格参考 GPT / Gemini 一类工具型 AI 产品，而非内容消费型 App：
	•	不强调品牌色侵占
	•	不做强情绪化配色
	•	不制造视觉噪音
	•	让“内容、结构与过程”成为视觉主角

UI 应长期使用而不疲劳，适合连续数小时工作场景。

2. 核心设计原则（强约束）

1）中性色优先，品牌色克制使用
2）不使用渐变、不使用拟物、不使用阴影叠加特效
3）层级靠「留白 + 字重 + 对比度」，而非颜色堆叠
4）所有视觉元素必须服务于“可读性”和“可理解性”
5）白天 / 黑夜模式在结构上完全一致，仅变量不同

⸻

二、色彩系统（Color System）

1. 颜色角色定义（不是颜色本身）

所有颜色只允许通过“语义角色”使用，禁止直接硬编码颜色值：
	•	Background（背景）
	•	Surface（承载层）
	•	Border / Divider（边界）
	•	Text Primary / Secondary / Tertiary
	•	Accent（强调色）
	•	Status（状态色：成功 / 警告 / 错误）

⸻

2. 白天模式（Light Mode）

背景与层级
	•	App Background：#FFFFFF
	•	Surface Primary（主内容区）：#FFFFFF
	•	Surface Secondary（侧栏 / 面板）：#F7F7F8
	•	Surface Elevated（弹窗 / 浮层）：#FFFFFF

说明：
	•	白天模式几乎不区分背景与内容边界，靠留白区分
	•	禁止使用明显卡片阴影

边界与分隔
	•	Border Default：#E5E7EB
	•	Divider Subtle：#ECEEF1
	•	Focus Ring：#D1D5DB

边界使用原则：
	•	默认不画边框
	•	只有在“需要明确结构边界”时才出现

文本颜色
	•	Text Primary：#111827
	•	Text Secondary：#4B5563
	•	Text Tertiary：#9CA3AF
	•	Text Disabled：#D1D5DB

强调色（Accent）
	•	Accent Primary：#2563EB（低饱和蓝）
	•	Accent Hover：#1D4ED8
	•	Accent Muted：#E0E7FF

使用限制：
	•	Accent 只允许用于「当前选中 / 关键动作 / 进度完成」
	•	不允许大面积填充

状态色
	•	Success：#16A34A
	•	Warning：#D97706
	•	Error：#DC2626

状态色只用于 icon / 细线 / 小标签，不用于背景块。

⸻

3. 黑夜模式（Dark Mode）

背景与层级
	•	App Background：#0F172A
	•	Surface Primary：#020617
	•	Surface Secondary：#020617
	•	Surface Elevated：#020617

说明：
	•	黑夜模式是“深蓝黑”，不是纯黑
	•	所有层级尽量用同一背景，减少对比疲劳

边界与分隔
	•	Border Default：#1E293B
	•	Divider Subtle：#1E293B
	•	Focus Ring：#334155

文本颜色
	•	Text Primary：#F8FAFC
	•	Text Secondary：#CBD5E1
	•	Text Tertiary：#64748B
	•	Text Disabled：#334155

强调色（Accent）
	•	Accent Primary：#60A5FA
	•	Accent Hover：#93C5FD
	•	Accent Muted：#1E293B

状态色
	•	Success：#22C55E
	•	Warning：#F59E0B
	•	Error：#EF4444

⸻

三、排版系统（Typography）

1. 字体选择
	•	英文 / 数字：Inter / System UI
	•	中文：系统默认（macOS: PingFang SC / Windows: Microsoft YaHei UI）

禁止使用艺术字体。

2. 字号与字重规范
	•	Page Title：18px / Semibold
	•	Section Title：14px / Medium
	•	Body Text：13px / Regular
	•	Secondary Text：12px / Regular
	•	Meta / Hint：11px / Regular

3. 行高
	•	标准正文行高：1.6
	•	日志 / 代码 / 过程输出：1.5

⸻

四、布局与空间（Layout & Spacing）

1. 栅格与边距
	•	基础单位：8px
	•	页面内边距：24px
	•	模块间距：16–24px
	•	行内元素间距：8–12px

2. 留白原则
	•	宁可留白，不要填充
	•	不允许为了“看起来丰富”而加视觉元素

⸻

五、组件规范（关键组件）

1. 按钮（Button）
	•	Primary Button：仅用于当前主要动作
	•	Secondary Button：默认样式，无填充
	•	Danger Button：仅用于不可逆操作

规则：
	•	按钮高度统一 32px
	•	圆角 6px
	•	禁止使用 icon-only 主按钮

2. 列表与表格
	•	无边框
	•	Hover 状态仅改变背景 3–5% 明度
	•	当前选中行使用 Accent Muted 背景

3. 输入框
	•	默认无边框，仅底线或背景区分
	•	Focus 状态使用 Focus Ring

4. 日志 / AI 执行过程区
	•	等宽字体
	•	不使用气泡样式
	•	不模拟“聊天感”
	•	事件类型靠 icon + 文本区分，而非颜色块

⸻

六、图标与图形语言

1. 图标
	•	风格：线性 / 单色
	•	尺寸：16px / 20px
	•	颜色：继承文本颜色

禁止彩色图标。

2. 分隔与强调
	•	使用 Divider，不使用卡片框
	•	强调信息使用字重或位置，不使用背景色块

⸻

七、动效与反馈（Motion）

1. 动效原则
	•	所有动效 < 150ms
	•	仅用于状态变化反馈
	•	不使用缓动弹性效果

2. 允许的动效
	•	列表加载淡入
	•	任务进度条线性推进
	•	折叠展开高度变化

⸻

八、不可违反的设计禁区
	•	不使用渐变背景
	•	不使用卡片阴影
	•	不使用情绪化插画
	•	不使用大面积品牌色
	•	不模拟聊天 UI

⸻

九、整体视觉一句话定义

这是一个“理性、克制、长期使用不疲劳”的 AI 工作台，而不是一个取悦用户的内容 App。


品牌升级补丁：

🧱 RedBox 视觉规范 · 品牌感升级补丁（Patch 1.0）

一、设计定位补充
	•	关键词：容器、秩序、收纳、提取、AI生成、温度感
	•	目标：增强 RedBox 的可识别度与图形语言表达，不打破克制基调
	•	设计哲学不变：不引入装饰感、情绪化表现，仅通过结构+图形+微色彩强化识别度

⸻

二、颜色系统 Patch（新增/替换变量）

你现有的蓝色强调色（#2563EB）非常理性，用于 AI 功能没问题。现在补充一个专属的 品牌红变量组，用于“盒子相关”组件或背景。

变量名	色值	用法	使用规则
--brand-red	#D83A34	RedBox 主色（基于 icon 实色）	仅用于品牌 Logo、icon、导航或卡片角标
--brand-red-muted	#FBE9E9	低饱和版红色背景	仅用于 hover、浅强调区域
--brand-red-border	#F3C1C1	红色边框线	用于边界强调
--brand-red-text	#B91C1C	警示型红/强调文字色	用于模块标题、当前状态

✅ 使用限制：依然遵守原有原则——不大面积铺色，只用于语义明确场景。

⸻

三、图形语言补丁（引入盒子意象）

1. 图形基础元件（Box）
	•	可引入一个极简的盒子形状作为品牌图元（SVG），放置于：
	•	插件弹窗顶部（左侧或右上角）；
	•	设置页 Logo 区域；
	•	文件导出时的小角标；
	•	图形形式：
	•	扁平投影角度正视盒子，顶部微开（保持“开合”语义）
	•	三角形折盖可弱化、抽象为线条
	•	若有 loading/AI生成场景，可加光圈 / 点阵喷发动画（不违反装饰原则）

2. 图形位置原则

位置	建议
插件 icon	保留 3D icon，不做 WebGL 渐变
内部界面 icon	用线稿版，基于相同透视
状态提示	用打开的盒子 + 发光点或卡片线条图


⸻

四、排版与文案补丁

组件级命名优化建议

原名称	替代命名（更具 RedBox 品牌性）
我的收藏	我的盒子 / 我的 Box
下载笔记	存入盒子（按钮）
AI仿写	从盒子生成草稿
识别文本	盒中提取文字（OCR）


⸻

五、组件语义补丁建议

类型	修改前	修改后
按钮文本	⬇️ 下载	📦 存入红盒子
设置标题	设置	Box 设置中心
状态提示	提取成功	📦 文字已收纳进盒子


⸻

六、动效建议补丁（不违背动效原则）

场景	动效建议
点击“存入盒子”	盒子 icon 轻微 scale-zoom，伴随淡入卡片线条
提取成功	弹出卡片+✅，透明淡入
AI 生成进行中	盒子微开合 + 点阵光环转圈（SVG内动效）


⸻

七、最终一致性策略

项目	执行方式
所有“红色”出现	限定为 --brand-red 体系色，不跳出主轴
图标风格	全部转换为线性 1px 描边图标，禁用拟物质感
Box 图元设计	可由你生成 SVG 标准形，统一使用（我可代做）
渐变保留策略	保留在插件 icon 与 favicon 中，内部 UI 禁止出现


⸻

✅ 总结一句话版本

你仍将拥有一个 “理性·工具型” 的 RedBox 系统，
但这一次，它终于有了一个真正可识别、可扩展、可延续的品牌语义 ——
“红色收纳盒中的 AI 内容生成器”。

