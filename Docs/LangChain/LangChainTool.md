

✅ 一、你可以给 AI 增加哪些类型的工具？

工具（Tools）的本质是：

让模型可以调用 外部能力，补充它本身不能做到的事情。

你可以加的工具主要分成 9 大类：

⸻

① 数据库工具（DB 查询类）

用途：
	•	查用户数据
	•	查题库
	•	查词库
	•	查历史记录

例子：
	•	query_db
	•	query_user_profile
	•	query_question_bank

⸻

② 网络工具（HTTP 请求类）

让 LLM 调用外部 API，比如：
	•	某个雅思题库网站（爬虫）
	•	Reddit / X / Google Search
	•	你自己的网站 API

⸻

③ 文件处理工具

例如：
	•	解析 PDF（简历解析）
	•	解析 Word
	•	解析 PPT
	•	解析本地 TXT、日志等

⸻

④ 文本操作工具

例如：
	•	正则提取
	•	分词
	•	关键词抽取
	•	文本清洗
	•	HTML 转 Markdown

在语料处理里很常用。

⸻

⑤ 数据结构转换工具

例如：
	•	把答案结构化
	•	抽取 JSON
	•	标准化格式
	•	错误修复

雅思串题 Agent 非常需要！

⸻

⑥ 内部业务工具（custom tools）

你可以定义任何业务函数：
	•	提取用户故事
	•	根据故事生成 mapping
	•	生成口语答案
	•	生成加粗稿

AI 就能 自动调用这些函数。

⸻

⑦ 算法工具

例如：
	•	排序
	•	相似度计算
	•	评分算法
	•	统计分析
	•	Embedding 检索

⸻

⑧ RAG（知识库工具）

这类工具也可以挂在 Agent 里：
	•	文档检索
	•	向量库搜索
	•	混合检索（向量 + BM25）

适合大题库或背景知识。

⸻

⑨ 执行型工具（危险要慎重）
	•	执行 shell 命令
	•	读写文件
	•	运行 Python 代码
	•	系统操作

⚠️ 生产环境愈发需要 sandbox，否则风险极大。

⸻

✅ 二、怎么为 AI 添加工具（最新版 LangChain 1.0 + LangGraph 标准）

下面给你 最干净、完全最新标准 的写法。

⸻

✅ Step1：定义工具（@tool）

from langchain_core.tools import tool

@tool
def extract_stories(profile: dict) -> dict:
    """从用户档案提取故事"""
    # 你可以写业务逻辑，也可以让 AI 来生成
    return {
        "story1": "...",
        "story2": "...",
        "story3": "..."
    }


⸻

✅ Step2：把工具绑定到模型

from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4o")

llm_with_tools = llm.bind_tools([extract_stories])

从现在开始，LLM 就可以自动生成：

{
  "tool": "extract_stories",
  "arguments": {...}
}

并执行 tool。

⸻

✅ Step3：在 LangGraph 的 node 里运行这个模型

def extract_stories_node(state):
    result = llm_with_tools.invoke({
        "profile": state["profile"]
    })
    return { "stories": result }


⸻

✅ Step4：把工具加入 Agent 的 graph

graph.add_node("extract_stories", extract_stories_node)

AI 就能自动用它。

⸻

✅ 三、给你一组适合“雅思串题 Agent”使用的工具设计（非常实用）

这是最佳工具搭配：

⸻

① read_resume_tool

自动从用户上传的 PDF 简历中提取：
	•	教育背景
	•	社团活动
	•	项目
	•	技能
	•	兴趣
	•	旅行
	•	小故事
	•	工作经历

⸻

② extract_stories_tool

把简历 + 表格中的信息转换成 3–5 个“万能故事”。

⸻

③ question_search_tool

从题库查询：
	•	本季新题
	•	必考话题
	•	主题分类
	•	Part1/2/3 筛选
	•	与故事相关度排序

⸻

④ mapping_tool

将故事映射到题库：

题目 -> story1
题目 -> story2
题目 -> story3


⸻

⑤ answer_formatter_tool

把答案格式化成：
	•	评分区间 6.0 / 7.0 / 7.5
	•	结构化 JSON
	•	分点

⸻

⑥ bold_script_tool

对需要记忆的关键词进行加粗：

My **friend Lily** helped me ...


⸻

⑦ practice_followup_tool

生成：
	•	反问句
	•	延伸问法
	•	考官可能追问的 follow-up

⸻

⑧ pronunciation_training_tool

生成：
	•	语音版答案
	•	音标拆解
	•	重音标注

⸻

⑨ pdf_export_tool

把串题稿件导出成：
	•	PDF
	•	Markdown
	•	Word

⸻

✅ 四、你怎么知道工具是否被正确调用？

很简单：
在 LangGraph 的 app.invoke() 结果中会显示：
	•	ToolName
	•	arguments
	•	LLM 的 tool call
	•	执行返回值

你可以观察整个流程。

⸻

📌 最终总结（超级关键）

AI Agent = LLM + 多种工具（tools） + LangGraph 控制流程。

你可以添加的工具包括：
	•	数据库
	•	网络
	•	文件解析
	•	文本清洗
	•	业务逻辑
	•	分析算法
	•	知识库
	•	执行工具

添加方法永远是：

@tool
→ llm.bind_tools([...])
→ node 内使用
→ graph 注册

这样 AI 会自动调用工具完成复杂任务。


# Tools

Tools extend what [agents](/oss/javascript/langchain/agents) can do—letting them fetch real-time data, execute code, query external databases, and take actions in the world.

Under the hood, tools are callable functions with well-defined inputs and outputs that get passed to a [chat model](/oss/javascript/langchain/models). The model decides when to invoke a tool based on the conversation context, and what input arguments to provide.

<Tip>
  For details on how models handle tool calls, see [Tool calling](/oss/javascript/langchain/models#tool-calling).
</Tip>

## Create tools

### Basic tool definition

The simplest way to create a tool is by importing the `tool` function from the `langchain` package. You can use [zod](https://zod.dev/) to define the tool's input schema:

```ts  theme={null}
import * as z from "zod"
import { tool } from "langchain"

const searchDatabase = tool(
  ({ query, limit }) => `Found ${limit} results for '${query}'`,
  {
    name: "search_database",
    description: "Search the customer database for records matching the query.",
    schema: z.object({
      query: z.string().describe("Search terms to look for"),
      limit: z.number().describe("Maximum number of results to return"),
    }),
  }
);
```

<Note>
  **Server-side tool use**

  Some chat models (e.g., [OpenAI](/oss/javascript/integrations/chat/openai), [Anthropic](/oss/javascript/integrations/chat/anthropic), and [Gemini](/oss/javascript/integrations/chat/google_generative_ai)) feature [built-in tools](/oss/javascript/langchain/models#server-side-tool-use) that are executed server-side, such as web search and code interpreters. Refer to the [provider overview](/oss/javascript/integrations/providers/overview) to learn how to access these tools with your specific chat model.
</Note>

## Accessing context

<Info>
  **Why this matters:** Tools are most powerful when they can access agent state, runtime context, and long-term memory. This enables tools to make context-aware decisions, personalize responses, and maintain information across conversations.

  The runtime context provides a structured way to supply runtime data, such as DB connections, user IDs, or config, into your tools. This avoids global state and keeps tools testable and reusable.
</Info>

#### Context

Tools can access an agent's runtime context through the `config` parameter:

```ts  theme={null}
import * as z from "zod"
import { ChatOpenAI } from "@langchain/openai"
import { createAgent } from "langchain"

const getUserName = tool(
  (_, config) => {
    return config.context.user_name
  },
  {
    name: "get_user_name",
    description: "Get the user's name.",
    schema: z.object({}),
  }
);

const contextSchema = z.object({
  user_name: z.string(),
});

const agent = createAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [getUserName],
  contextSchema,
});

const result = await agent.invoke(
  {
    messages: [{ role: "user", content: "What is my name?" }]
  },
  {
    context: { user_name: "John Smith" }
  }
);
```

#### Memory (Store)

Access persistent data across conversations using the store. The store is accessed via `config.store` and allows you to save and retrieve user-specific or application-specific data.

```ts expandable theme={null}
import * as z from "zod";
import { createAgent, tool } from "langchain";
import { InMemoryStore } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

const store = new InMemoryStore();

// Access memory
const getUserInfo = tool(
  async ({ user_id }) => {
    const value = await store.get(["users"], user_id);
    console.log("get_user_info", user_id, value);
    return value;
  },
  {
    name: "get_user_info",
    description: "Look up user info.",
    schema: z.object({
      user_id: z.string(),
    }),
  }
);

// Update memory
const saveUserInfo = tool(
  async ({ user_id, name, age, email }) => {
    console.log("save_user_info", user_id, name, age, email);
    await store.put(["users"], user_id, { name, age, email });
    return "Successfully saved user info.";
  },
  {
    name: "save_user_info",
    description: "Save user info.",
    schema: z.object({
      user_id: z.string(),
      name: z.string(),
      age: z.number(),
      email: z.string(),
    }),
  }
);

const agent = createAgent({
  model: new ChatOpenAI({ model: "gpt-4o" }),
  tools: [getUserInfo, saveUserInfo],
  store,
});

// First session: save user info
await agent.invoke({
  messages: [
    {
      role: "user",
      content: "Save the following user: userid: abc123, name: Foo, age: 25, email: foo@langchain.dev",
    },
  ],
});

// Second session: get user info
const result = await agent.invoke({
  messages: [
    { role: "user", content: "Get user info for user with id 'abc123'" },
  ],
});

console.log(result);
// Here is the user info for user with ID "abc123":
// - Name: Foo
// - Age: 25
// - Email: foo@langchain.dev
```

#### Stream writer

Stream custom updates from tools as they execute using `config.streamWriter`. This is useful for providing real-time feedback to users about what a tool is doing.

```ts  theme={null}
import * as z from "zod";
import { tool, ToolRuntime } from "langchain";

const getWeather = tool(
  ({ city }, config: ToolRuntime) => {
    const writer = config.writer;

    // Stream custom updates as the tool executes
    if (writer) {
      writer(`Looking up data for city: ${city}`);
      writer(`Acquired data for city: ${city}`);
    }

    return `It's always sunny in ${city}!`;
  },
  {
    name: "get_weather",
    description: "Get weather for a given city.",
    schema: z.object({
      city: z.string(),
    }),
  }
);
```

***

<Callout icon="pen-to-square" iconType="regular">
  [Edit this page on GitHub](https://github.com/langchain-ai/docs/edit/main/src/oss/langchain/tools.mdx) or [file an issue](https://github.com/langchain-ai/docs/issues/new/choose).
</Callout>

<Tip icon="terminal" iconType="regular">
  [Connect these docs](/use-these-docs) to Claude, VSCode, and more via MCP for real-time answers.
</Tip>


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.langchain.com/llms.txt

