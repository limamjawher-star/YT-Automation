import React, { useState } from 'react';
import { 
  FileText, 
  Sparkles, 
  RefreshCw, 
  ArrowRight, 
  Copy, 
  Check, 
  Tag, 
  Layers, 
  Clock, 
  Edit3, 
  Save,
  Play
} from 'lucide-react';
import { Scene, VideoProject } from '../types.js';

interface ScriptStageViewProps {
  project: VideoProject;
  onRegenerateScript: () => void;
  onProceedToVisuals: () => void;
  onRunFullPipeline: () => void;
  onUpdateProject: (updates: Partial<VideoProject>) => void;
  isLoading: boolean;
}

export const ScriptStageView: React.FC<ScriptStageViewProps> = ({
  project,
  onRegenerateScript,
  onProceedToVisuals,
  onRunFullPipeline,
  onUpdateProject,
  isLoading,
}) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [editedNarration, setEditedNarration] = useState<string>('');
  const [editedPrompt, setEditedPrompt] = useState<string>('');

  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const startEditScene = (scene: Scene) => {
    setEditingSceneId(scene.id);
    setEditedNarration(scene.narration);
    setEditedPrompt(scene.imagePrompt);
  };

  const saveSceneEdit = (sceneIndex: number) => {
    const updatedScenes = [...project.scenes];
    updatedScenes[sceneIndex] = {
      ...updatedScenes[sceneIndex],
      narration: editedNarration,
      imagePrompt: editedPrompt,
    };
    onUpdateProject({ scenes: updatedScenes });
    setEditingSceneId(null);
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <FileText className="w-3.5 h-3.5" />
            Stage 2 &bull; Script & Storyboard
            {project.researchStatus && (
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 lowercase">
                grounded in {project.researchStatus} research
              </span>
            )}
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white line-clamp-1">
            {project.title || project.topic}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {project.scenes?.length || 0} Scenes Planned &bull; ~{project.targetDurationMinutes * 60}s Target
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            id="btn-regen-script"
            onClick={onRegenerateScript}
            disabled={isLoading}
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Regenerate Script</span>
          </button>

          <button
            id="btn-proceed-visuals"
            onClick={onProceedToVisuals}
            disabled={isLoading || !project.scenes?.length}
            className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl flex items-center gap-1.5 shadow-sm shadow-rose-950/40 transition-all disabled:opacity-50 cursor-pointer"
          >
            <span>Proceed to Visuals</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <button
            id="btn-run-all-from-script"
            onClick={onRunFullPipeline}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 rounded-xl flex items-center gap-1.5 shadow-md transition-all disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-3 h-3 fill-white" />
            <span>⚡ Render Entire Video</span>
          </button>
        </div>
      </div>

      {/* YouTube Metadata Summary Card */}
      {project.youtubeMetadata && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              YouTube Video Package & SEO
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {project.youtubeMetadata.category}
            </span>
          </div>

          <div className="space-y-3">
            {/* Title */}
            <div className="flex items-start justify-between gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800/80">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">Optimized Title</span>
                <div className="text-sm font-bold text-white">{project.youtubeMetadata.title}</div>
              </div>
              <button
                onClick={() => copyToClipboard(project.youtubeMetadata?.title || '', 'title')}
                className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg shrink-0 cursor-pointer"
                title="Copy Title"
              >
                {copiedSection === 'title' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Tags */}
            {project.youtubeMetadata.tags && (
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                  <Tag className="w-3 h-3" />
                  SEO Tags ({project.youtubeMetadata.tags.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {project.youtubeMetadata.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-0.5 rounded-md bg-slate-800/80 text-[11px] text-slate-300 border border-slate-700/60"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Scene by Scene Breakdown */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-rose-400" />
            Scene-by-Scene Storyboard ({project.scenes?.length || 0})
          </h3>
          <span className="text-xs text-slate-400">
            Click edit to fine-tune voiceover text or image prompts
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {project.scenes?.map((scene, idx) => {
            const isEditing = editingSceneId === scene.id;

            return (
              <div
                key={scene.id || idx}
                className="bg-slate-900/70 border border-slate-800 rounded-xl p-4.5 space-y-3 relative hover:border-slate-700 transition-colors"
              >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-bold">
                      Scene {idx + 1}
                    </span>
                    {scene.onScreenText && (
                      <span className="text-xs font-medium text-slate-300 px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
                        Overlay: "{scene.onScreenText}"
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="w-3 h-3" />
                      <span>~{scene.estimatedDurationSeconds}s</span>
                    </div>

                    {isEditing ? (
                      <button
                        onClick={() => saveSceneEdit(idx)}
                        className="p-1 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                      >
                        <Save className="w-3 h-3" />
                        <span>Save</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => startEditScene(scene)}
                        className="p-1 px-2 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Spoken Narration */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-400 flex items-center gap-1">
                      Narration Voiceover (TTS)
                    </label>
                    {isEditing ? (
                      <textarea
                        rows={3}
                        value={editedNarration}
                        onChange={(e) => setEditedNarration(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-rose-500 outline-none"
                      />
                    ) : (
                      <div className="p-3 bg-slate-950/80 rounded-lg text-slate-200 leading-relaxed border border-slate-800/60">
                        "{scene.narration}"
                      </div>
                    )}
                  </div>

                  {/* Visual Prompt */}
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-400 flex items-center gap-1">
                      Visual Generation Prompt (Imagen)
                    </label>
                    {isEditing ? (
                      <textarea
                        rows={3}
                        value={editedPrompt}
                        onChange={(e) => setEditedPrompt(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-rose-500 outline-none"
                      />
                    ) : (
                      <div className="p-3 bg-slate-950/80 rounded-lg text-slate-400 leading-relaxed border border-slate-800/60 italic">
                        {scene.imagePrompt || scene.visualDescription}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
