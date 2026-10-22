let cachedCapacitor: any = (typeof window !== 'undefined' ? (window as any).Capacitor : undefined);

if (!cachedCapacitor && typeof window !== 'undefined') {
    import(/* @vite-ignore */ '@capacitor/core')
        .then(mod => {
            cachedCapacitor = mod.Capacitor || mod;
        })
        .catch(() => {});
}

/**
 * Uygulamanın Capacitor ile derlenmiş native bir ortamda (Android/iOS uygulaması) çalışıp çalışmadığını döndürür.
 */
export const isNativePlatform = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (cachedCapacitor?.isNativePlatform) {
        return cachedCapacitor.isNativePlatform();
    }
    if ((window as any).Capacitor?.isNativePlatform) {
        return (window as any).Capacitor.isNativePlatform();
    }
    return false;
};

/**
 * Kullanıcının mobil bir cihaz tarayıcısından (Brave, Safari, Chrome Android vb.) girip girmediğini döndürür.
 */
export const isMobileBrowser = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

/**
 * Kullanıcının genel olarak bir mobil cihazda (Native Uygulama VEYA Mobil Tarayıcı) olup olmadığını döndürür.
 */
export const isMobileDevice = (): boolean => {
    return isNativePlatform() || isMobileBrowser();
};
