/**
 * Web Search Tool - Web 搜索工具
 *
 * 使用原生 fetch 进行 DuckDuckGo 搜索
 * 不再依赖 LangChain
 */

import { z } from 'zod';
import {
    DeclarativeTool,
    ToolKind,
    type ToolResult,
    createSuccessResult,
    createErrorResult,
    ToolErrorType,
} from '../toolRegistry';

// 参数 Schema
const SearchParamsSchema = z.object({
    query: z.string().describe('The search query to look up on the web'),
    maxResults: z.number().optional().describe('Maximum number of results (default: 5)'),
});

type SearchParams = z.infer<typeof SearchParamsSchema>;

/**
 * Web 搜索工具
 */
export class WebSearchTool extends DeclarativeTool<typeof SearchParamsSchema> {
    readonly name = 'web_search';
    readonly displayName = 'Web Search';
    readonly description = 'Search the web for information. REQUIRED: query (string, core keywords only; no filler like "帮我/一下"). Example: web_search({ "query": "dan koe" }). Use this when you need current info, facts, or resources from the internet.';
    readonly kind = ToolKind.Search;
    readonly parameterSchema = SearchParamsSchema;
    readonly requiresConfirmation = false;

    getDescription(params: SearchParams): string {
        return `Search the web for: "${params.query}"`;
    }

    async execute(params: SearchParams, signal: AbortSignal): Promise<ToolResult> {
        if (signal.aborted) {
            return createErrorResult('Search cancelled', ToolErrorType.CANCELLED);
        }

        try {
            const maxResults = params.maxResults || 5;

            // 使用 DuckDuckGo HTML 搜索
            const encodedQuery = encodeURIComponent(params.query);
            const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`Search API error: ${response.status}`);
            }

            const html = await response.text();

            // 解析结果
            const results: { title: string; url: string; description: string }[] = [];
            const resultRegex = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
            const descRegex = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/g;

            let match;
            let index = 0;
            while ((match = resultRegex.exec(html)) !== null && index < maxResults) {
                const url = match[1];
                const title = match[2].replace(/<[^>]+>/g, '');

                // 尝试获取描述
                const descMatch = descRegex.exec(html);
                const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '') : '';

                if (url && title) {
                    results.push({ title, url, description });
                    index++;
                }
            }

            if (results.length === 0) {
                return createSuccessResult('No results found for the search query.');
            }

            // 格式化结果
            const formattedResults = results.map((result, idx) => {
                return `[${idx + 1}] ${result.title}
URL: ${result.url}
${result.description}
`;
            }).join('\n');

            return createSuccessResult(
                `Search results for "${params.query}":\n\n${formattedResults}`,
                `🔍 Found ${results.length} results for: ${params.query}`
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return createErrorResult(`Search failed: ${message}`);
        }
    }
}
