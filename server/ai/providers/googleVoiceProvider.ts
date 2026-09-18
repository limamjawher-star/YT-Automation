import { GoogleGenAI, Modality } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { getAiConfig } from '../config.js';
import { aiLogger } from '../logger.js';
import { concurrencyManager } from '../limiter.js';
import { assetCache, computeDeterministicHash } from '../cache.js';
import { withRetry } from '../../utils/retry.js';
import { generateFallbackAudio, getAudioDuration } from '../../ffmpeg.js';
import {
  ProviderExecutionOptions,
  VoiceGenerationRequest,
  VoiceGenerationResult,
  VoiceProvider,
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

// Convert PCM buffer into standard 44-byte WAV header format
export function pcmToWavBuffer(
  pcmBuffer: Buffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  if (pcmBuffer.slice(0, 4).toString() === 'RIFF') {
    return pcmBuffer; // Already has RIFF WAV header
  }
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export class GoogleVoiceProvider implements VoiceProvider {
  public readonly name = 'google-tts';

  public async generateVoice(
    request: VoiceGenerationRequest,
    options: ProviderExecutionOptions = {}
  ): Promise<VoiceGenerationResult> {
    const config = getAiConfig();
    const startTime = Date.now();
    const operation = request.operation || 'voice_generation';
    const model = config.voiceModel;
    const textTrimmed = request.text.trim();

    if (!textTrimmed) {
      throw new Error('Narration text cannot be empty for voice generation');
    }

    // Check deterministic cache
    const cacheKey = computeDeterministicHash({
      provider: this.name,
      model,
      text: textTrimmed,
      voiceName: request.voiceName,
    });

    const outputExt = path.extname(request.outputFilePath) || '.wav';

    if (!options.skipCache) {
      const cached = assetCache.copyCachedFile('voice', cacheKey, request.outputFilePath, outputExt);
      if (cached) {
        const stat = fs.statSync(request.outputFilePath);
        const durationSeconds = await getAudioDuration(request.outputFilePath, { signal: options.signal });
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
          durationSeconds,
          cached: true,
          model,
          provider: this.name,
          durationMs,
          bytesWritten: stat.size,
        };
      }
    }

    return await concurrencyManager.runWithLimit(
      'voice',
      async () => {
        if (options.signal?.aborted) {
          const err = new Error('Voice generation aborted');
          err.name = 'AbortError';
          throw err;
        }

        const apiKeyPresent = !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
        let success = false;
        let lastError: any = null;

        // Ensure target directory exists
        const targetDir = path.dirname(request.outputFilePath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        if (apiKeyPresent) {
          try {
            const ai = getAiClient();
            await withRetry(
              async () => {
                const response = await ai.models.generateContent({
                  model: 'gemini-2.5-flash',
                  contents: [{ parts: [{ text: textTrimmed }] }],
                  config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: request.voiceName },
                      },
                    },
                  },
                });

                const candidate = response.candidates?.[0];
                const inlineData = candidate?.content?.parts?.[0]?.inlineData;

                if (inlineData?.data) {
                  const rawBuffer = Buffer.from(inlineData.data, 'base64');
                  const wavBuffer = pcmToWavBuffer(rawBuffer, 24000, 1, 16);
                  fs.writeFileSync(request.outputFilePath, wavBuffer);
                  success = true;
                  return;
                }
                throw new Error('No audio inline data returned from Gemini TTS');
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
            console.warn(`[GoogleVoiceProvider] Gemini audio generation failed, falling back to TTS synthesizer:`, err?.message || err);
          }
        }

        // Fallback to Google Translate TTS or tone synthesis
        if (!success) {
          await generateFallbackAudio(
            request.outputFilePath,
            request.estimatedDurationSeconds || 5,
            textTrimmed,
            { signal: options.signal }
          );
          success = true;
        }

        const durationSeconds = await getAudioDuration(request.outputFilePath, { signal: options.signal });
        const durationMs = Date.now() - startTime;
        const stat = fs.statSync(request.outputFilePath);

        // Save to deterministic cache
        if (!options.skipCache) {
          assetCache.saveFileToCache('voice', cacheKey, request.outputFilePath, outputExt);
        }

        aiLogger.log({
          provider: this.name,
          model: lastError ? 'fallback-synthesizer' : model,
          operation,
          durationMs,
          success: true,
          cached: false,
          estimatedCostUsd: 0,
        });

        return {
          filePath: request.outputFilePath,
          durationSeconds,
          cached: false,
          model: lastError ? 'fallback-synthesizer' : model,
          provider: this.name,
          durationMs,
          bytesWritten: stat.size,
        };
      },
      options.signal
    );
  }
}

export const googleVoiceProvider = new GoogleVoiceProvider();
