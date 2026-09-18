import {
  ExplicitPipelineStage,
  PipelineStage,
  PipelineJob,
  PipelineState,
  PipelineEvent,
  PipelineSseEventType,
  StageProgress,
  VideoProject,
} from '../../src/schemas/index.js';

export type {
  ExplicitPipelineStage,
  PipelineStage,
  PipelineJob,
  PipelineState,
  PipelineEvent,
  PipelineSseEventType,
  StageProgress,
  VideoProject,
};

/**
 * Standard execution sequence of explicit pipeline stages.
 */
export const ORDERED_PIPELINE_STAGES: readonly ExplicitPipelineStage[] = [
  'research',
  'story',
  'script',
  'scene_plan',
  'shot_plan',
  'visuals',
  'voiceover',
  'audio',
  'timeline',
  'captions',
  'thumbnail',
  'render',
  'qa',
  'completed',
] as const;

/**
 * Relative weight of each stage in the end-to-end pipeline.
 * Real progress calculation: (completedStageWeights + currentStageWeight * (subProgress / 100)) / totalWeight * 100.
 */
export const STAGE_WEIGHTS: Record<ExplicitPipelineStage, number> = {
  research: 5,
  story: 5,
  script: 10,
  scene_plan: 5,
  shot_plan: 5,
  visuals: 20,
  voiceover: 15,
  audio: 5,
  timeline: 5,
  captions: 5,
  thumbnail: 5,
  render: 20,
  qa: 5,
  completed: 0,
};

export const TOTAL_PIPELINE_WEIGHT = Object.values(STAGE_WEIGHTS).reduce((sum, w) => sum + w, 0);

export interface StageContext {
  projectId: string;
  jobId: string;
  project: VideoProject;
  signal: AbortSignal;
  /**
   * Safe project mutator that synchronizes with storage
   */
  updateProject: (mutator: (p: VideoProject) => void) => void;
  /**
   * Reports sub-progress within the active stage (0-100) and step description.
   * Progress MUST come from actual work items completed.
   */
  emitProgress: (progressPercent: number, message: string, data?: Record<string, unknown>) => void;
  /**
   * Emits that asset generation has started (e.g. scene 2 image)
   */
  emitAssetStarted: (assetType: string, assetId: string, details?: Record<string, unknown>) => void;
  /**
   * Emits that asset generation has completed successfully
   */
  emitAssetCompleted: (assetType: string, assetId: string, url?: string, details?: Record<string, unknown>) => void;
  /**
   * Emits that asset generation failed
   */
  emitAssetFailed: (assetType: string, assetId: string, error: string) => void;
  /**
   * Emits operational warnings (e.g. non-fatal fallback, subtitle formatting fallback)
   */
  emitWarning: (message: string, details?: Record<string, unknown>) => void;
  /**
   * Emits operational log
   */
  emitLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /**
   * Check if user requested job cancellation
   */
  isCancelled: () => boolean;
}

export type StageHandler = (context: StageContext) => Promise<void>;

export interface PipelineSseEventPayload {
  event: PipelineSseEventType;
  jobId: string;
  projectId: string;
  stage?: ExplicitPipelineStage;
  timestamp: string;
  data: Record<string, unknown>;
}
