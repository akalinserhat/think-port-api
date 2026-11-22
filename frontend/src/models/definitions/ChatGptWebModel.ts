/**
 * ThinkPort AI Gateway - OpenAI ChatGPT (Sanal Tarayıcı) Model Tanımı (ChatGptWebModel.ts)
 * IWebBrowserModel (BaseWebBrowserModel) arayüzünü uygulayan bağımsız ChatGPT Web model sınıfı.
 * Hedef Web URL: https://chatgpt.com/
 */

import { BaseWebBrowserModel } from '../BaseWebBrowserModel';

export class ChatGptWebModel extends BaseWebBrowserModel {
  readonly id = 'chatgpt-web';
  readonly name = 'ChatGPT Web (Sanal Tarayıcı)';
  readonly vendor = 'OpenAI';
  readonly provider = 'chatgpt-web';
  readonly protocolId = 'proto_openai';
  readonly description =
    'OpenAI ChatGPT web oturumu (https://chatgpt.com/) üzerinden @akalin/browser_module Playwright oturum havuzu ve proxy tüneliyle erişilen LLM.';
  readonly sourceFile = 'src/models/definitions/ChatGptWebModel.ts';
  readonly targetUrl = 'https://chatgpt.com/';
  readonly sessionPrefix = 'chatgpt-session';
  readonly contextWindow = 128000;
  readonly maxOutputTokens = 16384;
  readonly webModel = 'chatgpt-web';

  readonly aliases: readonly string[] = [
    'chatgpt-web',
    'chatgpt-web-ai',
    'openai-chatgpt-web',
    'chatgpt-app',
    'chatgpt-browser',
  ];
}

export const chatGptWebModel = new ChatGptWebModel();
