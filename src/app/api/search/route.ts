/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { toSimplified } from '@/lib/chinese';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { rankSearchResults } from '@/lib/search-ranking';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 🔒 成人内容过滤逻辑
  // URL 参数优先级: ?adult=1 (显示成人) > ?filter=off (显示成人) > 全局配置
  const adultParam = searchParams.get('adult'); // OrionTV 风格参数
  const filterParam = searchParams.get('filter'); // TVBox 风格参数

  let shouldFilterAdult = !config.SiteConfig.DisableYellowFilter; // 默认使用全局配置

  // URL 参数覆盖全局配置
  if (adultParam === '1' || adultParam === 'true') {
    shouldFilterAdult = false; // 显式启用成人内容
  } else if (adultParam === '0' || adultParam === 'false') {
    shouldFilterAdult = true; // 显式禁用成人内容
  } else if (filterParam === 'off' || filterParam === 'disable') {
    shouldFilterAdult = false; // 禁用过滤 = 显示成人内容
  } else if (filterParam === 'on' || filterParam === 'enable') {
    shouldFilterAdult = true; // 启用过滤 = 隐藏成人内容
  }

  // 将搜索关键词规范化为简体中文，提升繁体用户搜索体验
  let normalizedQuery = query;
  try {
    if (query) {
      normalizedQuery = await toSimplified(query);
    }
  } catch (e) {
    console.warn('繁体转简体失败，使用原始关键词', (e as any)?.message || e);
    normalizedQuery = query;
  }

  // 准备搜索关键词列表：如果转换后的关键词与原词不同，则同时搜索两者
  const searchQueries = [normalizedQuery];
  if (query && normalizedQuery !== query) {
    searchQueries.push(query);
  }

  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  // 对每个站点，尝试搜索所有关键词
  const searchPromises = apiSites.flatMap((site) =>
    searchQueries.map((q) =>
      Promise.race([
        searchFromApi(site, q),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
        ),
      ]).catch((err) => {
        console.warn(`搜索失败 ${site.name} (query: ${q}):`, err.message);
        return []; // 返回空数组而不是抛出错误
      })
    )
  );

  try {
    const results = await Promise.allSettled(searchPromises);
    const successResults = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<any>).value);
    let flattenedResults = successResults.flat();

    // 去重：根据 source 和 id 去重
    const uniqueResultsMap = new Map<string, any>();
    flattenedResults.forEach((item) => {
      const key = `${item.source}|${item.id}`;
      if (!uniqueResultsMap.has(key)) {
        uniqueResultsMap.set(key, item);
      }
    });
    flattenedResults = Array.from(uniqueResultsMap.values());

    // 🔒 成人内容 + 违禁关键词过滤逻辑
    if (shouldFilterAdult) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = (result.type_name || '').toLowerCase();
        const title = (result.title || '').toLowerCase();
        const sourceKey = result.source_key || '';

        // 1. 屏蔽整个标记为成人的来源站点
        const source = apiSites.find((s) => s.key === sourceKey);
        if (source && source.is_adult) {
          return false;
        }

        // 2. 屏蔽分类名中包含成人敏感词的结果（原有 yellowWords 逻辑）
        if (yellowWords.some((word: string) => typeName.includes(word.toLowerCase()))) {
          return false;
        }

        // 3. 新增：屏蔽标题或分类中包含赌博/博彩等违禁关键词的结果
        const blockedWords = [
          '赌博',
          '博彩',
          '赌场',
          '彩票',
          '棋牌',
          '老虎机',
          '百家乐',
          '真人视讯',
          '菠菜',
          '六合彩',
          '时时彩',
          '捕鱼',
          '斗地主',
          '德州扑克',
        ];
        const hasBlockedWord = blockedWords.some(
          (word) => title.includes(word.toLowerCase()) || typeName.includes(word.toLowerCase())
        );
        if (hasBlockedWord) {
          return false;
        }

        // 所有检查通过，才保留该结果
        return true;
      });
    }

    // 🎯 智能排序：按相关性对搜索结果排序（使用规范化关键词）
    flattenedResults = rankSearchResults(
      flattenedResults,
      normalizedQuery || query
    );

    const cacheTime = await getCacheTime();

    if (flattenedResults.length === 0) {
      // no cache if empty
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    return NextResponse.json(
      { results: flattenedResults, normalizedQuery },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
          'X-Adult-Filter': shouldFilterAdult ? 'enabled' : 'disabled', // 调试信息
        },
      }
    );
  } catch (error) {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}