import { GoogleGenAI, Type } from '@google/genai';
import { getAiConfig } from '../config.js';
import { aiLogger } from '../logger.js';
import { concurrencyManager } from '../limiter.js';
import { assetCache, computeDeterministicHash } from '../cache.js';
import { withRetry } from '../../utils/retry.js';
import {
  ProviderExecutionOptions,
  StructuredGenerationRequest,
  StructuredGenerationResult,
  TextGenerationRequest,
  TextGenerationResult,
  TextProvider,
} from '../types.js';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || '';
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class GeminiTextProvider implements TextProvider {
  public readonly name = 'gemini';

  public async generateText(
    request: TextGenerationRequest,
    options: ProviderExecutionOptions = {}
  ): Promise<TextGenerationResult> {
    const config = getAiConfig();
    const startTime = Date.now();
    const operation = request.operation || 'text_generation';

    // Check deterministic cache
    const cacheKey = computeDeterministicHash({
      provider: this.name,
      model: config.textModel,
      prompt: request.prompt,
      systemInstruction: request.systemInstruction || '',
      temperature: request.temperature ?? config.generationParams.temperature,
    });

    if (!options.skipCache) {
      const cached = assetCache.getCachedText<TextGenerationResult>(cacheKey);
      if (cached) {
        aiLogger.log({
          provider: this.name,
          model: cached.model,
          operation,
          durationMs: Date.now() - startTime,
          success: true,
          cached: true,
          usage: cached.usage,
          estimatedCostUsd: 0,
        });
        return {
          ...cached,
          durationMs: Date.now() - startTime,
        };
      }
    }

    return await concurrencyManager.runWithLimit(
      'text',
      async () => {
        if (options.signal?.aborted) {
          const err = new Error('Text generation aborted');
          err.name = 'AbortError';
          throw err;
        }

        const ai = getAiClient();
        const candidateModels = [config.textModel, ...config.fallbackTextModels];
        let lastError: any = null;

        for (const model of candidateModels) {
          if (options.signal?.aborted) break;

          try {
            const result = await withRetry(
              async () => {
                return await ai.models.generateContent({
                  model,
                  contents: request.prompt,
                  config: {
                    systemInstruction: request.systemInstruction,
                    temperature: request.temperature ?? config.generationParams.temperature,
                    topP: config.generationParams.topP,
                    topK: config.generationParams.topK,
                    maxOutputTokens: request.maxOutputTokens ?? config.generationParams.maxOutputTokens,
                  },
                });
              },
              {
                maxRetries: config.retryPolicy.maxRetries,
                initialDelayMs: config.retryPolicy.initialDelayMs,
                maxDelayMs: config.retryPolicy.maxDelayMs,
                backoffMultiplier: config.retryPolicy.backoffMultiplier,
                signal: options.signal,
                onRetry: options.onRetry,
              }
            );

            const durationMs = Date.now() - startTime;
            const text = result.text || '';
            const usage = result.usageMetadata
              ? {
                  promptTokenCount: result.usageMetadata.promptTokenCount,
                  candidatesTokenCount: result.usageMetadata.candidatesTokenCount,
                  totalTokenCount: result.usageMetadata.totalTokenCount,
                  cachedContentTokenCount: result.usageMetadata.cachedContentTokenCount,
                }
              : undefined;

            const estimatedCostUsd = aiLogger.estimateCost(model, usage);

            aiLogger.log({
              provider: this.name,
              model,
              operation,
              durationMs,
              success: true,
              usage,
              estimatedCostUsd,
            });

            const output: TextGenerationResult = {
              text,
              usage,
              model,
              provider: this.name,
              durationMs,
            };

            if (!options.skipCache) {
              assetCache.saveTextToCache(cacheKey, output);
            }

            return output;
          } catch (err: any) {
            lastError = err;
            if (options.signal?.aborted || err?.name === 'AbortError') {
              throw err;
            }
            console.warn(`[GeminiTextProvider] Model ${model} failed for ${operation}:`, err?.message || err);
          }
        }

        const durationMs = Date.now() - startTime;
        aiLogger.log({
          provider: this.name,
          model: config.textModel,
          operation,
          durationMs,
          success: false,
          error: lastError?.message || String(lastError),
        });

        throw lastError || new Error(`All candidate models failed for ${operation}`);
      },
      options.signal
    );
  }

  public async generateStructured<T>(
    request: StructuredGenerationRequest<T>,
    options: ProviderExecutionOptions = {}
  ): Promise<StructuredGenerationResult<T>> {
    const config = getAiConfig();
    const startTime = Date.now();
    const operation = request.operation || 'structured_generation';

    // Check deterministic cache
    const cacheKey = computeDeterministicHash({
      provider: this.name,
      model: config.textModel,
      prompt: request.prompt,
      systemInstruction: request.systemInstruction || '',
      temperature: request.temperature ?? config.generationParams.temperature,
    });

    if (!options.skipCache) {
      const cached = assetCache.getCachedText<StructuredGenerationResult<T>>(cacheKey);
      if (cached) {
        aiLogger.log({
          provider: this.name,
          model: cached.model,
          operation,
          durationMs: Date.now() - startTime,
          success: true,
          cached: true,
          usage: cached.usage,
          estimatedCostUsd: 0,
        });
        return {
          ...cached,
          durationMs: Date.now() - startTime,
        };
      }
    }

    return await concurrencyManager.runWithLimit(
      'text',
      async () => {
        if (options.signal?.aborted) {
          const err = new Error('Structured generation aborted');
          err.name = 'AbortError';
          throw err;
        }

        const ai = getAiClient();
        const candidateModels = [config.textModel, ...config.fallbackTextModels];
        let lastError: any = null;

        for (const model of candidateModels) {
          if (options.signal?.aborted) break;

          try {
            const result = await withRetry(
              async () => {
                const genConfig: any = {
                  systemInstruction: request.systemInstruction,
                  temperature: request.temperature ?? config.generationParams.temperature,
                  responseMimeType: 'application/json',
                };
                if (request.schema) {
                  genConfig.responseSchema = request.schema;
                }

                return await ai.models.generateContent({
                  model,
                  contents: request.prompt,
                  config: genConfig,
                });
              },
              {
                maxRetries: config.retryPolicy.maxRetries,
                initialDelayMs: config.retryPolicy.initialDelayMs,
                maxDelayMs: config.retryPolicy.maxDelayMs,
                backoffMultiplier: config.retryPolicy.backoffMultiplier,
                signal: options.signal,
                onRetry: options.onRetry,
              }
            );

            const durationMs = Date.now() - startTime;
            const rawText = result.text || '';
            const usage = result.usageMetadata
              ? {
                  promptTokenCount: result.usageMetadata.promptTokenCount,
                  candidatesTokenCount: result.usageMetadata.candidatesTokenCount,
                  totalTokenCount: result.usageMetadata.totalTokenCount,
                  cachedContentTokenCount: result.usageMetadata.cachedContentTokenCount,
                }
              : undefined;

            const parsed = JSON.parse(rawText);
            let validatedData: T = parsed;
            if (request.validator) {
              const valRes = request.validator(parsed);
              if (!valRes.success) {
                throw new Error(`Validation failed for structured data: ${JSON.stringify(valRes.errors)}`);
              }
              validatedData = valRes.data as T;
            }

            const estimatedCostUsd = aiLogger.estimateCost(model, usage);

            aiLogger.log({
              provider: this.name,
              model,
              operation,
              durationMs,
              success: true,
              usage,
              estimatedCostUsd,
            });

            const output: StructuredGenerationResult<T> = {
              data: validatedData,
              rawText,
              usage,
              model,
              provider: this.name,
              durationMs,
            };

            if (!options.skipCache) {
              assetCache.saveTextToCache(cacheKey, output);
            }

            return output;
          } catch (err: any) {
            lastError = err;
            if (options.signal?.aborted || err?.name === 'AbortError') {
              throw err;
            }
            console.warn(`[GeminiTextProvider] Model ${model} failed for ${operation}:`, err?.message || err);
          }
        }

        const durationMs = Date.now() - startTime;
        aiLogger.log({
          provider: this.name,
          model: config.textModel,
          operation,
          durationMs,
          success: false,
          error: lastError?.message || String(lastError),
        });

        throw lastError || new Error(`All candidate models failed for ${operation}`);
      },
      options.signal
    );
  }
}

export const geminiTextProvider = new GeminiTextProvider();
