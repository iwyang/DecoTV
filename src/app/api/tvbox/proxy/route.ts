/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';  // 假设你有这个获取配置的函数

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 确保实时运行

// 违禁分类关键词列表（已去重、整理、覆盖常见变体）
const BLOCKED_CATEGORIES = [
  '伦理片',
  '里番动漫',
  '同性',
  '伦理',
  '三级伦理',
  '网红主播',
  '韩国伦理',
  '西方伦理',
  '日本伦理',
  '两性课堂',
  '写真热舞',
  '擦边短剧',
  '港台三级',
  '里番动画',
  '成人',
  '里番',
  '理论片',
  '福利',
  // 以下为补充常见绕过/变体词（可根据实际情况增删）
  '三级片',
  '三级',
  'AV',
  'av',
  '成人动漫',
  'H动漫',
  '情色',
  '写真',
  '热舞',
  '主播',
  '直播',           // 可选：如果直播分类正常内容较多，可删除此行
  '美女直播',
  '短剧',           // 可选：很多擦边内容藏在短剧里
  '微短剧',
  '成人电影',
  '限制级',
  '情色电影',
  '丝袜',
  '制服',
  '自拍',
  '偷拍',
  '同志',
  'gay',
  'les',
  '耽美',
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sourceKey = searchParams.get('source');

    if (!sourceKey) {
      return NextResponse.json(
        { code: 400, msg: '缺少 source 参数' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    const targetSource = config.SourceConfig.find((s: any) => s.key === sourceKey);

    if (!targetSource || targetSource.disabled) {
      return NextResponse.json(
        { code: 404, msg: `未找到或已禁用源: ${sourceKey}` },
        { status: 404 }
      );
    }

    // 构建原始 API 的完整 URL
    const originalParams = new URLSearchParams(searchParams);
    originalParams.delete('source'); // 移除代理专有参数
    const targetUrl = `${targetSource.api}${originalParams.toString() ? '?' + originalParams.toString() : ''}`;

    console.log(`[Proxy] 转发请求 → ${targetUrl}`);

    // 请求原始源
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TVBox Proxy/1.0)',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { code: response.status, msg: '上游源返回错误' },
        { status: response.status }
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch (e) {
      return NextResponse.json(
        { code: 500, msg: '上游返回非 JSON 格式' },
        { status: 500 }
      );
    }

    // 如果是搜索请求（有 wd 参数），通常不需过滤分类
    const isSearch = searchParams.has('wd');

    // 过滤分类（仅在非搜索请求时处理）
    if (!isSearch && Array.isArray(data.class)) {
      const originalCount = data.class.length;

      data.class = data.class.filter((cat: any) => {
        const name = (cat.type_name || cat.type || '').toString().trim().toLowerCase();
        return !BLOCKED_CATEGORIES.some(keyword =>
          name.includes(keyword.toLowerCase())
        );
      });

      console.log(
        `[Proxy 分类过滤] 源: ${sourceKey} | 原分类数: ${originalCount} → 过滤后: ${data.class.length}`
      );
    }

    // 可选：同时过滤列表中的成人内容（首页推荐、分类列表等）
    if (Array.isArray(data.list)) {
      data.list = data.list.filter((item: any) => {
        const text = [
          item.vod_name,
          item.vod_remarks,
          item.type_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return !BLOCKED_CATEGORIES.some(kw => text.includes(kw.toLowerCase()));
      });
    }

    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-cache, no-store', // 避免缓存导致过滤失效
      },
    });
  } catch (error: any) {
    console.error('[Proxy Error]', error);
    return NextResponse.json(
      { code: 500, msg: '代理处理失败', error: error.message },
      { status: 500 }
    );
  }
}

// 处理 CORS 预检
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}