/**
 * ThinkPort AI Gateway - SDXL Turbo Model Tanımı (SdxlTurboModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız SDXL Turbo hızlı görsel üretim model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class SdxlTurboModel extends BaseThinkPortModel {
  readonly id = 'turbo';
  readonly name = 'SDXL Turbo (Hızlı Görsel)';
  readonly vendor = 'Stability AI';
  readonly provider = 'pollinations-image';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'image';
  readonly sourceType: ThinkPortModelSourceType = 'image';
  readonly badge = 'Hızlı · Görsel';
  readonly description =
    'Saniyeler içinde hızlı görsel ve konsept taslaklar üreten SDXL Turbo modeli.';
  readonly sourceFile = 'src/models/definitions/SdxlTurboModel.ts';
  override readonly isImage = true;
  override readonly contextWindow = 4096;
  override readonly maxOutputTokens = 1024;
  override readonly imageModel = 'turbo';
  override readonly styleModifier = 'cinematic lighting, high detail, concept art, sharp focus';

  override readonly aliases: readonly string[] = ['turbo', 'sdxl', 'sdxl-turbo'];
}

export const sdxlTurboModel = new SdxlTurboModel();

