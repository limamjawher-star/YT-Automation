import fs from 'fs';
import path from 'path';
import {
  ExplicitPipelineStage,
  ORDERED_PIPELINE_STAGES,
  PipelineEvent,
  PipelineJob,
  STAGE_WEIGHTS,
  TOTAL_PIPELINE_WEIGHT,
  VideoProject,
} from './types.js';
import { globalPipelineEvents, PipelineEventEmitter } from './events.js';
import { globalJobStore, JobStore } from './jobStore.js';
import { stageHandlers } from './stages/index.js';
import { getProject, saveProject, getProjectDir, projectStore } from '../storage.js';
import { terminateJobProcesses } from '../ffmpeg.js';

export interface PipelineEngineConfig {
  jobStore?: JobStore;
  eventEmitter?: PipelineEventEmitter;
}

export class PipelineEngine {
  private jobStore: JobStore;
  private events: PipelineEventEmitter;
  private activeExecutions: Set<string> = new Set();
  private cancellationRequests: Set<string> = new Set();
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(config: PipelineEngineConfig = {}) {
    this.jobStore = config.jobStore || globalJobStore;
    this.events = config.eventEmitter || globalPipelineEvents;

    // Recover jobs left unfinished from prior crashes/server restarts
    const recovered = this.jobStore.recoverStaleJobs();
    if (recovered > 0) {
      console.log(`[PipelineEngine] Recovered ${recovered} interrupted job(s) from previous session.`);
    }
  }

  /**
   * Starts a pipeline execution job. Returns immediately with the newly created job.
   */
  startJob(
    projectId: string,
    options: {
      type?: 'full_pipeline' | 'stage';
      stages?: ExplicitPipelineStage[];
    } = {}
  ): PipelineJob {
    const project = getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // If an active job is already running for this project, return it
    const activeJob = this.jobStore.getActiveJobForProject(projectId);
    if (activeJob) {
      return activeJob;
    }

    const type = options.type || 'full_pipeline';
    const targetStages = options.stages && options.stages.length > 0
      ? options.stages
      : [...ORDERED_PIPELINE_STAGES];

    const job = this.jobStore.createInitialJob(projectId, type, targetStages);
    this.events.emitJobCreated(job);

    // Trigger async execution on the next event loop tick without holding the caller
    setImmediate(() => {
      this.executeJob(job.id).catch((err) => {
        console.error(`[PipelineEngine] Unhandled job execution error for ${job.id}:`, err);
      });
    });

    return job;
  }

  /**
   * Cancels a currently running or queued job.
   * Forcefully terminates any running FFmpeg child processes and aborts network calls.
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobStore.getJob(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return false;
    }

    this.cancellationRequests.add(jobId);

    // Abort controller
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(jobId);
    }

    // Terminate all associated FFmpeg child processes
    terminateJobProcesses(jobId);

    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    if (job.state) {
      job.state.status = 'cancelled';
      job.state.finishedAt = job.finishedAt;
      job.state.events.push({
        stage: job.stage,
        status: 'error',
        message: 'Job cancelled by user request',
        progressPercent: job.progress,
        timestamp: job.finishedAt,
      });
    }

    this.jobStore.saveJob(job);
    this.events.emitJobCancelled(job);

    // Reset project state to ready
    const project = getProject(job.projectId);
    if (project && project.status === 'generating') {
      project.status = 'ready';
      project.renderLogs = project.renderLogs || [];
      pLogs(project, `Job ${jobId} cancelled by user.`);
      saveProject(project);
    }

    return true;
  }

  /**
   * Pauses a running pipeline job
   */
  pauseJob(jobId: string): boolean {
    const job = this.jobStore.getJob(jobId);
    if (!job || job.status !== 'running') {
      return false;
    }

    // Abort controller to yield current async operation cleanly
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(jobId);
    }
    terminateJobProcesses(jobId);

    job.status = 'paused';
    if (job.state) {
      job.state.status = 'paused';
    }
    this.jobStore.saveJob(job);
    this.events.emitJobPaused(job);

    const project = getProject(job.projectId);
    if (project) {
      project.status = 'ready';
      pLogs(project, `Job ${job.id} paused by user.`);
      saveProject(project);
    }

    return true;
  }

  /**
   * Retries a failed job from the stage where it failed
   */
  retryFailedJob(jobId: string): PipelineJob {
    const job = this.jobStore.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const failedStage = (job.stage as ExplicitPipelineStage) || 'research';
    return this.restartFromStage(job.projectId, failedStage);
  }

  /**
   * Retries the current/failed stage for a project
   */
  retryStage(projectId: string, stage?: ExplicitPipelineStage): PipelineJob {
    // Cancel any running job first
    const active = this.jobStore.getActiveJobForProject(projectId);
    if (active) {
      this.cancelJob(active.id);
    }

    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const targetStage: ExplicitPipelineStage = stage || (project.currentStage as ExplicitPipelineStage) || 'research';
    return this.restartFromStage(projectId, targetStage);
  }

  /**
   * Resumes pipeline execution from the last successful checkpoint.
   * Skips all already-completed assets and deliverables.
   */
  resumeFromCheckpoint(projectId: string): PipelineJob {
    // Cancel any active job first
    const active = this.jobStore.getActiveJobForProject(projectId);
    if (active) {
      this.cancelJob(active.id);
    }

    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const firstIncomplete = this.findFirstIncompleteStage(projectId, project);
    console.log(`[PipelineEngine] Resuming project ${projectId} from checkpoint stage: ${firstIncomplete}`);

    return this.restartFromStage(projectId, firstIncomplete);
  }

  /**
   * Restarts pipeline execution starting from a user-selected stage through to completion.
   */
  restartFromStage(projectId: string, startStage: ExplicitPipelineStage): PipelineJob {
    // Cancel any active job first
    const active = this.jobStore.getActiveJobForProject(projectId);
    if (active) {
      this.cancelJob(active.id);
    }

    const stageIdx = ORDERED_PIPELINE_STAGES.indexOf(startStage);
    const targetStages: ExplicitPipelineStage[] = stageIdx >= 0
      ? (ORDERED_PIPELINE_STAGES.slice(stageIdx) as ExplicitPipelineStage[])
      : [...ORDERED_PIPELINE_STAGES];

    return this.startJob(projectId, {
      type: 'full_pipeline',
      stages: targetStages,
    });
  }

  /**
   * Inspects persisted files and modular state to find the earliest uncompleted stage.
   */
  findFirstIncompleteStage(projectId: string, project: VideoProject): ExplicitPipelineStage {
    const projectDir = getProjectDir(projectId);

    // 1. Research
    const research = projectStore.readProjectModular<any>(projectId, 'research');
    if (!research || !research.hookSuggestions || research.hookSuggestions.length === 0) {
      return 'research';
    }

    // 2. Story
    // If research exists, story is virtually instant, check script
    // 3. Script
    if (!project.script || !project.scenes || project.scenes.length === 0) {
      return 'script';
    }

    // 4. Scene Plan
    const hasUnestimatedScenes = project.scenes.some(
      (s) => !s.estimatedDurationSeconds || s.estimatedDurationSeconds <= 0
    );
    if (hasUnestimatedScenes) {
      return 'scene_plan';
    }

    // 5. Shot Plan
    const hasUnconfiguredShots = project.scenes.some((s) => !s.onScreenText || s.onScreenText.trim().length === 0);
    if (hasUnconfiguredShots) {
      return 'shot_plan';
    }

    // 6. Visuals
    const scenesDir = path.join(projectDir, 'scenes');
    const allImagesPresent = project.scenes.every((_, idx) => {
      const imgPath = path.join(scenesDir, `scene_${idx}.png`);
      return fs.existsSync(imgPath) && fs.statSync(imgPath).size > 1000;
    });
    if (!allImagesPresent) {
      return 'visuals';
    }

    // 7. Voiceover
    const audioDir = path.join(projectDir, 'audio');
    const allAudioPresent = project.scenes.every((_, idx) => {
      const audPath = path.join(audioDir, `scene_${idx}.wav`);
      return fs.existsSync(audPath) && fs.statSync(audPath).size > 500;
    });
    if (!allAudioPresent) {
      return 'voiceover';
    }

    // 8. Audio Processing
    if (!project.totalDurationSeconds || project.totalDurationSeconds <= 0) {
      return 'audio';
    }

    // 9. Timeline
    const timeline = projectStore.readProjectModular<any>(projectId, 'timeline');
    if (!timeline || !timeline.tracks) {
      return 'timeline';
    }

    // 10. Captions
    const srtCanonical = path.join(projectDir, 'captions', 'subtitles.srt');
    const srtRoot = path.join(projectDir, 'subtitles.srt');
    if (!fs.existsSync(srtCanonical) && !fs.existsSync(srtRoot)) {
      return 'captions';
    }

    // 11. Thumbnail
    const thumbCanonical = path.join(projectDir, 'thumbnails', 'thumbnail.png');
    const thumbRoot = path.join(projectDir, 'thumbnail.png');
    if (!fs.existsSync(thumbCanonical) && !fs.existsSync(thumbRoot)) {
      return 'thumbnail';
    }

    // 12. Render
    const videoCanonical = path.join(projectDir, 'renders', 'video.mp4');
    const videoRoot = path.join(projectDir, 'video.mp4');
    const videoExists = (fs.existsSync(videoCanonical) && fs.statSync(videoCanonical).size > 5000) ||
                        (fs.existsSync(videoRoot) && fs.statSync(videoRoot).size > 5000);
    if (!videoExists) {
      return 'render';
    }

    // 13. QA
    if (project.currentStage !== 'completed') {
      return 'qa';
    }

    return 'completed';
  }

  /**
   * Retrieves a job by ID
   */
  getJob(jobId: string): PipelineJob | null {
    return this.jobStore.getJob(jobId);
  }

  /**
   * Retrieves all jobs for a project
   */
  getJobsForProject(projectId: string): PipelineJob[] {
    return this.jobStore.getJobsForProject(projectId);
  }

  /**
   * Retrieves the active job for a project if one exists
   */
  getActiveJobForProject(projectId: string): PipelineJob | null {
    return this.jobStore.getActiveJobForProject(projectId);
  }

  /**
   * Internal execution loop running all planned stages sequentially
   */
  private async executeJob(jobId: string): Promise<void> {
    const job = this.jobStore.getJob(jobId);
    if (!job) return;

    const controller = new AbortController();
    this.abortControllers.set(jobId, controller);
    this.activeExecutions.add(jobId);

    job.status = 'running';
    job.startedAt = new Date().toISOString();
    if (job.state) {
      job.state.status = 'running';
      job.state.startedAt = job.startedAt;
    }
    this.jobStore.saveJob(job);
    this.events.emitJobStarted(job);

    const project = getProject(job.projectId);
    if (!project) {
      this.failJob(job, `Project ${job.projectId} was deleted or not found`);
      this.activeExecutions.delete(jobId);
      this.abortControllers.delete(jobId);
      return;
    }

    // Set project status to generating
    project.status = 'generating';
    project.errorMessage = undefined;
    pLogs(project, `[PipelineEngine] Starting execution for job ${job.id}`);
    saveProject(project);

    const stagesToExecute = (job.targetStages && job.targetStages.length > 0
      ? job.targetStages
      : ORDERED_PIPELINE_STAGES) as ExplicitPipelineStage[];

    // Calculate total weight of planned stages for real progress calculation
    const totalPlannedWeight = stagesToExecute.reduce(
      (sum, s) => sum + (STAGE_WEIGHTS[s] || 5),
      0
    ) || TOTAL_PIPELINE_WEIGHT;

    let accumulatedWeight = 0;

    try {
      for (const stage of stagesToExecute) {
        if (this.isCancelled(jobId) || controller.signal.aborted) {
          this.handleCancelled(job);
          return;
        }

        const stageWeight = STAGE_WEIGHTS[stage] || 5;

        // Update active stage on job and project
        job.stage = stage;
        if (job.state) {
          job.state.currentStage = stage;
          if (job.state.stages[stage]) {
            job.state.stages[stage].status = 'running';
            job.state.stages[stage].startedAt = new Date().toISOString();
          }
        }

        project.currentStage = stage as any;
        saveProject(project);
        this.jobStore.saveJob(job);

        this.events.emitStageStarted(job.id, job.projectId, stage, `Stage ${stage} started`);

        const handler = stageHandlers[stage];
        if (!handler) {
          throw new Error(`No stage handler defined for stage: ${stage}`);
        }

        // Sub-progress callback from stage handler
        const emitProgress = (subProgress: number, message: string, data?: Record<string, unknown>) => {
          if (this.isCancelled(jobId) || controller.signal.aborted) return;

          // Real progress: accumulated finished stage weights + proportion of current stage
          const boundedSub = Math.max(0, Math.min(100, subProgress));
          const currentStageContribution = stageWeight * (boundedSub / 100);
          const computedOverall = Math.min(
            100,
            Math.round(((accumulatedWeight + currentStageContribution) / totalPlannedWeight) * 100)
          );

          job.progress = computedOverall;
          if (job.state) {
            job.state.progress = computedOverall;
            job.state.currentStepMessage = message;
            if (job.state.stages[stage]) {
              job.state.stages[stage].progress = boundedSub;
              job.state.stages[stage].message = message;
            }
          }

          project.renderProgress = computedOverall;
          saveProject(project);
          this.jobStore.saveJob(job);

          this.events.emitStageProgress(job.id, job.projectId, stage, computedOverall, message, data);
        };

        // Context passed into each stage handler
        const stageContext = {
          projectId: job.projectId,
          jobId: job.id,
          project,
          signal: controller.signal,
          updateProject: (mutator: (p: VideoProject) => void) => {
            mutator(project);
            saveProject(project);
          },
          emitProgress,
          emitAssetStarted: (assetType: string, assetId: string, details?: Record<string, unknown>) => {
            this.events.emitAssetStarted(job.id, job.projectId, stage, assetType, assetId, details);
          },
          emitAssetCompleted: (assetType: string, assetId: string, url?: string, details?: Record<string, unknown>) => {
            this.events.emitAssetCompleted(job.id, job.projectId, stage, assetType, assetId, url, details);
          },
          emitAssetFailed: (assetType: string, assetId: string, error: string) => {
            this.events.emitAssetFailed(job.id, job.projectId, stage, assetType, assetId, error);
          },
          emitWarning: (message: string, details?: Record<string, unknown>) => {
            this.events.emitWarning(job.id, job.projectId, stage, message, details);
          },
          emitLog: (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
            this.events.emitLog(job.id, job.projectId, stage, message, level);
          },
          isCancelled: () => this.isCancelled(jobId) || controller.signal.aborted,
        };

        // Execute stage
        await handler(stageContext);

        if (this.isCancelled(jobId) || controller.signal.aborted) {
          this.handleCancelled(job);
          return;
        }

        // Stage completed
        accumulatedWeight += stageWeight;
        const stageProgressEnd = Math.min(100, Math.round((accumulatedWeight / totalPlannedWeight) * 100));
        job.progress = stageProgressEnd;

        if (job.state) {
          job.state.progress = stageProgressEnd;
          if (job.state.stages[stage]) {
            job.state.stages[stage].status = 'completed';
            job.state.stages[stage].progress = 100;
            job.state.stages[stage].finishedAt = new Date().toISOString();
          }
        }

        project.renderProgress = stageProgressEnd;
        saveProject(project);
        this.jobStore.saveJob(job);

        this.events.emitStageCompleted(job.id, job.projectId, stage, `Stage ${stage} completed successfully`);
      }

      // All stages completed successfully!
      job.status = 'completed';
      job.progress = 100;
      job.finishedAt = new Date().toISOString();
      if (job.state) {
        job.state.status = 'completed';
        job.state.progress = 100;
        job.state.finishedAt = job.finishedAt;
      }
      this.jobStore.saveJob(job);

      project.status = 'ready';
      project.renderProgress = 100;
      project.errorMessage = undefined;
      pLogs(project, `[PipelineEngine] Job ${job.id} completed successfully.`);
      saveProject(project);

      this.events.emitJobCompleted(job);
    } catch (err: any) {
      if (this.isCancelled(jobId) || controller.signal.aborted || err?.name === 'AbortError') {
        this.handleCancelled(job);
        return;
      }
      console.error(`[PipelineEngine] Error in stage ${job.stage} for job ${job.id}:`, err);
      this.failJob(job, err?.message || 'Pipeline stage failed');
    } finally {
      this.activeExecutions.delete(jobId);
      this.cancellationRequests.delete(jobId);
      this.abortControllers.delete(jobId);
    }
  }

  private isCancelled(jobId: string): boolean {
    return this.cancellationRequests.has(jobId);
  }

  private handleCancelled(job: PipelineJob): void {
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    if (job.state) {
      job.state.status = 'cancelled';
      job.state.finishedAt = job.finishedAt;
    }
    this.jobStore.saveJob(job);
    this.events.emitJobCancelled(job);

    const project = getProject(job.projectId);
    if (project) {
      project.status = 'ready';
      pLogs(project, `Job ${job.id} execution halted due to cancellation.`);
      saveProject(project);
    }
  }

  private failJob(job: PipelineJob, errorMessage: string): void {
    const now = new Date().toISOString();
    job.status = 'failed';
    job.error = errorMessage;
    job.finishedAt = now;

    if (job.state) {
      job.state.status = 'failed';
      job.state.error = errorMessage;
      job.state.finishedAt = now;
      if (job.state.stages[job.stage]) {
        job.state.stages[job.stage].status = 'failed';
        job.state.stages[job.stage].error = errorMessage;
        job.state.stages[job.stage].finishedAt = now;
      }
      job.state.events.push({
        stage: job.stage,
        status: 'error',
        message: errorMessage,
        progressPercent: job.progress,
        timestamp: now,
      });
    }

    this.jobStore.saveJob(job);

    const project = getProject(job.projectId);
    if (project) {
      project.status = 'error';
      project.errorMessage = errorMessage;
      pLogs(project, `[Error] ${errorMessage}`);
      saveProject(project);
    }

    const errEvent: PipelineEvent = {
      stage: job.stage,
      status: 'error',
      message: errorMessage,
      progressPercent: job.progress,
      timestamp: now,
    };
    this.events.emitStageError(job.id, job.projectId, job.stage as ExplicitPipelineStage, errorMessage, errEvent);
    this.events.emitJobFailed(job, errorMessage);
  }
}

function pLogs(project: VideoProject, msg: string): void {
  project.renderLogs = project.renderLogs || [];
  project.renderLogs.push(msg);
}

export const globalPipelineEngine = new PipelineEngine();
