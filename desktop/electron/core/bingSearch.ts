/**
 * Bing Web Search integration for persona research
 * Uses DuckDuckGo HTML scraping as free alternative (no API key required)
 */

import https from 'https';

export interface SearchResult {
    title: string;
    snippet: string;
    url: string;
}

/**
 * Search the web using DuckDuckGo HTML scraping (free, no API key)
 * Falls back gracefully if search fails
 */
export async function searchWeb(query: string, count: number = 5): Promise<SearchResult[]> {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    return new Promise((resolve) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const results = parseDuckDuckGoHTML(data, count);
                    console.log(`[searchWeb] Found ${results.length} results for: ${query}`);
                    resolve(results);
                } catch (e) {
                    console.error('[searchWeb] Parse error:', e);
                    resolve([]);
                }
            });
        });

        req.on('error', (err) => {
            console.error('[searchWeb] Request error:', err);
            resolve([]); // Fail gracefully
        });

        req.setTimeout(10000, () => {
            req.destroy();
            resolve([]);
        });
    });
}

/**
 * Parse DuckDuckGo HTML response to extract search results
 */
function parseDuckDuckGoHTML(html: string, count: number): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo HTML format uses result__a for links and result__snippet for descriptions
    const resultRegex = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([^<]*(?:<[^>]+>[^<]*)*)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < count) {
        const url = match[1];
        const title = match[2].trim();
        // Clean snippet of HTML tags
        const snippet = match[3].replace(/<[^>]+>/g, '').trim();

        if (title && snippet && !url.includes('duckduckgo.com')) {
            results.push({ title, snippet, url });
        }
    }

    // Fallback: try simpler regex if above didn't work
    if (results.length === 0) {
        const simpleLinkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([^<]+)<\/a>/g;
        const simpleSnippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([^<]+)/g;

        const titles: string[] = [];
        const snippets: string[] = [];

        let m;
        while ((m = simpleLinkRegex.exec(html)) !== null) titles.push(m[1].trim());
        while ((m = simpleSnippetRegex.exec(html)) !== null) snippets.push(m[1].trim());

        for (let i = 0; i < Math.min(titles.length, snippets.length, count); i++) {
            if (titles[i] && snippets[i]) {
                results.push({
                    title: titles[i],
                    snippet: snippets[i],
                    url: ''
                });
            }
        }
    }

    return results;
}
