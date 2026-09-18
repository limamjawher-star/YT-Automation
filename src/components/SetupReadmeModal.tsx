import React from 'react';
import { 
  BookOpen, 
  Terminal, 
  Key, 
  Layers, 
  Check, 
  X, 
  Sparkles,
  ExternalLink 
} from 'lucide-react';

interface SetupReadmeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SetupReadmeModal: React.FC<SetupReadmeModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-rose-500" />
            <h3 className="text-base font-bold text-white">
              Setup & Local Run Instructions
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-300 leading-relaxed">
          {/* Section 1: Overview */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" />
              1. 100% Google AI Powered Pipeline
            </h4>
            <p className="text-xs text-slate-400">
              This pipeline runs on your local machine and uses only Google AI tools and open-source FFmpeg:
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <li className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="font-bold text-white block">Script & Storyboard:</span>
                <span className="text-slate-400">Gemini 3.8 Flash (pacing & scene breakdown)</span>
              </li>
              <li className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="font-bold text-white block">Visual Generation:</span>
                <span className="text-slate-400">Google Imagen / Gemini AI Images (16:9 or 9:16)</span>
              </li>
              <li className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="font-bold text-white block">Voiceover Narration:</span>
                <span className="text-slate-400">Google TTS with natural voice models</span>
              </li>
              <li className="p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="font-bold text-white block">Video Assembly:</span>
                <span className="text-slate-400">Local FFmpeg (motion transitions, audio sync, subtitles)</span>
              </li>
            </ul>
          </div>

          {/* Section 2: Launch Command */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Terminal className="w-4 h-4" />
              2. Single Command to Start Locally
            </h4>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-emerald-300 flex items-center justify-between">
              <span>npm run dev</span>
              <span className="text-[11px] text-slate-500 font-sans">Port 3000 (localhost:3000)</span>
            </div>
            <p className="text-xs text-slate-400">
              Launches the Express API server and Vite dashboard in a unified full-stack process.
            </p>
          </div>

          {/* Section 3: API Key Configuration */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Key className="w-4 h-4" />
              3. Where to Input Your Google API Key
            </h4>
            <p className="text-xs text-slate-400">
              Create or edit the <code className="text-rose-300 bg-slate-800 px-1 py-0.5 rounded font-mono">.env</code> file in the project root directory:
            </p>
            <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
{`# .env
GEMINI_API_KEY="AIzaSyYourActualGoogleKeyHere"
`}
            </pre>
            <p className="text-xs text-slate-400">
              A single Google Cloud / Google AI Studio API key powers all Gemini and Imagen operations. In AI Studio, this is automatically injected at runtime.
            </p>
          </div>

          {/* Section 4: Local Storage */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
              <Layers className="w-4 h-4" />
              4. Local Output Structure
            </h4>
            <p className="text-xs text-slate-400">
              Finished projects and media assets are saved locally in the project directory:
            </p>
            <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
{`storage/
  projects/
    proj_12345/
      project.json      # Full project metadata & YouTube description
      scenes/           # scene_0.png, scene_1.png...
      audio/            # scene_0.wav, scene_1.wav...
      subtitles.srt     # Synchronized caption track
      thumbnail.png     # Resized YouTube thumbnail
      video.mp4         # Final rendered video file ready for upload!
`}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl cursor-pointer"
          >
            Close & Start Creating
          </button>
        </div>
      </div>
    </div>
  );
};
