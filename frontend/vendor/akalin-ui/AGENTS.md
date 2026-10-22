# Akalin UI - Project Rules & Guidelines

Bu belge, `@akalin/ui` projesinde kod geliştirme yaparken uyulması gereken temel ilkeleri içerir.

## 1. Geriye Dönük Uyumluluk ve @deprecated Politikası
- **Kırıcı Değişiklik Önleme**: Projede yapılan değişikliklerin `Webakus.UI`, `Webakus.AdminUI` gibi kütüphaneyi kullanan tüketici projelerde derleme veya çalışma zamanı hatasına yol açmaması esastır.
- **Eski Fonksiyonları Koruma**: Yenilenen veya terk edilecek fonksiyonlar, bileşenler ve tipler hemen silinmez; yeni yapıya köprü olacak şekilde tutulur.
- **@deprecated İbaresi**: Terk edilecek ögelere JSDoc `@deprecated` etiketi ve `@see [YeniÖğe]` yönlendirmesi eklenir.
- **Geliştirici Uyarısı**: Çalışma zamanında (geliştirme ortamında) `console.warn` ile geliştiricilere geçiş uyarısı verilir.
- Ayrıntılı rehber için bkz: [.agents/rules/backward-compatibility.md](file:///.agents/rules/backward-compatibility.md)
