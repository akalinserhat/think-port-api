/**
 * ThinkPort AI Gateway - FLUX Realism Model Tanımı (FluxRealismModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız FLUX Realism görsel üretim model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class FluxRealismModel extends BaseThinkPortModel {
  readonly id = 'flux-realism';
  readonly name = 'FLUX Realism (Fotogerçekçi)';
  readonly vendor = 'Black Forest Labs';
  readonly provider = 'pollinations-image';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'image';
  readonly sourceType: ThinkPortModelSourceType = 'image';
  readonly badge = 'Fotoğraf · HD';
  readonly description =
    'Fotogerçekçi portre, mimari ve doğa fotoğrafı üretimi için optimize edilmiş FLUX modeli.';
  readonly sourceFile = 'src/models/definitions/FluxRealismModel.ts';
  override readonly isImage = true;
  override readonly contextWindow = 4096;
  override readonly maxOutputTokens = 1024;
  override readonly imageModel = 'flux-realism';
  override readonly styleModifier =
    'photorealistic, raw photo, 8k uhd, DSLR, natural lighting, ultra detailed, realistic texture';

  override readonly aliases: readonly string[] = ['flux-realism', 'flux-photo'];
}

export const fluxRealismModel = new FluxRealismModel();

