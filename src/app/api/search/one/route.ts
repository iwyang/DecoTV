import { NextRequest, NextResponse } from 'next/server';

import { resolveAdultFilter } from '@/lib/adult-filter';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { filterSensitiveContent } from '@/lib/filter';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');

  if (!query || !resourceId) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { result: null, error: '缺少必要参数: q 或 resourceId' }, 
      { headers: { 'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}` } }
    );
  }

  const config = await getConfig();
  let apiSites = await getAvailableApiSites(authInfo.username);

  const shouldFilterAdult = resolveAdultFilter(
    searchParams,
    config.SiteConfig.DisableYellowFilter,
  );

  if (shouldFilterAdult) {
    apiSites = apiSites.filter((site) => !site.is_adult);
  }

  const targetSite = apiSites.find((site) => site.key === resourceId);
  if (!targetSite) {
    return NextResponse.json({ error: `未找到指定的视频源: ${resourceId}`, result: null }, { status: 404 });
  }

  try {
    const results = await searchFromApi(targetSite, query);
    let result = results.filter((r) => r.title === query);

    // 统一敏感内容过滤
    result = filterSensitiveContent(result, shouldFilterAdult, [targetSite]);

    if (result.length === 0) {
      return NextResponse.json({ error: '未找到结果', result: null }, { status: 404 });
    }

    return NextResponse.json({ results: result });
  } catch (error) {
    return NextResponse.json({ error: '搜索失败', result: null }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Max-Age': '86400',
    },
  });
}