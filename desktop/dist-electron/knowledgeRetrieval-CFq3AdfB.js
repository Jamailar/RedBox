"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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
    if ((embeddingConfig == null ? void 0 : embeddingConfig.endpoint) && (embeddingConfig == null ? void 0 : embeddingConfig.apiKey) && (embeddingConfig == null ? void 0 : embeddingConfig.model)) {
      console.log("[RAG] Using hybrid search with embeddings");
      method = "hybrid";
      const queryEmbedding = await getEmbedding(query, embeddingConfig);
      if (queryEmbedding) {
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
exports.buildAdvisorPromptWithRAG = buildAdvisorPromptWithRAG;
exports.hybridRetrieve = hybridRetrieve;
