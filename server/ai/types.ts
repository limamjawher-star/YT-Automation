/**
 * Centralized Provider Abstractions & Types for AI Integration
 */

export interface AiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface AiExecutionLog {
  id: string;
  provider: string;
  model: string;
  operation: string;
  durationMs: number;
  success: boolean;
  error?: string;
  usage?: AiUsageMetadata;
  estimatedCostUsd?: number;
  timestamp: string;
  cached?: boolean;
}

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface ConcurrencyLimits {
  text: number;
  image: number;
  voice: number;
}

export interface GenerationParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
}

export interface AiConfig {
  textModel: string;
  fallbackTextModels: string[];
  imageModel: string;
  voiceModel: string;
  generationParams: GenerationParams;
  retryPolicy: RetryPolicy;
  concurrencyLimits: ConcurrencyLimits;
  cacheEnabled: boolean;
  cacheDir: string;
}

export interface ProviderExecutionOptions {
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void;
  skipCache?: boolean;
}

// -------------------------------------------------------------
// Text Provider Abstraction
// -------------------------------------------------------------
export interface TextGenerationRequest {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  operation?: string;
}

export interface TextGenerationResult {
  text: string;
  usage?: AiUsageMetadata;
  model: string;
  provider: string;
  durationMs: number;
}

export interface StructuredGenerationRequest<T = any> {
  prompt: string;
  systemInstruction?: string;
  schema?: any; // Zod schema or JSON schema definition
  validator?: (raw: unknown) => { success: boolean; data?: T; errors?: any };
  temperature?: number;
  operation?: string;
}

export interface StructuredGenerationResult<T = any> {
  data: T;
  rawText: string;
  usage?: AiUsageMetadata;
  model: string;
  provider: string;
  durationMs: number;
}

export interface TextProvider {
  name: string;
  generateText(request: TextGenerationRequest, options?: ProviderExecutionOptions): Promise<TextGenerationResult>;
  generateStructured<T>(request: StructuredGenerationRequest<T>, options?: ProviderExecutionOptions): Promise<StructuredGenerationResult<T>>;
}

// -------------------------------------------------------------
// Image Provider Abstraction
// -------------------------------------------------------------
export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  visualStyle?: string;
  operation?: string;
  outputFilePath: string;
}

export interface ImageGenerationResult {
  filePath: string;
  cached: boolean;
  model: string;
  provider: string;
  durationMs: number;
  bytesWritten: number;
}

export interface ImageProvider {
  name: string;
  generateImage(request: ImageGenerationRequest, options?: ProviderExecutionOptions): Promise<ImageGenerationResult>;
}

// -------------------------------------------------------------
// Voice / TTS Provider Abstraction
// -------------------------------------------------------------
export interface VoiceGenerationRequest {
  text: string;
  voiceName: string;
  outputFilePath: string;
  operation?: string;
  estimatedDurationSeconds?: number;
}

export interface VoiceGenerationResult {
  filePath: string;
  durationSeconds: number;
  cached: boolean;
  model: string;
  provider: string;
  durationMs: number;
  bytesWritten: number;
}

export interface VoiceProvider {
  name: string;
  generateVoice(request: VoiceGenerationRequest, options?: ProviderExecutionOptions): Promise<VoiceGenerationResult>;
}
