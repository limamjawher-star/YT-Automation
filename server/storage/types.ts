import { VideoProject, Scene, YouTubeMetadata, Asset } from '../../src/types.js';

export interface StorageConfig {
  storageRoot: string;
  projectsDir: string;
  tempTtlMs?: number; // Max age before temp file is considered abandoned (default: 1 hour)
}

export interface ProjectResearchData {
  topic: string;
  targetAudience?: string;
  hookSuggestions?: string[];
  keyPoints?: string[];
  recommendedLengthMinutes?: number;
}

export interface ProjectScriptData {
  title: string;
  topic: string;
  script: string;
  scenesCount: number;
}

export interface ProjectTimelineData {
  totalDurationSeconds: number;
  fps: number;
  resolution: { width: number; height: number };
  aspectRatio: string;
  scenes: Array<{
    sceneIndex: number;
    durationSeconds: number;
    hasImage: boolean;
    hasAudio: boolean;
  }>;
}

export interface ProjectAssetRecord {
  id: string;
  projectId: string;
  type: 'image' | 'audio' | 'video' | 'subtitle' | 'thumbnail' | 'music' | 'sfx';
  relativePath: string;
  publicUrl: string;
  filename: string;
  sizeBytes?: number;
  mimeType: string;
  createdAt: string;
}

export interface ProjectVersionSnapshot {
  versionId: string;
  projectId: string;
  timestamp: string;
  label: string;
  description?: string;
  stage: string;
  projectSnapshot: VideoProject;
}

export interface IPathValidationService {
  isValidProjectId(id: string): boolean;
  sanitizeFilename(name: string): string;
  resolveSafePath(baseDir: string, relativePath: string): string;
  ensureProjectCanonicalDirs(projectDir: string): void;
}

export interface IAtomicWriteService {
  writeJsonAtomic<T>(filePath: string, data: T): void;
  readJsonWithRecovery<T>(filePath: string, validator?: (data: unknown) => boolean): T | null;
}

export interface ITempManager {
  createTempFile(projectId: string, prefix: string, extension: string): { filePath: string; cleanup: () => void };
  cleanupProjectTemp(projectId: string): number;
  cleanupAllAbandonedTemp(maxAgeMs?: number): number;
}

export interface IAssetStore {
  registerAsset(projectId: string, asset: Omit<ProjectAssetRecord, 'createdAt'>): ProjectAssetRecord;
  getAssets(projectId: string): ProjectAssetRecord[];
  getAssetByPath(projectId: string, relativePath: string): ProjectAssetRecord | null;
  saveAssetFile(projectId: string, category: string, filename: string, buffer: Buffer, mimeType?: string): ProjectAssetRecord;
  resolveAssetPath(projectId: string, relativePath: string): { absolutePath: string; mimeType: string } | null;
  scanAndSyncAssets(projectId: string): ProjectAssetRecord[];
}

export interface IVersionStore {
  createSnapshot(projectId: string, label: string, description?: string): ProjectVersionSnapshot;
  listSnapshots(projectId: string): ProjectVersionSnapshot[];
  getSnapshot(projectId: string, versionId: string): ProjectVersionSnapshot | null;
  restoreSnapshot(projectId: string, versionId: string): VideoProject;
}

export interface IProjectStore {
  getProject(id: string): VideoProject | null;
  saveProject(project: VideoProject): void;
  getAllProjects(): VideoProject[];
  deleteProject(id: string): boolean;
  createProject(initialSettings: Partial<VideoProject> & { topic: string }): VideoProject;
  getProjectDir(id: string): string;
  normalizeAndMigrate(projectId: string): VideoProject | null;
}
