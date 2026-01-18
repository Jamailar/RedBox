"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const events = require("events");
const main = require("./main-CWgrynnU.js");
class AdvisorChatService extends events.EventEmitter {
  constructor(config) {
    super();
    __publicField(this, "config");
    __publicField(this, "toolRegistry");
    __publicField(this, "toolExecutor");
    __publicField(this, "messages", []);
    __publicField(this, "abortController", null);
    this.config = config;
    this.toolRegistry = new main.ToolRegistry();
    this.toolRegistry.registerTools([
      new main.WebSearchTool(),
      new main.CalculatorTool()
    ]);
    this.toolExecutor = new main.ToolExecutor(
      this.toolRegistry,
      async () => {
        const { ToolConfirmationOutcome } = await Promise.resolve().then(() => require("./main-CWgrynnU.js")).then((n) => n.toolRegistry);
        return ToolConfirmationOutcome.ProceedOnce;
      }
    );
  }
  /**
   * 发送消息
   */
  async sendMessage(message, history = []) {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    let fullResponse = "";
    try {
      this.emitEvent({
        type: "thinking_start",
        content: "正在分析问题..."
      });
      const ragContext = await this.performRAG(message, signal);
      this.messages = [];
      const systemContent = this.buildSystemPrompt(ragContext);
      this.messages.push(new main.SystemMessage(systemContent));
      for (const msg of history.slice(-10)) {
        if (msg.role === "user") {
          this.messages.push(new main.HumanMessage(msg.content));
        } else {
          this.messages.push(new main.AIMessage(msg.content));
        }
      }
      this.messages.push(new main.HumanMessage(message));
      this.emitEvent({
        type: "thinking_chunk",
        content: "基于专业知识和上下文进行深度思考..."
      });
      fullResponse = await this.runAgentLoop(signal);
      this.emitEvent({ type: "thinking_end", content: "思考完成" });
      this.emitEvent({ type: "done" });
      return fullResponse;
    } catch (error) {
      if (!signal.aborted) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emitEvent({ type: "error", content: errorMsg });
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }
  /**
   * 取消执行
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
  /**
   * 执行 RAG 检索
   */
  async performRAG(query, signal) {
    if (!this.config.knowledgeDir) {
      return { context: "", sources: [] };
    }
    this.emitEvent({
      type: "rag_start",
      content: "正在检索相关知识..."
    });
    try {
      const { buildAdvisorPromptWithRAG } = await Promise.resolve().then(() => require("./knowledgeRetrieval-BYy3yi4S.js"));
      const { prompt, sources, method } = await buildAdvisorPromptWithRAG(
        "",
        // 不使用原始 prompt，只获取 RAG 上下文
        query,
        this.config.knowledgeDir,
        this.config.embeddingConfig
      );
      if (signal.aborted) {
        return { context: "", sources: [] };
      }
      this.emitEvent({
        type: "rag_result",
        content: method === "hybrid" ? "使用混合检索" : "使用关键词检索",
        sources
      });
      const ragMatch = prompt.match(/## 相关知识[\s\S]*?(?=\n##|$)/);
      const context = ragMatch ? ragMatch[0] : "";
      return { context, sources };
    } catch (error) {
      console.error("RAG failed:", error);
      return { context: "", sources: [] };
    }
  }
  /**
   * 构建系统提示词
   */
  buildSystemPrompt(ragContext) {
    const parts = [];
    parts.push(this.config.systemPrompt || `你是 ${this.config.advisorName}，一个专业的智囊团成员。`);
    parts.push(`
## 思考方式

在回答问题时，请进行深度思考：
1. 首先分析问题的本质和关键点
2. 结合你的专业知识进行推理
3. 如果需要计算或搜索，可以使用可用工具
4. 给出有深度、有价值的观点

你的回答应该体现专业性和独特视角。`);
    if (ragContext.context) {
      parts.push(`
## 知识库参考

以下是从知识库检索到的相关信息，请在回答时参考：

${ragContext.context}

引用来源：${ragContext.sources.join(", ") || "无"}`);
    }
    parts.push(`
## 可用工具

你可以使用以下工具辅助回答：
- web_search: 搜索网络获取最新信息
- calculator: 进行数学计算

只在必要时使用工具，大多数问题可以直接基于知识回答。`);
    return parts.join("\n\n");
  }
  /**
   * 执行 Agent 循环
   */
  async runAgentLoop(signal) {
    const maxTurns = this.config.maxTurns || 5;
    let turnCount = 0;
    const llm = this.createLLM();
    while (turnCount < maxTurns && !signal.aborted) {
      turnCount++;
      let fullContent = "";
      const stream = await llm.stream(this.messages, { signal });
      let hasToolCalls = false;
      let toolCalls = [];
      for await (const chunk of stream) {
        if (signal.aborted) return fullContent;
        if (chunk.content) {
          const content = typeof chunk.content === "string" ? chunk.content : "";
          fullContent += content;
          this.emitEvent({ type: "response_chunk", content });
        }
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          hasToolCalls = true;
          toolCalls = chunk.tool_calls;
        }
      }
      if (hasToolCalls && toolCalls.length > 0) {
        this.messages.push(new main.AIMessage({
          content: fullContent,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id || `call_${Date.now()}`,
            name: tc.name,
            args: tc.args
          }))
        }));
        for (const toolCall of toolCalls) {
          const callId = toolCall.id || `call_${Date.now()}`;
          this.emitEvent({
            type: "tool_start",
            tool: { name: toolCall.name, params: toolCall.args }
          });
          const request = {
            callId,
            name: toolCall.name,
            params: toolCall.args
          };
          const response = await this.toolExecutor.execute(request, signal);
          this.emitEvent({
            type: "tool_end",
            tool: {
              name: toolCall.name,
              result: {
                success: response.result.success,
                content: response.result.display || response.result.llmContent
              }
            }
          });
          this.messages.push(
            new main.ToolMessage({
              tool_call_id: callId,
              content: response.result.llmContent
            })
          );
        }
        continue;
      }
      this.emitEvent({ type: "response_end", content: fullContent });
      return fullContent;
    }
    return "";
  }
  /**
   * 创建 LLM 实例
   */
  createLLM() {
    const toolSchemas = this.toolRegistry.getToolSchemas();
    return new main.ChatOpenAI({
      modelName: this.config.model,
      apiKey: this.config.apiKey,
      configuration: { baseURL: this.config.baseURL },
      temperature: this.config.temperature ?? 0.7,
      streaming: true
    }).bindTools(toolSchemas);
  }
  /**
   * 发送事件
   */
  emitEvent(partial) {
    const event = {
      ...partial,
      advisorId: this.config.advisorId,
      advisorName: this.config.advisorName,
      advisorAvatar: this.config.advisorAvatar
    };
    this.emit(partial.type, event);
    this.emit("event", event);
  }
}
function createAdvisorChatService(config) {
  return new AdvisorChatService(config);
}
exports.AdvisorChatService = AdvisorChatService;
exports.createAdvisorChatService = createAdvisorChatService;
