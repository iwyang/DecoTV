/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { toSimplified } from '@/lib/chinese';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { rankSearchResults } from '@/lib/search-ranking';
import { filterSensitiveContent } from '@/lib/filter';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(JSON.stringify({ error: '搜索关键词不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 注意：流式接口目前不解析 adult/filter 参数，统一跟随全局配置
  const shouldFilterAdult = !config.SiteConfig.DisableYellowFilter;

  let normalizedQuery = query;
  try {
    normalizedQuery = await toSimplified(query);
  } catch (e) {
    console.warn('繁体转简体失败', e);
  }

  const searchQueries = [normalizedQuery];
  if (query && normalizedQuery !== query) searchQueries.push(query);

  let streamClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const safeEnqueue = (data: Uint8Array) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(data);
          return true;
        } catch {
          streamClosed = true;
          return false;
        }
      };

      // start 事件
      safeEnqueue(encoder.encode(`data: ${JSON.stringify({
        type: 'start',
        query,
        normalizedQuery,
        totalSources: apiSites.length,
        timestamp: Date.now(),
      })}\n\n`));

      let completedSources = 0;
      const allResults: any[] = [];

      const searchPromises = apiSites.map(async (site) => {
        try {
          const siteResultsPromises = searchQueries.map((q) =>
            Promise.race([
              searchFromApi(site, q),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
              ),
            ]).catch(() => [])
          );

          const resultsArrays = await Promise.all(siteResultsPromises);
          let results = resultsArrays.flat();

          // 去重
          const uniqueMap = new Map();
          results.forEach((r: any) => uniqueMap.set(r.id, r));
          results = Array.from(uniqueMap.values());

          // 统一过滤（包括赌博词）
          const filteredResults = filterSensitiveContent(results, shouldFilterAdult, [site]);

          // 排序
          const sortedResults = rankSearchResults(filteredResults, normalizedQuery);

          completedSources++;

          if (!streamClosed) {
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results: sortedResults,
              timestamp: Date.now(),
            })}\n\n`));
          }

          if (sortedResults.length > 0) allResults.push(...sortedResults);
        } catch (error) {
          completedSources++;
          if (!streamClosed) {
            safeEnqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: error instanceof Error ? error.message : '搜索失败',
            })}\n\n`));
          }
        }

        if (completedSources === apiSites.length && !streamClosed) {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            totalResults: allResults.length,
            completedSources,
            timestamp: Date.now(),
          })}\n\n`));
          controller.close();
        }
      });

      await Promise.allSettled(searchPromises);
    },
    cancel() {
      streamClosed = true;
      console.log('Client disconnected');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}