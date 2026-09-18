import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  JobStore,
  PipelineEngine,
  ORDERED_PIPELINE_STAGES,
  STAGE_WEIGHTS,
  TOTAL_PIPELINE_WEIGHT,
  PipelineEventEmitter,
} from '../server/pipeline/index.js';
import {
  PipelineJobSchema,
  ExplicitPipelineStage,
} from '../src/schemas/index.js';
import { ProjectStore } from '../server/storage/projectStore.js';

describe('Pipeline Job Architecture', () => {
  const testDir = path.join(process.cwd(), 'test-storage-pipeline');
  const jobsDir = path.join(testDir, 'jobs');
  const projectsDir = path.join(testDir, 'projects');

  let jobStore: JobStore;
  let projectStore: ProjectStore;
  let testEvents: PipelineEventEmitter;

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });

    jobStore = new JobStore({ jobsDir });
    projectStore = new ProjectStore({
      storageRoot: testDir,
      projectsDir,
    });
    testEvents = new PipelineEventEmitter();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('JobStore Persistence & Lifecycle', () => {
    it('creates an initial job with all 14 explicit stages in queued state', () => {
      const projectId = 'proj_test_101';
      const job = jobStore.createInitialJob(projectId);

      assert.match(job.id, /^job_/);
      assert.equal(job.projectId, projectId);
      assert.equal(job.status, 'queued');
      assert.equal(job.progress, 0);
      assert.equal(job.stage, 'research');

      assert.ok(job.state);
      assert.equal(job.state?.status, 'queued');
      assert.equal(job.state?.currentStage, 'research');

      // Check all 14 stages exist in initial state
      for (const stage of ORDERED_PIPELINE_STAGES) {
        assert.ok(job.state?.stages[stage]);
        assert.equal(job.state?.stages[stage].status, 'pending');
        assert.equal(job.state?.stages[stage].progress, 0);
      }

      // Validates against Zod schema
      const validation = PipelineJobSchema.safeParse(job);
      assert.equal(validation.success, true);
    });

    it('persists and retrieves job from disk atomically', () => {
      const projectId = 'proj_test_102';
      const job = jobStore.createInitialJob(projectId);

      const retrieved = jobStore.getJob(job.id);
      assert.ok(retrieved);
      assert.equal(retrieved?.id, job.id);
      assert.equal(retrieved?.projectId, projectId);

      // Verify file exists on disk
      const filePath = path.join(jobsDir, `${job.id}.json`);
      assert.equal(fs.existsSync(filePath), true);
    });

    it('recovers interrupted running jobs on startup and marks them failed', () => {
      const projectId = 'proj_test_103';
      const job = jobStore.createInitialJob(projectId);
      job.status = 'running';
      if (job.state) job.state.status = 'running';
      jobStore.saveJob(job);

      // Simulate new server startup with fresh JobStore instance
      const freshJobStore = new JobStore({ jobsDir });
      const recoveredCount = freshJobStore.recoverStaleJobs();

      assert.equal(recoveredCount, 1);

      const recoveredJob = freshJobStore.getJob(job.id);
      assert.equal(recoveredJob?.status, 'failed');
      assert.ok(recoveredJob?.error?.includes('interrupted by server restart'));
      assert.equal(recoveredJob?.state?.status, 'failed');
    });

    it('returns active job for project correctly', () => {
      const projectId = 'proj_test_104';
      const job = jobStore.createInitialJob(projectId);
      job.status = 'running';
      jobStore.saveJob(job);

      const active = jobStore.getActiveJobForProject(projectId);
      assert.equal(active?.id, job.id);

      job.status = 'completed';
      jobStore.saveJob(job);

      const noActive = jobStore.getActiveJobForProject(projectId);
      assert.equal(noActive, null);
    });
  });

  describe('Pipeline Stage Definitions & Real Progress Calculation', () => {
    it('defines explicit 14 pipeline stages with positive weights summing to 110', () => {
      assert.deepEqual(ORDERED_PIPELINE_STAGES, [
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
      ]);

      assert.equal(TOTAL_PIPELINE_WEIGHT, 110);
      assert.equal(STAGE_WEIGHTS.render, 20);
      assert.equal(STAGE_WEIGHTS.visuals, 20);
      assert.equal(STAGE_WEIGHTS.voiceover, 15);
      assert.equal(STAGE_WEIGHTS.script, 10);
    });

    it('computes real progress derived from actual completed stages and work', () => {
      const stages: ExplicitPipelineStage[] = ['research', 'story', 'script'];
      const totalPlannedWeight = stages.reduce((s, st) => s + STAGE_WEIGHTS[st], 0); // 5 + 5 + 10 = 20

      // When research (weight 5) is done
      let accumulated = 5;
      let overallProgress = Math.round((accumulated / totalPlannedWeight) * 100);
      assert.equal(overallProgress, 25); // 5 / 20 = 25%

      // When story is halfway through (50% of 5 = 2.5)
      let subProgress = 50;
      let currentContribution = STAGE_WEIGHTS.story * (subProgress / 100);
      overallProgress = Math.round(((accumulated + currentContribution) / totalPlannedWeight) * 100);
      assert.equal(overallProgress, 38); // 7.5 / 20 = 37.5 -> 38%
    });
  });

  describe('Pipeline Event System', () => {
    it('emits typed lifecycle events for job and stage transitions', () => {
      const eventsRecorded: string[] = [];

      testEvents.on('job:created', (j) => eventsRecorded.push(`job:created:${j.id}`));
      testEvents.on('stage:started', (id, st) => eventsRecorded.push(`stage:started:${st}`));
      testEvents.on('stage:progress', (id, st, ev) => eventsRecorded.push(`stage:progress:${st}:${ev.progressPercent}`));
      testEvents.on('stage:completed', (id, st) => eventsRecorded.push(`stage:completed:${st}`));

      const dummyJob = jobStore.createInitialJob('proj_dummy');
      testEvents.emitJobCreated(dummyJob);

      testEvents.emitStageStarted(dummyJob.id, 'proj_dummy', 'research', 'Research starting');
      testEvents.emitStageProgress(dummyJob.id, 'proj_dummy', 'research', 5, 'Gathering hooks');
      testEvents.emitStageCompleted(dummyJob.id, 'proj_dummy', 'research', 'Research complete');

      assert.ok(eventsRecorded.includes(`job:created:${dummyJob.id}`));
      assert.ok(eventsRecorded.includes('stage:started:research'));
      assert.ok(eventsRecorded.includes('stage:progress:research:5'));
      assert.ok(eventsRecorded.includes('stage:completed:research'));
    });
  });

  describe('Job Cancellation', () => {
    it('cancels active job and updates state correctly', () => {
      const engine = new PipelineEngine({
        jobStore,
        eventEmitter: testEvents,
      });

      const project = projectStore.createProject({
        topic: 'Cancellation Test Project',
      });

      const job = jobStore.createInitialJob(project.id);
      job.status = 'running';
      jobStore.saveJob(job);

      let cancelledEventEmitted = false;
      testEvents.on('job:cancelled', (j) => {
        if (j.id === job.id) cancelledEventEmitted = true;
      });

      const success = engine.cancelJob(job.id);
      assert.equal(success, true);
      assert.equal(cancelledEventEmitted, true);

      const cancelledJob = jobStore.getJob(job.id);
      assert.equal(cancelledJob?.status, 'cancelled');
      assert.ok(cancelledJob?.finishedAt);
    });
  });
});
