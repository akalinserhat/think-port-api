/**
 * @file formatters.ts
 * @description Sayısal ve parasal değerler için formatlayıcı yardımcı fonksiyonlar.
 */

export const formatCurrency = (amount: number, currencySymbol: string = ''): string => {
    if (amount === undefined || amount === null) return '';
    const formatted = new Intl.NumberFormat('tr-TR', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    }).format(amount);
    
    return currencySymbol ? `${formatted} ${currencySymbol}` : formatted;
};
