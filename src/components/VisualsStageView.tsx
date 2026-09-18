import React, { useState } from 'react';
import { 
  Image as ImageIcon, 
  RefreshCw, 
  ArrowRight, 
  Maximize2, 
  Edit3, 
  Save, 
  Sparkles, 
  Check, 
  Loader2, 
  X 
} from 'lucide-react';
import { Scene, VideoProject } from '../types.js';

interface VisualsStageViewProps {
  project: VideoProject;
  onRegenerateAllImages: () => void;
  onRegenerateSingleImage: (sceneIndex: number, newPrompt?: string) => Promise<void>;
  onProceedToVoiceover: () => void;
  isLoading: boolean;
}

export const VisualsStageView: React.FC<VisualsStageViewProps> = ({
  project,
  onRegenerateAllImages,
  onRegenerateSingleImage,
  onProceedToVoiceover,
  isLoading,
}) => {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [editingSceneIdx, setEditingSceneIdx] = useState<number | null>(null);
  const [promptDraft, setPromptDraft] = useState<string>('');
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);

  const isPortrait = project.aspectRatio === '9:16';

  const handleRegenerate = async (sceneIndex: number) => {
    setRegeneratingIdx(sceneIndex);
    try {
      await onRegenerateSingleImage(sceneIndex, promptDraft || undefined);
      setEditingSceneIdx(null);
    } finally {
      setRegeneratingIdx(null);
    }
  };

  const startEditPrompt = (idx: number, currentPrompt: string) => {
    setEditingSceneIdx(idx);
    setPromptDraft(currentPrompt);
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* Stage Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <ImageIcon className="w-3.5 h-3.5" />
            Stage 2 &bull; Visual Synthesis
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white">
            Scene Visual Assets
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Art Style: <span className="text-slate-200 font-medium">{project.visualStyle}</span> &bull; Format: {project.aspectRatio}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            id="btn-regen-all-images"
            onClick={onRegenerateAllImages}
            disabled={isLoading || regeneratingIdx !== null}
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Regenerate All Visuals</span>
          </button>

          <button
            id="btn-proceed-voiceover"
            onClick={onProceedToVoiceover}
            disabled={isLoading || !project.scenes?.some(s => s.imageUrl)}
            className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl flex items-center gap-1.5 shadow-sm shadow-rose-950/40 transition-all disabled:opacity-50 cursor-pointer"
          >
            <span>Proceed to Voiceover</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Visual Cards Grid */}
      <div className={`grid gap-5 ${isPortrait ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
        {project.scenes?.map((scene, idx) => {
          const isRegenerating = regeneratingIdx === idx || scene.isGeneratingImage;
          const isEditing = editingSceneIdx === idx;

          return (
            <div
              key={scene.id || idx}
              className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-lg flex flex-col group hover:border-slate-700 transition-all"
            >
              {/* Image Frame Container */}
              <div 
                className={`relative w-full bg-slate-950 overflow-hidden flex items-center justify-center ${
                  isPortrait ? 'aspect-[9/16]' : 'aspect-video'
                }`}
              >
                {scene.imageUrl ? (
                  <>
                    <img
                      src={scene.imageUrl}
                      alt={`Scene ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-102"
                    />
                    {/* Hover Overlay Controls */}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/30 opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-between">
                      <div className="flex justify-end">
                        <button
                          onClick={() => setLightboxImage(scene.imageUrl!)}
                          className="p-1.5 bg-slate-900/80 hover:bg-slate-800 text-white rounded-lg text-xs backdrop-blur-sm cursor-pointer"
                          title="Expand Fullscreen"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="text-[11px] text-white font-medium line-clamp-2 bg-slate-950/60 p-2 rounded-lg backdrop-blur-sm">
                        "{scene.onScreenText || scene.narration}"
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center p-6 text-center space-y-2 text-slate-500">
                    <Loader2 className="w-8 h-8 animate-spin text-rose-500" />
                    <span className="text-xs">Synthesizing Scene Visual...</span>
                  </div>
                )}

                {/* Loading state overlay */}
                {isRegenerating && (
                  <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-10">
                    <Loader2 className="w-7 h-7 animate-spin text-rose-500" />
                    <span className="text-xs font-semibold text-white">Generating AI Visual...</span>
                  </div>
                )}

                {/* Top Badge */}
                <div className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-slate-950/80 backdrop-blur-sm border border-slate-700/80 text-[11px] font-bold text-white shadow">
                  Scene {idx + 1}
                </div>
              </div>

              {/* Scene Info & Prompt Controls */}
              <div className="p-4 space-y-3 flex-1 flex flex-col justify-between bg-slate-900/40">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase font-bold text-slate-400 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-400" />
                      Visual Prompt
                    </span>
                    {!isEditing && (
                      <button
                        onClick={() => startEditPrompt(idx, scene.imagePrompt || scene.visualDescription)}
                        className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit Prompt</span>
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        value={promptDraft}
                        onChange={(e) => setPromptDraft(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-rose-500 outline-none resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditingSceneIdx(null)}
                          className="px-2.5 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleRegenerate(idx)}
                          disabled={isRegenerating}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Save className="w-3 h-3" />
                          <span>Save & Regenerate</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed">
                      {scene.imagePrompt || scene.visualDescription}
                    </p>
                  )}
                </div>

                {/* Bottom Card Actions */}
                {!isEditing && (
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">
                      Duration: ~{scene.actualDurationSeconds || scene.estimatedDurationSeconds}s
                    </span>

                    <button
                      onClick={() => handleRegenerate(idx)}
                      disabled={isRegenerating}
                      className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                      <span>Regenerate Image</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fullscreen Lightbox Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] w-full flex flex-col items-center">
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute -top-10 right-0 text-slate-400 hover:text-white p-2 cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={lightboxImage}
              alt="Scene preview"
              referrerPolicy="no-referrer"
              className="max-h-[85vh] max-w-full object-contain rounded-xl shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
