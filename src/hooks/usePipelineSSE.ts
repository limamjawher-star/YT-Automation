import { useState, useEffect, useRef, useCallback } from 'react';
import { ExplicitPipelineStage, PipelineJob, VideoProject } from '../types.js';

export interface LivePipelineEvent {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  level?: 'info' | 'warn' | 'error';
  stage?: ExplicitPipelineStage;
}

export interface ActiveAssetInfo {
  type: string;
  id: string;
  url?: string;
  details?: Record<string, unknown>;
  status: 'generating' | 'ready' | 'failed';
}

export interface UsePipelineSSEResult {
  activeJob: PipelineJob | null;
  activeAsset: ActiveAssetInfo | null;
  eventsLog: LivePipelineEvent[];
  warnings: string[];
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  cancelJob: () => Promise<void>;
  pauseJob: () => Promise<void>;
  resumeFromCheckpoint: () => Promise<void>;
  retryFailed: () => Promise<void>;
  retryStage: (stage?: ExplicitPipelineStage) => Promise<void>;
  restartFromStage: (stage: ExplicitPipelineStage) => Promise<void>;
  startFullPipeline: (stages?: ExplicitPipelineStage[]) => Promise<void>;
}

export function usePipelineSSE(
  project: VideoProject | null,
  onProjectUpdate: (updated: VideoProject) => void
): UsePipelineSSEResult {
  const [activeJob, setActiveJob] = useState<PipelineJob | null>(null);
  const [activeAsset, setActiveAsset] = useState<ActiveAssetInfo | null>(null);
  const [eventsLog, setEventsLog] = useState<LivePipelineEvent[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');

  const eventSourceRef = useRef<EventSource | null>(null);
  const projectId = project?.id;

  // Append a live event to the local event stream
  const addEvent = useCallback((type: string, message: string, stage?: ExplicitPipelineStage, level: 'info' | 'warn' | 'error' = 'info') => {
    setEventsLog((prev) => [
      ...prev.slice(-99), // keep last 100 events
      {
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        type,
        message,
        stage,
        timestamp: new Date().toLocaleTimeString(),
        level,
      },
    ]);
  }, []);

  // Sync project from server
  const refetchProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const fresh = await res.json();
        onProjectUpdate(fresh);
      }
    } catch (err) {
      console.warn('Failed to refetch project:', err);
    }
  }, [projectId, onProjectUpdate]);

  // Connect to SSE stream
  useEffect(() => {
    if (!projectId) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnectionStatus('disconnected');
      setActiveJob(null);
      return;
    }

    setConnectionStatus('connecting');
    const sseUrl = `/api/projects/${projectId}/pipeline/stream`;
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnectionStatus('connected');
    };

    es.onerror = () => {
      setConnectionStatus('disconnected');
    };

    // 1. Initial Snapshot
    es.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.activeJob) {
          setActiveJob(payload.activeJob);
        }
        if (payload.project) {
          onProjectUpdate(payload.project);
        }
      } catch (err) {
        console.error('Error parsing SSE snapshot:', err);
      }
    });

    // 2. Job Started
    es.addEventListener('job_started', (e: MessageEvent) => {
      try {
        const job = JSON.parse(e.data);
        setActiveJob(job);
        addEvent('job_started', `Job ${job.id} started`, job.stage);
        refetchProject();
      } catch (err) {
        console.error('SSE job_started error:', err);
      }
    });

    // 3. Stage Started
    es.addEventListener('stage_started', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setActiveJob((prev) => prev ? { ...prev, stage: data.stage, status: 'running' } : null);
        addEvent('stage_started', `Starting stage "${data.stage}"`, data.stage);
        refetchProject();
      } catch (err) {
        console.error('SSE stage_started error:', err);
      }
    });

    // 4. Stage Progress
    es.addEventListener('stage_progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setActiveJob((prev) => prev ? {
          ...prev,
          progress: data.progressPercent,
          stage: data.stage,
        } : null);

        // Directly update project progress in parent without polling
        if (project) {
          onProjectUpdate({
            ...project,
            renderProgress: data.progressPercent,
            currentStage: data.stage,
          });
        }

        addEvent('stage_progress', data.message || `Progress: ${data.progressPercent}%`, data.stage);
      } catch (err) {
        console.error('SSE stage_progress error:', err);
      }
    });

    // 5. Asset Started
    es.addEventListener('asset_started', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setActiveAsset({
          type: data.assetType,
          id: data.assetId,
          details: data.details,
          status: 'generating',
        });
        addEvent('asset_started', `Generating ${data.assetType} (${data.assetId})`, data.stage);
      } catch (err) {
        console.error('SSE asset_started error:', err);
      }
    });

    // 6. Asset Completed
    es.addEventListener('asset_completed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setActiveAsset({
          type: data.assetType,
          id: data.assetId,
          url: data.url,
          details: data.details,
          status: 'ready',
        });
        addEvent('asset_completed', `Asset ${data.assetType} (${data.assetId}) ready`, data.stage);
        refetchProject();
      } catch (err) {
        console.error('SSE asset_completed error:', err);
      }
    });

    // 7. Asset Failed
    es.addEventListener('asset_failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setActiveAsset({
          type: data.assetType,
          id: data.assetId,
          status: 'failed',
        });
        addEvent('asset_failed', `Failed ${data.assetType} (${data.assetId}): ${data.error}`, data.stage, 'error');
      } catch (err) {
        console.error('SSE asset_failed error:', err);
      }
    });

    // 8. Warning
    es.addEventListener('warning', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const msg = data.message || 'Pipeline warning';
        setWarnings((prev) => [...prev.slice(-9), msg]);
        addEvent('warning', msg, data.stage, 'warn');
      } catch (err) {
        console.error('SSE warning error:', err);
      }
    });

    // 9. Log
    es.addEventListener('log', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        addEvent('log', data.message, data.stage, data.level || 'info');
      } catch (err) {
        console.error('SSE log error:', err);
      }
    });

    // 10. Stage Completed
    es.addEventListener('stage_completed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        addEvent('stage_completed', `Stage "${data.stage}" completed successfully`, data.stage);
        refetchProject();
      } catch (err) {
        console.error('SSE stage_completed error:', err);
      }
    });

    // 11. Job Paused
    es.addEventListener('job_paused', (e: MessageEvent) => {
      try {
        const job = JSON.parse(e.data);
        setActiveJob(job);
        addEvent('job_paused', `Job ${job.id} paused by operator`, job.stage, 'warn');
        refetchProject();
      } catch (err) {
        console.error('SSE job_paused error:', err);
      }
    });

    // 12. Job Cancelled
    es.addEventListener('job_cancelled', (e: MessageEvent) => {
      try {
        const job = JSON.parse(e.data);
        setActiveJob(job);
        setActiveAsset(null);
        addEvent('job_cancelled', `Job ${job.id} cancelled. FFmpeg and AI processes terminated.`, job.stage, 'warn');
        refetchProject();
      } catch (err) {
        console.error('SSE job_cancelled error:', err);
      }
    });

    // 13. Job Failed
    es.addEventListener('job_failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const job = data.job || data;
        setActiveJob(job);
        setActiveAsset(null);
        addEvent('job_failed', `Job execution halted: ${data.error || job.error}`, job.stage, 'error');
        refetchProject();
      } catch (err) {
        console.error('SSE job_failed error:', err);
      }
    });

    // 14. Job Completed
    es.addEventListener('job_completed', (e: MessageEvent) => {
      try {
        const job = JSON.parse(e.data);
        setActiveJob(job);
        setActiveAsset(null);
        addEvent('job_completed', `Pipeline job ${job.id} fully completed! Deliverables ready.`, job.stage);
        refetchProject();
      } catch (err) {
        console.error('SSE job_completed error:', err);
      }
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [projectId, addEvent, refetchProject, onProjectUpdate]);

  // Operational Actions

  const cancelJob = useCallback(async () => {
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/pipeline/cancel`, { method: 'POST' });
    } catch (err) {
      console.error('Cancel job request failed:', err);
    }
  }, [projectId]);

  const pauseJob = useCallback(async () => {
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/pipeline/pause`, { method: 'POST' });
    } catch (err) {
      console.error('Pause job request failed:', err);
    }
  }, [projectId]);

  const resumeFromCheckpoint = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/pipeline/resume`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.job) setActiveJob(data.job);
        if (data.project) onProjectUpdate(data.project);
      }
    } catch (err) {
      console.error('Resume from checkpoint request failed:', err);
    }
  }, [projectId, onProjectUpdate]);

  const retryFailed = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/pipeline/retry-stage`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.job) setActiveJob(data.job);
      }
    } catch (err) {
      console.error('Retry failed request failed:', err);
    }
  }, [projectId]);

  const retryStage = useCallback(async (stage?: ExplicitPipelineStage) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/pipeline/retry-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.job) setActiveJob(data.job);
      }
    } catch (err) {
      console.error('Retry stage request failed:', err);
    }
  }, [projectId]);

  const restartFromStage = useCallback(async (stage: ExplicitPipelineStage) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/pipeline/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.job) setActiveJob(data.job);
      }
    } catch (err) {
      console.error('Restart from stage request failed:', err);
    }
  }, [projectId]);

  const startFullPipeline = useCallback(async (stages?: ExplicitPipelineStage[]) => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages, type: 'full_pipeline' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.job) setActiveJob(data.job);
      }
    } catch (err) {
      console.error('Start pipeline request failed:', err);
    }
  }, [projectId]);

  return {
    activeJob,
    activeAsset,
    eventsLog,
    warnings,
    connectionStatus,
    cancelJob,
    pauseJob,
    resumeFromCheckpoint,
    retryFailed,
    retryStage,
    restartFromStage,
    startFullPipeline,
  };
}
