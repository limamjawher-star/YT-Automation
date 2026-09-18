import React from 'react';
import { 
  FileText, 
  Image as ImageIcon, 
  Mic, 
  Film, 
  Check, 
  Loader2, 
  Settings2 
} from 'lucide-react';
import { PipelineStage, VideoProject } from '../types.js';

interface StageProgressBarProps {
  project: VideoProject;
  activeTab: PipelineStage;
  onSelectTab: (stage: PipelineStage) => void;
}

interface StageInfo {
  id: PipelineStage;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STAGES: StageInfo[] = [
  { id: 'topic', label: '1. Settings', subtitle: 'Topic & Style', icon: Settings2 },
  { id: 'scenes', label: '2. Script', subtitle: 'Gemini 3.8 Storyboard', icon: FileText },
  { id: 'visuals', label: '3. Visuals', subtitle: 'Google Imagen/AI', icon: ImageIcon },
  { id: 'voiceover', label: '4. Voiceover', subtitle: 'Google TTS Audio', icon: Mic },
  { id: 'assembly', label: '5. Assembly', subtitle: 'FFmpeg Video Render', icon: Film },
];

export const StageProgressBar: React.FC<StageProgressBarProps> = ({
  project,
  activeTab,
  onSelectTab,
}) => {
  const getStageStatus = (stageId: PipelineStage): 'completed' | 'current' | 'pending' | 'generating' => {
    if (project.status === 'generating' && project.currentStage === stageId) {
      return 'generating';
    }

    const order: PipelineStage[] = ['topic', 'script', 'scenes', 'visuals', 'voiceover', 'assembly', 'completed'];
    const projectIndex = order.indexOf(project.currentStage);
    const thisIndex = order.indexOf(stageId === 'scenes' ? 'script' : stageId);

    if (project.currentStage === 'completed') {
      return 'completed';
    }

    // Specific asset checks
    if (stageId === 'topic') return 'completed';
    if (stageId === 'scenes' && project.scenes && project.scenes.length > 0) return 'completed';
    if (stageId === 'visuals' && project.scenes?.some(s => s.imageUrl)) return 'completed';
    if (stageId === 'voiceover' && project.scenes?.some(s => s.audioUrl)) return 'completed';
    if (stageId === 'assembly' && project.finalVideoUrl) return 'completed';

    if (stageId === activeTab) return 'current';
    return thisIndex <= projectIndex ? 'completed' : 'pending';
  };

  return (
    <div className="w-full bg-slate-900/60 border-b border-slate-800 px-4 py-3">
      <div className="max-w-7xl mx-auto">
        {/* Stages list */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {STAGES.map((stage) => {
            const status = getStageStatus(stage.id);
            const isSelected = activeTab === stage.id;
            const Icon = stage.icon;

            return (
              <button
                key={stage.id}
                id={`stage-tab-${stage.id}`}
                onClick={() => onSelectTab(stage.id)}
                className={`flex items-center gap-2.5 p-2 rounded-lg text-left transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-slate-800 border-rose-500/50 shadow-sm'
                    : 'bg-slate-950/40 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 text-xs font-semibold ${
                    status === 'generating'
                      ? 'bg-rose-500 text-white animate-pulse'
                      : status === 'completed'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : isSelected
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {status === 'generating' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : status === 'completed' ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-semibold truncate ${
                    isSelected ? 'text-white' : 'text-slate-300'
                  }`}>
                    {stage.label}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {stage.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
