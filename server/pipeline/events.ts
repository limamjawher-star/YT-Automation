import { EventEmitter } from 'events';
import {
  ExplicitPipelineStage,
  PipelineEvent,
  PipelineJob,
  PipelineSseEventPayload,
  PipelineSseEventType,
  PipelineStage,
} from './types.js';

export class PipelineEventEmitter extends EventEmitter {
  constructor() {
    super();
    // Allow ample listeners across active connections and SSE streams
    this.setMaxListeners(200);
  }

  private dispatchSse(payload: PipelineSseEventPayload): void {
    // 1. Emit typed SSE event
    this.emit(payload.event, payload);
    // 2. Emit unified stream event
    this.emit('sse_event', payload);
    // 3. Emit scoped job event
    this.emit(`job:${payload.jobId}`, payload);
    // 4. Emit scoped project event
    this.emit(`project:${payload.projectId}`, payload);
  }

  emitJobCreated(job: PipelineJob): void {
    this.emit('job:created', job);
  }

  emitJobStarted(job: PipelineJob): void {
    this.emit('job:started', job);
    this.dispatchSse({
      event: 'job_started',
      jobId: job.id,
      projectId: job.projectId,
      stage: job.stage as ExplicitPipelineStage,
      timestamp: new Date().toISOString(),
      data: {
        status: job.status,
        progress: job.progress,
        targetStages: job.targetStages,
      },
    });
  }

  emitStageStarted(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    message = `Starting stage: ${stage}`
  ): void {
    const timestamp = new Date().toISOString();
    const event: PipelineEvent = {
      stage,
      status: 'started',
      message,
      progressPercent: 0,
      timestamp,
    };
    this.emit('stage:started', jobId, stage, event);
    this.dispatchSse({
      event: 'stage_started',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { message, progressPercent: 0 },
    });
  }

  emitStageProgress(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    progressPercent: number,
    message: string,
    data?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString();
    const event: PipelineEvent = {
      stage,
      status: 'progress',
      message,
      progressPercent,
      timestamp,
      data,
    };
    this.emit('stage:progress', jobId, stage, event);
    this.dispatchSse({
      event: 'stage_progress',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { progressPercent, message, ...data },
    });
  }

  emitAssetStarted(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    assetType: string,
    assetId: string,
    details?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString();
    this.dispatchSse({
      event: 'asset_started',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { assetType, assetId, details },
    });
  }

  emitAssetCompleted(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    assetType: string,
    assetId: string,
    url?: string,
    details?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString();
    this.dispatchSse({
      event: 'asset_completed',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { assetType, assetId, url, details },
    });
  }

  emitAssetFailed(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    assetType: string,
    assetId: string,
    error: string
  ): void {
    const timestamp = new Date().toISOString();
    this.dispatchSse({
      event: 'asset_failed',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { assetType, assetId, error },
    });
  }

  emitWarning(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    message: string,
    details?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString();
    this.dispatchSse({
      event: 'warning',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { message, details },
    });
  }

  emitLog(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    message: string,
    level: 'info' | 'warn' | 'error' = 'info'
  ): void {
    const timestamp = new Date().toISOString();
    this.dispatchSse({
      event: 'log',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { message, level },
    });
  }

  emitStageCompleted(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    message = `Stage ${stage} completed`
  ): void {
    const timestamp = new Date().toISOString();
    const event: PipelineEvent = {
      stage,
      status: 'completed',
      message,
      progressPercent: 100,
      timestamp,
    };
    this.emit('stage:completed', jobId, stage, event);
    this.dispatchSse({
      event: 'stage_completed',
      jobId,
      projectId,
      stage,
      timestamp,
      data: { message, progressPercent: 100 },
    });
  }

  emitStageError(
    jobId: string,
    projectId: string,
    stage: ExplicitPipelineStage,
    error: string,
    event?: PipelineEvent
  ): void {
    const timestamp = new Date().toISOString();
    const ev = event || {
      stage,
      status: 'error',
      message: error,
      progressPercent: 0,
      timestamp,
    };
    this.emit('stage:error', jobId, stage, error, ev);
  }

  emitJobPaused(job: PipelineJob): void {
    this.emit('job:paused', job);
    this.dispatchSse({
      event: 'job_paused',
      jobId: job.id,
      projectId: job.projectId,
      stage: job.stage as ExplicitPipelineStage,
      timestamp: new Date().toISOString(),
      data: {
        status: 'paused',
        progress: job.progress,
      },
    });
  }

  emitJobCancelled(job: PipelineJob): void {
    this.emit('job:cancelled', job);
    this.dispatchSse({
      event: 'job_cancelled',
      jobId: job.id,
      projectId: job.projectId,
      stage: job.stage as ExplicitPipelineStage,
      timestamp: new Date().toISOString(),
      data: {
        status: 'cancelled',
        progress: job.progress,
      },
    });
  }

  emitJobFailed(job: PipelineJob, error: string): void {
    this.emit('job:failed', job, error);
    this.dispatchSse({
      event: 'job_failed',
      jobId: job.id,
      projectId: job.projectId,
      stage: job.stage as ExplicitPipelineStage,
      timestamp: new Date().toISOString(),
      data: {
        status: 'failed',
        error,
        progress: job.progress,
      },
    });
  }

  emitJobCompleted(job: PipelineJob): void {
    this.emit('job:completed', job);
    this.dispatchSse({
      event: 'job_completed',
      jobId: job.id,
      projectId: job.projectId,
      stage: 'completed',
      timestamp: new Date().toISOString(),
      data: {
        status: 'completed',
        progress: 100,
      },
    });
  }
}

export const globalPipelineEvents = new PipelineEventEmitter();
