/**
 * Akalin UI - Depolama Kotası İlerleme Çubuğu (StorageQuotaBar)
 * 
 * Başlıca Görevleri:
 * - Bulut depolama veya dosya kotasını kullanılan/toplam GB ve yüzde oranıyla görsel olarak göstermek
 */

import React from 'react';
import BaseProgressBar from '../base/progress/BaseProgressBar';

export interface StorageQuotaBarProps {
  usedBytes: number;
  totalBytes: number;
  colorClass?: string;
  className?: string;
}

const formatGB = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(2);

const StorageQuotaBar: React.FC<StorageQuotaBarProps> = ({
  usedBytes,
  totalBytes,
  colorClass = 'bg-primary',
  className = ''
}) => {
  const percentage = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  
  const labelLeft = (
    <span>
      <span className="font-bold">{formatGB(usedBytes)} GB</span> kullanıldı
    </span>
  );
  
  const labelRight = (
    <span>
      <span className="font-bold">{formatGB(totalBytes)} GB</span> toplam
    </span>
  );

  return (
    <BaseProgressBar
      progress={percentage}
      colorClass="bg-danger"
      backgroundColorClass="bg-success"
      labelLeft={labelLeft}
      labelRight={labelRight}
      className={className}
    />
  );
};

export default StorageQuotaBar;
