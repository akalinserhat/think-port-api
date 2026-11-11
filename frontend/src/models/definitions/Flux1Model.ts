/**
 * ThinkPort AI Gateway - FLUX.1 Görsel Üretici Model Tanımı (Flux1Model.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız FLUX.1 görsel üretim model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class Flux1Model extends BaseThinkPortModel {
  readonly id = 'flux';
  readonly name = 'FLUX.1 (Görsel Üretici)';
  readonly vendor = 'Black Forest Labs';
  readonly provider = 'pollinations-image';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'image';
  readonly sourceType: ThinkPortModelSourceType = 'image';
  readonly badge = 'Görsel · HD';
  readonly description =
    'Ücretsiz, yüksek çözünürlüklü genel amaçlı yapay zeka görsel üretim modeli (FLUX.1).';
  readonly sourceFile = 'src/models/definitions/Flux1Model.ts';
  override readonly isImage = true;
  override readonly contextWindow = 4096;
  override readonly maxOutputTokens = 1024;
  override readonly imageModel = 'flux';
  override readonly styleModifier = 'high quality, detailed, sharp focus, 8k';

  override readonly aliases: readonly string[] = [
    'flux',
    'dall-e-3',
    'dall-e-2',
    'gpt-image-1',
    'flux.1',
    'flux-1',
    'flux-schnell',
    'flux-dev',
    'flux-pro',
  ];
}

export const flux1Model = new Flux1Model();

