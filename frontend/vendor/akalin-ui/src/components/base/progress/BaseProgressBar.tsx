/**
 * @file BaseProgressBar.tsx
 * @description Temel ve jenerik ilerleme çubuğu (progress bar) bileşeni.
 * Yüzdelik değer, dinamik renk/arka plan sınıfları ve opsiyonel sol/sağ etiket desteği sunar.
 */

import React from 'react';

export interface BaseProgressBarProps {
  progress: number; // 0 to 100
  colorClass?: string; // Tailwind bg color class (e.g. 'bg-primary', 'bg-success', 'bg-warning', 'bg-danger')
  backgroundColorClass?: string; // Tailwind background color class for the track
  height?: number; // Height in pixels
  labelLeft?: React.ReactNode;
  labelRight?: React.ReactNode;
  className?: string; // Additional classes for the container
}

const BaseProgressBar: React.FC<BaseProgressBarProps> = ({
  progress,
  colorClass = 'bg-primary',
  backgroundColorClass = 'bg-secondary',
  height = 8,
  labelLeft,
  labelRight,
  className = ''
}) => {
  // Ensure progress is between 0 and 100
  const clampedProgress = Math.max(0, Math.min(progress, 100));

  return (
    <div className={`w-full flex flex-col gap-8 ${className}`}>
      <div className={`w-full ${backgroundColorClass} rounded-full overflow-hidden`} style={{ height: `${height}px` }}>
        <div
          className={`${colorClass} transition-all duration-500`}
          style={{ width: `${clampedProgress}%`, height: `${height}px` }}
        />
      </div>
      
      {(labelLeft || labelRight) && (
        <div className="flex justify-between items-center text-xs text-secondary font-medium mt-4">
          <div className="flex-1 text-left">{labelLeft}</div>
          <div className="flex-1 text-right">{labelRight}</div>
        </div>
      )}
    </div>
  );
};

export default BaseProgressBar;
