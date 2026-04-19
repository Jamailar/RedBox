# Manuscript Package HTML Architecture

## 结论

当前正式产品架构分成两条主链路：

- `*.redpost` 小红书图文笔记：方案一升级版
  内容映射 + 宿主自动重排 + 每页独立 HTML
- `*.redarticle` 长文工程：方案二
  AI 直接阅读整份 Markdown 并生成最终 HTML

这不是过渡实现，而是当前推荐的正式工程协议。

## 为什么这样拆

### 图文工程

小红书图文的核心不是连续长页，而是多张 3:4 图片组成的分页内容。  
如果让 AI 直接输出一个超长 HTML，再在浏览器里做硬分页，问题会集中在：

- 文案一改就要重新算分页
- 真分页需要浏览器测量，复杂度高
- 导出图文时不稳定
- 页面节奏不可控

所以图文工程改成：

1. Markdown 仍然是正文源
2. 宿主在每次保存时都按当前正文全量重排分页
3. 连续三个空行作为强制分页标记
4. 宿主负责把每一页渲染成独立 HTML

这是“正文驱动分页，宿主直接落页”。

### 长文工程

长文阅读页和公众号正文更依赖全文语义、段落组织、引用层级、整页节奏。  
这类场景更适合直接让 AI 阅读全文后输出最终 HTML，而不是把每个段落抽成固定 slot 再强行映射。

## 图文工程正式架构

### 文件结构

以 `example.redpost` 为例：

- `manifest.json`
- `content.md`
- `content-map.json`
- `richpost-page-plan.json`
- `layout.html`
- `pages/page-001.html`
- `pages/page-002.html`
- `cover.json`
- `images.json`
- `assets.json`

### 数据流

1. 用户编辑 `content.md`
2. 宿主把 Markdown 解析成 `content-map.json`
3. 宿主根据当前 block 和配图生成新的 `richpost-page-plan.json`
4. 连续三个空行会先切出明确分页段
5. 宿主把每个 page 渲染成 `pages/page-xxx.html`
6. 宿主生成 `layout.html` 作为多页总预览
7. 前端 iframe 直接预览真实文件

### `content-map.json`

`content-map.json` 仍然保留，因为它是图文工程的正文结构基础层。  
它负责把 Markdown 解析成稳定 block：

```json
{
  "version": 1,
  "packageKind": "post",
  "title": "示例文章",
  "entry": "content.md",
  "generatedAt": 1713513600000,
  "blocks": [
    {
      "id": "h1_001",
      "slot": "h1_001",
      "type": "heading",
      "level": 1,
      "text": "主标题",
      "order": 0,
      "charCount": 3
    },
    {
      "id": "p_001",
      "slot": "p_001",
      "type": "paragraph",
      "level": null,
      "text": "第一段正文",
      "order": 1,
      "charCount": 5
    }
  ]
}
```

block id 是分页规划的锚点，AI 只能引用这些 id，不能复制正文重写结构。

### `richpost-page-plan.json`

这是图文工程最关键的新文件。  
默认由宿主自动生成；AI 如果被显式触发，也只输出分页方案：

```json
{
  "version": 1,
  "title": "示例文章",
  "generatedAt": 1713513600000,
  "source": "ai",
  "pageCount": 4,
  "pages": [
    {
      "id": "page-001",
      "label": "第 1 页",
      "template": "cover",
      "title": "封面标题",
      "summary": "封面页",
      "blockIds": ["h1_001", "p_001"],
      "assetIds": ["asset_cover"]
    }
  ]
}
```

宿主约束：

- `blockIds` 只能引用 `content-map.json` 中已存在的 block
- 同一 block 不允许跨页面重复
- `assetIds` 只能引用已绑定素材
- 宿主每次保存正文时都会按当前 Markdown 重新生成默认 page plan
- AI 输出非法 page plan 时，宿主会归一化并补齐剩余 block
- AI 生成的 page plan 只是一份临时覆盖结果，正文再次编辑后会被自动重排替换

### 每页 HTML

`pages/page-001.html`、`pages/page-002.html` 是最终落盘资产。  
每个文件都满足：

- 独立 HTML 文档
- 固定 3:4 页面尺寸
- 不依赖运行时 JS 才能布局
- 可单独预览
- 可直接作为后续导图输入

### `layout.html`

`layout.html` 在图文工程里不再表示单页模板，而是预览壳：

- 负责纵向堆叠全部页面
- 每个页面通过 iframe 加载 `pages/page-xxx.html`
- 用于编辑时总览，不承担分页计算

## 长文工程正式架构

### 文件结构

以 `example.redarticle` 为例：

- `manifest.json`
- `content.md`
- `manifest.json` 内的 `longformLayoutPresetId`
- `layout.html`
- `wechat.html`
- `cover.json`
- `images.json`
- `assets.json`

### 数据流

1. 用户编辑 `content.md`
2. 保存时只更新正文，不自动改 HTML
3. 长文母版由 `manifest.longformLayoutPresetId` 控制
4. 点击 `生成排版` 时，AI 读取整份 Markdown，结合当前母版生成 `layout.html`
5. 点击 `生成公众号` 时，AI 读取整份 Markdown，结合当前母版生成 `wechat.html`
6. 切换长文母版时，宿主更新 manifest，并立即重做当前目标 HTML
7. 前端 iframe 直接预览真实文件

## 模块拆分

### AI 模块

#### 图文分页规划

- prompt: `prompts/library/templates/richpost_page_planner.txt`
- 输入：
  - 标题
  - Markdown 摘要
  - block outline
  - 素材 outline
  - 可用模板清单
  - 默认 page plan JSON
- 输出：
  - 严格 JSON page plan

说明：

- 这条 AI 能力不是图文主链路必需步骤
- 它只用于用户显式要求“重新想一版分页”
- 一旦正文继续编辑，宿主自动重排会覆盖这份 AI 结果

#### 长文 HTML 生成

- prompt: `prompts/library/templates/package_html_document_renderer.txt`
- skill: `builtin-skills/longform-layout-designer/SKILL.md`
- 输入：
  - 全量 Markdown
  - 封面
  - 配图
  - 当前母版 `manifest.longformLayoutPresetId`
  - 目标渠道 `layout` / `wechat`
- 输出：
  - 完整 HTML 文档

### 宿主模块

#### `src-tauri/src/commands/manuscripts.rs`

负责：

- Markdown -> block map
- 默认 page plan 自动重排
- AI page plan 生成
- page plan 归一化
- 每页 HTML 渲染
- `layout.html` 预览壳渲染
- 长文最终 HTML 生成和保存

#### `src-tauri/src/manuscript_package.rs`

负责：

- 工程状态读取
- `richpost-page-plan.json` 元信息暴露
- `pages/` 每页状态暴露
- `layout.html` / `wechat.html` 真实文件状态暴露

#### `src-tauri/src/helpers.rs`

负责固定路径协议：

- `content-map.json`
- `richpost-page-plan.json`
- `pages/`
- `pages/page-xxx.html`

### 前端模块

#### `src/pages/Manuscripts.tsx`

负责：

- 保存前同步正文
- 触发 `manuscripts:generate-richpost-page-plan`
- 触发 `manuscripts:generate-package-html`
- 刷新包状态
- 根据工程类型切换按钮语义

#### `src/components/manuscripts/WritingDraftWorkbench.tsx`

负责：

- 图文工程多页 iframe 预览
- 长文工程 `layout.html` / `wechat.html` 预览
- 稿件页 `长文排版` 模式下的母版抽屉
- 文件已存在但未生成内容时的占位提示

## 哪些必须用现成库

### 必须用现成能力

- `serde_json`
  JSON page plan 和工程状态读写
- Tauri 文件路径与命令通道
  前后端主链路已经建立，不应自造第二套桥
- 前端 iframe 真实文件预览
  这是最稳定的 HTML 预览方式

### 当前不需要额外引入库

这版分页方案不做浏览器测量分页，也不在导出阶段截图，所以当前不需要：

- `html-to-image`
- `modern-screenshot`
- DOM 高度测量库

如果未来追加“导出多张图片”，再引入这类库更合适。

## 哪些需要自研

### 必须自研

- Markdown block 稳定 id 生成
- richpost 默认分页器
- AI page plan schema
- page plan 归一化和容错
- page plan -> page HTML 渲染器
- `layout.html` 多页预览壳

这些都直接绑定当前产品协议，没有现成通用库能替代。

## 性能策略

### 已采用

- 保存正文时只重建 `content-map.json`、默认分页方案和页面 HTML，不重新请求 AI
- 默认重排只做本地结构计算，不走模型调用
- 图文 AI 只作为可选分页重想工具，不是保存时依赖
- 每页 HTML 独立落盘，预览按页加载，避免一次注入超长 DOM
- `layout.html` 只做总览壳，不负责复杂排版逻辑
- 长文母版只写入 manifest，再把样式约束注入生成 prompt；正文层和排版层保持分离

### 后续可加

- page plan hash 缓存，正文不变时跳过重生成
- 页面级更新时间对比，只重写受影响页
- 导图阶段复用已有 page HTML，不再重新计算页面结构

## 方案对比

### 方案 A：浏览器自动分页

优点：

- 理论上正文更新后可自动分页

缺点：

- 需要浏览器测量
- 图片和段落拆分页很难稳定
- 编辑预览和导出容易出现差异

### 方案 B：AI 直接写每页最终 HTML

优点：

- 最快出结果

缺点：

- 正文和 HTML 极易漂移
- 一改稿就要整组页面重做
- 页面尺寸和内容量不可控

### 方案 C：宿主自动重排，AI 只做可选分页重想

优点：

- 正文源单一
- 宿主负责最终落页，稳定可控
- 正文编辑后结果立即刷新，不依赖历史分页状态
- 后续导图可直接复用

缺点：

- 宿主分页器和渲染器要自研

### 推荐

图文工程采用方案 C，是当前最优解。  
长文工程继续使用方案二，因为它本质是全文阅读页面，不是图文卡片页。
