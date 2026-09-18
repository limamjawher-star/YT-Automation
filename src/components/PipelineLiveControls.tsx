import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  XCircle,
  AlertTriangle,
  Radio,
  ChevronDown,
  ChevronUp,
  Layers,
  Terminal,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertOctagon,
  Image as ImageIcon,
  Mic,
  Film,
  FileText,
  Compass,
} from 'lucide-react';
import { ExplicitPipelineStage, EXPLICIT_PIPELINE_STAGES, PipelineJob } from '../types.js';
import { ActiveAssetInfo, LivePipelineEvent } from '../hooks/usePipelineSSE.js';

interface PipelineLiveControlsProps {
  job: PipelineJob | null;
  activeAsset: ActiveAssetInfo | null;
  eventsLog: LivePipelineEvent[];
  warnings: string[];
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  onCancel: () => void;
  onPause: () => void;
  onResumeCheckpoint: () => void;
  onRetryFailed: () => void;
  onRetryStage: (stage?: ExplicitPipelineStage) => void;
  onRestartFromStage: (stage: ExplicitPipelineStage) => void;
}

const STAGE_LABELS: Record<ExplicitPipelineStage, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  research: { label: 'Research', icon: Compass },
  story: { label: 'Story Arc', icon: Sparkles },
  script: { label: 'Script', icon: FileText },
  scene_plan: { label: 'Scene Plan', icon: Layers },
  shot_plan: { label: 'Shot Plan', icon: Film },
  visuals: { label: 'Visuals', icon: ImageIcon },
  voiceover: { label: 'Voiceover', icon: Mic },
  audio: { label: 'Audio Master', icon: Mic },
  timeline: { label: 'Timeline', icon: Clock },
  captions: { label: 'Captions', icon: FileText },
  thumbnail: { label: 'Thumbnail', icon: ImageIcon },
  render: { label: 'Render', icon: Film },
  qa: { label: 'QA Check', icon: CheckCircle2 },
  completed: { label: 'Completed', icon: CheckCircle2 },
};

export const PipelineLiveControls: React.FC<PipelineLiveControlsProps> = ({
  job,
  activeAsset,
  eventsLog,
  warnings,
  connectionStatus,
  onCancel,
  onPause,
  onResumeCheckpoint,
  onRetryFailed,
  onRetryStage,
  onRestartFromStage,
}) => {
  const [showLogs, setShowLogs] = useState(false);
  const [selectedRestartStage, setSelectedRestartStage] = useState<ExplicitPipelineStage>('visuals');

  const isRunning = job?.status === 'running';
  const isPaused = job?.status === 'paused';
  const isFailed = job?.status === 'failed';
  const isCancelled = job?.status === 'cancelled';
  const isCompleted = job?.status === 'completed';

  const currentStage = (job?.stage as ExplicitPipelineStage) || 'research';
  const currentStageIndex = EXPLICIT_PIPELINE_STAGES.indexOf(currentStage);

  return (
    <div className="w-full bg-slate-900/90 border-y border-slate-800 backdrop-blur-md px-4 py-3 text-slate-200">
      <div className="max-w-7xl mx-auto space-y-3">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status & Job ID */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  connectionStatus === 'connected'
                    ? 'bg-emerald-400 ring-2 ring-emerald-400/30'
                    : connectionStatus === 'connecting'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-slate-500'
                }`}
                title={`SSE stream: ${connectionStatus}`}
              />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Pipeline Engine
              </span>
            </div>

            {/* Status Badge */}
            <div className="flex items-center gap-1.5">
              {isRunning && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1 animate-pulse">
                  <Radio className="w-3 h-3" />
                  Running ({job?.progress || 0}%)
                </span>
              )}
              {isPaused && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  Paused ({job?.progress || 0}%)
                </span>
              )}
              {isFailed && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1">
                  <AlertOctagon className="w-3 h-3" />
                  Failed at {job?.stage}
                </span>
              )}
              {isCancelled && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                  Cancelled
                </span>
              )}
              {isCompleted && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Completed (100%)
                </span>
              )}
              {!job && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800/80 text-slate-400 border border-slate-700/60">
                  Idle / Ready
                </span>
              )}
            </div>

            {job?.id && (
              <span className="font-mono text-[11px] text-slate-500 hidden sm:inline">
                {job.id}
              </span>
            )}
          </div>

          {/* Active Asset Notification Badge */}
          {activeAsset && isRunning && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-sky-950/60 border border-sky-800/60 text-sky-300 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <span>
                {activeAsset.type.toUpperCase()}: {activeAsset.id}
              </span>
            </div>
          )}

          {/* Action Control Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Running: Pause & Cancel */}
            {isRunning && (
              <>
                <button
                  id="btn-pipeline-pause"
                  onClick={onPause}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Pause pipeline execution"
                >
                  <Pause className="w-3.5 h-3.5 text-amber-400" />
                  <span>Pause</span>
                </button>
                <button
                  id="btn-pipeline-cancel"
                  onClick={onCancel}
                  className="px-3 py-1.5 text-xs font-medium bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-800 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Cancel job and terminate FFmpeg processes"
                >
                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                  <span>Cancel Job</span>
                </button>
              </>
            )}

            {/* Paused: Resume */}
            {isPaused && (
              <>
                <button
                  id="btn-pipeline-resume"
                  onClick={onResumeCheckpoint}
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-emerald-950/40"
                  title="Resume pipeline from checkpoint"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume</span>
                </button>
                <button
                  id="btn-pipeline-cancel-paused"
                  onClick={onCancel}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </>
            )}

            {/* Failed: Retry Failed / Resume Checkpoint */}
            {isFailed && (
              <>
                <button
                  id="btn-pipeline-retry"
                  onClick={onRetryFailed}
                  className="px-3.5 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-rose-950/40"
                  title="Retry failed stage"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry Stage ({job?.stage})</span>
                </button>
                <button
                  id="btn-pipeline-resume-checkpoint"
                  onClick={onResumeCheckpoint}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Resume from last intact checkpoint"
                >
                  <Compass className="w-3.5 h-3.5 text-sky-400" />
                  <span>Resume Checkpoint</span>
                </button>
              </>
            )}

            {/* Restart from Stage Selector */}
            <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-lg p-0.5">
              <select
                id="select-restart-stage"
                value={selectedRestartStage}
                onChange={(e) => setSelectedRestartStage(e.target.value as ExplicitPipelineStage)}
                disabled={isRunning}
                className="bg-transparent text-xs text-slate-300 px-2 py-1 outline-none cursor-pointer disabled:opacity-50"
              >
                {EXPLICIT_PIPELINE_STAGES.map((s) => (
                  <option key={s} value={s} className="bg-slate-900 text-slate-200">
                    {STAGE_LABELS[s]?.label || s}
                  </option>
                ))}
              </select>
              <button
                id="btn-pipeline-restart-stage"
                onClick={() => onRestartFromStage(selectedRestartStage)}
                disabled={isRunning}
                className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-all disabled:opacity-40 cursor-pointer"
                title={`Restart from stage "${selectedRestartStage}"`}
              >
                Restart
              </button>
            </div>

            {/* Toggle Real-time Logs Console */}
            <button
              onClick={() => setShowLogs(!showLogs)}
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                showLogs
                  ? 'bg-slate-800 border-slate-600 text-white'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Logs ({eventsLog.length})</span>
              {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Real Progress Bar */}
        <div className="space-y-1">
          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800/80">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isFailed
                  ? 'bg-red-500'
                  : isPaused
                  ? 'bg-amber-500'
                  : isCompleted
                  ? 'bg-emerald-500'
                  : 'bg-gradient-to-r from-rose-500 via-pink-500 to-amber-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, job?.progress || 0))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="truncate pr-2">
              {job?.state?.currentStepMessage || (isRunning ? 'Processing stage deliverables...' : 'Ready')}
            </span>
            <span className="font-mono text-slate-300 shrink-0">{job?.progress || 0}%</span>
          </div>
        </div>

        {/* 14 Explicit Pipeline Stages Flow */}
        <div className="overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-800">
          <div className="flex items-center gap-1 min-w-[760px]">
            {EXPLICIT_PIPELINE_STAGES.map((stg, idx) => {
              const info = STAGE_LABELS[stg];
              const Icon = info.icon;
              const isCurrent = currentStage === stg && isRunning;
              const isPassed = currentStageIndex > idx || isCompleted;
              const isStageFailed = currentStage === stg && isFailed;

              return (
                <button
                  key={stg}
                  onClick={() => onRestartFromStage(stg)}
                  disabled={isRunning}
                  className={`flex-1 min-w-[50px] py-1.5 px-1 rounded flex flex-col items-center justify-center gap-0.5 border text-center transition-all cursor-pointer disabled:cursor-default ${
                    isCurrent
                      ? 'bg-rose-500/20 border-rose-500/60 text-rose-300 ring-1 ring-rose-500/40'
                      : isStageFailed
                      ? 'bg-red-500/20 border-red-500/50 text-red-300'
                      : isPassed
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-slate-950/40 border-slate-800/60 text-slate-500 hover:border-slate-700 hover:text-slate-400'
                  }`}
                  title={`Stage ${idx + 1}: ${info.label}. Click to restart from here.`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="text-[9px] font-medium leading-tight truncate w-full">
                    {info.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Warnings Banner */}
        {warnings.length > 0 && (
          <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-800/60 text-amber-300 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-0.5">
              {warnings.slice(-3).map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          </div>
        )}

        {/* Real-time SSE Events Console Drawer */}
        {showLogs && (
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold border-b border-slate-800/80 pb-2">
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                Live SSE Pipeline Events Stream
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {connectionStatus === 'connected' ? 'Connected (Live Stream)' : 'Waiting for events'}
              </span>
            </div>
            <div className="h-44 overflow-y-auto font-mono text-[11px] space-y-1 pr-1">
              {eventsLog.length === 0 ? (
                <div className="text-slate-600 italic">No events recorded yet.</div>
              ) : (
                eventsLog.map((ev) => (
                  <div key={ev.id} className="flex items-start gap-2 leading-tight">
                    <span className="text-slate-600 text-[10px] shrink-0 font-mono">{ev.timestamp}</span>
                    <span
                      className={`text-[10px] px-1 rounded uppercase font-bold shrink-0 ${
                        ev.level === 'error'
                          ? 'bg-red-950 text-red-400'
                          : ev.level === 'warn'
                          ? 'bg-amber-950 text-amber-400'
                          : 'bg-slate-900 text-emerald-400'
                      }`}
                    >
                      {ev.type}
                    </span>
                    <span
                      className={
                        ev.level === 'error'
                          ? 'text-red-300'
                          : ev.level === 'warn'
                          ? 'text-amber-300'
                          : 'text-slate-300'
                      }
                    >
                      {ev.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
