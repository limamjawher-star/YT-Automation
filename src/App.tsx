/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.js';
import { StageProgressBar } from './components/StageProgressBar.js';
import { PipelineLiveControls } from './components/PipelineLiveControls.js';
import { ProjectConfigForm } from './components/ProjectConfigForm.js';
import { ResearchStageView } from './components/ResearchStageView.js';
import { ScriptStageView } from './components/ScriptStageView.js';
import { VisualsStageView } from './components/VisualsStageView.js';
import { VoiceoverStageView } from './components/VoiceoverStageView.js';
import { AssemblyStageView } from './components/AssemblyStageView.js';
import { ProjectHistoryModal } from './components/ProjectHistoryModal.js';
import { SetupReadmeModal } from './components/SetupReadmeModal.js';
import { usePipelineSSE } from './hooks/usePipelineSSE.js';
import { 
  PipelineStage, 
  SystemStatus, 
  VideoAspectRatio, 
  VideoProject, 
  VideoTone, 
  VisualStyle, 
  VoiceName 
} from './types.js';

export default function App() {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [currentProject, setCurrentProject] = useState<VideoProject | null>(null);
  const [activeTab, setActiveTab] = useState<PipelineStage>('topic');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isDocsOpen, setIsDocsOpen] = useState<boolean>(false);

  // Helper to sync updated project into state
  const updateProjectState = (updated: VideoProject) => {
    setCurrentProject(updated);
    setProjects((prev) => {
      const exists = prev.some((p) => p.id === updated.id);
      if (exists) {
        return prev.map((p) => (p.id === updated.id ? updated : p));
      }
      return [updated, ...prev];
    });
  };

  // Real-time Server-Sent Events (SSE) hook - no fake timers or interval polling
  const pipeline = usePipelineSSE(currentProject, (updated) => {
    updateProjectState(updated);
  });

  const isPipelineRunning = isLoading || pipeline.activeJob?.status === 'running' || currentProject?.status === 'generating';

  // Fetch status and projects on mount
  useEffect(() => {
    fetchStatus();
    fetchProjects();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        // If no active project and there are existing projects, select the most recent one
        if (!currentProject && data.length > 0) {
          setCurrentProject(data[0]);
          if (data[0].finalVideoUrl) {
            setActiveTab('assembly');
          } else if (data[0].scenes?.some((s: any) => s.audioUrl)) {
            setActiveTab('voiceover');
          } else if (data[0].scenes?.some((s: any) => s.imageUrl)) {
            setActiveTab('visuals');
          } else if (data[0].scenes?.length > 0) {
            setActiveTab('scenes');
          } else if (data[0].researchStatus || data[0].currentStage === 'research') {
            setActiveTab('research');
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  };

  // Create new project and start step-by-step: Dedicated Research Stage before scripting
  const handleCreateStepByStep = async (config: {
    topic: string;
    aspectRatio: VideoAspectRatio;
    tone: VideoTone;
    visualStyle: VisualStyle;
    voice: VoiceName;
    targetDurationMinutes: number;
    userProvidedSources?: string;
    userResearchNotes?: string;
  }) => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      // 1. Create project
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const newProj = await createRes.json();
      updateProjectState(newProj);

      // 2. Generate structured topic research first
      setActiveTab('research');
      const researchRes = await fetch(`/api/projects/${newProj.id}/generate-research`, {
        method: 'POST',
      });
      if (researchRes.ok) {
        const data = await researchRes.json();
        updateProjectState(data.project || newProj);
      }
      fetchStatus();
    } catch (err: any) {
      setErrorBanner(err.message || 'Error initializing project research');
    } finally {
      setIsLoading(false);
    }
  };

  // Proceed from Research stage to Script generation (uses approved research object)
  const handleProceedFromResearchToScript = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      setActiveTab('scenes');
      const scriptRes = await fetch(`/api/projects/${currentProject.id}/generate-script`, {
        method: 'POST',
      });
      if (!scriptRes.ok) {
        const errData = await scriptRes.json();
        throw new Error(errData.error || 'Failed to generate script from research');
      }
      const withScript = await scriptRes.json();
      updateProjectState(withScript);
      fetchStatus();
    } catch (err: any) {
      setErrorBanner(err.message || 'Failed to generate script');
    } finally {
      setIsLoading(false);
    }
  };

  // Create project and run full pipeline end-to-end
  const handleCreateAndRunAll = async (config: {
    topic: string;
    aspectRatio: VideoAspectRatio;
    tone: VideoTone;
    visualStyle: VisualStyle;
    voice: VoiceName;
    targetDurationMinutes: number;
  }) => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const createRes = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const newProj = await createRes.json();
      updateProjectState(newProj);
      setActiveTab('assembly');

      const runRes = await fetch(`/api/projects/${newProj.id}/run-pipeline`, {
        method: 'POST',
      });
      if (!runRes.ok) {
        const errData = await runRes.json();
        throw new Error(errData.error || 'Pipeline execution failed');
      }
      const data = await runRes.json();
      const initialProject = data.project || data;
      updateProjectState(initialProject);
      fetchStatus();
    } catch (err: any) {
      setErrorBanner(err.message || 'Pipeline execution error');
      setIsLoading(false);
    }
  };

  // Regenerate Script
  const handleRegenerateScript = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/generate-script`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate script');
      }
      const updated = await res.json();
      updateProjectState(updated);
    } catch (err: any) {
      setErrorBanner(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Generate All Visuals
  const handleGenerateVisuals = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      setActiveTab('visuals');
      const res = await fetch(`/api/projects/${currentProject.id}/generate-images`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate visual assets');
      }
      const updated = await res.json();
      updateProjectState(updated);
    } catch (err: any) {
      setErrorBanner(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Regenerate Single Image
  const handleRegenerateSingleImage = async (sceneIndex: number, newPrompt?: string) => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/scenes/${sceneIndex}/regenerate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: newPrompt }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate image');
      }
      const data = await res.json();
      updateProjectState(data.project);
    } catch (err: any) {
      setErrorBanner(err.message);
    }
  };

  // Generate All Voiceover
  const handleGenerateVoiceover = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      setActiveTab('voiceover');
      const res = await fetch(`/api/projects/${currentProject.id}/generate-voiceover`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate voiceover');
      }
      const updated = await res.json();
      updateProjectState(updated);
    } catch (err: any) {
      setErrorBanner(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Regenerate Single Audio
  const handleRegenerateSingleAudio = async (sceneIndex: number, newNarration?: string, newVoice?: VoiceName) => {
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/scenes/${sceneIndex}/regenerate-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narration: newNarration, voice: newVoice }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to regenerate audio');
      }
      const data = await res.json();
      updateProjectState(data.project);
    } catch (err: any) {
      setErrorBanner(err.message);
    }
  };

  // Assemble Video with FFmpeg
  const handleAssembleVideo = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      setActiveTab('assembly');
      const res = await fetch(`/api/projects/${currentProject.id}/assemble-video`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to assemble video');
      }
      const updated = await res.json();
      updateProjectState(updated);
    } catch (err: any) {
      setErrorBanner(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Run full pipeline from current project
  const handleRunFullPipelineForCurrent = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      setActiveTab('assembly');
      const res = await fetch(`/api/projects/${currentProject.id}/run-pipeline`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to run full pipeline');
      }
      const data = await res.json();
      const updated = data.project || data;
      updateProjectState(updated);
    } catch (err: any) {
      setErrorBanner(err.message);
      setIsLoading(false);
    }
  };

  // Delete project
  const handleDeleteProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
        if (currentProject?.id === id) {
          const remaining = projects.filter((p) => p.id !== id);
          setCurrentProject(remaining.length > 0 ? remaining[0] : null);
          setActiveTab('topic');
        }
        fetchStatus();
      }
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  // Update project manual edits
  const handleUpdateProject = async (updates: Partial<VideoProject>) => {
    if (!currentProject) return;
    const merged = { ...currentProject, ...updates };
    updateProjectState(merged);
    try {
      await fetch(`/api/projects/${currentProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.error('Failed to save project updates:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-rose-500 selection:text-white">
      {/* Navigation Header */}
      <Header
        systemStatus={systemStatus}
        hasActiveProject={!!currentProject}
        onOpenNewProject={() => {
          setCurrentProject(null);
          setActiveTab('topic');
        }}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenDocs={() => setIsDocsOpen(true)}
      />

      {/* Stage Navigation Stepper */}
      {currentProject && (
        <StageProgressBar
          project={currentProject}
          activeTab={activeTab}
          onSelectTab={(stage) => setActiveTab(stage)}
        />
      )}

      {/* Real-time Operational Pipeline Controls */}
      {currentProject && (
        <PipelineLiveControls
          job={pipeline.activeJob}
          activeAsset={pipeline.activeAsset}
          eventsLog={pipeline.eventsLog}
          warnings={pipeline.warnings}
          connectionStatus={pipeline.connectionStatus}
          onCancel={pipeline.cancelJob}
          onPause={pipeline.pauseJob}
          onResumeCheckpoint={pipeline.resumeFromCheckpoint}
          onRetryFailed={pipeline.retryFailed}
          onRetryStage={pipeline.retryStage}
          onRestartFromStage={pipeline.restartFromStage}
        />
      )}

      {/* Error banner notification */}
      {errorBanner && (
        <div className="max-w-4xl mx-auto mt-4 px-4 w-full">
          <div className="bg-rose-950/80 border border-rose-800 text-rose-200 text-xs px-4 py-3 rounded-xl flex items-center justify-between shadow-lg">
            <span>{errorBanner}</span>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-rose-400 hover:text-white font-bold ml-2 cursor-pointer"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Main View Area */}
      <main className="flex-1 pb-16">
        {/* Stage 1: Topic & Settings */}
        {activeTab === 'topic' && (
          <ProjectConfigForm
            project={currentProject}
            onSaveAndNextStage={handleCreateStepByStep}
            onSaveAndRunAll={handleCreateAndRunAll}
            isLoading={isPipelineRunning}
          />
        )}

        {/* Stage 2: Research & Verification Dossier */}
        {activeTab === 'research' && currentProject && (
          <ResearchStageView
            project={currentProject}
            onProceedToScript={handleProceedFromResearchToScript}
            onRunFullPipeline={handleRunFullPipelineForCurrent}
            onUpdateProject={handleUpdateProject}
            isLoading={isPipelineRunning}
          />
        )}

        {/* Stage 3: Script & Storyboard */}
        {activeTab === 'scenes' && currentProject && (
          <ScriptStageView
            project={currentProject}
            onRegenerateScript={handleRegenerateScript}
            onProceedToVisuals={handleGenerateVisuals}
            onRunFullPipeline={handleRunFullPipelineForCurrent}
            onUpdateProject={handleUpdateProject}
            isLoading={isPipelineRunning}
          />
        )}

        {/* Stage 3: Visual Generation */}
        {activeTab === 'visuals' && currentProject && (
          <VisualsStageView
            project={currentProject}
            onRegenerateAllImages={handleGenerateVisuals}
            onRegenerateSingleImage={handleRegenerateSingleImage}
            onProceedToVoiceover={handleGenerateVoiceover}
            isLoading={isPipelineRunning}
          />
        )}

        {/* Stage 4: Voiceover (TTS) */}
        {activeTab === 'voiceover' && currentProject && (
          <VoiceoverStageView
            project={currentProject}
            onRegenerateAllAudio={handleGenerateVoiceover}
            onRegenerateSingleAudio={handleRegenerateSingleAudio}
            onProceedToAssembly={handleAssembleVideo}
            isLoading={isPipelineRunning}
          />
        )}

        {/* Stage 5: Final FFmpeg Assembly */}
        {activeTab === 'assembly' && currentProject && (
          <AssemblyStageView
            project={currentProject}
            onReAssembleVideo={handleAssembleVideo}
            isLoading={isPipelineRunning}
          />
        )}
      </main>

      {/* Modals */}
      <ProjectHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        projects={projects}
        currentProjectId={currentProject?.id}
        onSelectProject={(id) => {
          const found = projects.find((p) => p.id === id);
          if (found) {
            setCurrentProject(found);
            if (found.finalVideoUrl) setActiveTab('assembly');
            else if (found.scenes?.some((s) => s.audioUrl)) setActiveTab('voiceover');
            else if (found.scenes?.some((s) => s.imageUrl)) setActiveTab('visuals');
            else setActiveTab('scenes');
          }
        }}
        onDeleteProject={handleDeleteProject}
      />

      <SetupReadmeModal
        isOpen={isDocsOpen}
        onClose={() => setIsDocsOpen(false)}
      />
    </div>
  );
}
