import { getAiConfig } from './config.js';

class Semaphore {
  private activeCount = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  public setMaxConcurrency(max: number): void {
    this.maxConcurrency = Math.max(1, max);
    this.dispatch();
  }

  public async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      const err = new Error('Operation aborted while waiting for AI concurrency slot');
      err.name = 'AbortError';
      throw err;
    }

    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.queue.indexOf(onSlotAvailable);
        if (index !== -1) {
          this.queue.splice(index, 1);
        }
        signal?.removeEventListener('abort', onAbort);
        const err = new Error('Operation aborted while waiting for AI concurrency slot');
        err.name = 'AbortError';
        reject(err);
      };

      const onSlotAvailable = () => {
        signal?.removeEventListener('abort', onAbort);
        this.activeCount++;
        resolve(() => this.release());
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.queue.push(onSlotAvailable);
    });
  }

  private release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.dispatch();
  }

  private dispatch(): void {
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrency) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}

class ConcurrencyManager {
  private textLimiter: Semaphore;
  private imageLimiter: Semaphore;
  private voiceLimiter: Semaphore;

  constructor() {
    const config = getAiConfig();
    this.textLimiter = new Semaphore(config.concurrencyLimits.text);
    this.imageLimiter = new Semaphore(config.concurrencyLimits.image);
    this.voiceLimiter = new Semaphore(config.concurrencyLimits.voice);
  }

  public updateLimits(): void {
    const config = getAiConfig();
    this.textLimiter.setMaxConcurrency(config.concurrencyLimits.text);
    this.imageLimiter.setMaxConcurrency(config.concurrencyLimits.image);
    this.voiceLimiter.setMaxConcurrency(config.concurrencyLimits.voice);
  }

  public async runWithLimit<T>(
    type: 'text' | 'image' | 'voice',
    fn: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    this.updateLimits();
    let limiter: Semaphore;
    switch (type) {
      case 'text':
        limiter = this.textLimiter;
        break;
      case 'image':
        limiter = this.imageLimiter;
        break;
      case 'voice':
        limiter = this.voiceLimiter;
        break;
      default:
        limiter = this.textLimiter;
    }

    const release = await limiter.acquire(signal);
    try {
      if (signal?.aborted) {
        const err = new Error('Operation aborted');
        err.name = 'AbortError';
        throw err;
      }
      return await fn();
    } finally {
      release();
    }
  }

  public getStatus() {
    return {
      text: { active: this.textLimiter.getActiveCount(), queued: this.textLimiter.getQueueLength() },
      image: { active: this.imageLimiter.getActiveCount(), queued: this.imageLimiter.getQueueLength() },
      voice: { active: this.voiceLimiter.getActiveCount(), queued: this.voiceLimiter.getQueueLength() },
    };
  }
}

export const concurrencyManager = new ConcurrencyManager();
