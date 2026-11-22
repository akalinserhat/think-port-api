/**
 * ThinkPort AI Gateway - Google Gemini (Sanal Tarayıcı) Model Tanımı (GeminiWebModel.ts)
 * IWebBrowserModel (BaseWebBrowserModel) arayüzünü uygulayan bağımsız Gemini Web model sınıfı.
 * Hedef Web URL: https://gemini.google.com/app
 */

import { BaseWebBrowserModel } from '../BaseWebBrowserModel';

export class GeminiWebModel extends BaseWebBrowserModel {
  readonly id = 'gemini-web';
  readonly name = 'Gemini Web (Sanal Tarayıcı)';
  readonly vendor = 'Google';
  readonly provider = 'gemini-web';
  readonly protocolId = 'proto_gemini';
  readonly description =
    'Google Gemini web oturumu (https://gemini.google.com/app) üzerinden @akalin/browser_module Playwright oturum havuzu ve proxy tüneliyle erişilen LLM.';
  readonly sourceFile = 'src/models/definitions/GeminiWebModel.ts';
  readonly targetUrl = 'https://gemini.google.com/app';
  readonly sessionPrefix = 'gemini-session';
  readonly contextWindow = 1000000;
  readonly maxOutputTokens = 16384;
  readonly webModel = 'gemini-web';

  readonly aliases: readonly string[] = [
    'gemini-web',
    'gemini-web-ai',
    'google-gemini-web',
    'gemini-app',
    'gemini-browser',
  ];
}

export const geminiWebModel = new GeminiWebModel();
