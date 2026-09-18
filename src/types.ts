export type VideoAspectRatio = '16:9' | '9:16';

export type VideoTone = 
  | 'Engaging & Fast-Paced'
  | 'Informative & Educational'
  | 'Dramatic & Storytelling'
  | 'Humorous & Entertaining'
  | 'Mysterious & Documentary'
  | 'Motivational & Inspiring';

export type VisualStyle = 
  | 'Cinematic Photorealism'
  | 'Digital Concept Art'
  | 'Anime & Manga'
  | '3D Pixar Style'
  | 'Dark Atmospheric Noir'
  | 'Minimalist Motion Vector';

export type VoiceName = 'Kore' | 'Puck' | 'Fenrir' | 'Charon' | 'Zephyr';

export interface Scene {
  id: string;
  sceneNumber: number;
  narration: string;
  visualDescription: string;
  imagePrompt: string;
  estimatedDurationSeconds: number;
  actualDurationSeconds?: number;
  onScreenText?: string;
  imageUrl?: string;
  audioUrl?: string;
  isGeneratingImage?: boolean;
  isGeneratingAudio?: boolean;
  status: 'pending' | 'ready' | 'error';
  errorMessage?: string;
}

export interface YouTubeMetadata {
  title: string;
  description: string;
  tags: string[];
  category: string;
  chapters: { time: string; title: string }[];
}

export interface VideoProject {
  id: string;
  title: string;
  topic: string;
  aspectRatio: VideoAspectRatio;
  tone: VideoTone;
  visualStyle: VisualStyle;
  voice: VoiceName;
  targetDurationMinutes: number; // e.g., 0.5 for 30s Shorts, 1, 2, 3
  createdAt: string;
  updatedAt: string;
  currentStage: PipelineStage;
  status: 'draft' | 'generating' | 'ready' | 'error';
  errorMessage?: string;
  script?: string;
  youtubeMetadata?: YouTubeMetadata;
  scenes: Scene[];
  finalVideoUrl?: string;
  thumbnailUrl?: string;
  totalDurationSeconds?: number;
  renderProgress?: number;
  renderLogs?: string[];
}

export type PipelineStage = 
  | 'topic'
  | 'script'
  | 'scenes'
  | 'visuals'
  | 'voiceover'
  | 'assembly'
  | 'completed';

export interface PipelineProgressEvent {
  stage: PipelineStage;
  status: 'started' | 'progress' | 'completed' | 'error';
  message: string;
  progressPercent: number;
  data?: any;
}

export interface SystemStatus {
  hasGeminiKey: boolean;
  hasFfmpeg: boolean;
  storagePath: string;
  activeProjectsCount: number;
}
