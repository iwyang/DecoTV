// app/api/search/resources/route.ts  (资源列表接口，无需额外修改赌博过滤)

import { NextRequest, NextResponse } from 'next/server';

import { resolveAdultFilter } from '@/lib/adult-filter';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const config = await getAvailableApiSites(authInfo.username);
    const globalConfig = await getConfig();

    const shouldFilterAdult = resolveAdultFilter(
      searchParams,
      globalConfig.SiteConfig.DisableYellowFilter,
    );

    const apiSites = shouldFilterAdult
      ? config.filter((site) => !site.is_adult)
      : config;

    return NextResponse.json(apiSites, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cookie',
        'X-Adult-Filter': shouldFilterAdult ? 'enabled' : 'disabled',
      },
    });
  } catch {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}