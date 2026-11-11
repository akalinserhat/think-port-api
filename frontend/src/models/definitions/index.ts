/**
 * ThinkPort AI Gateway - Bireysel Model Tanımları İhracı (definitions/index.ts)
 *
 * Yeni bir model eklemek için:
 * 1. Bu klasörde `BaseThinkPortModel` (`IThinkPortModel`) sınıfını uygulayan yeni bir dosya oluşturun.
 * 2. Aşağıdaki `BUILTIN_THINKPORT_MODELS` dizisine ekleyin.
 */

import { IThinkPortModel } from '../IThinkPortModel';
import { Gpt4oModel, gpt4oModel } from './Gpt4oModel';
import { Claude35SonnetModel, claude35SonnetModel } from './Claude35SonnetModel';
import { DeepSeekR1Model, deepSeekR1Model } from './DeepSeekR1Model';
import { Gemini25ProModel, gemini25ProModel } from './Gemini25ProModel';
import { Flux1Model, flux1Model } from './Flux1Model';
import { FluxRealismModel, fluxRealismModel } from './FluxRealismModel';
import { FluxAnimeModel, fluxAnimeModel } from './FluxAnimeModel';
import { Flux3dModel, flux3dModel } from './Flux3dModel';
import { SdxlTurboModel, sdxlTurboModel } from './SdxlTurboModel';
import { Qwen25LocalModel, qwen25LocalModel } from './Qwen25LocalModel';
import { Gemma4LocalModel, gemma4LocalModel } from './Gemma4LocalModel';
import { DynamicOllamaModelAdapter } from './DynamicOllamaModelAdapter';
import { CustomModelAdapter } from './CustomModelAdapter';

export {
  Gpt4oModel,
  gpt4oModel,
  Claude35SonnetModel,
  claude35SonnetModel,
  DeepSeekR1Model,
  deepSeekR1Model,
  Gemini25ProModel,
  gemini25ProModel,
  Flux1Model,
  flux1Model,
  FluxRealismModel,
  fluxRealismModel,
  FluxAnimeModel,
  fluxAnimeModel,
  Flux3dModel,
  flux3dModel,
  SdxlTurboModel,
  sdxlTurboModel,
  Qwen25LocalModel,
  qwen25LocalModel,
  Gemma4LocalModel,
  gemma4LocalModel,
  DynamicOllamaModelAdapter,
  CustomModelAdapter,
};

/**
 * Sistemde yerleşik olarak tanımlı tüm IThinkPortModel örnekleri.
 */
export const BUILTIN_THINKPORT_MODELS: readonly IThinkPortModel[] = [
  gpt4oModel,
  claude35SonnetModel,
  deepSeekR1Model,
  gemini25ProModel,
  qwen25LocalModel,
  gemma4LocalModel,
  flux1Model,
  fluxRealismModel,
  fluxAnimeModel,
  flux3dModel,
  sdxlTurboModel,
];

