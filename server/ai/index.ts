import { TextProvider, ImageProvider, VoiceProvider } from './types.js';
import { geminiTextProvider } from './providers/geminiTextProvider.js';
import { geminiImageProvider } from './providers/geminiImageProvider.js';
import { googleVoiceProvider } from './providers/googleVoiceProvider.js';

export * from './types.js';
export * from './config.js';
export * from './logger.js';
export * from './limiter.js';
export * from './cache.js';

const textProviders = new Map<string, TextProvider>();
const imageProviders = new Map<string, ImageProvider>();
const voiceProviders = new Map<string, VoiceProvider>();

// Register default providers
textProviders.set(geminiTextProvider.name, geminiTextProvider);
imageProviders.set(geminiImageProvider.name, geminiImageProvider);
voiceProviders.set(googleVoiceProvider.name, googleVoiceProvider);

let defaultTextProviderName = geminiTextProvider.name;
let defaultImageProviderName = geminiImageProvider.name;
let defaultVoiceProviderName = googleVoiceProvider.name;

export function registerTextProvider(provider: TextProvider, makeDefault = false): void {
  textProviders.set(provider.name, provider);
  if (makeDefault) {
    defaultTextProviderName = provider.name;
  }
}

export function registerImageProvider(provider: ImageProvider, makeDefault = false): void {
  imageProviders.set(provider.name, provider);
  if (makeDefault) {
    defaultImageProviderName = provider.name;
  }
}

export function registerVoiceProvider(provider: VoiceProvider, makeDefault = false): void {
  voiceProviders.set(provider.name, provider);
  if (makeDefault) {
    defaultVoiceProviderName = provider.name;
  }
}

export function getTextProvider(name?: string): TextProvider {
  const targetName = name || defaultTextProviderName;
  const provider = textProviders.get(targetName);
  if (!provider) {
    throw new Error(`TextProvider '${targetName}' is not registered`);
  }
  return provider;
}

export function getImageProvider(name?: string): ImageProvider {
  const targetName = name || defaultImageProviderName;
  const provider = imageProviders.get(targetName);
  if (!provider) {
    throw new Error(`ImageProvider '${targetName}' is not registered`);
  }
  return provider;
}

export function getVoiceProvider(name?: string): VoiceProvider {
  const targetName = name || defaultVoiceProviderName;
  const provider = voiceProviders.get(targetName);
  if (!provider) {
    throw new Error(`VoiceProvider '${targetName}' is not registered`);
  }
  return provider;
}
