/**
 * ThinkPort AI Gateway - FLUX Anime & İllüstrasyon Model Tanımı (FluxAnimeModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız FLUX Anime görsel üretim model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class FluxAnimeModel extends BaseThinkPortModel {
  readonly id = 'flux-anime';
  readonly name = 'FLUX Anime & İllüstrasyon';
  readonly vendor = 'Black Forest Labs';
  readonly provider = 'pollinations-image';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'image';
  readonly sourceType: ThinkPortModelSourceType = 'image';
  readonly badge = 'Anime · Sanat';
  readonly description =
    'Anime, manga ve dijital konsept sanat çizimleri için özelleştirilmiş görsel üretim modeli.';
  readonly sourceFile = 'src/models/definitions/FluxAnimeModel.ts';
  override readonly isImage = true;
  override readonly contextWindow = 4096;
  override readonly maxOutputTokens = 1024;
  override readonly imageModel = 'flux-anime';
  override readonly styleModifier =
    'anime style, vibrant anime key visual, studio ghibli and makoto shinkai aesthetic, crisp lineart, cel shaded';

  override readonly aliases: readonly string[] = ['flux-anime', 'anime'];
}

export const fluxAnimeModel = new FluxAnimeModel();

