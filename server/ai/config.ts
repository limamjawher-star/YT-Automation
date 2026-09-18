import path from 'path';
import { AiConfig } from './types.js';

let activeConfig: AiConfig | null = null;

export function loadAiConfigFromEnv(): AiConfig {
  const parseNum = (val: string | undefined, fallback: number): number => {
    if (!val) return fallback;
    const parsed = Number(val);
    return isNaN(parsed) ? fallback : parsed;
  };

  const parseBool = (val: string | undefined, fallback: boolean): boolean => {
    if (val === undefined) return fallback;
    return val.toLowerCase() === 'true' || val === '1';
  };

  const parseList = (val: string | undefined, fallback: string[]): string[] => {
    if (!val) return fallback;
    return val.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  };

  const textModel = process.env.AI_TEXT_MODEL || 'gemini-2.5-flash';
  const fallbackTextModels = parseList(
    process.env.AI_FALLBACK_TEXT_MODELS,
    ['gemini-2.5-pro', 'gemini-3.1-flash-lite']
  );
  const imageModel = process.env.AI_IMAGE_MODEL || 'imagen-3.0-generate-002';
  const voiceModel = process.env.AI_VOICE_MODEL || 'gemini-2.5-flash';

  const temperature = parseNum(process.env.AI_TEMPERATURE, 0.7);
  const topP = process.env.AI_TOP_P ? parseNum(process.env.AI_TOP_P, 0.95) : undefined;
  const topK = process.env.AI_TOP_K ? parseNum(process.env.AI_TOP_K, 40) : undefined;
  const maxOutputTokens = process.env.AI_MAX_OUTPUT_TOKENS
    ? parseNum(process.env.AI_MAX_OUTPUT_TOKENS, 8192)
    : undefined;

  const retryPolicy = {
    maxRetries: parseNum(process.env.AI_MAX_RETRIES, 3),
    initialDelayMs: parseNum(process.env.AI_INITIAL_DELAY_MS, 1200),
    maxDelayMs: parseNum(process.env.AI_MAX_DELAY_MS, 10000),
    backoffMultiplier: parseNum(process.env.AI_BACKOFF_MULTIPLIER, 2),
  };

  const concurrencyLimits = {
    text: parseNum(process.env.AI_CONCURRENCY_TEXT, 3),
    image: parseNum(process.env.AI_CONCURRENCY_IMAGE, 2),
    voice: parseNum(process.env.AI_CONCURRENCY_VOICE, 2),
  };

  const cacheEnabled = parseBool(process.env.AI_CACHE_ENABLED, true);
  const cacheDir = process.env.AI_CACHE_DIR
    ? path.resolve(process.env.AI_CACHE_DIR)
    : path.resolve(process.cwd(), '.cache', 'ai');

  return {
    textModel,
    fallbackTextModels,
    imageModel,
    voiceModel,
    generationParams: {
      temperature,
      topP,
      topK,
      maxOutputTokens,
    },
    retryPolicy,
    concurrencyLimits,
    cacheEnabled,
    cacheDir,
  };
}

export function getAiConfig(): AiConfig {
  if (!activeConfig) {
    activeConfig = loadAiConfigFromEnv();
  }
  return activeConfig;
}

export function updateAiConfig(partial: Partial<AiConfig>): AiConfig {
  const current = getAiConfig();
  activeConfig = {
    ...current,
    ...partial,
    generationParams: {
      ...current.generationParams,
      ...(partial.generationParams || {}),
    },
    retryPolicy: {
      ...current.retryPolicy,
      ...(partial.retryPolicy || {}),
    },
    concurrencyLimits: {
      ...current.concurrencyLimits,
      ...(partial.concurrencyLimits || {}),
    },
  };
  return activeConfig;
}

export function resetAiConfig(): void {
  activeConfig = null;
}
