# 提示词：重构小红书笔记采集功能（API 模式）

## 背景

当前 RedBox Capture 插件的"采集博主笔记"功能采用逐个打开 Tab 的方式，速度极慢。需要参考 social-media-copilot 的实现，将其重构为 API 调用模式，同时保留传统 Tab 模式作为备选。

## 核心目标

1. **新增 API 模式采集**：通过小红书 API 直接获取博主笔记数据，无需逐个打开 Tab，大幅提升采集速度
2. **保留传统模式**：用户可选择使用原来的 Tab 模式（更稳定但慢）
3. **迁移配置页面**：删除 settings 页面的"小红书采集"配置，改为在插件主页面（sidepanel）采集时动态配置
4. **支持任务控制**：可暂停、继续、取消采集任务
5. **进度回调**：采集过程实时显示进度

## 参考资源

- `social-media-copilot-main/src/entrypoints/xhs.content/tasks/author-post/processor.ts` — 博主笔记采集核心逻辑
- `social-media-copilot-main/src/entrypoints/xhs.content/api/request.ts` — API 签名和请求头构造
- `social-media-copilot-main/src/entrypoints/xhs.content/api/user.ts` — webV1UserPosted API
- `social-media-copilot-main/src/entrypoints/xhs.content/api/note.ts` — webV1Feed API
- `/Users/chenshengguang/Documents/程序代码/蘑菇小红书创作/RedBox/Plugin/docs/xhs-capture-principle.md` — 当前采集原理文档

## 技术方案

### 架构变更

```
传统模式（慢）:                          API 模式（快）:
profile tab → 获取笔记链接列表            profile tab → 获取笔记列表 + 逐条调用 feed API
  → 循环遍历每个链接                        → 所有操作在当前页面内完成
    → 打开新 tab                           → 无需打开/关闭 tab
    → 等待加载完成                          → 随机间隔 3~X 秒
    → 提取数据                             → 实时进度回调
    → 关闭 tab                            → 支持取消/暂停
```

### API 签名（必须参考 social-media-copilot 实现）

#### 请求头格式

```
x-s:        mnsv2() 生成，包装为 "XYS_" + base64(JSON)
x-s-common: localStorage[b1] + CRC32 + 固定字段，base64 编码
x-t:        时间戳毫秒字符串
x-xray-traceid: 64位混合字符串
x-b3-traceid: 16位随机十六进制
```

#### 签名函数要求

所有签名函数必须内联在注入脚本中（作为嵌套函数），因为是通过 `chrome.scripting.executeScript` 注入到页面执行的，必须是纯 JavaScript，不能依赖外部库。

需要实现：
- MD5 哈希函数
- CRC32 函数（标准 IEEE 802.3）
- 自定义 Base64 编码（XHS 专用查表）
- mnsv2() 调用和结果包装

### 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `background.js` | 新增 API 提取函数、签名工具函数、API 收集器、取消支持、消息路由、设置默认值 |
| `sidepanel.html` | 新增博主笔记采集配置面板（模式/条数/间隔） |
| `sidepanel.js` | 配置面板逻辑、options 参数传递、进度监听、取消按钮 |
| `sidepanel.css` | 配置面板样式 |
| `settings.html` | 删除「小红书采集」section |
| `settings.js` | 删除对应 JS 元素引用 |

## 功能需求

### 1. 模式选择（sidepanel 配置面板）

```html
<section id="blogger-notes-config">
  <!-- 展开/收起按钮 -->
  <!-- 模式选择：API 模式（更快）/ 传统模式（更稳定） -->
  <!-- 笔记数量：1-200，默认50 -->
  <!-- 随机间隔：最少3秒 ~ 最大X秒 -->
</section>
```

- 勾选时：显示「API 模式（更快）」— 直接调 XHS API 获取笔记详情
- 取消勾选：显示「传统模式（更稳定）」— 逐个打开 Tab 提取
- 默认使用 API 模式

### 2. 默认模式修改

`background.js` 中 `DEFAULT_PLUGIN_SETTINGS` 需要添加：
```javascript
xhsBloggerCollectionMode: 'api'  // 默认 API 模式
```

### 3. 消息路由修改

```javascript
case 'xhs:collect-blogger-notes':
  execute: () => {
    const options = message?.options || {};
    if (options.mode === 'tab') {
      return collectXhsBloggerNotesFromTab(tabId, options);
    }
    return collectXhsBloggerNotesViaApi(tabId, options);
  }
```

注意：当前 `message?.options` 可能是 `undefined`，需要确保 sidepanel 正确传递 options 参数。

### 4. 任务取消支持

- 新增 `xhsActiveTaskAbortController = { aborted: false }`
- `collectXhsBloggerNotesViaApi` 循环中检查取消标志
- 新增 `cancelXhsActiveTask()` 函数设置 aborted = true
- 任务执行中显示「取消采集」按钮

### 5. 进度回调

参考 social-media-copilot 的 `TaskProcessor` 模式：
- 通过 `chrome.runtime.sendMessage({ type: 'xhs:task-progress', ... })` 广播进度
- sidepanel 监听进度消息并更新 UI
- 进度格式：`{ current, total, message }`
- 显示：「已采集 12/50」

## API 流程（参考 social-media-copilot）

### 阶段1：获取博主笔记列表

```javascript
// 调用 /api/sns/web/v1/user_posted
// 参数：user_id, cursor, num=20, image_formats
// 分页获取直到达到 limit 数量
```

### 阶段2：获取每条笔记详情

```javascript
// 对每条笔记调用 /api/sns/web/v1/feed
// 参数：source_note_id, xsec_token, xsec_source='pc_user'
// 需要 xsec_token（从笔记列表获取）
```

### 阶段3：保存到知识库

```javascript
// 调用已有的 postKnowledgeEntry(buildXhsEntry(notePayload))
```

## 验证清单

1. **API 模式**：打开博主主页 → 选 API 模式 → 点击采集 → 侧栏显示进度 → 笔记保存到知识库
2. **传统模式**：切换传统模式 → 采集 → 确认 Tab 逐个打开并关闭
3. **取消**：启动采集 → 点击取消 → 部分已保存的笔记存在
4. **默认模式**：不设置 options → 走 API 模式
5. **设置页**：确认「小红书采集」section 已移除
6. **进度显示**：采集过程中实时显示进度百分比

## 已知问题排查

如果 API 模式失败，需要检查：
1. `window.mnsv2` 是否可用（XHS 页面全局函数）
2. `localStorage['b1']` 是否有值
3. `document.cookie` 是否包含 `a1`
4. 签名头格式是否正确（参考 social-media-copilot 的 request.ts）
5. API 响应是否包含 `success: false`（需要解析 msg 字段）

## 注意事项

1. 所有签名代码必须内联在注入函数内（纯 JS，无外部依赖）
2. API 模式需要在已登录小红书的页面执行
3. 随机间隔至少 3 秒，避免触发反爬机制
4. 兼容 Tab 模式和 API 模式的结果格式，统一保存到知识库