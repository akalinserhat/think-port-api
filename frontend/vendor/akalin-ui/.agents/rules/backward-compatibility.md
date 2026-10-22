# Backward Compatibility and Deprecation Guidelines

## Scope
Bu kural, `@akalin/ui` kütüphanesinde ve ilişkili projelerde yapılacak tüm geliştirme, yeniden yapılandırma (refactoring) ve isimlendirme değişikliklerinde geçerlidir.

## Temel Kurallar
1. **Ani Kırıcı Değişiklik Yapmama (No Breaking Changes)**:
   - Eski bileşenler, fonksiyonlar, prop'lar veya tipler hemen silinmemelidir.
   - Eski fonksiyonlar yeni fonksiyonlara köprü (wrapper / delegator) kuracak şekilde en az bir sürüm döngüsü boyunca çalışır tutulmalıdır.
2. **JSDoc / TSDoc `@deprecated` Etiketi**:
   - Terk edilecek tüm API ve bileşenlere `@deprecated` etiketi eklenmeli, yerine hangi alternatifin (`@see`) kullanılacağı belirtilmelidir.
3. **Geliştirme Ortamı Konsol Uyarısı**:
   - Terk edilen fonksiyon veya bileşenler çağrıldığında geliştirme modunda (`process.env.NODE_ENV !== 'production'`) tek seferlik `console.warn` uyarısı verilerek tüketiciler uyarılmalıdır.
4. **`src/index.ts` Export'ları**:
   - Eski export isimleri korunmalı, alias olarak re-export edilmeli ve `@deprecated` olarak işaretlenmelidir.
