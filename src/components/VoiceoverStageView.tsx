import React, { useState } from 'react';
import { 
  Mic, 
  RefreshCw, 
  ArrowRight, 
  Play, 
  Pause, 
  Volume2, 
  Clock, 
  Edit3, 
  Save, 
  Sparkles,
  Loader2 
} from 'lucide-react';
import { Scene, VideoProject, VoiceName } from '../types.js';

interface VoiceoverStageViewProps {
  project: VideoProject;
  onRegenerateAllAudio: () => void;
  onRegenerateSingleAudio: (sceneIndex: number, newNarration?: string, newVoice?: VoiceName) => Promise<void>;
  onProceedToAssembly: () => void;
  isLoading: boolean;
}

const VOICES: { name: VoiceName; gender: string; style: string }[] = [
  { name: 'Kore', gender: 'Female', style: 'Warm, clear, and professional' },
  { name: 'Puck', gender: 'Male', style: 'Energetic, engaging, and dynamic' },
  { name: 'Fenrir', gender: 'Male', style: 'Deep, resonant, and documentary' },
  { name: 'Charon', gender: 'Male', style: 'Authoritative, calm, and articulate' },
  { name: 'Zephyr', gender: 'Female', style: 'Smooth, friendly, and conversational' },
];

export const VoiceoverStageView: React.FC<VoiceoverStageViewProps> = ({
  project,
  onRegenerateAllAudio,
  onRegenerateSingleAudio,
  onProceedToAssembly,
  isLoading,
}) => {
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);
  const [editingSceneIdx, setEditingSceneIdx] = useState<number | null>(null);
  const [narrationDraft, setNarrationDraft] = useState<string>('');
  const [voiceDraft, setVoiceDraft] = useState<VoiceName>(project.voice || 'Kore');
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);

  const togglePlay = (audioUrl: string) => {
    const audioEl = document.getElementById(`audio-player-${audioUrl}`) as HTMLAudioElement;
    if (!audioEl) return;

    if (playingAudioUrl === audioUrl) {
      audioEl.pause();
      setPlayingAudioUrl(null);
    } else {
      // Pause all other audio
      document.querySelectorAll('audio').forEach((a) => a.pause());
      audioEl.play().catch(console.warn);
      setPlayingAudioUrl(audioUrl);
    }
  };

  const startEditNarration = (idx: number, currentText: string) => {
    setEditingSceneIdx(idx);
    setNarrationDraft(currentText);
    setVoiceDraft(project.voice);
  };

  const handleRegenerate = async (sceneIndex: number) => {
    setRegeneratingIdx(sceneIndex);
    try {
      await onRegenerateSingleAudio(sceneIndex, narrationDraft || undefined, voiceDraft);
      setEditingSceneIdx(null);
    } finally {
      setRegeneratingIdx(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* Stage Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Mic className="w-3.5 h-3.5" />
            Stage 3 &bull; Voiceover Narration
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white">
            Audio Synthesizer & Speech Timing
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Engine: <span className="text-slate-200 font-medium">Google TTS</span> &bull; Active Voice:{' '}
            <span className="text-rose-400 font-medium">{project.voice}</span> &bull; Total Duration:{' '}
            <span className="text-emerald-400 font-medium">{project.totalDurationSeconds || 0}s</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            id="btn-regen-all-audio"
            onClick={onRegenerateAllAudio}
            disabled={isLoading || regeneratingIdx !== null}
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Regenerate All Audio</span>
          </button>

          <button
            id="btn-proceed-assembly"
            onClick={onProceedToAssembly}
            disabled={isLoading || !project.scenes?.some(s => s.audioUrl)}
            className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl flex items-center gap-1.5 shadow-sm shadow-rose-950/40 transition-all disabled:opacity-50 cursor-pointer"
          >
            <span>Proceed to FFmpeg Assembly</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Audio Cards List */}
      <div className="space-y-4">
        {project.scenes?.map((scene, idx) => {
          const isRegenerating = regeneratingIdx === idx || scene.isGeneratingAudio;
          const isEditing = editingSceneIdx === idx;
          const isPlaying = playingAudioUrl === scene.audioUrl;

          return (
            <div
              key={scene.id || idx}
              className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4.5 space-y-3.5 hover:border-slate-700 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-bold">
                    Scene {idx + 1}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Duration: {scene.actualDurationSeconds || scene.estimatedDurationSeconds}s</span>
                  </div>
                </div>

                {!isEditing && (
                  <button
                    onClick={() => startEditNarration(idx, scene.narration)}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Script & Voice</span>
                  </button>
                )}
              </div>

              {/* Editable Narration / Audio Player */}
              {isEditing ? (
                <div className="space-y-3 p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400">
                      Narration Script
                    </label>
                    <textarea
                      rows={3}
                      value={narrationDraft}
                      onChange={(e) => setNarrationDraft(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-white focus:border-rose-500 outline-none resize-none"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="w-full sm:w-auto flex items-center gap-2">
                      <label className="text-xs text-slate-400 shrink-0">Voice:</label>
                      <select
                        value={voiceDraft}
                        onChange={(e) => setVoiceDraft(e.target.value as VoiceName)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white outline-none cursor-pointer"
                      >
                        {VOICES.map((v) => (
                          <option key={v.name} value={v.name}>
                            {v.name} ({v.gender})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2 self-end">
                      <button
                        onClick={() => setEditingSceneIdx(null)}
                        className="px-3 py-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleRegenerate(idx)}
                        disabled={isRegenerating}
                        className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Re-synthesize Audio</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 text-xs text-slate-200 leading-relaxed">
                    "{scene.narration}"
                  </div>

                  {/* Audio Controls Bar */}
                  <div className="flex items-center justify-between gap-4 p-2 bg-slate-950/60 rounded-xl border border-slate-800/60">
                    <div className="flex items-center gap-3">
                      {scene.audioUrl && (
                        <audio
                          id={`audio-player-${scene.audioUrl}`}
                          src={scene.audioUrl}
                          onEnded={() => setPlayingAudioUrl(null)}
                          className="hidden"
                        />
                      )}

                      <button
                        onClick={() => scene.audioUrl && togglePlay(scene.audioUrl)}
                        disabled={!scene.audioUrl || isRegenerating}
                        className="w-8 h-8 rounded-lg bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all disabled:opacity-40 cursor-pointer shadow-sm"
                        title={isPlaying ? 'Pause' : 'Play Narration'}
                      >
                        {isRegenerating ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isPlaying ? (
                          <Pause className="w-4 h-4 fill-white" />
                        ) : (
                          <Play className="w-4 h-4 fill-white ml-0.5" />
                        )}
                      </button>

                      <div className="flex items-center gap-1 text-slate-400">
                        <Volume2 className="w-4 h-4 text-rose-400" />
                        <span className="text-xs font-medium text-slate-300">
                          {isPlaying ? 'Playing Narration' : 'Scene Narration Track'}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRegenerate(idx)}
                      disabled={isRegenerating}
                      className="px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRegenerating ? 'animate-spin' : ''}`} />
                      <span>Re-synthesize</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
