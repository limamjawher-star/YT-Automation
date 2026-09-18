/**
 * Bounded Retry Utility with Exponential Backoff
 * Designed for transient AI/network errors.
 * Strictly avoids retrying permanent validation, schema, or authorization errors.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Determines whether an error is transient (temporary network/rate limit/server error)
 * vs permanent (validation, schema mismatch, unauthorized, bad request).
 */
export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  const err = error as Record<string, unknown>;
  const name = String(err.name || '');
  const message = String(err.message || '').toLowerCase();
  const code = String(err.code || '');
  const status = Number(err.status || err.statusCode || 0);

  // 1. Permanent validation & client errors -> NEVER RETRY
  if (
    name === 'ZodError' ||
    name === 'ValidationError' ||
    message.includes('validation error') ||
    message.includes('schema validation') ||
    message.includes('invalid argument') ||
    message.includes('invalid json') ||
    message.includes('unexpected token') ||
    message.includes('bad request') ||
    message.includes('not found') ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    code === 'INVALID_ARGUMENT' ||
    code === 'PERMISSION_DENIED' ||
    code === 'NOT_FOUND'
  ) {
    return false;
  }

  // 2. Transient network errors -> RETRY
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'RESOURCE_EXHAUSTED' ||
    code === 'UNAVAILABLE' ||
    code === 'DEADLINE_EXCEEDED'
  ) {
    return true;
  }

  // 3. Transient HTTP status codes (Rate limits & 5xx server errors)
  if (status === 429 || (status >= 500 && status <= 599)) {
    return true;
  }

  // 4. Common transient error text from AI SDKs and Node fetch
  if (
    message.includes('resource exhausted') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota exceeded') ||
    message.includes('fetch failed') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('service unavailable') ||
    message.includes('gateway timeout') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('502') ||
    message.includes('temporary failure')
  ) {
    return true;
  }

  return false;
}

/**
 * Executes an async operation with bounded retry and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const factor = options.factor ?? options.backoffMultiplier ?? 2;
  const jitter = options.jitter ?? true;
  const signal = options.signal;
  const shouldRetry = options.shouldRetry ?? isTransientError;

  let attempt = 0;

  while (true) {
    if (signal?.aborted) {
      const abortErr = new Error('Operation aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;

      if (signal?.aborted) {
        const abortErr = new Error('Operation aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      // If it's not a transient error, or we reached max retries, fail fast!
      const canRetry = shouldRetry(err);
      if (!canRetry || attempt > maxRetries) {
        throw err;
      }

      // Compute exponential backoff with jitter
      const exponentialDelay = initialDelayMs * Math.pow(factor, attempt - 1);
      const jitterAmount = jitter ? Math.floor(Math.random() * 300) : 0;
      const delayMs = Math.min(maxDelayMs, exponentialDelay) + jitterAmount;

      if (options.onRetry) {
        options.onRetry(attempt, err, delayMs);
      } else {
        console.warn(
          `[Retry] Transient error on attempt ${attempt}/${maxRetries}. Retrying in ${delayMs}ms:`,
          (err as any)?.message || err
        );
      }

      // Wait with AbortSignal cancellation awareness
      await sleepAbortable(delayMs, signal);
    }
  }
}

/**
 * Cancellable sleep helper
 */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Operation aborted during backoff');
      err.name = 'AbortError';
      return reject(err);
    }

    let timeoutId: NodeJS.Timeout | null = null;
    let abortListener: (() => void) | null = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
    };

    abortListener = () => {
      cleanup();
      const err = new Error('Operation aborted during backoff');
      err.name = 'AbortError';
      reject(err);
    };

    if (signal) {
      signal.addEventListener('abort', abortListener, { once: true });
    }

    timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}
