"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require$$2 = require("https");
async function searchWeb(query, count = 5) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
  return new Promise((resolve) => {
    const req = require$$2.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const results = parseDuckDuckGoHTML(data, count);
          console.log(`[searchWeb] Found ${results.length} results for: ${query}`);
          resolve(results);
        } catch (e) {
          console.error("[searchWeb] Parse error:", e);
          resolve([]);
        }
      });
    });
    req.on("error", (err) => {
      console.error("[searchWeb] Request error:", err);
      resolve([]);
    });
    req.setTimeout(1e4, () => {
      req.destroy();
      resolve([]);
    });
  });
}
function parseDuckDuckGoHTML(html, count) {
  const results = [];
  const resultRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/g;
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < count) {
    const url = match[1];
    const title = match[2].trim();
    const snippet = match[3].replace(/<[^>]+>/g, "").trim();
    if (title && snippet && !url.includes("duckduckgo.com")) {
      results.push({ title, snippet, url });
    }
  }
  if (results.length === 0) {
    const simpleLinkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([^<]+)<\/a>/g;
    const simpleSnippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)/g;
    const titles = [];
    const snippets = [];
    let m;
    while ((m = simpleLinkRegex.exec(html)) !== null) titles.push(m[1].trim());
    while ((m = simpleSnippetRegex.exec(html)) !== null) snippets.push(m[1].trim());
    for (let i = 0; i < Math.min(titles.length, snippets.length, count); i++) {
      if (titles[i] && snippets[i]) {
        results.push({
          title: titles[i],
          snippet: snippets[i],
          url: ""
        });
      }
    }
  }
  return results;
}
exports.searchWeb = searchWeb;
