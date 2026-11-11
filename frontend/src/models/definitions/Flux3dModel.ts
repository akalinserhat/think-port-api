/**
 * ThinkPort AI Gateway - FLUX 3D Render Model Tanımı (Flux3dModel.ts)
 * IThinkPortModel arayüzünü uygulayan bağımsız FLUX 3D görsel üretim model sınıfı.
 */

import { BaseThinkPortModel } from '../BaseThinkPortModel';
import {
  ThinkPortModelCategory,
  ThinkPortModelSourceType,
} from '../IThinkPortModel';

export class Flux3dModel extends BaseThinkPortModel {
  readonly id = 'flux-3d';
  readonly name = 'FLUX 3D Render';
  readonly vendor = 'Black Forest Labs';
  readonly provider = 'pollinations-image';
  readonly protocolId = 'proto_openai';
  readonly category: ThinkPortModelCategory = 'image';
  readonly sourceType: ThinkPortModelSourceType = 'image';
  readonly badge = '3D · Render';
  readonly description =
    '3B karakter, izometrik sahne ve Pixar/Octane Render tarzı görsel üretim modeli.';
  readonly sourceFile = 'src/models/definitions/Flux3dModel.ts';
  override readonly isImage = true;
  override readonly contextWindow = 4096;
  override readonly maxOutputTokens = 1024;
  override readonly imageModel = 'flux-3d';
  override readonly styleModifier =
    '3d render, octane render, unreal engine 5, Pixar and Blender 3D style, volumetric lighting, ray tracing';

  override readonly aliases: readonly string[] = ['flux-3d', '3d-render'];
}

export const flux3dModel = new Flux3dModel();

