"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const events = require("events");
const main = require("./main-BJYm76hq.js");
require("fs/promises");
require("path");
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
        const { ToolConfirmationOutcome } = await Promise.resolve().then(() => require("./main-BJYm76hq.js")).then((n) => n.toolRegistry);
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
const DIRECTOR_ID = "director-system";
const DIRECTOR_NAME = "总监";
const DIRECTOR_AVATAR = "🎯";
const DIRECTOR_INTRODUCTION_PROMPT = `你是智囊团的总监，负责在老板和团队成员之间做好沟通桥梁。

## 你的角色

你直接向老板汇报，是老板最信任的助手。你的任务是：
1. 理解老板的真实意图和需求
2. 基于上下文进行意图识别和发散思考
3. 提出有价值的子问题，帮助团队成员更好地理解任务
4. 不做具体分工，让成员自由发挥专业特长

## 当前任务

老板提出了一个问题，你需要：
1. 快速理解老板的核心诉求
2. 结合可能相关的背景知识，对这个问题进行发散
3. 提出3-5个有深度的子问题，引导团队思考

## 输出格式

老板，我理解您的需求是：[一句话概括核心诉求]

为了更好地解答，我想到了几个相关的问题：

1. [子问题1]？
2. [子问题2]？
3. [子问题3]？
4. [子问题4]？（可选）
5. [子问题5]？（可选）

接下来请各位同事从自己的专业角度来分析。

## 要求
- 称呼用户为"老板"
- 简洁亲切，总字数控制在150字以内
- 不要直接回答问题，而是做意图发散
- 不要做分工安排，不要输出表格
- 子问题要有深度，能引发思考`;
const DIRECTOR_SUMMARY_PROMPT = `你是智囊团的总监，现在需要向老板汇报团队的讨论成果。

## 你的角色

你是老板最信任的助手，负责把团队的工作成果提炼汇报。老板很忙，需要你帮他快速抓住重点。

## 你的任务

团队成员已经完成了讨论，你需要：
1. 快速提炼每位成员的核心贡献
2. 找出最有价值的观点和建议
3. 告诉老板应该重点关注谁的发言
4. 用简洁的语言让老板快速理解全貌

## 输出格式

老板，团队讨论完毕，我来给您汇报一下：

**核心要点**
[2-3句话总结最重要的结论]

**各位的贡献**
- **[成员名]**：[一句话概括其核心观点和价值]
- **[成员名]**：[一句话概括其核心观点和价值]
...

**重点推荐**
建议您重点看一下 **[成员名]** 的发言，因为[简要原因]。

如果需要深入了解某个方面，可以追问相关的同事。

## 要求
- 称呼用户为"老板"
- 语气亲切专业，像真正的助手在汇报
- 总字数控制在200字以内
- 不要输出表格
- 突出重点，帮老板节省时间
- 明确指出最值得关注的成员发言`;
class DirectorAgent extends events.EventEmitter {
  constructor(config) {
    super();
    __publicField(this, "config");
    __publicField(this, "abortController", null);
    this.config = config;
  }
  /**
   * 发起讨论 - 分析用户问题并设定讨论方向
   */
  async introduceDiscussion(userMessage, advisorNames, discussionGoal = "") {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try {
      this.emitEvent({ type: "thinking_start", content: "正在分析问题..." });
      const llm = this.createLLM();
      const goalContext = discussionGoal ? `

## 🎯 群聊目标

本群的讨论目标是：**${discussionGoal}**

请务必围绕此目标来分析用户的问题，你的开场和引导都应该服务于这个目标。` : "";
      const systemPrompt = DIRECTOR_INTRODUCTION_PROMPT + goalContext;
      const messages = [
        new main.SystemMessage(systemPrompt),
        new main.HumanMessage(`用户问题：${userMessage}

参与讨论的成员：${advisorNames.join("、")}${discussionGoal ? `

群聊目标：${discussionGoal}` : ""}`)
      ];
      let fullResponse = "";
      const stream = await llm.stream(messages, { signal });
      this.emitEvent({ type: "thinking_end", content: "分析完成" });
      for await (const chunk of stream) {
        if (signal.aborted) break;
        const content = typeof chunk.content === "string" ? chunk.content : "";
        if (content) {
          fullResponse += content;
          this.emitEvent({ type: "response_chunk", content });
        }
      }
      this.emitEvent({ type: "response_end", content: fullResponse });
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
   * 总结讨论 - 对比分析所有成员的观点
   */
  async summarizeDiscussion(userMessage, conversationHistory) {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    try {
      this.emitEvent({ type: "thinking_start", content: "正在综合分析各方观点..." });
      const discussionText = conversationHistory.filter((m) => m.role === "assistant" && m.advisorName).map((m) => `【${m.advisorName}】
${m.content}`).join("\n\n---\n\n");
      const llm = this.createLLM();
      const messages = [
        new main.SystemMessage(DIRECTOR_SUMMARY_PROMPT),
        new main.HumanMessage(`原始问题：${userMessage}

团队讨论内容：

${discussionText}`)
      ];
      let fullResponse = "";
      const stream = await llm.stream(messages, { signal });
      this.emitEvent({ type: "thinking_end", content: "分析完成" });
      for await (const chunk of stream) {
        if (signal.aborted) break;
        const content = typeof chunk.content === "string" ? chunk.content : "";
        if (content) {
          fullResponse += content;
          this.emitEvent({ type: "response_chunk", content });
        }
      }
      this.emitEvent({ type: "response_end", content: fullResponse });
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
   * 取消当前执行
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
  /**
   * 创建 LLM 实例
   */
  createLLM() {
    return new main.ChatOpenAI({
      modelName: this.config.model,
      apiKey: this.config.apiKey,
      configuration: { baseURL: this.config.baseURL },
      temperature: this.config.temperature ?? 0.7,
      streaming: true
    });
  }
  /**
   * 发送事件
   */
  emitEvent(partial) {
    const event = {
      ...partial,
      advisorId: DIRECTOR_ID,
      advisorName: DIRECTOR_NAME,
      advisorAvatar: DIRECTOR_AVATAR
    };
    this.emit(partial.type, event);
    this.emit("event", event);
  }
}
function createDirectorAgent(config) {
  return new DirectorAgent(config);
}
class DiscussionFlowService extends events.EventEmitter {
  constructor(config, win = null) {
    super();
    __publicField(this, "config");
    __publicField(this, "win");
    __publicField(this, "abortController", null);
    this.config = config;
    this.win = win;
  }
  /**
   * 执行完整的讨论流程
   * @param isSixHatsMode 是否为六顶思考帽模式（按固定顺序，无总监）
   * @param discussionGoal 群聊目标（所有成员围绕此目标讨论）
   */
  async orchestrateDiscussion(roomId, userMessage, advisors, existingHistory = [], isSixHatsMode = false, discussionGoal = "") {
    var _a, _b, _c;
    this.abortController = new AbortController();
    const newMessages = [];
    const conversationHistory = [];
    try {
      const advisorNames = advisors.map((a) => a.name);
      if (isSixHatsMode) {
        for (let i = 0; i < advisors.length; i++) {
          const advisor = advisors[i];
          if ((_a = this.abortController) == null ? void 0 : _a.signal.aborted) break;
          const fullHistory = [
            { role: "user", content: userMessage },
            ...conversationHistory.filter((m) => m.role === "assistant").map((m) => ({
              role: "assistant",
              content: `[${m.advisorName}的观点]
${m.content}`
            }))
          ];
          const response = await this.advisorSpeak(
            advisor,
            userMessage,
            fullHistory,
            discussionGoal
          );
          const advisorMessage = {
            id: `msg_${Date.now()}_${advisor.id}`,
            role: "advisor",
            advisorId: advisor.id,
            advisorName: advisor.name,
            advisorAvatar: advisor.avatar,
            content: response,
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            phase: "discussion"
          };
          newMessages.push(advisorMessage);
          conversationHistory.push({
            role: "assistant",
            advisorId: advisor.id,
            advisorName: advisor.name,
            content: response
          });
        }
        this.emit("discussion_complete", { roomId, messages: newMessages });
        return newMessages;
      }
      const directorIntro = await this.directorIntroduction(
        userMessage,
        advisorNames,
        discussionGoal
      );
      const introMessage = {
        id: `msg_${Date.now()}_director_intro`,
        role: "director",
        advisorId: DIRECTOR_ID,
        advisorName: DIRECTOR_NAME,
        advisorAvatar: DIRECTOR_AVATAR,
        content: directorIntro,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        phase: "introduction"
      };
      newMessages.push(introMessage);
      conversationHistory.push({
        role: "director",
        advisorId: DIRECTOR_ID,
        advisorName: DIRECTOR_NAME,
        content: directorIntro
      });
      const shuffledAdvisors = this.shuffleArray([...advisors]);
      for (const advisor of shuffledAdvisors) {
        if ((_b = this.abortController) == null ? void 0 : _b.signal.aborted) break;
        const fullHistory = [
          // 用户消息
          { role: "user", content: userMessage },
          // 总监开场
          { role: "assistant", content: `[总监分析]
${directorIntro}` },
          // 之前成员的发言
          ...conversationHistory.filter((m) => m.role === "assistant").map((m) => ({
            role: "assistant",
            content: `[${m.advisorName}的观点]
${m.content}`
          }))
        ];
        const response = await this.advisorSpeak(
          advisor,
          userMessage,
          fullHistory,
          discussionGoal
        );
        const advisorMessage = {
          id: `msg_${Date.now()}_${advisor.id}`,
          role: "advisor",
          advisorId: advisor.id,
          advisorName: advisor.name,
          advisorAvatar: advisor.avatar,
          content: response,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          phase: "discussion"
        };
        newMessages.push(advisorMessage);
        conversationHistory.push({
          role: "assistant",
          advisorId: advisor.id,
          advisorName: advisor.name,
          content: response
        });
      }
      if (!((_c = this.abortController) == null ? void 0 : _c.signal.aborted)) {
        const directorSummary = await this.directorSummarize(
          userMessage,
          conversationHistory
        );
        const summaryMessage = {
          id: `msg_${Date.now()}_director_summary`,
          role: "director",
          advisorId: DIRECTOR_ID,
          advisorName: DIRECTOR_NAME,
          advisorAvatar: DIRECTOR_AVATAR,
          content: directorSummary,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          phase: "summary"
        };
        newMessages.push(summaryMessage);
      }
      this.emit("discussion_complete", { roomId, messages: newMessages });
      return newMessages;
    } catch (error) {
      this.emit("discussion_error", { roomId, error });
      throw error;
    } finally {
      this.abortController = null;
    }
  }
  /**
   * 总监开场分析
   */
  async directorIntroduction(userMessage, advisorNames, discussionGoal = "") {
    const directorConfig = {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      model: this.config.model,
      temperature: 0.7
    };
    const director = createDirectorAgent(directorConfig);
    director.on("event", (event) => {
      this.forwardEventToFrontend("director", event);
    });
    this.sendToFrontend("creative-chat:advisor-start", {
      advisorId: DIRECTOR_ID,
      advisorName: DIRECTOR_NAME,
      advisorAvatar: DIRECTOR_AVATAR,
      phase: "introduction"
    });
    return await director.introduceDiscussion(userMessage, advisorNames, discussionGoal);
  }
  /**
   * 成员发言
   */
  async advisorSpeak(advisor, userMessage, history, discussionGoal = "") {
    const advisorConfig = {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      model: this.config.model,
      advisorId: advisor.id,
      advisorName: advisor.name,
      advisorAvatar: advisor.avatar,
      systemPrompt: this.enhanceSystemPrompt(advisor.systemPrompt, history, discussionGoal),
      knowledgeDir: advisor.knowledgeDir,
      embeddingConfig: this.config.embeddingConfig,
      maxTurns: 3,
      temperature: 0.7
    };
    const advisorService = createAdvisorChatService(advisorConfig);
    advisorService.on("event", (event) => {
      this.forwardEventToFrontend("advisor", event);
    });
    this.sendToFrontend("creative-chat:advisor-start", {
      advisorId: advisor.id,
      advisorName: advisor.name,
      advisorAvatar: advisor.avatar,
      phase: "discussion"
    });
    return await advisorService.sendMessage(userMessage, history);
  }
  /**
   * 总监总结
   */
  async directorSummarize(userMessage, conversationHistory) {
    const directorConfig = {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      model: this.config.model,
      temperature: 0.7
    };
    const director = createDirectorAgent(directorConfig);
    director.on("event", (event) => {
      this.forwardEventToFrontend("director", event);
    });
    this.sendToFrontend("creative-chat:advisor-start", {
      advisorId: DIRECTOR_ID,
      advisorName: DIRECTOR_NAME,
      advisorAvatar: DIRECTOR_AVATAR,
      phase: "summary"
    });
    return await director.summarizeDiscussion(userMessage, conversationHistory);
  }
  /**
   * 增强系统提示词，加入上下文感知和群聊目标
   */
  enhanceSystemPrompt(basePrompt, history, discussionGoal = "") {
    const contextInfo = history.length > 1 ? `

## 讨论上下文

在你之前，已有其他成员发表了观点。请参考他们的观点，提出你独特的见解，可以补充、支持或提出不同看法。` : "";
    const goalInfo = discussionGoal ? `

## 🎯 群聊目标

本次讨论的核心目标是：**${discussionGoal}**

请务必围绕此目标展开分析和讨论，你的所有观点和建议都应该服务于这个目标。` : "";
    const isSixHatsMode = basePrompt.includes("六顶思考帽");
    if (isSixHatsMode) {
      return `${basePrompt}${goalInfo}${contextInfo}

## 重要提示
- 你是群聊讨论中的一员，请根据你的帽子角色发表观点
- **紧扣目标**：你的分析必须围绕群聊目标"${discussionGoal || "用户提出的问题"}"展开
- **主动使用工具**：当需要数据支撑、案例佐证时，请使用 web_search 搜索
- **深度思考**：按照你的"深度思考流程"逐步分析
- 如果有其他帽子的观点，请适当回应或对比
- 突出你的独特视角，与其他帽子形成互补`;
    }
    return `${basePrompt}${goalInfo}${contextInfo}

## 回复要求
- 你是群聊讨论中的一员，请根据你的专业角色发表观点
- **紧扣目标**：你的分析必须围绕群聊目标"${discussionGoal || "用户提出的问题"}"展开
- 保持简洁，150-250字
- 如果有其他成员的观点，请适当回应或对比
- 突出你的专业视角和独特见解`;
  }
  /**
   * 随机打乱数组
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  /**
   * 转发事件到前端
   */
  forwardEventToFrontend(source, event) {
    switch (event.type) {
      case "thinking_start":
      case "thinking_chunk":
      case "thinking_end":
        this.sendToFrontend("creative-chat:thinking", {
          advisorId: event.advisorId,
          advisorName: event.advisorName,
          advisorAvatar: event.advisorAvatar,
          type: event.type,
          content: event.content
        });
        break;
      case "rag_start":
      case "rag_result":
        this.sendToFrontend("creative-chat:rag", {
          advisorId: event.advisorId,
          type: event.type,
          content: event.content,
          sources: event.sources
        });
        break;
      case "tool_start":
      case "tool_end":
        this.sendToFrontend("creative-chat:tool", {
          advisorId: event.advisorId,
          type: event.type,
          tool: event.tool
        });
        break;
      case "response_chunk":
        this.sendToFrontend("creative-chat:stream", {
          advisorId: event.advisorId,
          content: event.content,
          done: false
        });
        break;
      case "response_end":
        this.sendToFrontend("creative-chat:stream", {
          advisorId: event.advisorId,
          content: "",
          done: true
        });
        break;
      case "error":
        console.error(`[${source}] Error:`, event.content);
        break;
    }
  }
  /**
   * 发送消息到前端
   */
  sendToFrontend(channel, data) {
    var _a;
    (_a = this.win) == null ? void 0 : _a.webContents.send(channel, data);
  }
  /**
   * 取消讨论
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}
function createDiscussionFlowService(config, win = null) {
  return new DiscussionFlowService(config, win);
}
exports.DIRECTOR_AVATAR = DIRECTOR_AVATAR;
exports.DIRECTOR_ID = DIRECTOR_ID;
exports.DIRECTOR_NAME = DIRECTOR_NAME;
exports.DirectorAgent = DirectorAgent;
exports.DiscussionFlowService = DiscussionFlowService;
exports.createDirectorAgent = createDirectorAgent;
exports.createDiscussionFlowService = createDiscussionFlowService;
