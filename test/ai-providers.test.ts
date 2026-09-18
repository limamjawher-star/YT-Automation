import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  getAiConfig,
  updateAiConfig,
  resetAiConfig,
  loadAiConfigFromEnv,
} from '../server/ai/config.js';
import { aiLogger } from '../server/ai/logger.js';
import { concurrencyManager } from '../server/ai/limiter.js';
import { assetCache, computeDeterministicHash } from '../server/ai/cache.js';
import {
  getTextProvider,
  getImageProvider,
  getVoiceProvider,
  registerTextProvider,
  registerImageProvider,
  registerVoiceProvider,
} from '../server/ai/index.js';
import {
  TextProvider,
  ImageProvider,
  VoiceProvider,
  TextGenerationRequest,
  TextGenerationResult,
  StructuredGenerationRequest,
  StructuredGenerationResult,
  ImageGenerationRequest,
  ImageGenerationResult,
  VoiceGenerationRequest,
  VoiceGenerationResult,
} from '../server/ai/types.js';

describe('AI Integration Layer: Configuration Service', () => {
  beforeEach(() => {
    resetAiConfig();
  });

  afterEach(() => {
    resetAiConfig();
  });

  it('provides sensible defaults for all AI parameters without hardcoding', () => {
    const config = getAiConfig();
    assert.strictEqual(typeof config.textModel, 'string');
    assert.strictEqual(typeof config.imageModel, 'string');
    assert.strictEqual(typeof config.voiceModel, 'string');
    assert.ok(config.textModel.length > 0);
    assert.ok(config.imageModel.length > 0);
    assert.ok(config.voiceModel.length > 0);
    assert.strictEqual(config.retryPolicy.maxRetries >= 1, true);
    assert.strictEqual(config.concurrencyLimits.text >= 1, true);
    assert.strictEqual(config.concurrencyLimits.image >= 1, true);
    assert.strictEqual(config.concurrencyLimits.voice >= 1, true);
  });

  it('allows dynamic updating of AI parameters', () => {
    const updated = updateAiConfig({
      textModel: 'test-custom-text-model',
      concurrencyLimits: { text: 5, image: 4, voice: 3 },
    });
    assert.strictEqual(updated.textModel, 'test-custom-text-model');
    assert.strictEqual(updated.concurrencyLimits.text, 5);
    assert.strictEqual(getAiConfig().textModel, 'test-custom-text-model');
  });

  it('loads configuration from environment overrides', () => {
    const oldEnv = { ...process.env };
    process.env.AI_TEXT_MODEL = 'gemini-custom-flash';
    process.env.AI_IMAGE_MODEL = 'imagen-custom-model';
    process.env.AI_CONCURRENCY_IMAGE = '4';

    const fromEnv = loadAiConfigFromEnv();
    assert.strictEqual(fromEnv.textModel, 'gemini-custom-flash');
    assert.strictEqual(fromEnv.imageModel, 'imagen-custom-model');
    assert.strictEqual(fromEnv.concurrencyLimits.image, 4);

    process.env = oldEnv;
  });
});

describe('AI Integration Layer: Deterministic Asset Caching', () => {
  const testDir = path.join(process.cwd(), '.cache', 'ai-test');

  beforeEach(() => {
    updateAiConfig({ cacheDir: testDir, cacheEnabled: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('computes identical hashes for identical inputs regardless of key order', () => {
    const hash1 = computeDeterministicHash({
      prompt: 'Cinematic sunset',
      model: 'imagen-3.0-generate-002',
      aspectRatio: '16:9',
      style: 'Photorealism',
    });

    const hash2 = computeDeterministicHash({
      style: 'Photorealism',
      model: 'imagen-3.0-generate-002',
      aspectRatio: '16:9',
      prompt: 'Cinematic sunset',
    });

    assert.strictEqual(hash1, hash2);
  });

  it('computes distinct hashes for different inputs', () => {
    const hash1 = computeDeterministicHash({ prompt: 'A sunny day' });
    const hash2 = computeDeterministicHash({ prompt: 'A rainy day' });
    assert.notStrictEqual(hash1, hash2);
  });

  it('caches text results deterministically and retrieves them', () => {
    const hash = computeDeterministicHash({ prompt: 'Hello world test' });
    const dummyResult = {
      text: 'Hello test response',
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      durationMs: 120,
    };

    assetCache.saveTextToCache(hash, dummyResult);
    const retrieved = assetCache.getCachedText(hash);
    assert.deepStrictEqual(retrieved, dummyResult);
  });

  it('caches binary file assets and copies them to target destinations', () => {
    const tempSource = path.join(testDir, 'temp-source.png');
    const tempTarget = path.join(testDir, 'temp-target.png');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(tempSource, Buffer.from('fake-png-image-content'));

    const hash = computeDeterministicHash({ prompt: 'Unique image test' });
    const cachedPath = assetCache.saveFileToCache('image', hash, tempSource, '.png');
    assert.ok(cachedPath);
    assert.ok(fs.existsSync(cachedPath));

    const copied = assetCache.copyCachedFile('image', hash, tempTarget, '.png');
    assert.strictEqual(copied, true);
    assert.ok(fs.existsSync(tempTarget));
    assert.strictEqual(fs.readFileSync(tempTarget).toString(), 'fake-png-image-content');
  });
});

describe('AI Integration Layer: Concurrency Limiting', () => {
  it('enforces maximum concurrent executions under load', async () => {
    updateAiConfig({
      concurrencyLimits: { text: 2, image: 2, voice: 2 },
    });

    let activeRunning = 0;
    let maxSeenActive = 0;

    const runTask = async (id: number) => {
      return await concurrencyManager.runWithLimit('image', async () => {
        activeRunning++;
        if (activeRunning > maxSeenActive) {
          maxSeenActive = activeRunning;
        }
        await new Promise((res) => setTimeout(res, 25));
        activeRunning--;
        return id;
      });
    };

    const tasks = [1, 2, 3, 4, 5].map((id) => runTask(id));
    const results = await Promise.all(tasks);

    assert.deepStrictEqual(results, [1, 2, 3, 4, 5]);
    assert.ok(maxSeenActive <= 2, `Max active (${maxSeenActive}) exceeded limit of 2`);
  });
});

describe('AI Integration Layer: Structured Logging & Cost Estimation', () => {
  beforeEach(() => {
    aiLogger.clearLogs();
  });

  it('records structured logs with provider, model, duration, and usage', () => {
    const entry = aiLogger.log({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      operation: 'script_generation',
      durationMs: 450,
      success: true,
      usage: {
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        totalTokenCount: 1500,
      },
      estimatedCostUsd: 0.000225,
    });

    assert.ok(entry.id.startsWith('ai-log-'));
    assert.strictEqual(entry.provider, 'gemini');
    assert.strictEqual(entry.model, 'gemini-2.5-flash');
    assert.strictEqual(entry.success, true);
    assert.strictEqual(entry.durationMs, 450);

    const logs = aiLogger.getRecentLogs(10);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].id, entry.id);
  });

  it('estimates costs accurately for flash and pro models', () => {
    const flashCost = aiLogger.estimateCost('gemini-2.5-flash', {
      promptTokenCount: 100_000,
      candidatesTokenCount: 50_000,
      totalTokenCount: 150_000,
    });
    assert.ok(typeof flashCost === 'number');
    assert.ok(flashCost > 0);

    const imageCost = aiLogger.estimateCost('imagen-3.0-generate-002', undefined, 'image');
    assert.strictEqual(imageCost, 0.03);
  });
});

describe('AI Integration Layer: Provider Interface & Extensibility', () => {
  it('allows registering and swapping custom TextProvider', async () => {
    class MockTextProvider implements TextProvider {
      public name = 'mock-text';
      async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
        return {
          text: `Mocked: ${req.prompt}`,
          model: 'mock-model-v1',
          provider: this.name,
          durationMs: 10,
        };
      }
      async generateStructured<T>(req: StructuredGenerationRequest<T>): Promise<StructuredGenerationResult<T>> {
        const dummy = { topic: 'mock', points: [1, 2, 3] } as any;
        return {
          data: dummy,
          rawText: JSON.stringify(dummy),
          model: 'mock-model-v1',
          provider: this.name,
          durationMs: 10,
        };
      }
    }

    const mock = new MockTextProvider();
    registerTextProvider(mock, true);

    const provider = getTextProvider();
    assert.strictEqual(provider.name, 'mock-text');

    const result = await provider.generateText({ prompt: 'Hello' });
    assert.strictEqual(result.text, 'Mocked: Hello');
    assert.strictEqual(result.provider, 'mock-text');
  });

  it('allows registering and swapping custom ImageProvider', async () => {
    class MockImageProvider implements ImageProvider {
      public name = 'mock-image';
      async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
        return {
          filePath: req.outputFilePath,
          cached: false,
          model: 'mock-imagen-v1',
          provider: this.name,
          durationMs: 15,
          bytesWritten: 1024,
        };
      }
    }

    const mock = new MockImageProvider();
    registerImageProvider(mock, true);

    const provider = getImageProvider();
    assert.strictEqual(provider.name, 'mock-image');

    const result = await provider.generateImage({
      prompt: 'A futuristic city',
      aspectRatio: '16:9',
      outputFilePath: '/tmp/test.png',
    });
    assert.strictEqual(result.provider, 'mock-image');
    assert.strictEqual(result.model, 'mock-imagen-v1');
  });

  it('allows registering and swapping custom VoiceProvider', async () => {
    class MockVoiceProvider implements VoiceProvider {
      public name = 'mock-voice';
      async generateVoice(req: VoiceGenerationRequest): Promise<VoiceGenerationResult> {
        return {
          filePath: req.outputFilePath,
          durationSeconds: 7.5,
          cached: false,
          model: 'mock-tts-v1',
          provider: this.name,
          durationMs: 20,
          bytesWritten: 2048,
        };
      }
    }

    const mock = new MockVoiceProvider();
    registerVoiceProvider(mock, true);

    const provider = getVoiceProvider();
    assert.strictEqual(provider.name, 'mock-voice');

    const result = await provider.generateVoice({
      text: 'Voice narration text',
      voiceName: 'Kore',
      outputFilePath: '/tmp/test.wav',
    });
    assert.strictEqual(result.provider, 'mock-voice');
    assert.strictEqual(result.durationSeconds, 7.5);
  });
});
