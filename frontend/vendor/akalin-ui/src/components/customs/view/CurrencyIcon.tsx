/**
 * Akalin UI - Para Birimi İkon Bileşeni (CurrencyIcon)
 * Yüksek kaliteli, vektörel para birimi simgelerini (TCMB Resmi ₺ simgesi, $, €, £ vb.)
 * font ve cihaz uyumluluğu garantisiyle SVG olarak render eder.
 */
import React from 'react';

export interface CurrencyIconProps {
  /** Para birimi ISO kodu (örn: TRY, USD, EUR, GBP) */
  code?: string;
  /** Para birimi sembolü (örn: ₺, $, €, £) */
  symbol?: string;
  /** İkon boyutu piksel cinsinden (Varsayılan: 24) */
  size?: number | string;
  /** Ek CSS sınıfı */
  className?: string;
  /** Ek inline stiller (Sadece dinamik değerler) */
  style?: React.CSSProperties;
}

export const CurrencyIcon: React.FC<CurrencyIconProps> = ({
  code = '',
  symbol = '',
  size = 24,
  className = '',
  style
}) => {
  const normalizedCode = (code || '').toUpperCase().trim();
  const normalizedSymbol = (symbol || '').trim();

  const iconSize = typeof size === 'number' ? `${size}px` : size;

  // 1. Türk Lirası (₺ / TRY / TL) - TCMB Resmi Vektörel Simgesi
  if (
    normalizedCode === 'TRY' || 
    normalizedCode === 'TL' || 
    normalizedSymbol === '₺' ||
    normalizedSymbol.toUpperCase() === 'TL' ||
    normalizedSymbol.toUpperCase() === 'TRY' ||
    normalizedCode.includes('LIRA') ||
    normalizedCode.includes('LİRA')
  ) {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="-3 5 215 288" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-try ${className}`}
        style={style}
        aria-label="TRY"
      >
        <path d="M54.3355 9.3092c16.0514,0 25.3755,0 27.972,0 0,2.8326 0,14.9893 0,36.4699 0,21.4807 0,33.5193 0,36.1159l84.9785 -30.8047c0,8.2618 0,15.6974 0,22.3068l-84.9785 30.8047c0,0.9442 0,2.9507 0,6.0193 0,3.0687 0,5.0751 0,6.0193l46.03 -16.2875 38.9485 -14.5171c0,1.4163 0,5.016 0,10.7993 0,5.7833 0,9.265 0,10.4453 0,0.9442 -0.2361,1.4163 -0.7082,1.4163l-81.7917 29.3884c-0.9442,0.4721 -1.7704,0.9442 -2.4786,1.4163 0,14.3991 0,34.2864 0,59.6619 0,25.3755 0,45.2629 0,59.662 0,0 0,0.118 0,0.3541 0,0.236 0,0.354 0,0.354 21.4807,-2.5965 40.4828,-10.7403 57.0064,-24.4313 18.176,-14.8712 30.3326,-33.4012 36.4699,-55.59 2.5966,-10.1502 3.8949,-20.3004 3.8949,-30.4507 0,0 9.442,0 28.3261,0 0,22.897 -5.5472,44.4957 -16.6416,64.7961 -7.7897,15.5794 -18.412,29.0343 -31.8669,40.3648 -12.5107,11.0944 -26.5558,19.5922 -42.1352,25.4935 -20.3004,7.7897 -41.3089,10.5043 -63.0256,8.1438 0,-15.3433 0,-38.3583 0,-69.045 0,-30.6867 0,-53.8197 0,-69.3991 0,0 -1.5344,0.5902 -4.603,1.7704l-48.5086 17.3498c0,-7.0816 0,-14.5172 0,-22.3069l53.1116 -19.1201c0,-1.4163 0,-5.5472 0,-12.3927 -2.5966,1.1802 -6.0784,2.5966 -10.4453,4.2489 -4.367,1.6524 -7.1406,2.5966 -8.3208,2.8326l-27.9721 10.2683c0,0 -0.7672,0.236 -2.3015,0.7081 -1.5343,0.4721 -2.8916,0.8262 -4.0719,1.0622 0,-11.3304 0,-18.766 0,-22.3068l53.1116 -18.7661c0,-10.3862 0,-24.1952 0,-41.427 0,-17.2317 0,-31.0407 0,-41.427z" />
      </svg>
    );
  }

  // 2. Amerikan Doları ($ / USD)
  if (normalizedCode === 'USD' || normalizedSymbol === '$') {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 32 32" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-usd ${className}`}
        style={style}
        aria-label="USD"
      >
        <path d="M17.5 4V6.1C21.4 6.6 24 8.8 24.3 12.1H21.3C21 9.8 19.3 8.6 16.8 8.6C14 8.6 12.2 9.9 12.2 11.9C12.2 13.8 13.6 14.8 17.2 15.6C21.8 16.6 24.5 18.2 24.5 22C24.5 25.5 21.6 27.5 17.5 27.9V30H14.5V27.9C10.5 27.3 7.6 25 7.4 21.2H10.4C10.7 23.9 12.8 25.4 15.2 25.4C18.2 25.4 20.5 24 20.5 21.8C20.5 19.8 19 18.7 15.2 17.8C10.9 16.8 8.2 15.3 8.2 11.6C8.2 8.3 11 6.5 14.5 6.1V4H17.5Z" />
      </svg>
    );
  }

  // 3. Euro (€ / EUR)
  if (normalizedCode === 'EUR' || normalizedSymbol === '€') {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 32 32" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-eur ${className}`}
        style={style}
        aria-label="EUR"
      >
        <path d="M25 7.5C23.2 6.2 20.8 5.5 18 5.5C11.5 5.5 6.8 10.2 6.2 16.5H5V18.5H6.2C6.8 24.8 11.5 29.5 18 29.5C21 29.5 23.5 28.5 25.5 27L24 24.8C22.4 26 20.4 26.8 18 26.8C13.2 26.8 9.5 23.2 9 18.5H20V16.5H9C9.5 11.8 13.2 8.2 18 8.2C20.2 8.2 22.1 8.9 23.5 10L25 7.5ZM6.5 13.5H18V11.5H7.2C7 12.1 6.8 12.8 6.5 13.5ZM6.5 21.5C6.8 22.2 7 22.9 7.2 23.5H18V21.5H6.5Z" />
      </svg>
    );
  }

  // 4. İngiliz Sterlini (£ / GBP)
  if (normalizedCode === 'GBP' || normalizedSymbol === '£') {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 32 32" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-gbp ${className}`}
        style={style}
        aria-label="GBP"
      >
        <path d="M22 25.5H25V28H7V25.5C8.8 25.5 10.4 24.8 11.2 23.5C12.5 21.5 12.8 19 12.8 16H8V13.5H13C13.2 10.5 14 7.8 16 6.2C17.5 5 19.5 4.5 21.5 4.8C23.8 5.2 25 7 25 9.2C25 11.2 23.5 12.8 21.5 12.8C20 12.8 18.8 11.8 18.5 10.5C18.2 9.5 18.5 8.5 19.2 7.8C18.5 7.5 17.5 7.5 16.8 8.2C15.8 9.2 15.4 11 15.4 13.5H21V16H15.2C15.2 19 14.8 21.5 13.8 23.5C13.2 24.8 12.2 25.5 11 25.5H22Z" />
      </svg>
    );
  }

  // 5. Japon Yeni (¥ / JPY)
  if (normalizedCode === 'JPY' || normalizedSymbol === '¥') {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 32 32" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-jpy ${className}`}
        style={style}
        aria-label="JPY"
      >
        <path d="M17.5 16.5H23V18.5H17.5V20.5H23V22.5H17.5V28H14.5V22.5H9V20.5H14.5V18.5H9V16.5H14.5L7 5H10.5L16 14L21.5 5H25L17.5 16.5Z" />
      </svg>
    );
  }

  // 6. Azerbaycan Manatı (₼ / AZN)
  if (normalizedCode === 'AZN' || normalizedSymbol === '₼') {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 32 32" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-azn ${className}`}
        style={style}
        aria-label="AZN"
      >
        <path d="M16 6C10.5 6 6 10.5 6 16V26H9V16C9 12.1 12.1 9 16 9C19.9 9 23 12.1 23 16V26H26V16C26 10.5 21.5 6 16 6ZM14.5 12H17.5V26H14.5V12Z" />
      </svg>
    );
  }

  // 7. İsviçre Frangı (CHF)
  if (normalizedCode === 'CHF') {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 32 32" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-chf ${className}`}
        style={style}
        aria-label="CHF"
      >
        <path d="M7 6H19V9H10V14H18V17H10V26H7V6ZM18 20H21V17H23V20H26V22H23V25H21V22H18V20Z" />
      </svg>
    );
  }

  // 8. Rus Rublesi (₽ / RUB)
  if (normalizedCode === 'RUB' || normalizedSymbol === '₽') {
    return (
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 32 32" 
        width={iconSize} 
        height={iconSize} 
        fill="currentColor"
        className={`currency-icon currency-icon-rub ${className}`}
        style={style}
        aria-label="RUB"
      >
        <path d="M8 5H17C21.5 5 24 7.5 24 11.5C24 15.2 21.5 17.5 17.5 17.8V18H21V20.5H16.8V22.5H20V25H16.8V28H13.8V25H8V22.5H13.8V20.5H8V18H13.8V7.5H8V5ZM13.8 15.5H16.5C19 15.5 20.8 14.2 20.8 11.5C20.8 8.8 19 7.5 16.5 7.5H13.8V15.5Z" />
      </svg>
    );
  }

  // 9. Diğer Para Birimleri: Sembol varsa sembolü göster, yoksa genel döviz SVG'si
  if (normalizedSymbol && normalizedSymbol !== normalizedCode) {
    return (
      <span 
        className={`currency-icon-symbol font-bold ${className}`}
        style={{ fontSize: iconSize, lineHeight: 1, ...style }}
      >
        {normalizedSymbol}
      </span>
    );
  }

  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 32 32" 
      width={iconSize} 
      height={iconSize} 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2.2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
      className={`currency-icon currency-icon-default ${className}`}
      style={style}
      aria-label={normalizedCode || 'Currency'}
    >
      <rect x="4" y="8" width="24" height="16" rx="3" />
      <circle cx="16" cy="16" r="3.5" />
      <path d="M8 12h.01M24 20h.01" />
    </svg>
  );
};

export default CurrencyIcon;
