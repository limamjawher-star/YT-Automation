import fs from 'fs';
import path from 'path';
import { AtomicWriteService } from '../storage/atomicWrite.js';
import { PathValidationService } from '../storage/pathValidation.js';
import {
  ExplicitPipelineStage,
  ORDERED_PIPELINE_STAGES,
  PipelineJob,
  PipelineState,
  StageProgress,
} from './types.js';

export interface JobStoreConfig {
  jobsDir?: string;
  atomicWriteService?: AtomicWriteService;
  pathValidator?: PathValidationService;
}

export class JobStore {
  private readonly jobsDir: string;
  private readonly atomic: AtomicWriteService;
  private readonly pathValidator: PathValidationService;
  private memoryCache: Map<string, PipelineJob> = new Map();

  constructor(config: JobStoreConfig = {}) {
    this.jobsDir = config.jobsDir || path.join(process.cwd(), 'storage', 'jobs');
    this.atomic = config.atomicWriteService || new AtomicWriteService();
    this.pathValidator = config.pathValidator || new PathValidationService();

    if (!fs.existsSync(this.jobsDir)) {
      fs.mkdirSync(this.jobsDir, { recursive: true });
    }

    // Load jobs into memory cache
    this.loadJobsFromDisk();
  }

  private loadJobsFromDisk(): void {
    try {
      if (!fs.existsSync(this.jobsDir)) return;
      const files = fs.readdirSync(this.jobsDir);
      for (const file of files) {
        if (file.endsWith('.json') && !file.includes('.bak') && !file.includes('.tmp')) {
          const filePath = path.join(this.jobsDir, file);
          const job = this.atomic.readJsonWithRecovery<PipelineJob>(filePath);
          if (job && job.id) {
            this.memoryCache.set(job.id, job);
          }
        }
      }
    } catch (err) {
      console.warn('[JobStore] Warning while reading jobs directory:', err);
    }
  }

  /**
   * Recovers jobs from disk after a server restart.
   * Any jobs left in 'running' or 'queued' state are marked 'failed' with a clear restart notice.
   */
  recoverStaleJobs(): number {
    let recoveredCount = 0;
    const now = new Date().toISOString();

    for (const [id, job] of this.memoryCache.entries()) {
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'failed';
        job.finishedAt = now;
        job.error = 'Job execution was interrupted by server restart. Can be restarted or resumed.';
        if (job.state) {
          job.state.status = 'failed';
          job.state.finishedAt = now;
          job.state.error = job.error;
          job.state.events.push({
            stage: job.stage,
            status: 'error',
            message: job.error,
            progressPercent: job.progress,
            timestamp: now,
          });
        }
        this.saveJob(job);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }

  /**
   * Initializes a fresh PipelineJob and PipelineState with all planned stages
   */
  createInitialJob(
    projectId: string,
    type: 'full_pipeline' | 'stage' = 'full_pipeline',
    targetStages: ExplicitPipelineStage[] = [...ORDERED_PIPELINE_STAGES]
  ): PipelineJob {
    const id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();

    const initialStagesRecord: Record<string, StageProgress> = {};
    for (const stage of ORDERED_PIPELINE_STAGES) {
      const isTarget = targetStages.includes(stage);
      initialStagesRecord[stage] = {
        stage,
        status: isTarget ? 'pending' : 'skipped',
        progress: 0,
      };
    }

    const firstStage = targetStages[0] || 'research';

    const state: PipelineState = {
      jobId: id,
      projectId,
      currentStage: firstStage,
      status: 'queued',
      progress: 0,
      stages: initialStagesRecord,
      events: [
        {
          stage: firstStage,
          status: 'started',
          message: `Job ${id} queued for project ${projectId}`,
          progressPercent: 0,
          timestamp: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    const job: PipelineJob = {
      id,
      projectId,
      type,
      stage: firstStage,
      targetStages,
      status: 'queued',
      progress: 0,
      createdAt: now,
      state,
    };

    this.saveJob(job);
    return job;
  }

  /**
   * Persists a job atomically to disk and updates in-memory cache
   */
  saveJob(job: PipelineJob): void {
    const safeFilename = this.pathValidator.sanitizeFilename(`${job.id}.json`);
    const filePath = path.join(this.jobsDir, safeFilename);

    if (job.state) {
      job.state.updatedAt = new Date().toISOString();
    }

    this.memoryCache.set(job.id, job);
    this.atomic.writeJsonAtomic(filePath, job);
  }

  /**
   * Retrieves a job by ID
   */
  getJob(jobId: string): PipelineJob | null {
    if (this.memoryCache.has(jobId)) {
      return this.memoryCache.get(jobId)!;
    }

    const safeFilename = this.pathValidator.sanitizeFilename(`${jobId}.json`);
    const filePath = path.join(this.jobsDir, safeFilename);
    const loaded = this.atomic.readJsonWithRecovery<PipelineJob>(filePath);
    if (loaded) {
      this.memoryCache.set(loaded.id, loaded);
      return loaded;
    }
    return null;
  }

  /**
   * Returns all jobs belonging to a project, newest first
   */
  getJobsForProject(projectId: string): PipelineJob[] {
    const results: PipelineJob[] = [];
    for (const job of this.memoryCache.values()) {
      if (job.projectId === projectId) {
        results.push(job);
      }
    }
    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Returns the active (queued or running) job for a project, if any
   */
  getActiveJobForProject(projectId: string): PipelineJob | null {
    for (const job of this.memoryCache.values()) {
      if (job.projectId === projectId && (job.status === 'running' || job.status === 'queued')) {
        return job;
      }
    }
    return null;
  }

  /**
   * Returns all jobs in the system, newest first
   */
  getAllJobs(limit: number = 50): PipelineJob[] {
    const all = Array.from(this.memoryCache.values());
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return all.slice(0, limit);
  }
}

export const globalJobStore = new JobStore();
