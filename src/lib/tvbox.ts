/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdminConfig } from './admin.types';

interface TVBoxSite {
  key: string;
  name: string;
  type: number;
  api: string;
  searchable?: number;
  quickSearch?: number;
  filterable?: number;
  ext?: string;
  categories?: string[];
}

interface TVBoxJson {
  spider?: string;
  wallpaper?: string;
  sites: TVBoxSite[];
  lives?: any[];
}

export async function fetchTVBoxConfig(url: string): Promise<TVBoxJson> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'okhttp/3.12.1',
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch TVBox config: ${res.status} ${res.statusText}`
    );
  }

  const buffer = await res.arrayBuffer();
  const data = Buffer.from(buffer);
  let content = data.toString('utf8');

  // Check for JPEG header (FF D8)
  if (data.length > 2 && data[0] === 0xff && data[1] === 0xd8) {
    // Find the LAST occurrence of FF D9 (EOI) to avoid thumbnails
    const jpegEnd = data.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (jpegEnd !== -1) {
      const remaining = data.subarray(jpegEnd + 2);
      const remainingText = remaining.toString('utf8');

      // Look for base64 start
      // "ew" is start of "{" in base64
      // "ey" is start of "{" in base64 (if followed by "J" -> "{"key"...)
      let b64Start = remainingText.indexOf('ew');
      if (b64Start === -1) b64Start = remainingText.indexOf('ey');

      if (b64Start !== -1) {
        try {
          content = Buffer.from(
            remainingText.substring(b64Start),
            'base64'
          ).toString('utf8');
        } catch (e) {
          console.warn(
            'Failed to decode base64 from JPEG content, trying raw text',
            e
          );
          content = remainingText;
        }
      } else {
        // If no base64 pattern found, maybe it is just raw text after image
        // Some configs might have a prefix like "ZRCgVbJH**" before the json/base64
        // We try to find the first '{'
        const firstBrace = remainingText.indexOf('{');
        if (firstBrace !== -1) {
          content = remainingText.substring(firstBrace);
        } else {
          content = remainingText;
        }
      }
    }
  }

  // Strip comments (// ...)
  // Be careful with http://
  // We use a regex that matches // not preceded by :
  // Also handle comments at start of line
  const jsonStr = content.replace(/(^|[^:])\/\/.*$/gm, '$1');

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Try parsing original content if stripping failed or wasn't needed
    try {
      return JSON.parse(content);
    } catch (e2) {
      // Last resort: try to find the first '{' and last '}' in the whole content
      // This helps if there is garbage before or after the JSON
      const first = content.indexOf('{');
      const last = content.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        try {
          return JSON.parse(content.substring(first, last + 1));
        } catch (e3) {
          throw new Error('Invalid TVBox config format: not a valid JSON');
        }
      }
      throw new Error('Invalid TVBox config format: not a valid JSON');
    }
  }
}

export function parseTVBoxSites(config: TVBoxJson): TVBoxSite[] {
  if (!config.sites || !Array.isArray(config.sites)) {
    return [];
  }
  // 过滤出支持的类型：1 (json)
  // DecoTV 目前仅支持 JSON 格式的 CMS 接口
  return config.sites.filter((site) => site.type === 1);
}

export function sanitizeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

export function mergeTVBoxSites(
  adminConfig: AdminConfig,
  sites: TVBoxSite[],
  subscriptionName: string
): AdminConfig {
  const newConfig = { ...adminConfig };
  const safeName = sanitizeKey(subscriptionName);

  // 移除该订阅源之前的站点（如果有）
  newConfig.SourceConfig = newConfig.SourceConfig.filter(
    (s) => !s.key.startsWith(`tvbox_${safeName}_`)
  );

  // 添加新站点
  const newSites = sites.map((site) => ({
    key: `tvbox_${safeName}_${site.key}`,
    name: `${site.name}`,
    api: site.api,
    from: 'tvbox' as const,
    disabled: false,
    is_adult: false, // 默认为非成人，后续可手动修改
    detail: site.name, // 存储原始名称作为详情
  }));

  newConfig.SourceConfig.push(...newSites);

  return newConfig;
}

export function removeTVBoxSites(
  adminConfig: AdminConfig,
  subscriptionName: string
): AdminConfig {
  const newConfig = { ...adminConfig };
  const safeName = sanitizeKey(subscriptionName);

  newConfig.SourceConfig = newConfig.SourceConfig.filter(
    (s) => !s.key.startsWith(`tvbox_${safeName}_`)
  );

  return newConfig;
}
