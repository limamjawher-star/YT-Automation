import React from 'react';
import { 
  Sparkles, 
  Video, 
  FolderClock, 
  BookOpen, 
  CheckCircle2, 
  AlertCircle,
  Plus
} from 'lucide-react';
import { SystemStatus } from '../types.js';

interface HeaderProps {
  systemStatus: SystemStatus | null;
  onOpenNewProject: () => void;
  onOpenHistory: () => void;
  onOpenDocs: () => void;
  hasActiveProject: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  systemStatus,
  onOpenNewProject,
  onOpenHistory,
  onOpenDocs,
  hasActiveProject,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 sm:px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* Logo & Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-red-600 via-rose-500 to-amber-500 p-0.5 flex items-center justify-center shadow-lg shadow-rose-950/40">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Video className="w-5 h-5 text-rose-500" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Local AI Video Pipeline
              </h1>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                <Sparkles className="w-3 h-3" />
                Google AI Powered
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Gemini &bull; Imagen &bull; Google TTS &bull; Local FFmpeg
            </p>
          </div>
        </div>

        {/* Status Indicators & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Status Badges */}
          <div className="hidden lg:flex items-center gap-2 text-xs">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
              systemStatus?.hasGeminiKey 
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            }`}>
              {systemStatus?.hasGeminiKey ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              )}
              <span>Gemini API</span>
            </div>

            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
              systemStatus?.hasFfmpeg 
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}>
              {systemStatus?.hasFfmpeg ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
              )}
              <span>FFmpeg 4.4</span>
            </div>
          </div>

          {/* Quickstart / Docs Button */}
          <button
            id="btn-open-docs"
            onClick={onOpenDocs}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition-colors cursor-pointer"
            title="View README & Run Instructions"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Setup & Docs</span>
          </button>

          {/* Project History Button */}
          <button
            id="btn-open-history"
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700/80 border border-slate-700 rounded-lg transition-colors cursor-pointer"
            title="View Past Projects"
          >
            <FolderClock className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Library</span>
            {systemStatus && systemStatus.activeProjectsCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-700 text-[10px] text-slate-200">
                {systemStatus.activeProjectsCount}
              </span>
            )}
          </button>

          {/* New Project Button */}
          <button
            id="btn-new-project"
            onClick={onOpenNewProject}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 rounded-lg shadow-sm shadow-rose-900/40 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Video</span>
          </button>
        </div>
      </div>
    </header>
  );
};
