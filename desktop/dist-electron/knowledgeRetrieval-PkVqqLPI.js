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
    "爆款": ["热门", "火爆", "流行"],
    "涨粉": ["增粉", "吸粉", "粉丝增长"],
    "流量": ["曝光", "播放量", "阅读量"],
    "运营": ["营销", "推广", "增长"],
    "标题": ["题目", "封面文案"],
    "内容": ["文案", "正文", "笔记内容"]
  };
  for (const token of baseTokens) {
    const syns = synonyms[token];
    if (syns) {
      expanded.push(...syns);
    }
  }
  return [...new Set(expanded)];
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
async function hybridRetrieve(query, knowledgeDir, topK = 3) {
  try {
    const files = await fs__namespace.readdir(knowledgeDir);
    const textFiles = files.filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
    if (textFiles.length === 0) {
      return { chunks: [], context: "", sources: [] };
    }
    const allChunks = [];
    for (const file of textFiles) {
      const content = await fs__namespace.readFile(path__namespace.join(knowledgeDir, file), "utf-8");
      const chunks = chunkText(content, file);
      allChunks.push(...chunks);
    }
    if (allChunks.length === 0) {
      return { chunks: [], context: "", sources: [] };
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
    const fusedResults = fusionRank([
      bm25Results.slice(0, topK * 2),
      expandedResults.slice(0, topK * 2)
    ]);
    const topChunks = fusedResults.slice(0, topK);
    const sources = [...new Set(topChunks.map((c) => c.source))];
    const context = topChunks.map(
      (chunk, i) => `[参考${i + 1} - ${chunk.source}]
${chunk.content}`
    ).join("\n\n---\n\n");
    return {
      chunks: topChunks,
      context,
      sources
    };
  } catch (error) {
    console.error("RAG retrieval failed:", error);
    return { chunks: [], context: "", sources: [] };
  }
}
async function buildAdvisorPromptWithRAG(basePrompt, userQuery, knowledgeDir) {
  const retrieval = await hybridRetrieve(userQuery, knowledgeDir, 3);
  let prompt = basePrompt;
  if (retrieval.context) {
    prompt += `

## 参考知识库

以下是与用户问题相关的知识内容，请在回答时参考这些信息：

${retrieval.context}`;
  }
  prompt += `

## 回复要求
- 你是群聊中的一员，请根据你的角色设定发表观点
- 保持简洁，200字以内
- 如果知识库中有相关信息，请自然地融入你的回答`;
  return { prompt, sources: retrieval.sources };
}
exports.buildAdvisorPromptWithRAG = buildAdvisorPromptWithRAG;
exports.hybridRetrieve = hybridRetrieve;
