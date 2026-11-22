/**
 * ThinkPort AI Gateway - Sanal Tarayıcı (Web AI) Temel Model Sınıfı (BaseWebBrowserModel.ts)
 *
 * IWebBrowserModel arayüzünü uygulayan tüm sanal tarayıcı modelleri (GeminiWebModel, ChatGptWebModel vb.)
 * için ortak varsayılan özellikleri ve yetenek matrisini sağlar.
 */

import { BaseThinkPortModel } from './BaseThinkPortModel';
import {
  IThinkPortModelCapabilities,
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from './IThinkPortModel';
import { IWebBrowserModel } from './IWebBrowserModel';

export abstract class BaseWebBrowserModel
  extends BaseThinkPortModel
  implements IWebBrowserModel
{
  readonly category: ThinkPortModelCategory = 'chat';
  readonly sourceType: ThinkPortModelSourceType = 'web';
  readonly badge = 'Sanal Tarayıcı';
  override readonly hostingApp = '@akalin/browser_module (Docker Playwright)';
  override readonly accessType = 'Sanal Tarayıcı (Web AI Hybrid)';
  readonly browserEngine = '@akalin/browser_module (Docker Playwright)';
  readonly useProxy = true;
  readonly fallbackLocal = undefined;

  abstract override readonly targetUrl: string;
  abstract readonly sessionPrefix: string;

  override get capabilities(): IThinkPortModelCapabilities {
    return {
      streaming: true,
      vision: true,
      reasoning: true,
      functionCalling: true,
      imageGeneration: false,
      jsonMode: true,
    };
  }
}
