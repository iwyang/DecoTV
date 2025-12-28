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

  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  const type = searchParams.get('type') || 'movie';

  const [customCategories, setCustomCategories] = useState<
    Array<{ name: string; type: 'movie' | 'tv'; query: string }>
  >([]);

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

  const [selectedWeekday, setSelectedWeekday] = useState<string>('');

  const {
    sources,
    currentSource,
    isLoadingSources,
    isLoadingCategories,
    setCurrentSource,
    getFilteredCategories,
  } = useSourceFilter();

  const [filteredSourceCategories, setFilteredSourceCategories] = useState<
    SourceCategory[]
  >([]);

  const [selectedSourceCategory, setSelectedSourceCategory] =
    useState<SourceCategory | null>(null);

  const [sourceData, setSourceData] = useState<DoubanItem[]>([]);
  const [isLoadingSourceData, setIsLoadingSourceData] = useState(false);

  // 获取自定义分类数据
  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setCustomCategories(runtimeConfig.CUSTOM_CATEGORIES);
    }
  }, []);

  // 同步参数到 ref
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

  // 初始化 selectorsReady
  useEffect(() => {
    const timer = setTimeout(() => setSelectorsReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true);
  }, [type]);

  // type 变化时重置选择器
  useEffect(() => {
    if (type === 'custom' && customCategories.length > 0) {
      const types = Array.from(new Set(customCategories.map(cat => cat.type)));
      let selectedType = types.includes('movie') ? 'movie' : types[0];
      setPrimarySelection(selectedType);
      const firstCategory = customCategories.find(cat => cat.type === selectedType);
      if (firstCategory) setSecondarySelection(firstCategory.query);
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

    const timer = setTimeout(() => setSelectorsReady(true), 50);
    return () => clearTimeout(timer);
  }, [type, customCategories]);

  const skeletonData = Array.from({ length: 25 }, (_, i) => i);

  const isSnapshotEqual = useCallback((s1: any, s2: any) => {
    return (
      s1.type === s2.type &&
      s1.primarySelection === s2.primarySelection &&
      s1.secondarySelection === s2.secondarySelection &&
      s1.selectedWeekday === s2.selectedWeekday &&
      s1.currentPage === s2.currentPage &&
      JSON.stringify(s1.multiLevelSelection) === JSON.stringify(s2.multiLevelSelection)
    );
  }, []);

  const getRequestParams = useCallback((pageStart: number) => {
    if (type === 'tv' || type === 'show') {
      return { kind: 'tv' as const, category: type, type: secondarySelection, pageLimit: 25, pageStart };
    }
    return { kind: type as 'tv' | 'movie', category: primarySelection, type: secondarySelection, pageLimit: 25, pageStart };
  }, [type, primarySelection, secondarySelection]);

  // loadInitialData、fetchMoreData 等函数保持原样（省略以节省篇幅）

  const fetchSourceCategoryData = useCallback(
    async (category: SourceCategory) => {
      if (currentSource === 'auto') return;

      const source = sources.find(s => s.key === currentSource);
      if (!source) {
        setLoading(false);
        return;
      }

      setIsLoadingSourceData(true);
      try {
        const originalApiUrl = source.api.endsWith('/')
          ? `${source.api}?ac=videolist&t=${category.type_id}&pg=1`
          : `${source.api}/?ac=videolist&t=${category.type_id}&pg=1`;

        const isExternalUrl = originalApiUrl.startsWith('http://') || originalApiUrl.startsWith('https://');
        const proxyUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;
        const fetchUrl = isExternalUrl ? proxyUrl : originalApiUrl;

        const response = await fetch(fetchUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('获取分类数据失败');

        const data = await response.json();
        const items = data.list || [];

        const convertedItems: DoubanItem[] = items.map((item: any) => ({
          id: item.vod_id?.toString() || '',
          title: item.vod_name || '',
          poster: item.vod_pic || '',
          rating: 0,
          year: item.vod_year || '',
          subtitle: item.vod_remarks || '',
        }));

        setSourceData(convertedItems);
        setHasMore(items.length >= 20);
      } catch (error) {
        console.error('获取源分类数据失败:', error);
        setSourceData([]);
      } finally {
        setIsLoadingSourceData(false);
        setLoading(false);
      }
    },
    [currentSource, sources],
  );

  // 【核心修改】处理数据源切换
  const handleSourceChange = useCallback(
    async (sourceKey: string) => {
      if (sourceKey === currentSource) return;

      // 重置状态
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
        // 聚合模式逻辑不变
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
        setMultiLevelValues({ type: 'all', region: 'all', year: 'all', platform: 'all', label: 'all', sort: 'T' });
        setLoading(false); // 聚合模式由其他 effect 加载
        return;
      }

      // === 特定源模式 ===
      const source = sources.find(s => s.key === sourceKey);
      if (!source) {
        console.error('Source not found:', sourceKey);
        setLoading(false);
        return;
      }

      // 【新增判断】如果源名称或 API 包含“艾旦影视”，直接屏蔽其所有分类
      const sourceName = (source.name || '').toLowerCase();
      const sourceApi = (source.api || '').toLowerCase();
      const sourceKeyLower = (source.key || '').toLowerCase();

      if (
        sourceName.includes('艾旦影视') ||
        sourceApi.includes('艾旦影视') ||
        sourceKeyLower.includes('aidan') ||
        sourceKeyLower.includes('艾旦')
      ) {
        console.log('🔥 检测到艾旦影视相关源，已屏蔽其所有分类');
        setFilteredSourceCategories([]); // 空分类列表
        setLoading(false);
        return;
      }

      // === 正常源：获取并过滤敏感分类 ===
      try {
        const originalApiUrl = source.api.endsWith('/') ? `${source.api}?ac=class` : `${source.api}/?ac=class`;
        const isExternalUrl = originalApiUrl.startsWith('http://') || originalApiUrl.startsWith('https://');
        const proxyUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;
        const fetchUrl = isExternalUrl ? proxyUrl : originalApiUrl;

        const response = await fetch(fetchUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`获取分类失败: ${response.status}`);

        const data = await response.json();
        const allCategories: SourceCategory[] = data.class || [];

        if (allCategories.length === 0) {
          setFilteredSourceCategories([]);
          setLoading(false);
          return;
        }

        // 敏感分类关键词屏蔽（你之前提供的名单）
        const BLOCKED_CATEGORIES = [
          '伦理片', '里番动漫', '同性', '伦理', '三级伦理', '网红主播',
          '韩国伦理', '西方伦理', '日本伦理', '两性课堂', '写真热舞',
          '擦边短剧', '港台三级', '里番动画', '成人', '里番', '理论片', '福利',
        ];

        const filteredCategories = allCategories.filter((cat: SourceCategory) => {
          const name = (cat.type_name || '').trim();
          const id = (cat.type_id || '').toString().trim();
          return !BLOCKED_CATEGORIES.some(blocked => name.includes(blocked) || id.includes(blocked));
        });

        console.log(`✅ 分类过滤: ${allCategories.length} → ${filteredCategories.length}`);

        setFilteredSourceCategories(filteredCategories);

        if (filteredCategories.length === 0) {
          console.warn('该源经筛选后无可用分类');
          setLoading(false);
          return;
        }

        // 自动选中第一个并加载数据
        const firstCategory = filteredCategories[0];
        setSelectedSourceCategory(firstCategory);
        fetchSourceCategoryData(firstCategory);
      } catch (err) {
        console.error('获取分类失败:', err);
        setFilteredSourceCategories([]);
        setLoading(false);
      }
    },
    [currentSource, setCurrentSource, type, sources, fetchSourceCategoryData],
  );

  const handleSourceCategoryChange = useCallback(
    (category: SourceCategory) => {
      if (selectedSourceCategory?.type_id !== category.type_id) {
        setLoading(true);
        setCurrentPage(0);
        setSourceData([]);
        setHasMore(true);
        setIsLoadingMore(false);
        setSelectedSourceCategory(category);
        fetchSourceCategoryData(category);
      }
    },
    [selectedSourceCategory, fetchSourceCategoryData],
  );

  // 其他函数（getPageTitle 等）保持不变...

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              {getPageDescription()}
            </p>
          </div>

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
                sources={sources}
                currentSource={currentSource}
                sourceCategories={
                  currentSource !== 'auto'
                    ? filteredSourceCategories
                    : getFilteredCategories(type as 'movie' | 'tv' | 'anime' | 'show')
                }
                isLoadingSources={isLoadingSources}
                isLoadingCategories={isLoadingCategories}
                onSourceChange={handleSourceChange}
                onSourceCategoryChange={handleSourceCategoryChange}
                selectedSourceCategory={selectedSourceCategory}
              />
            </div>
          ) : (
            // 自定义分类组件不变
          )}
        </div>

        {/* 内容区域渲染逻辑不变 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
            {loading || isLoadingSourceData || !selectorsReady ? (
              skeletonData.map(index => <DoubanCardSkeleton key={index} />)
            ) : currentSource !== 'auto' && sourceData.length > 0 ? (
              sourceData.map((item, index) => (
                <div key={`source-${item.id}-${index}`} className='w-full'>
                  <VideoCard from='douban' title={item.title} poster={item.poster} year={item.year} type={type === 'movie' ? 'movie' : ''} />
                </div>
              ))
            ) : currentSource !== 'auto' && filteredSourceCategories.length === 0 ? (
              // 【关键提示】艾旦影视源被屏蔽分类后的提示
              <div className='col-span-full text-center py-12 text-gray-500 dark:text-gray-400'>
                <p>该源暂无可用分类</p>
                <p className='text-sm mt-2'>请尝试其他数据源</p>
              </div>
            ) : currentSource !== 'auto' && selectedSourceCategory ? (
              <div className='col-span-full text-center py-12 text-gray-500 dark:text-gray-400'>
                <p>该分类暂无数据</p>
                <p className='text-sm mt-2'>请尝试选择其他分类</p>
              </div>
            ) : currentSource !== 'auto' && !selectedSourceCategory ? (
              <div className='col-span-full text-center py-12 text-gray-500 dark:text-gray-400'>
                <p>请选择一个分类</p>
              </div>
            ) : (
              doubanData.map((item, index) => (
                <div key={`${item.title}-${index}`} className='w-full'>
                  <VideoCard
                    from='douban'
                    title={item.title}
                    poster={item.poster}
                    douban_id={Number(item.id)}
                    rate={item.rate}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''}
                    isBangumi={type === 'anime' && primarySelection === '每日放送'}
                  />
                </div>
              ))
            )}
          </div>

          {/* 加载更多等 UI 不变 */}
        </div>
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
