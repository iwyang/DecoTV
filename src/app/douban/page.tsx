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

  const [multiLevelValues, setMultiLevelValues] = useState<Record<string, string>>({
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

  const [filteredSourceCategories, setFilteredSourceCategories] = useState<SourceCategory[]>([]);

  const [selectedSourceCategory, setSelectedSourceCategory] = useState<SourceCategory | null>(null);

  const [sourceData, setSourceData] = useState<DoubanItem[]>([]);
  const [isLoadingSourceData, setIsLoadingSourceData] = useState(false);

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setCustomCategories(runtimeConfig.CUSTOM_CATEGORIES);
    }
  }, []);

  useEffect(() => {
    currentParamsRef.current = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage,
    };
  }, [type, primarySelection, secondarySelection, multiLevelValues, selectedWeekday, currentPage]);

  useEffect(() => {
    const timer = setTimeout(() => setSelectorsReady(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true);
  }, [type]);

  useEffect(() => {
    if (type === 'custom' && customCategories.length > 0) {
      const types = Array.from(new Set(customCategories.map((cat) => cat.type)));
      if (types.length > 0) {
        let selectedType = types.includes('movie') ? 'movie' : types[0];
        setPrimarySelection(selectedType);
        const firstCategory = customCategories.find((cat) => cat.type === selectedType);
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

    const timer = setTimeout(() => setSelectorsReady(true), 50);
    return () => clearTimeout(timer);
  }, [type, customCategories]);

  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  const isSnapshotEqual = useCallback((snapshot1: any, snapshot2: any) => {
    return (
      snapshot1.type === snapshot2.type &&
      snapshot1.primarySelection === snapshot2.primarySelection &&
      snapshot1.secondarySelection === snapshot2.secondarySelection &&
      snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
      snapshot1.currentPage === snapshot2.currentPage &&
      JSON.stringify(snapshot1.multiLevelSelection) === JSON.stringify(snapshot2.multiLevelSelection)
    );
  }, []);

  const getRequestParams = useCallback((pageStart: number) => {
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
  }, [type, primarySelection, secondarySelection]);

  const loadInitialData = useCallback(async () => {
    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage: 0,
    };

    try {
      setLoading(true);
      setDoubanData([]);
      setCurrentPage(0);
      setHasMore(true);
      setIsLoadingMore(false);

      let data: DoubanResult;

      if (type === 'custom') {
        const selectedCategory = customCategories.find(
          (cat) => cat.type === primarySelection && cat.query === secondarySelection
        );
        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 25,
            pageStart: 0,
          });
        } else {
          throw new Error('没有找到对应的分类');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendarData = await GetBangumiCalendarData();
        const weekdayData = calendarData.find((item) => item.weekday.en === selectedWeekday);
        if (weekdayData) {
          data = {
            code: 200,
            message: 'success',
            list: weekdayData.items
              .filter((item) => item && item.id)
              .map((item) => ({
                id: item.id?.toString() || '',
                title: item.name_cn || item.name,
                poster:
                  item.images?.large ||
                  item.images?.common ||
                  item.images?.medium ||
                  item.images?.small ||
                  item.images?.grid ||
                  '/logo.png',
                rate: item.rating?.score?.toFixed(1) || '',
                year: item.air_date?.split('-')?.[0] || '',
              })),
          };
        } else {
          throw new Error('没有找到对应的日期');
        }
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番剧' ? 'tv' : 'movie',
          pageLimit: 25,
          pageStart: 0,
          category: '动画',
          format: primarySelection === '番剧' ? '电视剧' : '',
          region: multiLevelValues.region ? multiLevelValues.region : '',
          year: multiLevelValues.year ? multiLevelValues.year : '',
          platform: multiLevelValues.platform ? multiLevelValues.platform : '',
          sort: multiLevelValues.sort ? multiLevelValues.sort : '',
          label: multiLevelValues.label ? multiLevelValues.label : '',
        });
      } else if (primarySelection === '全部') {
        data = await getDoubanRecommends({
          kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
          pageLimit: 25,
          pageStart: 0,
          category: multiLevelValues.type ? multiLevelValues.type : '',
          format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
          region: multiLevelValues.region ? multiLevelValues.region : '',
          year: multiLevelValues.year ? multiLevelValues.year : '',
          platform: multiLevelValues.platform ? multiLevelValues.platform : '',
          sort: multiLevelValues.sort ? multiLevelValues.sort : '',
          label: multiLevelValues.label ? multiLevelValues.label : '',
        });
      } else {
        data = await getDoubanCategories(getRequestParams(0));
      }

      if (data.code === 200) {
        const currentSnapshot = { ...currentParamsRef.current };
        if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
          setDoubanData(data.list);
          setHasMore(data.list.length > 0);
          setLoading(false);
        }
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }, [type, primarySelection, secondarySelection, multiLevelValues, selectedWeekday, getRequestParams, customCategories]);

  useEffect(() => {
    if (!selectorsReady) return;
    if (currentSource !== 'auto') {
      setLoading(false);
      return;
    }

    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => loadInitialData(), 100);

    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [selectorsReady, type, primarySelection, secondarySelection, multiLevelValues, selectedWeekday, loadInitialData, currentSource]);

  // 加载更多
  useEffect(() => {
    if (currentPage === 0 || currentSource !== 'auto') return;

    const fetchMoreData = async () => {
      const requestSnapshot = {
        type,
        primarySelection,
        secondarySelection,
        multiLevelSelection: multiLevelValues,
        selectedWeekday,
        currentPage,
      };

      try {
        setIsLoadingMore(true);

        let data: DoubanResult;

        if (type === 'custom') {
          const selectedCategory = customCategories.find(
            (cat) => cat.type === primarySelection && cat.query === secondarySelection
          );
          if (selectedCategory) {
            data = await getDoubanList({
              tag: selectedCategory.query,
              type: selectedCategory.type,
              pageLimit: 25,
              pageStart: currentPage * 25,
            });
          } else {
            throw new Error('没有找到对应的分类');
          }
        } else if (type === 'anime' && primarySelection === '每日放送') {
          data = { code: 200, message: 'success', list: [] };
        } else if (type === 'anime') {
          data = await getDoubanRecommends({
            kind: primarySelection === '番剧' ? 'tv' : 'movie',
            pageLimit: 25,
            pageStart: currentPage * 25,
            category: '动画',
            format: primarySelection === '番剧' ? '电视剧' : '',
            region: multiLevelValues.region || '',
            year: multiLevelValues.year || '',
            platform: multiLevelValues.platform || '',
            sort: multiLevelValues.sort || '',
            label: multiLevelValues.label || '',
          });
        } else if (primarySelection === '全部') {
          data = await getDoubanRecommends({
            kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
            pageLimit: 25,
            pageStart: currentPage * 25,
            category: multiLevelValues.type || '',
            format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
            region: multiLevelValues.region || '',
            year: multiLevelValues.year || '',
            platform: multiLevelValues.platform || '',
            sort: multiLevelValues.sort || '',
            label: multiLevelValues.label || '',
          });
        } else {
          data = await getDoubanCategories(getRequestParams(currentPage * 25));
        }

        if (data.code === 200) {
          const currentSnapshot = { ...currentParamsRef.current };
          if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
            setDoubanData((prev) => [...prev, ...data.list]);
            setHasMore(data.list.length > 0);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingMore(false);
      }
    };

    fetchMoreData();
  }, [currentPage, type, primarySelection, secondarySelection, multiLevelValues, selectedWeekday, customCategories, getRequestParams]);

  // 滚动监听
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading) return;
    if (!loadingRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => observerRef.current?.disconnect();
  }, [hasMore, isLoadingMore, loading]);

  const handlePrimaryChange = useCallback((value: string) => {
    if (value === primarySelection) return;

    setLoading(true);
    setCurrentPage(0);
    setDoubanData([]);
    setHasMore(true);
    setIsLoadingMore(false);
    setMultiLevelValues({
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    });

    if (type === 'custom' && customCategories.length > 0) {
      const firstCategory = customCategories.find((cat) => cat.type === value);
      setPrimarySelection(value);
      if (firstCategory) {
        setSecondarySelection(firstCategory.query);
      }
    } else {
      setPrimarySelection(value);
      if ((type === 'tv' || type === 'show') && value === '最近热门') {
        setSecondarySelection(type === 'tv' ? 'tv' : 'show');
      }
    }
  }, [primarySelection, type, customCategories]);

  const handleSecondaryChange = useCallback((value: string) => {
    if (value === secondarySelection) return;
    setLoading(true);
    setCurrentPage(0);
    setDoubanData([]);
    setHasMore(true);
    setIsLoadingMore(false);
    setSecondarySelection(value);
  }, [secondarySelection]);

  const handleMultiLevelChange = useCallback((values: Record<string, string>) => {
    const isEqual = JSON.stringify(values) === JSON.stringify(multiLevelValues);
    if (isEqual) return;

    setLoading(true);
    setCurrentPage(0);
    setDoubanData([]);
    setHasMore(true);
    setIsLoadingMore(false);
    setMultiLevelValues(values);
  }, [multiLevelValues]);

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  const fetchSourceCategoryData = useCallback(async (category: SourceCategory) => {
    if (currentSource === 'auto') return;

    const source = sources.find((s) => s.key === currentSource);
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

      const response = await fetch(fetchUrl, {
        headers: { Accept: 'application/json' },
      });

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
  }, [currentSource, sources]);

  const handleSourceChange = useCallback(async (sourceKey: string) => {
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
      setLoading(false);
      return;
    }

    const source = sources.find((s) => s.key === sourceKey);
    if (!source) {
      setLoading(false);
      return;
    }

    // 屏蔽艾旦影视源的所有分类
    const lowerName = (source.name || '').toLowerCase();
    const lowerApi = (source.api || '').toLowerCase();
    const lowerKey = (source.key || '').toLowerCase();

    if (lowerName.includes('艾旦影视') || lowerApi.includes('艾旦影视') || lowerKey.includes('aidan') || lowerKey.includes('艾旦')) {
      console.log('检测到艾旦影视相关源，已屏蔽其所有分类');
      setFilteredSourceCategories([]);
      setLoading(false);
      return;
    }

    try {
      const originalApiUrl = source.api.endsWith('/') ? `${source.api}?ac=class` : `${source.api}/?ac=class`;

      const isExternalUrl = originalApiUrl.startsWith('http://') || originalApiUrl.startsWith('https://');
      const proxyUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;
      const fetchUrl = isExternalUrl ? proxyUrl : originalApiUrl;

      const response = await fetch(fetchUrl, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) throw new Error(`获取分类列表失败: ${response.status}`);

      const data = await response.json();
      const allCategories: SourceCategory[] = data.class || [];

      if (allCategories.length === 0) {
        setFilteredSourceCategories([]);
        setLoading(false);
        return;
      }

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
          (blocked) => name.includes(blocked) || id.includes(blocked)
        );
      });

      setFilteredSourceCategories(filteredCategories);

      if (filteredCategories.length === 0) {
        setLoading(false);
        return;
      }

      const firstCategory = filteredCategories[0];
      setSelectedSourceCategory(firstCategory);
      fetchSourceCategoryData(firstCategory);
    } catch (err) {
      console.error('获取分类失败:', err);
      setFilteredSourceCategories([]);
      setLoading(false);
    }
  }, [currentSource, setCurrentSource, type, sources, fetchSourceCategoryData]);

  const handleSourceCategoryChange = useCallback((category: SourceCategory) => {
    if (selectedSourceCategory?.type_id === category.type_id) return;

    setLoading(true);
    setCurrentPage(0);
    setSourceData([]);
    setHasMore(true);
    setIsLoadingMore(false);
    setSelectedSourceCategory(category);
    fetchSourceCategoryData(category);
  }, [selectedSourceCategory, fetchSourceCategoryData]);

  const getPageTitle = () => {
    return type === 'movie' ? '电影' : type === 'tv' ? '电视剧' : type === 'anime' ? '动漫' : type === 'show' ? '综艺' : '自定义';
  };

  const getPageDescription = () => {
    if (type === 'anime' && primarySelection === '每日放送') {
      return '来自 Bangumi 番组计划的精选内容';
    }
    return '来自豆瓣的精选内容';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    const queryString = params.toString();
    return `/douban${queryString ? `?${queryString}` : ''}`;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className="px-4 sm:px-10 py-4 sm:py-8 overflow-visible">
        <div className="mb-6 sm:mb-8 space-y-4 sm:space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200">
              {getPageTitle()}
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
              {getPageDescription()}
            </p>
          </div>

          {type !== 'custom' ? (
            <div className="bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm">
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
            <div className="bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm">
              <DoubanCustomSelector
                customCategories={customCategories}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
              />
            </div>
          )}
        </div>

        <div className="max-w-[95%] mx-auto mt-8 overflow-visible">
          <div className="justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20">
            {loading || isLoadingSourceData || !selectorsReady ? (
              skeletonData.map((index) => <DoubanCardSkeleton key={index} />)
            ) : currentSource !== 'auto' && sourceData.length > 0 ? (
              sourceData.map((item, index) => (
                <div key={`source-${item.id}-${index}`} className="w-full">
                  <VideoCard
                    from="douban"
                    title={item.title}
                    poster={item.poster}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''}
                  />
                </div>
              ))
            ) : currentSource !== 'auto' && filteredSourceCategories.length === 0 ? (
              <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                <p>该源暂无可用分类</p>
                <p className="text-sm mt-2">请尝试其他数据源</p>
              </div>
            ) : currentSource !== 'auto' && selectedSourceCategory ? (
              <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                <p>该分类暂无数据</p>
                <p className="text-sm mt-2">请尝试选择其他分类</p>
              </div>
            ) : currentSource !== 'auto' && !selectedSourceCategory ? (
              <div className="col-span-full text-center py-12 text-gray-500 dark:text-gray-400">
                <p>请选择一个分类</p>
                <p className="text-sm mt-2">从上方分类列表中选择</p>
              </div>
            ) : (
              doubanData.map((item, index) => (
                <div key={`${item.title}-${index}`} className="w-full">
                  <VideoCard
                    from="douban"
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

          {hasMore && !loading && (
            <div
              ref={loadingRef}
              className="flex justify-center mt-12 py-8"
            >
              {isLoadingMore && (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500"></div>
                  <span className="text-gray-600">加载中...</span>
                </div>
              )}
            </div>
          )}

          {!hasMore && (doubanData.length > 0 || sourceData.length > 0) && (
            <div className="text-center text-gray-500 py-8">已加载全部内容</div>
          )}

          {!loading && doubanData.length === 0 && sourceData.length === 0 && filteredSourceCategories.length > 0 && selectedSourceCategory && (
            <div className="text-center text-gray-500 py-8">暂无相关内容</div>
          )}
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
