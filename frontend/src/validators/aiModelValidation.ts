/**
 * ThinkPort AI Gateway - Yapay Zeka Modelleri Form Validatörü (aiModelValidation.ts)
 * Sıfır inline validasyon ve sıfır hardcoded metin kurallarına uygun olarak
 * IThinkPortModel oluşturma ve düzenleme alanlarını doğrular.
 */

export interface AiModelFormData {
  id?: string;
  name?: string;
  vendor?: string;
  provider?: string;
  protocolId?: string;
}

export const validateAiModelField = (
  fieldName: keyof AiModelFormData,
  value: unknown,
  t: (key: string, defaultVal: string) => string
): string => {
  switch (fieldName) {
    case 'id':
      if (!value || typeof value !== 'string' || !value.trim()) {
        return t('models.validationIdRequired', 'Model kimliği (ID) zorunludur.');
      }
      if (value.trim().length < 2) {
        return t('models.validationIdMin', 'Model kimliği en az 2 karakter olmalıdır.');
      }
      return '';

    case 'name':
      if (!value || typeof value !== 'string' || !value.trim()) {
        return t('models.validationNameRequired', 'Model adı zorunludur.');
      }
      if (value.trim().length < 2) {
        return t('models.validationNameMin', 'Model adı en az 2 karakter olmalıdır.');
      }
      return '';

    case 'vendor':
      if (!value || typeof value !== 'string' || !value.trim()) {
        return t('models.validationVendorRequired', 'Üretici / Sağlayıcı firma zorunludur.');
      }
      return '';

    case 'provider':
      if (!value || typeof value !== 'string' || !value.trim()) {
        return t('models.validationProviderRequired', 'Gateway yönlendirme sağlayıcısı zorunludur.');
      }
      return '';

    default:
      return '';
  }
};

export const validateAiModelForm = (
  data: AiModelFormData,
  t: (key: string, defaultVal: string) => string
): Record<string, string> => {
  const errors: Record<string, string> = {};

  const idErr = validateAiModelField('id', data.id, t);
  if (idErr) errors.id = idErr;

  const nameErr = validateAiModelField('name', data.name, t);
  if (nameErr) errors.name = nameErr;

  const vendorErr = validateAiModelField('vendor', data.vendor, t);
  if (vendorErr) errors.vendor = vendorErr;

  const providerErr = validateAiModelField('provider', data.provider, t);
  if (providerErr) errors.provider = providerErr;

  return errors;
};

