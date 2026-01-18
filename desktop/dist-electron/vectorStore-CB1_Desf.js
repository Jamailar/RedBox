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
function chunkText(text, source, lastModified, chunkSize = 500, overlap = 100) {
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
        tokens: tokenize(currentChunk),
        lastModified
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
      tokens: tokenize(currentChunk),
      lastModified
    });
  }
  return chunks;
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
      console.error("VectorStore Embedding API error:", response.status);
      return texts.map(() => null);
    }
    const data = await response.json();
    return ((_a = data.data) == null ? void 0 : _a.map((d) => d.embedding)) || texts.map(() => null);
  } catch (error) {
    console.error("VectorStore embedding request failed:", error);
    return texts.map(() => null);
  }
}
async function buildVectorIndex(advisorId, advisorsDir, config, win) {
  const knowledgeDir = path__namespace.join(advisorsDir, advisorId, "knowledge");
  const indexFile = path__namespace.join(advisorsDir, advisorId, "knowledge", "embeddings.json");
  let index = { version: 1, lastUpdated: "", chunks: [] };
  try {
    const content = await fs__namespace.readFile(indexFile, "utf-8");
    index = JSON.parse(content);
  } catch {
  }
  const notifyProgress = (current, total, status) => {
    win == null ? void 0 : win.webContents.send("advisors:indexing-progress", {
      advisorId,
      current,
      total,
      status
    });
  };
  try {
    const files = await fs__namespace.readdir(knowledgeDir);
    const textFiles = files.filter((f) => f.endsWith(".txt") || f.endsWith(".md"));
    notifyProgress(0, textFiles.length, "Scanning files...");
    let newChunks = [];
    for (let i = 0; i < textFiles.length; i++) {
      const file = textFiles[i];
      const filePath = path__namespace.join(knowledgeDir, file);
      const stats = await fs__namespace.stat(filePath);
      const lastModified = stats.mtimeMs;
      const existingFileChunks = index.chunks.filter((c) => c.source === file);
      const isModified = existingFileChunks.length === 0 || existingFileChunks.some((c) => (c.lastModified || 0) < lastModified);
      if (!isModified) {
        newChunks.push(...existingFileChunks);
      } else {
        notifyProgress(i, textFiles.length, `Processing ${file}...`);
        const content = await fs__namespace.readFile(filePath, "utf-8");
        const fileChunks = chunkText(content, file, lastModified);
        const textsToEmbed = fileChunks.map((c) => c.content);
        if (textsToEmbed.length > 0) {
          for (let j = 0; j < textsToEmbed.length; j += 10) {
            const batchTexts = textsToEmbed.slice(j, j + 10);
            const batchEmbeddings = await getEmbeddings(batchTexts, config);
            for (let k = 0; k < batchTexts.length; k++) {
              fileChunks[j + k].embedding = batchEmbeddings[k] || void 0;
            }
          }
        }
        newChunks.push(...fileChunks);
      }
    }
    index.chunks = newChunks;
    index.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
    await fs__namespace.writeFile(indexFile, JSON.stringify(index, null, 2));
    notifyProgress(textFiles.length, textFiles.length, "Completed");
    return index;
  } catch (error) {
    console.error("Build index failed:", error);
    notifyProgress(0, 0, "Error: " + String(error));
    throw error;
  }
}
async function getIndexStatus(advisorId, advisorsDir) {
  const indexFile = path__namespace.join(advisorsDir, advisorId, "knowledge", "embeddings.json");
  try {
    const content = await fs__namespace.readFile(indexFile, "utf-8");
    const index = JSON.parse(content);
    const sources = new Set(index.chunks.map((c) => c.source));
    return {
      indexedFiles: sources.size,
      totalChunks: index.chunks.length,
      lastUpdated: index.lastUpdated
    };
  } catch {
    return null;
  }
}
exports.buildVectorIndex = buildVectorIndex;
exports.getIndexStatus = getIndexStatus;
