/**
 * ThinkPort AI Gateway - Dinamik API Protokolleri Validatörü (apiProtocolValidation.ts).
 * Sıfır inline validasyon ve sıfır hardcoded metin kurallarına uygun olarak
 * API protokol form alanlarını doğrular.
 */

export interface ApiProtocolFormData {
  ad?: string;
  aciklama?: string;
  requestScript?: string;
  responseScript?: string;
  modelsScript?: string;
}

export const validateApiProtocolField = (
  fieldName: keyof ApiProtocolFormData,
  value: unknown,
  t: (key: string, defaultVal: string) => string
): string => {
  switch (fieldName) {
    case 'ad':
      if (!value || typeof value !== 'string' || !value.trim()) {
        return t('protocols.validationNameRequired', 'Protokol adı zorunludur.');
      }
      if (value.trim().length < 2) {
        return t('protocols.validationNameMin', 'Protokol adı en az 2 karakter olmalıdır.');
      }
      return '';

    case 'requestScript':
      if (!value || typeof value !== 'string' || !value.trim()) {
        return t(
          'protocols.validationRequestRequired',
          'İstek dönüştürücü (buildRequest) scripti zorunludur.'
        );
      }
      if (!value.includes('buildRequest')) {
        return t(
          'protocols.validationRequestFunc',
          'Script "buildRequest" fonksiyonunu içermelidir.'
        );
      }
      return '';

    case 'responseScript':
      if (!value || typeof value !== 'string' || !value.trim()) {
        return t(
          'protocols.validationResponseRequired',
          'Yanıt ayrıştırıcı (parseResponse) scripti zorunludur.'
        );
      }
      if (!value.includes('parseResponse')) {
        return t(
          'protocols.validationResponseFunc',
          'Script "parseResponse" fonksiyonunu içermelidir.'
        );
      }
      return '';

    default:
      return '';
  }
};

export const validateApiProtocolForm = (
  data: ApiProtocolFormData,
  t: (key: string, defaultVal: string) => string
): Record<string, string> => {
  const errors: Record<string, string> = {};

  const adErr = validateApiProtocolField('ad', data.ad, t);
  if (adErr) errors.ad = adErr;

  const reqErr = validateApiProtocolField('requestScript', data.requestScript, t);
  if (reqErr) errors.requestScript = reqErr;

  const resErr = validateApiProtocolField('responseScript', data.responseScript, t);
  if (resErr) errors.responseScript = resErr;

  return errors;
};
