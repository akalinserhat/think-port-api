/**
 * ThinkPort AI Gateway - Sanal Tarayıcı (Web AI) Model Arayüzü (IWebBrowserModel.ts)
 *
 * Başlıca Sorumlulukları ve Görevleri:
 * - https://gemini.google.com/app ve https://chatgpt.com/ gibi sanal tarayıcı
 *   (@akalin/browser_module Docker Playwright) üzerinden erişilen tüm web tabanlı LLM
 *   modellerinin uyması gereken ortak sözleşmeyi (IWebBrowserModel) tanımlamak.
 */

import { IThinkPortModel } from './IThinkPortModel';

export interface IWebBrowserModel extends IThinkPortModel {
  /** Sanal tarayıcının bağlanacağı zorunlu hedef web URL'si (Örn: 'https://gemini.google.com/app', 'https://chatgpt.com/') */
  readonly targetUrl: string;
  /** Sanal tarayıcı motoru açıklaması */
  readonly browserEngine: string;
  /** İsteklerin proxy tüneli üzerinden geçirilip geçirilmeyeceği */
  readonly useProxy: boolean;
  /** Sanal tarayıcı oturum kimliği öneki */
  readonly sessionPrefix: string;
}

/**
 * Verilen modelin IWebBrowserModel arayüzünü uygulayıp uygulamadığını kontrol eden tip koruyucu (type guard).
 */
export function isWebBrowserModel(model: IThinkPortModel): model is IWebBrowserModel {
  const candidate = model as Partial<IWebBrowserModel>;
  return (
    typeof candidate.targetUrl === 'string' &&
    candidate.targetUrl.length > 0 &&
    typeof candidate.browserEngine === 'string' &&
    typeof candidate.sessionPrefix === 'string'
  );
}
