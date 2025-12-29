// app/api/search/route.ts  (主搜索接口，已添加赌博关键词屏蔽)

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { toSimplified } from '@/lib/chinese';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { rankSearchResults } from '@/lib/search-ranking';
import { filterSensitiveContent } from '@/lib/filter';

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
    return NextResponse.json({ results: [] }, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  const adultParam = searchParams.get('adult');
  const filterParam = searchParams.get('filter');

  let shouldFilterAdult = !config.SiteConfig.DisableYellowFilter;

  if (adultParam === '1' || adultParam === 'true') {
    shouldFilterAdult = false;
  } else if (adultParam === '0' || adultParam === 'false') {
    shouldFilterAdult = true;
  } else if (filterParam === 'off' || filterParam === 'disable') {
    shouldFilterAdult = false;
  } else if (filterParam === 'on' || filterParam === 'enable') {
    shouldFilterAdult = true;
  }

  let normalizedQuery = query;
  try {
    if (query) normalizedQuery = await toSimplified(query);
  } catch (e) {
    console.warn('繁体转简体失败', (e as any)?.message || e);
  }

  const searchQueries = [normalizedQuery];
  if (query && normalizedQuery !== query) searchQueries.push(query);

  const searchPromises = apiSites.flatMap((site) =>
    searchQueries.map((q) =>
      Promise.race([
        searchFromApi(site, q),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
        ),
      ]).catch((err) => {
        console.warn(`搜索失败 ${site.name} (query: ${q}):`, err.message);
        return [];
      })
    )
  );

  try {
    const results = await Promise.allSettled(searchPromises);
    const successResults = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    let flattenedResults = successResults.flat();

    const uniqueMap = new Map<string, any>();
    flattenedResults.forEach((item) => {
      const key = `${item.source}|${item.id}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    });
    flattenedResults = Array.from(uniqueMap.values());

    // 统一过滤：成人 + 赌博违禁词
    flattenedResults = filterSensitiveContent(flattenedResults, shouldFilterAdult, apiSites);

    flattenedResults = rankSearchResults(flattenedResults, normalizedQuery || query);

    const cacheTime = await getCacheTime();

    if (flattenedResults.length === 0) {
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
          'X-Adult-Filter': shouldFilterAdult ? 'enabled' : 'disabled',
        },
      }
    );
  } catch {
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}