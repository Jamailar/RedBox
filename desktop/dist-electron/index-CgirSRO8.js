"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const events = require("events");
const main = require("./main-D4qjIzda.js");
const fs = require("fs/promises");
const path = require("path");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
class QueryPlanner {
  constructor(config) {
    __publicField(this, "config");
    __publicField(this, "llm");
    this.config = config;
    this.llm = new main.ChatOpenAI({
      modelName: config.model,
      apiKey: config.apiKey,
      configuration: { baseURL: config.baseURL },
      temperature: config.temperature ?? 0.3
      // 低温度保证稳定性
    });
  }
  /**
   * 为智囊团成员生成智能检索计划
   */
  async planQueries(advisor, conversation) {
    const systemPrompt = this.buildPlannerPrompt(advisor);
    const userPrompt = this.buildQueryRequest(conversation);
    try {
      const response = await this.llm.invoke([
        new main.SystemMessage(systemPrompt),
        new main.HumanMessage(userPrompt)
      ]);
      const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      return this.parseQueryPlan(content, conversation.userQuery);
    } catch (error) {
      console.error("[QueryPlanner] Failed to generate query plan:", error);
      return this.createFallbackPlan(conversation.userQuery);
    }
  }
  /**
   * 构建查询规划器的系统提示词
   */
  buildPlannerPrompt(advisor) {
    return `你是一个智能检索规划器，专门为「${advisor.name}」设计检索策略。

## 角色背景
- 名称：${advisor.name}
- 性格特点：${advisor.personality}
- 专业领域：${advisor.expertise.join("、")}

## 你的任务
分析用户的问题，生成一组精准的检索词，帮助${advisor.name}从知识库中找到最有价值的参考信息。

## 检索词设计原则
1. **理解意图**：不是直接复制用户的问题，而是理解他们真正想知道什么
2. **专业视角**：基于${advisor.name}的专业背景，思考需要哪些知识来回答
3. **多维度覆盖**：
   - primary（核心）：直接相关的核心知识
   - background（背景）：理解问题所需的背景知识
   - contrast（对比）：可用于对比分析的案例
   - example（示例）：具体的实践案例或模板
4. **具体化**：避免过于抽象的检索词，要具体、可搜索

## 输出格式（JSON）
\`\`\`json
{
  "queryIntent": "用一句话描述问题的本质",
  "reasoning": "简要说明你的思考过程",
  "searchQueries": [
    {
      "query": "具体的检索词",
      "purpose": "primary|background|contrast|example",
      "expectedContent": "期望找到什么内容",
      "weight": 0.9
    }
  ]
}
\`\`\`

请生成 3-5 个检索词，按重要性排序。`;
  }
  /**
   * 构建查询请求
   */
  buildQueryRequest(conversation) {
    const parts = [];
    parts.push(`## 用户问题
${conversation.userQuery}`);
    if (conversation.discussionGoal) {
      parts.push(`## 讨论目标
${conversation.discussionGoal}`);
    }
    if (conversation.history.length > 0) {
      const recentHistory = conversation.history.slice(-5);
      const historyText = recentHistory.map((h) => `${h.advisorName || h.role}: ${h.content.slice(0, 200)}...`).join("\n");
      parts.push(`## 对话上下文
${historyText}`);
    }
    parts.push("\n请基于以上信息，生成检索计划（JSON格式）：");
    return parts.join("\n\n");
  }
  /**
   * 解析 AI 返回的检索计划
   */
  parseQueryPlan(content, originalQuery) {
    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      const searchQueries = (parsed.searchQueries || []).slice(0, 5).map((q, idx) => ({
        query: String(q.query || ""),
        purpose: ["primary", "background", "contrast", "example"].includes(q.purpose) ? q.purpose : "primary",
        expectedContent: String(q.expectedContent || ""),
        weight: typeof q.weight === "number" ? Math.min(1, Math.max(0, q.weight)) : 1 - idx * 0.15
      })).filter((q) => q.query.length > 0);
      if (searchQueries.length === 0) {
        searchQueries.push({
          query: originalQuery,
          purpose: "primary",
          expectedContent: "直接相关内容",
          weight: 1
        });
      }
      return {
        originalQuery,
        queryIntent: String(parsed.queryIntent || originalQuery),
        searchQueries,
        reasoning: String(parsed.reasoning || "")
      };
    } catch (error) {
      console.error("[QueryPlanner] Failed to parse response:", error);
      return this.createFallbackPlan(originalQuery);
    }
  }
  /**
   * 创建降级检索计划
   */
  createFallbackPlan(query) {
    const keywords = this.extractKeywords(query);
    const searchQueries = [
      {
        query,
        purpose: "primary",
        expectedContent: "直接相关内容",
        weight: 1
      }
    ];
    if (keywords.length > 0) {
      searchQueries.push({
        query: keywords.join(" "),
        purpose: "background",
        expectedContent: "背景知识",
        weight: 0.7
      });
    }
    return {
      originalQuery: query,
      queryIntent: query,
      searchQueries,
      reasoning: "使用降级策略：直接检索原始问题"
    };
  }
  /**
   * 简单的关键词提取
   */
  extractKeywords(text) {
    const stopWords = /* @__PURE__ */ new Set([
      "的",
      "了",
      "是",
      "在",
      "我",
      "有",
      "和",
      "就",
      "不",
      "人",
      "都",
      "一",
      "个",
      "上",
      "也",
      "很",
      "到",
      "说",
      "要",
      "去",
      "你",
      "会",
      "着",
      "没有",
      "看",
      "好",
      "这",
      "那",
      "什么",
      "怎么",
      "为什么",
      "如何",
      "请",
      "帮",
      "能",
      "可以",
      "吗"
    ]);
    const words = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w));
    return [...new Set(words)].slice(0, 5);
  }
}
function createQueryPlanner(config) {
  return new QueryPlanner(config);
}
function tokenize(text) {
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, " ");
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}${words[i + 1]}`);
  }
  return [...words, ...bigrams];
}
function bm25Score(queryTokens, docTokens, avgDocLength, k1 = 1.5, b = 0.75) {
  const docLength = docTokens.length;
  const termFreq = /* @__PURE__ */ new Map();
  for (const token of docTokens) {
    termFreq.set(token, (termFreq.get(token) || 0) + 1);
  }
  let score = 0;
  for (const queryToken of queryTokens) {
    const tf = termFreq.get(queryToken) || 0;
    if (tf > 0) {
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
      score += numerator / denominator;
    }
  }
  return score;
}
function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}
function chunkText(text, source, chunkSize = 500, overlap = 100) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  let currentChunk = "";
  let chunkIndex = 0;
  for (const para of paragraphs) {
    if (currentChunk.length + para.length > chunkSize && currentChunk.length > 0) {
      chunks.push({
        id: `${source}_chunk_${chunkIndex}`,
        content: currentChunk.trim(),
        source,
        tokens: tokenize(currentChunk)
      });
      chunkIndex++;
      const words = currentChunk.split("");
      currentChunk = words.slice(-overlap).join("") + "\n\n" + para;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }
  if (currentChunk.trim()) {
    chunks.push({
      id: `${source}_chunk_${chunkIndex}`,
      content: currentChunk.trim(),
      source,
      tokens: tokenize(currentChunk)
    });
  }
  return chunks;
}
function expandQuery(query) {
  const baseTokens = tokenize(query);
  const expanded = [...baseTokens];
  const synonyms = {
    "小红书": ["红薯", "笔记", "种草"],
    "爆款": ["热门", "火爆", "流行", "出圈"],
    "涨粉": ["增粉", "吸粉", "粉丝增长"],
    "流量": ["曝光", "播放量", "阅读量", "热度"],
    "运营": ["营销", "推广", "增长"],
    "标题": ["题目", "封面文案", "标题党"],
    "内容": ["文案", "正文", "笔记内容"],
    "变现": ["赚钱", "收益", "变现", "商业化"],
    "选题": ["话题", "内容方向", "创意"]
  };
  for (const token of baseTokens) {
    const syns = synonyms[token];
    if (syns) {
      expanded.push(...syns);
    }
  }
  return [...new Set(expanded)];
}
async function getEmbedding(text, config) {
  var _a, _b;
  try {
    const response = await fetch(`${config.endpoint}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        input: text.slice(0, 8e3)
        // 限制长度
      })
    });
    if (!response.ok) {
      console.error("Embedding API error:", response.status);
      return null;
    }
    const data = await response.json();
    return ((_b = (_a = data.data) == null ? void 0 : _a[0]) == null ? void 0 : _b.embedding) || null;
  } catch (error) {
    console.error("Embedding request failed:", error);
    return null;
  }
}
async function getEmbeddings(texts, config) {
  var _a;
  try {
    const response = await fetch(`${config.endpoint}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        input: texts.map((t) => t.slice(0, 8e3))
      })
    });
    if (!response.ok) {
      console.error("Batch embedding API error:", response.status);
      return texts.map(() => null);
    }
    const data = await response.json();
    return ((_a = data.data) == null ? void 0 : _a.map((d) => d.embedding)) || texts.map(() => null);
  } catch (error) {
    console.error("Batch embedding request failed:", error);
    return texts.map(() => null);
  }
}
function fusionRank(resultLists, k = 60) {
  const scores = /* @__PURE__ */ new Map();
  for (const results of resultLists) {
    for (let rank = 0; rank < results.length; rank++) {
      const chunk = results[rank];
      const rrfScore = 1 / (k + rank + 1);
      if (scores.has(chunk.id)) {
        scores.get(chunk.id).score += rrfScore;
      } else {
        scores.set(chunk.id, { chunk, score: rrfScore });
      }
    }
  }
  return Array.from(scores.values()).sort((a, b) => b.score - a.score).map((item) => item.chunk);
}
async function hybridRetrieve(query, knowledgeDir, embeddingConfig, topK = 3) {
  try {
    const files = await fs__namespace.readdir(knowledgeDir);
    const textFiles = files.filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
    if (textFiles.length === 0) {
      return { chunks: [], context: "", sources: [], method: "keyword-only" };
    }
    const allChunks = [];
    for (const file of textFiles) {
      const content = await fs__namespace.readFile(path__namespace.join(knowledgeDir, file), "utf-8");
      const chunks = chunkText(content, file);
      allChunks.push(...chunks);
    }
    if (allChunks.length === 0) {
      return { chunks: [], context: "", sources: [], method: "keyword-only" };
    }
    const expandedQuery = expandQuery(query);
    const queryTokens = tokenize(query);
    const avgDocLength = allChunks.reduce((sum, c) => sum + c.tokens.length, 0) / allChunks.length;
    const bm25Results = allChunks.map((chunk) => ({
      ...chunk,
      score: bm25Score(queryTokens, chunk.tokens, avgDocLength)
    })).sort((a, b) => (b.score || 0) - (a.score || 0));
    const expandedResults = allChunks.map((chunk) => ({
      ...chunk,
      score: bm25Score(expandedQuery, chunk.tokens, avgDocLength)
    })).sort((a, b) => (b.score || 0) - (a.score || 0));
    let semanticResults = [];
    let method = "keyword-only";
    let offlineChunks = null;
    const indexFile = path__namespace.join(knowledgeDir, "embeddings.json");
    try {
      const indexContent = await fs__namespace.readFile(indexFile, "utf-8");
      const index = JSON.parse(indexContent);
      if (index.chunks && index.chunks.length > 0) {
        console.log("[RAG] Loaded offline index with", index.chunks.length, "chunks");
        offlineChunks = index.chunks;
      }
    } catch {
    }
    if (offlineChunks) {
      allChunks.length = 0;
      allChunks.push(...offlineChunks);
      const avgDocLength2 = allChunks.reduce((sum, c) => sum + c.tokens.length, 0) / allChunks.length;
      const bm25ResultsOffline = allChunks.map((chunk) => ({
        ...chunk,
        score: bm25Score(queryTokens, chunk.tokens, avgDocLength2)
      })).sort((a, b) => (b.score || 0) - (a.score || 0));
      const expandedResultsOffline = allChunks.map((chunk) => ({
        ...chunk,
        score: bm25Score(expandedQuery, chunk.tokens, avgDocLength2)
      })).sort((a, b) => (b.score || 0) - (a.score || 0));
      bm25Results.length = 0;
      bm25Results.push(...bm25ResultsOffline);
      expandedResults.length = 0;
      expandedResults.push(...expandedResultsOffline);
    }
    if ((embeddingConfig == null ? void 0 : embeddingConfig.endpoint) && (embeddingConfig == null ? void 0 : embeddingConfig.apiKey) && (embeddingConfig == null ? void 0 : embeddingConfig.model)) {
      console.log("[RAG] Using hybrid search with embeddings");
      method = "hybrid";
      const queryEmbedding = await getEmbedding(query, embeddingConfig);
      if (queryEmbedding) {
        if (offlineChunks && offlineChunks.some((c) => c.embedding)) {
          console.log("[RAG] Using offline embeddings for semantic search");
          const semanticScored = offlineChunks.filter((c) => c.embedding).map((chunk) => ({
            ...chunk,
            score: cosineSimilarity(queryEmbedding, chunk.embedding)
          })).sort((a, b) => b.score - a.score).slice(0, 20);
          semanticResults = semanticScored;
        } else {
          console.log("[RAG] No offline embeddings, calculating on-the-fly");
          const topChunksForEmbedding = allChunks.slice(0, Math.min(20, allChunks.length));
          const chunkTexts = topChunksForEmbedding.map((c) => c.content);
          const chunkEmbeddings = await getEmbeddings(chunkTexts, embeddingConfig);
          const semanticScored = topChunksForEmbedding.map((chunk, i) => ({
            ...chunk,
            embedding: chunkEmbeddings[i] || void 0,
            score: chunkEmbeddings[i] ? cosineSimilarity(queryEmbedding, chunkEmbeddings[i]) : 0
          })).sort((a, b) => (b.score || 0) - (a.score || 0));
          semanticResults = semanticScored;
        }
      }
    } else {
      console.log("[RAG] Using keyword-only search (no embedding config)");
    }
    const resultLists = [
      bm25Results.slice(0, topK * 2),
      expandedResults.slice(0, topK * 2)
    ];
    if (semanticResults.length > 0) {
      resultLists.push(semanticResults.slice(0, topK * 2));
    }
    const fusedResults = fusionRank(resultLists);
    const topChunks = fusedResults.slice(0, topK);
    const sources = [...new Set(topChunks.map((c) => c.source))];
    const context = topChunks.map(
      (chunk, i) => `[参考${i + 1} - ${chunk.source}]
${chunk.content}`
    ).join("\n\n---\n\n");
    return {
      chunks: topChunks,
      context,
      sources,
      method
    };
  } catch (error) {
    console.error("RAG retrieval failed:", error);
    return { chunks: [], context: "", sources: [], method: "keyword-only" };
  }
}
async function buildAdvisorPromptWithRAG(basePrompt, userQuery, knowledgeDir, embeddingConfig) {
  const retrieval = await hybridRetrieve(userQuery, knowledgeDir, embeddingConfig, 3);
  let prompt = basePrompt;
  if (retrieval.context) {
    prompt += `

## 参考知识库 (${retrieval.method === "hybrid" ? "混合检索" : "关键词检索"})

以下是与用户问题相关的知识内容，请在回答时参考这些信息：

${retrieval.context}`;
  }
  prompt += `

## 回复要求
- 你是群聊中的一员，请根据你的角色设定发表观点
- 保持简洁，200字以内
- 如果知识库中有相关信息，请自然地融入你的回答`;
  return { prompt, sources: retrieval.sources, method: retrieval.method };
}
const knowledgeRetrieval = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  buildAdvisorPromptWithRAG,
  hybridRetrieve
}, Symbol.toStringTag, { value: "Module" }));
class SmartRetrieval extends events.EventEmitter {
  constructor(config) {
    super();
    __publicField(this, "config");
    __publicField(this, "queryPlanner");
    this.config = config;
    this.queryPlanner = createQueryPlanner({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model,
      temperature: 0.3
    });
  }
  /**
   * 执行智能检索
   */
  async retrieve(advisor, conversation, knowledgeDir) {
    const startTime = Date.now();
    this.emitEvent({
      type: "planning_start",
      message: `正在为 ${advisor.name} 规划检索策略...`
    });
    const queryPlan = await this.queryPlanner.planQueries(advisor, conversation);
    this.emitEvent({
      type: "planning_done",
      message: `生成 ${queryPlan.searchQueries.length} 个检索词`,
      data: {
        intent: queryPlan.queryIntent,
        queries: queryPlan.searchQueries.map((q) => q.query)
      }
    });
    const allSources = [];
    const seenChunkIds = /* @__PURE__ */ new Set();
    for (let i = 0; i < queryPlan.searchQueries.length; i++) {
      const searchQuery = queryPlan.searchQueries[i];
      this.emitEvent({
        type: "search_start",
        message: `检索 (${i + 1}/${queryPlan.searchQueries.length}): ${searchQuery.query}`,
        data: { query: searchQuery.query, purpose: searchQuery.purpose }
      });
      try {
        const result = await hybridRetrieve(
          searchQuery.query,
          knowledgeDir,
          this.config.embeddingConfig,
          3
          // 每轮检索 3 个
        );
        for (const chunk of result.chunks) {
          if (seenChunkIds.has(chunk.id)) continue;
          seenChunkIds.add(chunk.id);
          const relevanceScore = this.calculateRelevance(
            chunk.content,
            searchQuery,
            queryPlan.queryIntent
          );
          allSources.push({
            id: chunk.id,
            content: chunk.content,
            source: chunk.source,
            relevanceScore: relevanceScore * searchQuery.weight,
            matchedQuery: searchQuery.query,
            purpose: searchQuery.purpose
          });
        }
        this.emitEvent({
          type: "search_done",
          message: `找到 ${result.chunks.length} 条相关内容`,
          data: { sources: result.sources }
        });
      } catch (error) {
        console.error(`[SmartRetrieval] Search failed for query: ${searchQuery.query}`, error);
      }
    }
    this.emitEvent({
      type: "merging",
      message: "正在融合和评估检索结果..."
    });
    allSources.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topSources = allSources.slice(0, 5);
    const combinedContext = this.buildCombinedContext(topSources, queryPlan);
    const executionTimeMs = Date.now() - startTime;
    this.emitEvent({
      type: "complete",
      message: `检索完成，共找到 ${topSources.length} 条高相关内容`,
      data: { executionTimeMs }
    });
    return {
      queryPlan,
      sources: topSources,
      combinedContext,
      method: "smart-hybrid",
      stats: {
        queriesExecuted: queryPlan.searchQueries.length,
        totalChunksFound: allSources.length,
        uniqueSourcesFound: new Set(topSources.map((s) => s.source)).size,
        executionTimeMs
      }
    };
  }
  /**
   * 计算内容与查询的相关性分数
   */
  calculateRelevance(content, searchQuery, queryIntent) {
    const contentLower = content.toLowerCase();
    const queryWords = searchQuery.query.toLowerCase().split(/\s+/);
    const intentWords = queryIntent.toLowerCase().split(/\s+/);
    let score = 0;
    let matchCount = 0;
    for (const word of queryWords) {
      if (word.length >= 2 && contentLower.includes(word)) {
        matchCount++;
      }
    }
    score += matchCount / Math.max(queryWords.length, 1) * 0.5;
    let intentMatchCount = 0;
    for (const word of intentWords) {
      if (word.length >= 2 && contentLower.includes(word)) {
        intentMatchCount++;
      }
    }
    score += intentMatchCount / Math.max(intentWords.length, 1) * 0.3;
    const lengthBonus = Math.min(content.length / 1e3, 0.2);
    score += lengthBonus;
    switch (searchQuery.purpose) {
      case "primary":
        score *= 1.2;
        break;
      case "example":
        if (/案例|示例|例如|比如|实践/.test(content)) {
          score *= 1.1;
        }
        break;
      case "contrast":
        if (/对比|比较|不同|区别|优劣/.test(content)) {
          score *= 1.1;
        }
        break;
    }
    return Math.min(score, 1);
  }
  /**
   * 构建合并的上下文
   */
  buildCombinedContext(sources, queryPlan) {
    if (sources.length === 0) {
      return "";
    }
    const parts = [];
    parts.push(`**检索意图**: ${queryPlan.queryIntent}
`);
    const groupedByPurpose = {};
    for (const source of sources) {
      if (!groupedByPurpose[source.purpose]) {
        groupedByPurpose[source.purpose] = [];
      }
      groupedByPurpose[source.purpose].push(source);
    }
    const purposeLabels = {
      primary: "📌 核心参考",
      background: "📚 背景知识",
      contrast: "⚖️ 对比参考",
      example: "💡 案例示例"
    };
    for (const [purpose, purposeSources] of Object.entries(groupedByPurpose)) {
      const label = purposeLabels[purpose] || "📄 参考内容";
      parts.push(`### ${label}
`);
      for (const source of purposeSources) {
        parts.push(`**来源**: ${source.source} (相关度: ${(source.relevanceScore * 100).toFixed(0)}%)`);
        parts.push(source.content);
        parts.push("---");
      }
    }
    return parts.join("\n\n");
  }
  /**
   * 发送事件
   */
  emitEvent(event) {
    this.emit("event", event);
    this.emit(event.type, event);
  }
}
function createSmartRetrieval(config) {
  return new SmartRetrieval(config);
}
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
        const { ToolConfirmationOutcome } = await Promise.resolve().then(() => require("./main-D4qjIzda.js")).then((n) => n.toolRegistry);
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
      const ragContext = await this.performRAG(message, signal, history);
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
   * 执行智能 RAG 检索
   */
  async performRAG(query, signal, history = []) {
    if (!this.config.knowledgeDir) {
      return { context: "", sources: [] };
    }
    this.emitEvent({
      type: "rag_start",
      content: "正在智能规划检索策略..."
    });
    try {
      const smartRetrieval = createSmartRetrieval({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        model: this.config.model,
        embeddingConfig: this.config.embeddingConfig
      });
      smartRetrieval.on("event", (event) => {
        var _a, _b;
        if (event.type === "planning_done") {
          this.emitEvent({
            type: "thinking_chunk",
            content: `检索策略: ${((_b = (_a = event.data) == null ? void 0 : _a.queries) == null ? void 0 : _b.join(", ")) || ""}`
          });
        } else if (event.type === "search_done") {
          this.emitEvent({
            type: "thinking_chunk",
            content: event.message
          });
        }
      });
      const advisorContext = {
        name: this.config.advisorName,
        personality: this.extractPersonality(this.config.systemPrompt),
        expertise: this.extractExpertise(this.config.systemPrompt)
      };
      const conversationContext = {
        userQuery: query,
        history: history.map((h) => ({
          role: h.role,
          content: h.content
        }))
      };
      const result = await smartRetrieval.retrieve(
        advisorContext,
        conversationContext,
        this.config.knowledgeDir
      );
      if (signal.aborted) {
        return { context: "", sources: [] };
      }
      const sources = result.sources.map((s) => s.source);
      const uniqueSources = [...new Set(sources)];
      this.emitEvent({
        type: "rag_result",
        content: `智能检索完成 (${result.stats.queriesExecuted}轮, ${result.stats.uniqueSourcesFound}个来源)`,
        sources: uniqueSources
      });
      return {
        context: result.combinedContext,
        sources: uniqueSources,
        reasoning: result.queryPlan.reasoning
      };
    } catch (error) {
      console.error("[AdvisorChatService] Smart RAG failed, falling back:", error);
      return this.performFallbackRAG(query, signal);
    }
  }
  /**
   * 降级 RAG 检索（原始方法）
   */
  async performFallbackRAG(query, signal) {
    try {
      const { buildAdvisorPromptWithRAG: buildAdvisorPromptWithRAG2 } = await Promise.resolve().then(() => knowledgeRetrieval);
      const { prompt, sources, method } = await buildAdvisorPromptWithRAG2(
        "",
        query,
        this.config.knowledgeDir,
        this.config.embeddingConfig
      );
      if (signal.aborted) {
        return { context: "", sources: [] };
      }
      this.emitEvent({
        type: "rag_result",
        content: method === "hybrid" ? "混合检索" : "关键词检索",
        sources
      });
      const ragMatch = prompt.match(/## 参考知识库[\s\S]*?(?=\n##|$)/);
      return { context: ragMatch ? ragMatch[0] : "", sources };
    } catch (error) {
      console.error("Fallback RAG failed:", error);
      return { context: "", sources: [] };
    }
  }
  /**
   * 从系统提示词提取性格特点
   */
  extractPersonality(systemPrompt) {
    const match = systemPrompt.match(/性格[：:]\s*(.+?)(?:\n|$)/);
    return match ? match[1] : "专业、有见解";
  }
  /**
   * 从系统提示词提取专业领域
   */
  extractExpertise(systemPrompt) {
    const match = systemPrompt.match(/专业[：:]\s*(.+?)(?:\n|$)/);
    if (match) {
      return match[1].split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    }
    return ["内容创作", "分析"];
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
      let ragSection = `
## 知识库参考

以下是通过智能检索从知识库中找到的相关信息：`;
      if (ragContext.reasoning) {
        ragSection += `

**检索思路**: ${ragContext.reasoning}`;
      }
      ragSection += `

${ragContext.context}

**引用来源**: ${ragContext.sources.join(", ") || "无"}

请自然地将这些知识融入你的回答，不要生硬地引用。`;
      parts.push(ragSection);
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
exports.QueryPlanner = QueryPlanner;
exports.SmartRetrieval = SmartRetrieval;
exports.createDirectorAgent = createDirectorAgent;
exports.createDiscussionFlowService = createDiscussionFlowService;
exports.createQueryPlanner = createQueryPlanner;
exports.createSmartRetrieval = createSmartRetrieval;
