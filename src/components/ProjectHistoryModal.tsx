import React from 'react';
import { 
  FolderClock, 
  Trash2, 
  Play, 
  Download, 
  X, 
  Clock, 
  Layers, 
  Tv, 
  Smartphone,
  Sparkles
} from 'lucide-react';
import { VideoProject } from '../types.js';

interface ProjectHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: VideoProject[];
  currentProjectId?: string;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

export const ProjectHistoryModal: React.FC<ProjectHistoryModalProps> = ({
  isOpen,
  onClose,
  projects,
  currentProjectId,
  onSelectProject,
  onDeleteProject,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FolderClock className="w-5 h-5 text-rose-500" />
            <h3 className="text-base font-bold text-white">
              Project Library & History ({projects.length})
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Project List */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {projects.length === 0 ? (
            <div className="py-12 text-center text-slate-500 space-y-2">
              <FolderClock className="w-10 h-10 mx-auto stroke-1" />
              <p className="text-sm">No saved projects found in local storage.</p>
              <p className="text-xs text-slate-600">Create a video to start your library.</p>
            </div>
          ) : (
            projects.map((proj) => {
              const isSelected = proj.id === currentProjectId;

              return (
                <div
                  key={proj.id}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-rose-950/20 border-rose-500/50'
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Thumbnail preview */}
                    <div className="w-16 h-12 bg-slate-900 rounded-lg overflow-hidden shrink-0 border border-slate-800 flex items-center justify-center">
                      {proj.thumbnailUrl ? (
                        <img
                          src={proj.thumbnailUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Sparkles className="w-4 h-4 text-slate-600" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-white truncate">
                          {proj.title || proj.topic}
                        </h4>
                        {isSelected && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Active
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-1">
                        <span className="flex items-center gap-1">
                          {proj.aspectRatio === '16:9' ? (
                            <Tv className="w-3 h-3 text-slate-500" />
                          ) : (
                            <Smartphone className="w-3 h-3 text-slate-500" />
                          )}
                          {proj.aspectRatio}
                        </span>
                        <span>&bull;</span>
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3 text-slate-500" />
                          {proj.scenes?.length || 0} scenes
                        </span>
                        {proj.totalDurationSeconds && (
                          <>
                            <span>&bull;</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {proj.totalDurationSeconds}s
                            </span>
                          </>
                        )}
                        <span>&bull;</span>
                        <span className="text-slate-500">
                          {new Date(proj.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {proj.finalVideoUrl && (
                      <a
                        href={proj.finalVideoUrl}
                        download
                        className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg text-xs"
                        title="Download Video"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}

                    <button
                      onClick={() => {
                        onSelectProject(proj.id);
                        onClose();
                      }}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-white" />
                      <span>Open</span>
                    </button>

                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this project?')) {
                          onDeleteProject(proj.id);
                        }
                      }}
                      className="p-2 text-slate-500 hover:text-rose-400 bg-slate-800/60 hover:bg-slate-800 rounded-lg text-xs cursor-pointer"
                      title="Delete Project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
