import React, { useState, useEffect, useRef } from 'react';
import { 
  Film, 
  Download, 
  Copy, 
  Check, 
  RefreshCw, 
  Sparkles, 
  Terminal, 
  Play, 
  Share2, 
  Youtube,
  Image as ImageIcon,
  Clock,
  Layers
} from 'lucide-react';
import { VideoProject } from '../types.js';

interface AssemblyStageViewProps {
  project: VideoProject;
  onReAssembleVideo: () => void;
  isLoading: boolean;
}

export const AssemblyStageView: React.FC<AssemblyStageViewProps> = ({
  project,
  onReAssembleVideo,
  isLoading,
}) => {
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const isPortrait = project.aspectRatio === '9:16';

  // Auto-scroll render logs to bottom
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [project.renderLogs]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  // Format full YouTube description with Chapters
  const getFullYouTubeDescription = () => {
    if (!project.youtubeMetadata) return project.script || '';
    let desc = project.youtubeMetadata.description + '\n\n';
    if (project.youtubeMetadata.chapters?.length) {
      desc += '⏱️ CHAPTERS:\n';
      project.youtubeMetadata.chapters.forEach((c) => {
        desc += `${c.time} - ${c.title}\n`;
      });
      desc += '\n';
    }
    if (project.youtubeMetadata.tags?.length) {
      desc += project.youtubeMetadata.tags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
    }
    return desc;
  };

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Film className="w-3.5 h-3.5" />
            Stage 4 &bull; Final Assembly & Render
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white">
            {project.title || 'Rendered Video Package'}
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Format: {project.aspectRatio} &bull; Scenes: {project.scenes?.length} &bull; Duration:{' '}
            <span className="text-emerald-400 font-semibold">{project.totalDurationSeconds || 0}s</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            id="btn-re-assemble"
            onClick={onReAssembleVideo}
            disabled={isLoading}
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Re-Render with FFmpeg</span>
          </button>

          {project.finalVideoUrl && (
            <a
              id="btn-download-video"
              href={project.finalVideoUrl}
              download={`${project.id}_video.mp4`}
              className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl flex items-center gap-1.5 shadow-sm shadow-rose-950/40 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download MP4</span>
            </a>
          )}
        </div>
      </div>

      {/* Main Grid: Video Player + YouTube Metadata */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Video Player Column */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            {/* Player viewport */}
            <div 
              className={`w-full bg-black flex items-center justify-center relative ${
                isPortrait ? 'aspect-[9/16] max-w-sm mx-auto' : 'aspect-video'
              }`}
            >
              {project.finalVideoUrl ? (
                <video
                  id="final-rendered-video"
                  controls
                  playsInline
                  autoPlay={false}
                  poster={project.thumbnailUrl}
                  src={project.finalVideoUrl}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <Film className="w-12 h-12 text-slate-700 animate-pulse" />
                  <div className="text-sm font-semibold text-slate-400">
                    {isLoading ? 'FFmpeg Rendering in progress...' : 'Video not rendered yet.'}
                  </div>
                  <button
                    onClick={onReAssembleVideo}
                    disabled={isLoading}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    Start Assembly Render
                  </button>
                </div>
              )}
            </div>

            {/* Video Quick Info Bar */}
            <div className="p-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-rose-400" />
                  {project.totalDurationSeconds || 0}s Total
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-sky-400" />
                  {project.scenes?.length} Scenes Synced
                </span>
              </div>

              {project.thumbnailUrl && (
                <a
                  href={project.thumbnailUrl}
                  download="thumbnail.png"
                  className="text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Download Thumbnail</span>
                </a>
              )}
            </div>
          </div>

          {/* Real-time FFmpeg Console / Render Logs */}
          <div className="bg-slate-950 border border-slate-800/90 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
              <span className="flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                FFmpeg & Pipeline Execution Log
              </span>
              {project.renderProgress !== undefined && (
                <span className="text-emerald-400 font-mono">
                  {project.renderProgress}%
                </span>
              )}
            </div>

            {/* Progress Bar */}
            {isLoading && (
              <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-rose-500 to-amber-500 h-full transition-all duration-300"
                  style={{ width: `${project.renderProgress || 10}%` }}
                />
              </div>
            )}

            <div
              ref={logContainerRef}
              className="h-32 overflow-y-auto font-mono text-[11px] text-slate-400 bg-slate-900/50 p-2.5 rounded-lg border border-slate-800 space-y-1"
            >
              {project.renderLogs && project.renderLogs.length > 0 ? (
                project.renderLogs.map((log, idx) => (
                  <div key={idx} className="leading-tight">
                    <span className="text-slate-600 mr-1.5">&gt;</span>
                    <span className={log.includes('Error') ? 'text-rose-400 font-semibold' : 'text-slate-300'}>
                      {log}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-slate-600">No logs yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* YouTube Ready-to-Upload Package Column */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Youtube className="w-4 h-4 text-red-500" />
                YouTube Studio Upload Package
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                Ready to Copy
              </span>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold">Video Title</span>
                <button
                  onClick={() => copyText(project.youtubeMetadata?.title || project.title, 'title')}
                  className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                >
                  {copiedItem === 'title' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>Copy Title</span>
                </button>
              </div>
              <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-white font-medium">
                {project.youtubeMetadata?.title || project.title}
              </div>
            </div>

            {/* Description with Chapters */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold">Description with Chapters</span>
                <button
                  onClick={() => copyText(getFullYouTubeDescription(), 'desc')}
                  className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                >
                  {copiedItem === 'desc' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>Copy Description</span>
                </button>
              </div>
              <textarea
                readOnly
                rows={6}
                value={getFullYouTubeDescription()}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300 font-mono resize-none focus:outline-none"
              />
            </div>

            {/* Tags */}
            {project.youtubeMetadata?.tags && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold">YouTube Tags</span>
                  <button
                    onClick={() => copyText(project.youtubeMetadata?.tags.join(', ') || '', 'tags')}
                    className="text-[11px] text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedItem === 'tags' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>Copy All Tags</span>
                  </button>
                </div>
                <div className="p-2 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-400 leading-relaxed max-h-20 overflow-y-auto">
                  {project.youtubeMetadata.tags.join(', ')}
                </div>
              </div>
            )}

            {/* Export Summary Box */}
            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
              <div className="text-slate-300 font-semibold">Local Storage Output:</div>
              <div className="font-mono text-[10px] text-slate-500 truncate">
                ./storage/projects/{project.id}/video.mp4
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
