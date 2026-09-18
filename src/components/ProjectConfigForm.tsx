import React, { useState } from 'react';
import { 
  Sparkles, 
  Tv, 
  Smartphone, 
  Clock, 
  Palette, 
  Mic2, 
  Play, 
  ArrowRight,
  Flame,
  Volume2
} from 'lucide-react';
import { 
  VideoAspectRatio, 
  VideoTone, 
  VisualStyle, 
  VoiceName, 
  VideoProject 
} from '../types.js';

interface ProjectConfigFormProps {
  project?: VideoProject | null;
  onSaveAndRunAll: (data: {
    topic: string;
    aspectRatio: VideoAspectRatio;
    tone: VideoTone;
    visualStyle: VisualStyle;
    voice: VoiceName;
    targetDurationMinutes: number;
    userProvidedSources?: string;
    userResearchNotes?: string;
  }) => void;
  onSaveAndNextStage: (data: {
    topic: string;
    aspectRatio: VideoAspectRatio;
    tone: VideoTone;
    visualStyle: VisualStyle;
    voice: VoiceName;
    targetDurationMinutes: number;
    userProvidedSources?: string;
    userResearchNotes?: string;
  }) => void;
  isLoading: boolean;
}

const PRESET_TOPICS = [
  {
    title: 'Deep Sea Bioluminescence',
    topic: 'How deep sea creatures create light in pitch darkness: chemistry and survival tactics',
    tone: 'Mysterious & Documentary' as VideoTone,
    style: 'Cinematic Photorealism' as VisualStyle,
    ratio: '16:9' as VideoAspectRatio,
  },
  {
    title: 'Quantum Computing Explained',
    topic: 'Why quantum computers will revolutionize encryption and supercomputing in 60 seconds',
    tone: 'Informative & Educational' as VideoTone,
    style: 'Digital Concept Art' as VisualStyle,
    ratio: '16:9' as VideoAspectRatio,
  },
  {
    title: 'Why Coffee Makes You Alert',
    topic: 'The neuroscience of adenosine and caffeine: what happens in your brain after one cup',
    tone: 'Engaging & Fast-Paced' as VideoTone,
    style: '3D Pixar Style' as VisualStyle,
    ratio: '9:16' as VideoAspectRatio,
  },
  {
    title: 'The Library of Alexandria',
    topic: 'The real tragedy and lost discoveries of the ancient world’s greatest center of knowledge',
    tone: 'Dramatic & Storytelling' as VideoTone,
    style: 'Dark Atmospheric Noir' as VisualStyle,
    ratio: '16:9' as VideoAspectRatio,
  },
];

const VOICES: { name: VoiceName; gender: string; style: string }[] = [
  { name: 'Kore', gender: 'Female', style: 'Warm, clear, and professional' },
  { name: 'Puck', gender: 'Male', style: 'Energetic, engaging, and dynamic' },
  { name: 'Fenrir', gender: 'Male', style: 'Deep, resonant, and documentary' },
  { name: 'Charon', gender: 'Male', style: 'Authoritative, calm, and articulate' },
  { name: 'Zephyr', gender: 'Female', style: 'Smooth, friendly, and conversational' },
];

export const ProjectConfigForm: React.FC<ProjectConfigFormProps> = ({
  project,
  onSaveAndRunAll,
  onSaveAndNextStage,
  isLoading,
}) => {
  const [topic, setTopic] = useState(project?.topic || '');
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(project?.aspectRatio || '16:9');
  const [tone, setTone] = useState<VideoTone>(project?.tone || 'Engaging & Fast-Paced');
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(project?.visualStyle || 'Cinematic Photorealism');
  const [voice, setVoice] = useState<VoiceName>(project?.voice || 'Kore');
  const [duration, setDuration] = useState<number>(project?.targetDurationMinutes || 1);
  const [userProvidedSources, setUserProvidedSources] = useState<string>(project?.userProvidedSources || '');
  const [userResearchNotes, setUserResearchNotes] = useState<string>(project?.userResearchNotes || '');
  const [showAdvancedResearch, setShowAdvancedResearch] = useState<boolean>(false);

  const handleSubmit = (runAll: boolean) => {
    if (!topic.trim()) return;
    const payload = {
      topic: topic.trim(),
      aspectRatio,
      tone,
      visualStyle,
      voice,
      targetDurationMinutes: duration,
      userProvidedSources: userProvidedSources.trim() || undefined,
      userResearchNotes: userResearchNotes.trim() || undefined,
    };
    if (runAll) {
      onSaveAndRunAll(payload);
    } else {
      onSaveAndNextStage(payload);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-80 h-80 bg-rose-500/10 blur-3xl pointer-events-none rounded-full" />
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold">
            <Flame className="w-3.5 h-3.5 text-rose-400" />
            End-to-End Local AI Production
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Automate Your Next YouTube Video
          </h2>
          <p className="text-sm text-slate-400 max-w-2xl">
            Input any topic. Gemini will draft the script & storyboard, Google Imagen synthesizes scene visuals, Google TTS renders natural voiceover, and local FFmpeg stitches the timeline into an upload-ready MP4.
          </p>
        </div>
      </div>

      {/* Preset Quick Starters */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          Quick Topic Inspiration
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {PRESET_TOPICS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              onClick={() => {
                setTopic(preset.topic);
                setTone(preset.tone);
                setVisualStyle(preset.style);
                setAspectRatio(preset.ratio);
              }}
              className="text-left p-3 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-rose-500/40 hover:bg-slate-800/60 transition-all group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 group-hover:text-rose-400 transition-colors">
                  {preset.title}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  {preset.ratio === '16:9' ? 'YouTube 16:9' : 'Shorts 9:16'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-1 mt-1">
                {preset.topic}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Main Settings Form */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6">
        {/* Topic Input */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-white flex items-center justify-between">
            <span>Video Topic or Idea Prompt</span>
            <span className="text-xs font-normal text-slate-400">Be as descriptive as you like</span>
          </label>
          <textarea
            id="input-video-topic"
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. The Science of Sleep: Why REM sleep repairs your body and memory..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-rose-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition-all resize-none shadow-inner"
          />
        </div>

        {/* Video Format & Duration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Format / Aspect Ratio */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Video Format & Aspect Ratio
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAspectRatio('16:9')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  aspectRatio === '16:9'
                    ? 'bg-rose-500/10 border-rose-500/50 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <Tv className={`w-5 h-5 ${aspectRatio === '16:9' ? 'text-rose-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-xs font-bold">16:9 Widescreen</div>
                  <div className="text-[10px] text-slate-500">Standard YouTube Video</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAspectRatio('9:16')}
                className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  aspectRatio === '9:16'
                    ? 'bg-rose-500/10 border-rose-500/50 text-white shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <Smartphone className={`w-5 h-5 ${aspectRatio === '9:16' ? 'text-rose-400' : 'text-slate-500'}`} />
                <div>
                  <div className="text-xs font-bold">9:16 Vertical</div>
                  <div className="text-[10px] text-slate-500">YouTube Shorts / Reels</div>
                </div>
              </button>
            </div>
          </div>

          {/* Target Duration */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Target Duration & Pacing</span>
              <span className="text-[11px] text-rose-400 font-medium">
                {duration <= 0.5 ? '30s (~3 scenes)' : duration === 1 ? '1 min (~4 scenes)' : `${duration} mins (~${duration * 3} scenes)`}
              </span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '30s', value: 0.5, desc: 'Short' },
                { label: '1m', value: 1, desc: 'Standard' },
                { label: '2m', value: 2, desc: 'Deep' },
                { label: '3m', value: 3, desc: 'Full' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setDuration(item.value)}
                  className={`py-2 px-2 rounded-xl border text-center transition-all cursor-pointer ${
                    duration === item.value
                      ? 'bg-rose-500/10 border-rose-500/50 text-rose-300 font-bold'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs">{item.label}</div>
                  <div className="text-[9px] text-slate-500">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Style, Tone, Voice */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Tone */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Script Tone
            </label>
            <select
              id="select-video-tone"
              value={tone}
              onChange={(e) => setTone(e.target.value as VideoTone)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-rose-500 cursor-pointer"
            >
              <option value="Engaging & Fast-Paced">Engaging & Fast-Paced</option>
              <option value="Informative & Educational">Informative & Educational</option>
              <option value="Dramatic & Storytelling">Dramatic & Storytelling</option>
              <option value="Humorous & Entertaining">Humorous & Entertaining</option>
              <option value="Mysterious & Documentary">Mysterious & Documentary</option>
              <option value="Motivational & Inspiring">Motivational & Inspiring</option>
            </select>
          </div>

          {/* Visual Style */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Palette className="w-3 h-3 text-slate-400" />
              Visual Art Style
            </label>
            <select
              id="select-visual-style"
              value={visualStyle}
              onChange={(e) => setVisualStyle(e.target.value as VisualStyle)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-rose-500 cursor-pointer"
            >
              <option value="Cinematic Photorealism">Cinematic Photorealism</option>
              <option value="Digital Concept Art">Digital Concept Art</option>
              <option value="Anime & Manga">Anime & Manga</option>
              <option value="3D Pixar Style">3D Pixar Animation</option>
              <option value="Dark Atmospheric Noir">Dark Atmospheric Noir</option>
              <option value="Minimalist Motion Vector">Minimalist Motion Vector</option>
            </select>
          </div>

          {/* Voice */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Mic2 className="w-3 h-3 text-slate-400" />
              Google TTS Voice
            </label>
            <select
              id="select-voice"
              value={voice}
              onChange={(e) => setVoice(e.target.value as VoiceName)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-rose-500 cursor-pointer"
            >
              {VOICES.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.gender} &bull; {v.style})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Optional Provider-Agnostic Research Grounding & Notes */}
        <div className="border-t border-slate-800/80 pt-3">
          <button
            type="button"
            onClick={() => setShowAdvancedResearch(!showAdvancedResearch)}
            className="text-xs text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1.5 cursor-pointer py-1"
          >
            <span>{showAdvancedResearch ? '▼' : '▶'} Optional: Provide Custom Research Sources & Creator Notes</span>
          </button>

          {showAdvancedResearch && (
            <div className="mt-3 space-y-3 p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Custom Sources / Reference URLs (Provider-Agnostic)
                </label>
                <textarea
                  value={userProvidedSources}
                  onChange={(e) => setUserProvidedSources(e.target.value)}
                  placeholder="https://en.wikipedia.org/wiki/... or paste reference material text"
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Initial Editorial Notes / Angles
                </label>
                <textarea
                  value={userResearchNotes}
                  onChange={(e) => setUserResearchNotes(e.target.value)}
                  placeholder="Specify key angles to focus on, facts to emphasize, or claims to avoid..."
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-rose-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-end gap-3 border-t border-slate-800/80">
          <button
            id="btn-step-by-step"
            type="button"
            disabled={!topic.trim() || isLoading}
            onClick={() => handleSubmit(false)}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            <span>Step 1: Dedicated Research & Fact Dossier</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <button
            id="btn-run-full-pipeline"
            type="button"
            disabled={!topic.trim() || isLoading}
            onClick={() => handleSubmit(true)}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 via-rose-500 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-rose-950/50 transition-all disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>⚡ Run Full Automated Pipeline</span>
          </button>
        </div>
      </div>
    </div>
  );
};
