/* eslint-disable no-console,react-hooks/exhaustive-deps,@typescript-eslint/no-explicit-any */

'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';
import { useSourceFilter } from '@/hooks/useSourceFilter';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector, { SourceCategory } from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

function DoubanPageClient() {
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 用于存储最新参数值的 refs
  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  const type = searchParams.get('type') || 'movie';

  // 获取 runtimeConfig 中的自定义分类数据
  const [customCategories, setCustomCategories] = useState<
    Array<{ name: string; type: 'movie' | 'tv'; query: string }>
  >([]);

  // 选择器状态 - 完全独立，不依赖URL参数
  const [primarySelection, setPrimarySelection] = useState<string>(() => {
    if (type === 'movie') return '热门';
    if (type === 'tv' || type === 'show') return '最近热门';
    if (type === 'anime') return '每日放送';
    return '';
  });
  const [secondarySelection, setSecondarySelection] = useState<string>(() => {
    if (type === 'movie') return '全部';
    if (type === 'tv') return 'tv';
    if (type === 'show') return 'show';
    return '全部';
  });

  // MultiLevelSelector 状态
  const [multiLevelValues, setMultiLevelValues] = useState<
    Record<string, string>
  >({
    type: 'all',
    region: 'all',
    year: 'all',
    platform: 'all',
    label: 'all',
    sort: 'T',
  });

  // 星期选择器状态
  const [selectedWeekday, setSelectedWeekday] = useState<string>('');

  // 数据源筛选 Hook
  const {
    sources: originalSources, // 原始来源（未过滤）
    currentSource,
    isLoadingSources,
    isLoadingCategories,
    setCurrentSource,
    getFilteredCategories,
  } = useSourceFilter();

  // 新增：过滤后的可用源（屏蔽含有“艾旦影视”的源）
  const [filteredSources, setFilteredSources] = useState(originalSources);

  // 【核心修复】存储当前源的过滤后分类列表（用于渲染）
  const [filteredSourceCategories, setFilteredSourceCategories] = useState<
    SourceCategory[]
  >([]);

  // 选中的源分类
  const [selectedSourceCategory, setSelectedSourceCategory] =
    useState<SourceCategory | null>(null);

  // 源分类数据（用于直接查询源接口）
  const [sourceData, setSourceData] = useState<DoubanItem[]>([]);
  const [isLoadingSourceData, setIsLoadingSourceData] = useState(false);

  // 获取自定义分类数据
  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setCustomCategories(runtimeConfig.CUSTOM_CATEGORIES);
    }
  }, []);

  // 新增：实时过滤 sources，屏蔽含有“艾旦影视”的源
  useEffect(() => {
    const BLOCKED_SOURCE_KEYWORDS = ['艾旦影视'];

    const safeSources = originalSources.filter((source) => {
      const name = (source.name || '').toLowerCase();
      const api = (source.api || '').toLowerCase();
      const key = (source.key || '').toLowerCase();

      return !BLOCKED_SOURCE_KEYWORDS.some(
        (keyword) =>
          name.includes(keyword.toLowerCase()) ||
          api.includes(keyword.toLowerCase()) ||
          key.includes(keyword.toLowerCase())
      );
    });

    console.log(
      `✅ 来源过滤: 原 ${originalSources.length} 个 → 剩余 ${safeSources.length} 个 (已屏蔽含有“艾旦影视”的源)`,
    );

    setFilteredSources(safeSources);

    // 如果当前选中的源被屏蔽了，自动切回 auto
    if (
      currentSource !== 'auto' &&
      !safeSources.some((s) => s.key === currentSource)
    ) {
      console.log('当前源被屏蔽，自动切换回聚合模式');
      setCurrentSource('auto');
    }
  }, [originalSources, currentSource, setCurrentSource]);

  // 同步最新参数值到 ref
  useEffect(() => {
    currentParamsRef.current = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage,
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    currentPage,
  ]);

  // 初始化时标记选择器为准备好状态
  useEffect(() => {
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // type变化时立即重置selectorsReady（最高优先级）
  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true);
  }, [type]);

  // 当type变化时重置选择器状态
  useEffect(() => {
    if (type === 'custom' && customCategories.length > 0) {
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type)),
      );
      if (types.length > 0) {
        let selectedType = types.includes('movie') ? 'movie' : types[0];
        setPrimarySelection(selectedType);
        const firstCategory = customCategories.find(
          (cat) => cat.type === selectedType,
        );
        if (firstCategory) {
          setSecondarySelection(firstCategory.query);
        }
      }
    } else {
      if (type === 'movie') {
        setPrimarySelection('热门');
        setSecondarySelection('全部');
      } else if (type === 'tv') {
        setPrimarySelection('最近热门');
        setSecondarySelection('tv');
      } else if (type === 'show') {
        setPrimarySelection('最近热门');
        setSecondarySelection('show');
      } else if (type === 'anime') {
        setPrimarySelection('每日放送');
        setSecondarySelection('全部');
      } else {
        setPrimarySelection('');
        setSecondarySelection('全部');
      }
    }

    setMultiLevelValues({
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    });

    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [type, customCategories]);

  // 生成骨架屏数据
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  // 参数快照比较函数
  const isSnapshotEqual = useCallback(
    (
      snapshot1: any,
      snapshot2: any,
    ) => {
      return (
        snapshot1.type === snapshot2.type &&
        snapshot1.primarySelection === snapshot2.primarySelection &&
        snapshot1.secondarySelection === snapshot2.secondarySelection &&
        snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
        snapshot1.currentPage === snapshot2.currentPage &&
        JSON.stringify(snapshot1.multiLevelSelection) ===
          JSON.stringify(snapshot2.multiLevelSelection)
      );
    },
    [],
  );

  // 生成API请求参数的辅助函数
  const getRequestParams = useCallback(
    (pageStart: number) => {
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }
      return {
        kind: type as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        pageLimit: 25,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection],
  );

  // 防抖的数据加载函数（略，保持不变）
  const loadInitialData = useCallback(async () => {
    // ...（原代码不变）
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    getRequestParams,
    customCategories,
  ]);

  // 其他 useEffect 和函数保持不变（省略部分内容以突出修改点）

  // 从源接口获取分类数据
  const fetchSourceCategoryData = useCallback(
    async (category: SourceCategory) => {
      // ...（原代码不变）
    },
    [currentSource, filteredSources], // 更新依赖
  );

  // 处理数据源切换 - 实现链式自动选中逻辑
  const handleSourceChange = useCallback(
    async (sourceKey: string) => {
      if (sourceKey === currentSource) return;

      setLoading(true);
      setCurrentPage(0);
      setDoubanData([]);
      setSourceData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      setSelectedSourceCategory(null);
      setFilteredSourceCategories([]);
      setIsLoadingSourceData(false);

      setCurrentSource(sourceKey);

      if (sourceKey === 'auto') {
        // 切回聚合模式（逻辑不变）
        if (type === 'movie') {
          setPrimarySelection('热门');
          setSecondarySelection('全部');
        } else if (type === 'tv') {
          setPrimarySelection('最近热门');
          setSecondarySelection('tv');
        } else if (type === 'show') {
          setPrimarySelection('最近热门');
          setSecondarySelection('show');
        } else if (type === 'anime') {
          setPrimarySelection('每日放送');
          setSecondarySelection('全部');
        }
        setMultiLevelValues({
          type: 'all',
          region: 'all',
          year: 'all',
          platform: 'all',
          label: 'all',
          sort: 'T',
        });
      } else {
        const source = filteredSources.find((s) => s.key === sourceKey); // 使用 filteredSources
        if (!source) {
          console.error('🔥 [Debug] Source not found or blocked:', sourceKey);
          setLoading(false);
          return;
        }

        // ...（获取分类、过滤敏感分类等逻辑保持不变）

        try {
          // ...（fetch 分类逻辑不变）

          const allCategories: SourceCategory[] = data.class || [];

          if (allCategories.length === 0) {
            setFilteredSourceCategories([]);
            setLoading(false);
            return;
          }

          // 分类关键词屏蔽（你之前提供的名单）
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
          ];

          const filteredCategories = allCategories.filter((cat: SourceCategory) => {
            const name = (cat.type_name || '').trim();
            const id = (cat.type_id || '').toString().trim();
            return !BLOCKED_CATEGORIES.some(
              (blocked) => name.includes(blocked) || id.includes(blocked),
            );
          });

          console.log(
            '✅ Categories filtered:',
            allCategories.length,
            '→',
            filteredCategories.length,
          );

          setFilteredSourceCategories(filteredCategories);

          if (filteredCategories.length === 0) {
            console.warn('该源所有分类均被屏蔽');
            setLoading(false);
            return;
          }

          const firstCategory = filteredCategories[0];
          setSelectedSourceCategory(firstCategory);
          fetchSourceCategoryData(firstCategory);
        } catch (err) {
          console.error('🔥 [Debug] Fetch error:', err);
          setFilteredSourceCategories([]);
          setLoading(false);
        }
      }
    },
    [currentSource, setCurrentSource, type, filteredSources, fetchSourceCategoryData], // 依赖更新为 filteredSources
  );

  // 处理源分类切换（不变）
  const handleSourceCategoryChange = useCallback(
    (category: SourceCategory) => {
      // ...（原逻辑不变）
    },
    [selectedSourceCategory, fetchSourceCategoryData],
  );

  // ...（其余函数 getPageTitle 等保持不变）

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 选择器组件 */}
        {type !== 'custom' ? (
          <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
            <DoubanSelector
              type={type as 'movie' | 'tv' | 'show' | 'anime'}
              primarySelection={primarySelection}
              secondarySelection={secondarySelection}
              onPrimaryChange={handlePrimaryChange}
              onSecondaryChange={handleSecondaryChange}
              onMultiLevelChange={handleMultiLevelChange}
              onWeekdayChange={handleWeekdayChange}
              // 使用过滤后的 sources
              sources={filteredSources}
              currentSource={currentSource}
              sourceCategories={
                currentSource !== 'auto'
                  ? filteredSourceCategories
                  : getFilteredCategories(
                      type as 'movie' | 'tv' | 'anime' | 'show',
                    )
              }
              isLoadingSources={isLoadingSources}
              isLoadingCategories={isLoadingCategories}
              onSourceChange={handleSourceChange}
              onSourceCategoryChange={handleSourceCategoryChange}
              selectedSourceCategory={selectedSourceCategory}
            />
          </div>
        ) : (
          // ...（自定义分类不变）
        )}

        {/* 内容展示区域（不变） */}
        {/* ... */}
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
