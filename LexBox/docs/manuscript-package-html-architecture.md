# Manuscript Package HTML Architecture

## 目标

图文工程和长文工程统一采用工程化 HTML 协议，满足这几个要求：

- Markdown 仍然是正文唯一来源
- HTML 预览必须读取真实工程文件
- 图文需要正文自动映射到 HTML
- 长文需要保留 AI 全量排版能力

## 当前实现结论

- `*.redpost` 图文工程：方案一，正式主链路
- `*.redarticle` 长文工程：方案二，正式主链路

## 方案一：用于图文工程 `*.redpost`

该方案已经在图文工程中落地，协议如下。

### 文件职责

- `content.md`
  正文源文件
- `content-map.json`
  Markdown 结构化映射，按 block 保存标题和段落
- `layout.template.html` / `wechat.template.html`
  AI 生成或人工维护的模板 HTML
- `layout.html` / `wechat.html`
  宿主根据模板和内容映射渲染出的最终预览 HTML
- `cover.json` / `images.json`
  素材绑定索引

### 内容映射

宿主会把 Markdown 解析为 block 列表，每个 block 都有稳定 slot：

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

### 模板协议

模板使用两类占位符：

- 文本槽位：`{{slot:document_title}}`、`{{slot:h1_001}}`、`{{slot:p_001}}`
- 素材槽位：`{{asset:cover_figure}}`、`{{asset:image_gallery}}`、`{{asset:image_1_url}}`

宿主额外提供两个聚合槽位：

- `{{slot:content_all}}`
  直接输出完整正文流
- `{{slot:content_tail}}`
  输出模板没有显式摆放的剩余 block，作为兜底区

### 渲染规则

1. 保存 Markdown 时重建 `content-map.json`
2. 保持模板文件不动
3. 宿主把文本槽位和素材槽位注入模板
4. 输出真实 `layout.html`
5. 前端 iframe 直接读取真实渲染文件

### 优点

- 正文只有一份，不会和 HTML 漂移
- 修改正文不需要重新请求 AI
- 模板 diff 和正文 diff 清晰分离
- 预览刷新稳定，适合工程文件长期维护

## 方案二：用于长文工程 `*.redarticle`

该方案在长文工程中作为正式主链路保留。

### 定义

AI 直接读取整份 Markdown 正文，再生成最终 HTML 文档：

- 输入：完整 Markdown、封面、配图、风格要求
- 输出：完整 `layout.html` / `wechat.html`

### 适合场景

- 长文阅读页排版
- 公众号正文排版
- 需要 AI 基于全文语义重新组织页面结构

### 缺点

- 改一段正文就要重跑整页生成
- AI 生成结果容易漂移，结构不稳定
- HTML 文件和 Markdown 源文件容易失去一一对应
- 成本更高，错误更难定位

### 在本项目里的定位

方案二当前只在长文工程使用：

- `layout.html`
- `wechat.html`

长文保存 Markdown 时不自动改写 HTML，只有用户显式点击“生成排版 / 生成公众号”时才会重新调用 AI 全量生成。
