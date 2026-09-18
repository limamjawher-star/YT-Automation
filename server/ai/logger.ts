import { AiExecutionLog, AiUsageMetadata } from './types.js';

class AiLogger {
  private logs: AiExecutionLog[] = [];
  private readonly maxLogs: number = 250;

  /**
   * Estimate USD cost based on model and usage
   */
  public estimateCost(model: string, usage?: AiUsageMetadata, assetType?: 'image' | 'voice'): number | undefined {
    if (assetType === 'image') {
      // Imagen 3 estimated ~$0.03 per image
      return 0.03;
    }
    if (!usage || !usage.totalTokenCount) {
      return undefined;
    }

    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;

    const lowerModel = model.toLowerCase();
    if (lowerModel.includes('pro')) {
      // Gemini Pro: ~$1.25 / 1M input, $5.00 / 1M output
      const cost = (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 5.0;
      return Math.round(cost * 1_000_000) / 1_000_000;
    }

    if (lowerModel.includes('flash') || lowerModel.includes('lite')) {
      // Gemini Flash: ~$0.075 / 1M input, $0.30 / 1M output
      const cost = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;
      return Math.round(cost * 1_000_000) / 1_000_000;
    }

    // Default generic estimate
    const cost = (inputTokens / 1_000_000) * 0.1 + (outputTokens / 1_000_000) * 0.4;
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  /**
   * Log an AI execution event
   */
  public log(entry: Omit<AiExecutionLog, 'id' | 'timestamp'>): AiExecutionLog {
    const fullLog: AiExecutionLog = {
      id: `ai-log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.logs.push(fullLog);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Output structured log to stdout
    const logData = {
      type: 'AI_EXECUTION',
      provider: fullLog.provider,
      model: fullLog.model,
      operation: fullLog.operation,
      durationMs: fullLog.durationMs,
      success: fullLog.success,
      cached: fullLog.cached || false,
      usage: fullLog.usage,
      estimatedCostUsd: fullLog.estimatedCostUsd,
      error: fullLog.error,
      timestamp: fullLog.timestamp,
    };

    if (fullLog.success) {
      console.log(`[AI Log] ${fullLog.provider}:${fullLog.model} | ${fullLog.operation} | ${fullLog.durationMs}ms | success=${fullLog.success}${fullLog.cached ? ' (CACHED)' : ''}${fullLog.estimatedCostUsd ? ` | ~$${fullLog.estimatedCostUsd}` : ''}`);
    } else {
      console.warn(`[AI Log ERROR] ${fullLog.provider}:${fullLog.model} | ${fullLog.operation} | ${fullLog.durationMs}ms | error=${fullLog.error}`);
    }

    return fullLog;
  }

  public getRecentLogs(limit = 50): AiExecutionLog[] {
    return this.logs.slice(-limit).reverse();
  }

  public clearLogs(): void {
    this.logs = [];
  }
}

export const aiLogger = new AiLogger();
