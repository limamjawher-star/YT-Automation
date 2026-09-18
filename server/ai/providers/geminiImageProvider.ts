import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { getAiConfig } from '../config.js';
import { aiLogger } from '../logger.js';
import { concurrencyManager } from '../limiter.js';
import { assetCache, computeDeterministicHash } from '../cache.js';
import { withRetry } from '../../utils/retry.js';
import { generateFallbackSceneImage } from '../../ffmpeg.js';
import {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProvider,
  ProviderExecutionOptions,
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

export class GeminiImageProvider implements ImageProvider {
  public readonly name = 'gemini-imagen';

  public async generateImage(
    request: ImageGenerationRequest,
    options: ProviderExecutionOptions = {}
  ): Promise<ImageGenerationResult> {
    const config = getAiConfig();
    const startTime = Date.now();
    const operation = request.operation || 'image_generation';
    const model = config.imageModel;

    // Check deterministic cache
    const cacheKey = computeDeterministicHash({
      provider: this.name,
      model,
      prompt: request.prompt,
      visualStyle: request.visualStyle || '',
      aspectRatio: request.aspectRatio,
    });

    const outputExt = path.extname(request.outputFilePath) || '.png';

    if (!options.skipCache) {
      const cached = assetCache.copyCachedFile('image', cacheKey, request.outputFilePath, outputExt);
      if (cached) {
        const stat = fs.statSync(request.outputFilePath);
        const durationMs = Date.now() - startTime;
        aiLogger.log({
          provider: this.name,
          model,
          operation,
          durationMs,
          success: true,
          cached: true,
          estimatedCostUsd: 0,
        });

        return {
          filePath: request.outputFilePath,
          cached: true,
          model,
          provider: this.name,
          durationMs,
          bytesWritten: stat.size,
        };
      }
    }

    return await concurrencyManager.runWithLimit(
      'image',
      async () => {
        if (options.signal?.aborted) {
          const err = new Error('Image generation aborted');
          err.name = 'AbortError';
          throw err;
        }

        const ai = getAiClient();
        const apiKeyPresent = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
        let success = false;
        let lastError: any = null;

        // Ensure target directory exists
        const targetDir = path.dirname(request.outputFilePath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const fullPrompt = `${request.prompt}${request.visualStyle ? `. Style: ${request.visualStyle}` : ''}. High resolution, dramatic lighting, cinematic framing, masterpiece composition. No text, no watermarks.`;

        if (apiKeyPresent) {
          try {
            // Attempt 1: Official generateImages API (Imagen 3)
            await withRetry(
              async () => {
                try {
                  const imageResponse = await (ai.models as any).generateImages({
                    model,
                    prompt: fullPrompt,
                    config: {
                      numberOfImages: 1,
                      outputMimeType: 'image/jpeg',
                      aspectRatio: request.aspectRatio === '9:16' ? '9:16' : request.aspectRatio === '1:1' ? '1:1' : '16:9',
                    },
                  });

                  const imageBytes = imageResponse?.generatedImages?.[0]?.image?.imageBytes;
                  if (imageBytes) {
                    const buffer = Buffer.from(imageBytes, 'base64');
                    fs.writeFileSync(request.outputFilePath, buffer);
                    success = true;
                    return;
                  }
                } catch (genImagesErr: any) {
                  // Fall back to generateContent if model supports image output
                  const contentResponse = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: {
                      parts: [{ text: fullPrompt }],
                    },
                  });
                  const candidate = contentResponse.candidates?.[0];
                  if (candidate?.content?.parts) {
                    for (const part of candidate.content.parts) {
                      if (part.inlineData?.data) {
                        const buffer = Buffer.from(part.inlineData.data, 'base64');
                        fs.writeFileSync(request.outputFilePath, buffer);
                        success = true;
                        return;
                      }
                    }
                  }
                  throw genImagesErr;
                }
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
          } catch (err: any) {
            lastError = err;
            if (options.signal?.aborted || err?.name === 'AbortError') {
              throw err;
            }
            console.warn(`[GeminiImageProvider] API generation failed, falling back to procedural render:`, err?.message || err);
          }
        }

        // If API generation failed or no API key, use procedural SVG/FFmpeg fallback
        if (!success) {
          await generateFallbackSceneImage(
            request.outputFilePath,
            0,
            request.prompt.slice(0, 50),
            request.prompt,
            request.aspectRatio === '9:16' ? '9:16' : '16:9',
            { signal: options.signal }
          );
          success = true;
        }

        const durationMs = Date.now() - startTime;
        const stat = fs.statSync(request.outputFilePath);
        const estimatedCostUsd = apiKeyPresent && !lastError ? aiLogger.estimateCost(model, undefined, 'image') : 0;

        // Save to deterministic cache
        if (!options.skipCache) {
          assetCache.saveFileToCache('image', cacheKey, request.outputFilePath, outputExt);
        }

        aiLogger.log({
          provider: this.name,
          model: lastError ? 'fallback-procedural' : model,
          operation,
          durationMs,
          success: true,
          estimatedCostUsd,
          cached: false,
        });

        return {
          filePath: request.outputFilePath,
          cached: false,
          model: lastError ? 'fallback-procedural' : model,
          provider: this.name,
          durationMs,
          bytesWritten: stat.size,
        };
      },
      options.signal
    );
  }
}

export const geminiImageProvider = new GeminiImageProvider();
