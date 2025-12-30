/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getSpiderJar } from '@/lib/spiderJar';

// ================= Spider 公共可达 & 回退缓存逻辑 =================
const REMOTE_SPIDER_CANDIDATES: { url: string; md5?: string }[] = [
  {
    url: 'https://deco-spider.oss-cn-hangzhou.aliyuncs.com/XC.jar',
    md5: 'e53eb37c4dc3dce1c8ee0c996ca3a024',
  },
  {
    url: 'https://deco-spider-1250000000.cos.ap-shanghai.myqcloud.com/XC.jar',
    md5: 'e53eb37c4dc3dce1c8ee0c996ca3a024',
  },
  {
    url: 'https://cdn.gitcode.net/qq_26898231/TVBox/-/raw/main/JAR/XC.jar',
    md5: 'e53eb37c4dc3dce1c8ee0c996ca3a024',
  },
  {
    url: 'https://cdn.gitee.com/q215613905/TVBoxOS/raw/main/JAR/XC.jar',
    md5: 'e53eb37c4dc3dce1c8ee0c996ca3a024',
  },
  {
    url: 'https://gitcode.net/qq_26898231/TVBox/-/raw/main/JAR/XC.jar',
    md5: 'e53eb37c4dc3dce1c8ee0c996ca3a024',
  },
  {
    url: 'https://gitee.com/q215613905/TVBoxOS/raw/main/JAR/XC.jar',
    md5: 'e53eb37c4dc3dce1c8ee0c996ca3a024',
  },
  {
    url: 'https://gitcode.net/qq_26898231/TVBox/-/raw/main/JAR/XC.jar',
    md5: 'e53eb37c4dc3dce1c8ee0c996ca3a024',
  },
  {
    url: 'https://ghproxy.com/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    md5: 'a8b9c1d2e3f4',
  },
];

function isPrivateHost(host: string): boolean {
  if (!host) return true;
  const lower = host.toLowerCase();
  return (
    lower.startsWith('localhost') ||
    lower.startsWith('127.') ||
    lower.startsWith('0.0.0.0') ||
    lower.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower) ||
    lower.startsWith('192.168.') ||
    lower === '::1'
  );
}

function detectApiType(api: string): number {
  const url = api.toLowerCase().trim();

  if (url.startsWith('csp_')) return 3;

  if (
    url.includes('.xml') ||
    url.includes('xml.php') ||
    url.includes('api.php/provide/vod/at/xml') ||
    url.includes('provide/vod/at/xml') ||
    (url.includes('maccms') && url.includes('xml'))
  ) {
    return 0;
  }

  if (
    url.includes('.json') ||
    url.includes('json.php') ||
    url.includes('api.php/provide/vod') ||
    url.includes('provide/vod') ||
    url.includes('api.php') ||
    url.includes('maccms') ||
    url.includes('/api/') ||
    url.match(/\/provide.*vod/) ||
    url.match(/\/api.*vod/)
  ) {
    return 1;
  }

  return 1;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams, href } = new URL(req.url);
    const format = searchParams.get('format') || 'json';
    const mode = (searchParams.get('mode') || '').toLowerCase();
    const filterParam = searchParams.get('filter');
    const adultParam = searchParams.get('adult');
    const proxyParam = searchParams.get('proxy');
    const useSmartProxy = proxyParam !== 'off' && proxyParam !== 'disable';

    console.log(
      '[TVBox] request:',
      href,
      'format:',
      format,
      'mode:',
      mode,
      'filter:',
      filterParam,
      'proxy:',
      useSmartProxy,
    );

    const cfg = await getConfig();

    let shouldFilterAdult = true;
    if (filterParam === 'off' || filterParam === 'disable') {
      shouldFilterAdult = false;
      console.log('[TVBox] ⚠️ Adult filter DISABLED by explicit filter=off parameter');
    } else if (adultParam === '1' || adultParam === 'true') {
      shouldFilterAdult = false;
      console.log('[TVBox] ⚠️ Adult filter DISABLED by explicit adult=1 parameter');
    } else {
      console.log('[TVBox] 🔒 Adult filter ENABLED (strict safe mode)');
    }

    const forceSpiderRefresh = searchParams.get('forceSpiderRefresh') === '1';
    const jarInfo = await getSpiderJar(forceSpiderRefresh);
    const globalSpiderJar = jarInfo.success
      ? jarInfo.source
      : `${REMOTE_SPIDER_CANDIDATES[0].url};fail`;

    // ================= TVBox 配置主体 =================
    const tvboxConfig: any = {
      walls: [
        'https://img.ommmu.com/pic/2024/09/1726828800.jpg',
        'https://img.ommmu.com/pic/2024/09/1726828801.jpg',
      ],
      playerConfig: {},
      parses: [],
      lives: [],
      flags: ['qq', 'iqiyi', 'youku', 'mgtv', 'letv', 'pptv', 'sohu'],
      sites: cfg.SourceConfig.map((s: any) => {
        const proxyApi = `/api/tvbox/proxy?source=${s.key}`;
        return {
          key: s.key,
          name: s.name,
          type: detectApiType(s.api),
          api: proxyApi, // 使用代理过滤违禁分类
          search: 1,
          searchable: s.searchable ? 1 : 0,
          quickSearch: s.quickSearch ? 1 : 0,
          filterable: 1,
        };
      }),
      player: [
        {
          group: '硬解码',
          options: [
            { category: 4, name: 'opensles', value: '0' },
            { category: 4, name: 'overlay-format', value: '842225234' },
            { category: 4, name: 'framedrop', value: '1' },
            { category: 4, name: 'start-on-prepared', value: '1' },
            { category: 1, name: 'http-detect-range-support', value: '0' },
            { category: 1, name: 'fflags', value: 'fastseek' },
            { category: 4, name: 'reconnect', value: '1' },
            { category: 4, name: 'enable-accurate-seek', value: '0' },
            { category: 4, name: 'mediacodec', value: '1' },
            { category: 4, name: 'mediacodec-auto-rotate', value: '1' },
            { category: 4, name: 'mediacodec-handle-resolution-change', value: '1' },
            { category: 2, name: 'skip_loop_filter', value: '48' },
            { category: 4, name: 'packet-buffering', value: '0' },
            { category: 1, name: 'analyzeduration', value: '2000000' },
            { category: 1, name: 'probesize', value: '10485760' },
          ],
        },
      ],
      ads: [
        'mimg.0c1q0l.cn',
        'www.googletagmanager.com',
        'mc.usihnbcq.cn',
        'wan.51img1.com',
        'iqiyi.hbuioo.com',
        'vip.ffzyad.com',
        'https://lf1-cdn-tos.bytegoofy.com/obj/tos-cn-i-dy/455ccf9e8ae744378118e4bd289288dd',
      ],
      doh: [
        {
          name: '阿里DNS',
          url: 'https://dns.alidns.com/dns-query',
          ips: ['223.5.5.5', '223.6.6.6'],
        },
        {
          name: '腾讯DNS',
          url: 'https://doh.pub/dns-query',
          ips: ['119.29.29.29', '119.28.28.28'],
        },
      ],
    };

    // ================= Spider 处理 =================
    const overrideSpider = searchParams.get('spider');
    if (
      overrideSpider &&
      /^https?:\/\//i.test(overrideSpider) &&
      !isPrivateHost(new URL(overrideSpider).hostname)
    ) {
      tvboxConfig.spider = overrideSpider;
    } else {
      tvboxConfig.spider = globalSpiderJar;
    }

    tvboxConfig.spider_url = jarInfo.source;
    tvboxConfig.spider_md5 = jarInfo.md5;
    tvboxConfig.spider_cached = jarInfo.cached;
    tvboxConfig.spider_real_size = jarInfo.size;
    tvboxConfig.spider_tried = jarInfo.tried;
    tvboxConfig.spider_success = jarInfo.success;

    tvboxConfig.spider_backup = 'https://gitcode.net/qq_26898231/TVBox/-/raw/main/JAR/XC.jar';
    tvboxConfig.spider_candidates = REMOTE_SPIDER_CANDIDATES.map((c) => c.url);

    // ================= 配置验证日志 =================
    console.log('TVBox配置验证:', {
      sitesCount: tvboxConfig.sites.length,
      livesCount: tvboxConfig.lives.length,
      parsesCount: tvboxConfig.parses.length,
      spider: tvboxConfig.spider ? '已设置' : '未设置',
      spiderUrl: tvboxConfig.spider.split(';')[0],
      mode: mode || 'standard',
    });

    // ================= 返回响应 =================
    let responseContent: string;
    let contentType: string;

    if (format === 'base64') {
      const jsonString = JSON.stringify(tvboxConfig, null, 0);
      responseContent = Buffer.from(jsonString, 'utf-8').toString('base64');
      contentType = 'text/plain; charset=utf-8';
    } else {
      responseContent = JSON.stringify(
        tvboxConfig,
        (key, value) => {
          if (['type', 'searchable', 'quickSearch', 'filterable'].includes(key)) {
            return typeof value === 'string' ? parseInt(value) || 0 : value;
          }
          return value;
        },
        0
      );
      contentType = 'text/plain; charset=utf-8';
    }

    return new NextResponse(responseContent, {
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'Content-Type',
      },
    });
  } catch (e) {
    console.error('TVBox 配置生成失败:', e);
    return NextResponse.json(
      {
        error: 'TVBox 配置生成失败',
        details: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
    },
  });
}