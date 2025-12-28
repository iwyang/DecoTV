// src/lib/filter.ts  (或 app/lib/filter.ts，根据你的项目结构)

import { yellowWords } from './yellow';

export const blockedWords = [
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
  'AG',
  'DG',
  'BG',
  'MG',
  'PT',
  'BBIN',
  '沙巴',
  '开元',
  '皇冠',
  '罪恶之渊',  
  // 可继续添加更多隐晦代称
] as const;

/**
 * 统一敏感内容过滤函数
 * @param results 需要过滤的结果数组
 * @param shouldFilter 是否启用过滤
 * @param apiSites 可用站点列表（用于查找 source 是否为成人源）
 * @returns 过滤后的结果
 */
export function filterSensitiveContent(
  results: any[],
  shouldFilter: boolean,
  apiSites: any[] = []
): any[] {
  if (!shouldFilter) return results;

  return results.filter((result) => {
    const typeName = (result.type_name || '').toLowerCase();
    const title = (result.title || '').toLowerCase();
    const sourceKey = result.source_key || result.source || '';

    // 1. 屏蔽整站标记为成人的源
    const source = apiSites.find((s: any) => s.key === sourceKey);
    if (source?.is_adult) {
      return false;
    }

    // 2. 屏蔽分类包含成人敏感词
    if (yellowWords.some((word: string) => typeName.includes(word.toLowerCase()))) {
      return false;
    }

    // 3. 屏蔽标题或分类包含赌博违禁词
    if (
      blockedWords.some(
        (word) => title.includes(word.toLowerCase()) || typeName.includes(word.toLowerCase())
      )
    ) {
      return false;
    }

    return true;
  });
}