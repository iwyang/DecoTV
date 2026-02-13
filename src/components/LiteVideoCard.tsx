'use client';

import { useRouter } from 'next/navigation';
import { memo, useCallback, useMemo, useState } from 'react';

import { optimizeGridImageUrl, processImageUrl } from '@/lib/utils';

import ExternalImage from '@/components/ExternalImage';
import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import { SimpleRatingBadge } from '@/components/RatingBadge';

interface LiteVideoCardProps {
  title?: string;
  poster?: string;
  year?: string;
  rate?: string;
  type?: string;
  isBangumi?: boolean;
}

const LiteVideoCard = memo(function LiteVideoCard({
  title = '',
  poster = '',
  year = '',
  rate,
  type = '',
}: LiteVideoCardProps) {
  const router = useRouter();
  const [isLoaded, setIsLoaded] = useState(false);

  const posterUrl = useMemo(() => {
    const proxied = processImageUrl(poster);
    const optimized = optimizeGridImageUrl(proxied, {
      width: 320,
      height: 480,
      quality: 64,
    });

    return optimized || '/logo.png';
  }, [poster]);

  const handleClick = useCallback(() => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const url = `/play?title=${encodeURIComponent(trimmedTitle)}${
      year ? `&year=${year}` : ''
    }${type ? `&stype=${type}` : ''}`;

    router.push(url);
  }, [router, title, year, type]);

  return (
    <div
      className='group relative w-full cursor-pointer'
      onClick={handleClick}
      style={{
        contain: 'layout style paint',
        contentVisibility: 'auto',
        containIntrinsicSize: '340px',
      }}
    >
      <div className='relative aspect-2/3 overflow-hidden rounded-lg'>
        {!isLoaded && <ImagePlaceholder aspectRatio='aspect-2/3' />}
        <ExternalImage
          src={posterUrl}
          alt={title}
          fill
          unoptimized={false}
          quality={64}
          sizes='(max-width: 640px) 31vw, (max-width: 1024px) 18vw, 12vw'
          fetchPriority='low'
          loading='lazy'
          decoding='async'
          referrerPolicy='no-referrer'
          className={`object-cover transition-opacity duration-200 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setIsLoaded(true)}
          onError={() => setIsLoaded(true)}
          draggable={false}
        />
        {rate ? <SimpleRatingBadge rating={rate} /> : null}
      </div>

      <div className='mt-2 text-center'>
        <span className='block truncate text-sm font-semibold text-slate-800 dark:text-gray-100'>
          {title}
        </span>
        {year && year !== 'unknown' ? (
          <span className='mt-1 inline-block rounded border border-gray-500/50 px-2 py-0.5 text-xs text-slate-600 dark:text-gray-400'>
            {year}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export default LiteVideoCard;
