import fs from 'fs';
import path from 'path';
import {
  IProjectStore,
  StorageConfig,
  ProjectScriptData,
  ProjectTimelineData,
  ProjectResearchData,
} from './types.js';
import { VideoProject } from '../../src/types.js';
import { pathValidation } from './pathValidation.js';
import { atomicWrite } from './atomicWrite.js';
import { AssetStore } from './assetStore.js';
import { VersionStore } from './versionStore.js';
import { TempManager } from './tempManager.js';

export class ProjectStore implements IProjectStore {
  private projectsRoot: string;
  private storageRoot: string;
  public readonly assetStore: AssetStore;
  public readonly versionStore: VersionStore;
  public readonly tempManager: TempManager;

  constructor(config?: Partial<StorageConfig>) {
    this.storageRoot = config?.storageRoot || path.join(process.cwd(), 'storage');
    this.projectsRoot = config?.projectsDir || path.join(this.storageRoot, 'projects');

    if (!fs.existsSync(this.storageRoot)) {
      fs.mkdirSync(this.storageRoot, { recursive: true });
    }
    if (!fs.existsSync(this.projectsRoot)) {
      fs.mkdirSync(this.projectsRoot, { recursive: true });
    }

    this.assetStore = new AssetStore(this.projectsRoot);
    this.tempManager = new TempManager(this.projectsRoot, config?.tempTtlMs);
    this.versionStore = new VersionStore(
      this.projectsRoot,
      (id) => this.getProject(id),
      (p) => this.saveProject(p)
    );
  }

  /**
   * Safe project directory resolver with directory structure verification
   */
  getProjectDir(projectId: string): string {
    if (!pathValidation.isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID: "${projectId}"`);
    }

    const projectDir = path.join(this.projectsRoot, projectId);
    pathValidation.ensureProjectCanonicalDirs(projectDir);
    return projectDir;
  }

  /**
   * Creates a new video project with canonical storage structure
   */
  createProject(initial: Partial<VideoProject> & { topic: string }): VideoProject {
    const id = initial.id && pathValidation.isValidProjectId(initial.id)
      ? initial.id
      : `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const projectDir = this.getProjectDir(id);
    const now = new Date().toISOString();

    const project: VideoProject = {
      id,
      title: initial.title || initial.topic.slice(0, 60),
      topic: initial.topic,
      aspectRatio: initial.aspectRatio || '16:9',
      tone: initial.tone || 'Engaging & Fast-Paced',
      visualStyle: initial.visualStyle || 'Digital Concept Art',
      voice: initial.voice || 'Kore',
      targetDurationMinutes: initial.targetDurationMinutes || 1,
      createdAt: now,
      updatedAt: now,
      currentStage: 'topic',
      status: 'draft',
      scenes: [],
      renderLogs: [`Project initialized: "${initial.topic}"`],
    };

    this.saveProject(project);
    return project;
  }

  /**
   * Saves project data atomically to project.json and synchronizes canonical modular files:
   * script.json, scenes.json, timeline.json, metadata.json, research.json
   */
  saveProject(project: VideoProject): void {
    if (!pathValidation.isValidProjectId(project.id)) {
      throw new Error(`Cannot save project: invalid ID "${project.id}"`);
    }

    const projectDir = this.getProjectDir(project.id);
    project.updatedAt = new Date().toISOString();

    // 1. Save primary project.json atomically
    const projectJsonPath = path.join(projectDir, 'project.json');
    atomicWrite.writeJsonAtomic(projectJsonPath, project);

    // 2. Synchronize modular canonical files atomically
    try {
      // script.json
      const scriptData: ProjectScriptData = {
        title: project.title,
        topic: project.topic,
        script: project.script || '',
        scenesCount: project.scenes?.length || 0,
      };
      atomicWrite.writeJsonAtomic(path.join(projectDir, 'script.json'), scriptData);

      // scenes.json
      atomicWrite.writeJsonAtomic(path.join(projectDir, 'scenes.json'), project.scenes || []);

      // metadata.json
      if (project.youtubeMetadata) {
        atomicWrite.writeJsonAtomic(path.join(projectDir, 'metadata.json'), project.youtubeMetadata);
      }

      // research.json
      const researchData: ProjectResearchData = {
        topic: project.topic,
        targetAudience: 'General Audience',
        recommendedLengthMinutes: project.targetDurationMinutes,
        hookSuggestions: project.scenes?.[0]?.onScreenText ? [project.scenes[0].onScreenText] : [],
        keyPoints: project.scenes?.map((s) => s.onScreenText || s.visualDescription).filter(Boolean) || [],
      };
      atomicWrite.writeJsonAtomic(path.join(projectDir, 'research.json'), researchData);

      // timeline.json
      const isLandscape = project.aspectRatio === '16:9';
      const timelineData: ProjectTimelineData = {
        totalDurationSeconds: project.totalDurationSeconds || 0,
        fps: 25,
        resolution: isLandscape ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 },
        aspectRatio: project.aspectRatio,
        scenes: (project.scenes || []).map((s, idx) => ({
          sceneIndex: idx,
          durationSeconds: s.actualDurationSeconds || s.estimatedDurationSeconds || 5,
          hasImage: !!s.imageUrl,
          hasAudio: !!s.audioUrl,
        })),
      };
      atomicWrite.writeJsonAtomic(path.join(projectDir, 'timeline.json'), timelineData);

      // 3. Scan & sync asset catalog
      this.assetStore.scanAndSyncAssets(project.id);
    } catch (modularErr) {
      console.warn(`[ProjectStore] Warning synchronizing modular files for ${project.id}:`, modularErr);
    }
  }

  /**
   * Retrieves a project with automatic normalization and backward-compatibility migration
   */
  getProject(projectId: string): VideoProject | null {
    if (!pathValidation.isValidProjectId(projectId)) {
      return null;
    }

    const projectDir = path.join(this.projectsRoot, projectId);
    const projectJsonPath = path.join(projectDir, 'project.json');

    if (!fs.existsSync(projectJsonPath)) {
      return null;
    }

    const project = atomicWrite.readJsonWithRecovery<VideoProject>(projectJsonPath);
    if (!project) {
      return null;
    }

    // Normalization & Backward-Compatibility check
    return this.normalizeAndMigrate(project.id, project);
  }

  /**
   * Normalizes an existing project folder to the canonical structure without breaking data
   */
  normalizeAndMigrate(projectId: string, existingProject?: VideoProject): VideoProject | null {
    if (!pathValidation.isValidProjectId(projectId)) return null;

    const projectDir = path.join(this.projectsRoot, projectId);
    const projectJsonPath = path.join(projectDir, 'project.json');

    const project = existingProject || atomicWrite.readJsonWithRecovery<VideoProject>(projectJsonPath);
    if (!project) return null;

    // 1. Ensure all canonical directories exist
    pathValidation.ensureProjectCanonicalDirs(projectDir);

    // 2. Ensure default fields are present
    project.scenes = project.scenes || [];
    project.renderLogs = project.renderLogs || [];
    project.status = project.status || 'draft';
    project.currentStage = project.currentStage || 'topic';

    // 3. Ensure modular JSON files exist (migrate from single project.json)
    const modularFiles = [
      { name: 'script.json', data: { title: project.title, topic: project.topic, script: project.script || '', scenesCount: project.scenes.length } },
      { name: 'scenes.json', data: project.scenes },
      { name: 'metadata.json', data: project.youtubeMetadata || {} },
      { name: 'research.json', data: { topic: project.topic, recommendedLengthMinutes: project.targetDurationMinutes } },
      {
        name: 'timeline.json',
        data: {
          totalDurationSeconds: project.totalDurationSeconds || 0,
          fps: 25,
          resolution: project.aspectRatio === '16:9' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 },
          aspectRatio: project.aspectRatio,
          scenes: project.scenes.map((s, idx) => ({
            sceneIndex: idx,
            durationSeconds: s.actualDurationSeconds || s.estimatedDurationSeconds || 5,
            hasImage: !!s.imageUrl,
            hasAudio: !!s.audioUrl,
          })),
        },
      },
    ];

    for (const mod of modularFiles) {
      const modPath = path.join(projectDir, mod.name);
      if (!fs.existsSync(modPath)) {
        atomicWrite.writeJsonAtomic(modPath, mod.data);
      }
    }

    // 4. Catalog existing assets into assets.json
    const assetsPath = path.join(projectDir, 'assets.json');
    if (!fs.existsSync(assetsPath)) {
      this.assetStore.scanAndSyncAssets(projectId);
    }

    return project;
  }

  /**
   * Retrieves all projects, sorted newest first
   */
  getAllProjects(): VideoProject[] {
    if (!fs.existsSync(this.projectsRoot)) {
      return [];
    }

    try {
      const entries = fs.readdirSync(this.projectsRoot, { withFileTypes: true });
      const projects: VideoProject[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() && pathValidation.isValidProjectId(entry.name)) {
          const proj = this.getProject(entry.name);
          if (proj) {
            projects.push(proj);
          }
        }
      }

      projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return projects;
    } catch (err) {
      console.error('[ProjectStore] Error listing projects:', err);
      return [];
    }
  }

  /**
   * Saves a modular sub-document (e.g. 'research', 'script', 'metadata', 'scenes', 'timeline')
   */
  saveProjectModular<T = unknown>(projectId: string, moduleName: string, data: T): void {
    const projectDir = this.getProjectDir(projectId);
    const filename = pathValidation.sanitizeFilename(`${moduleName}.json`);
    const filePath = path.join(projectDir, filename);
    atomicWrite.writeJsonAtomic(filePath, data);
  }

  /**
   * Reads a modular sub-document with recovery
   */
  readProjectModular<T = unknown>(projectId: string, moduleName: string): T | null {
    const projectDir = this.getProjectDir(projectId);
    const filename = pathValidation.sanitizeFilename(`${moduleName}.json`);
    const filePath = path.join(projectDir, filename);
    return atomicWrite.readJsonWithRecovery<T>(filePath);
  }

  /**
   * Safely deletes a project and its canonical directory tree

   */
  deleteProject(projectId: string): boolean {
    if (!pathValidation.isValidProjectId(projectId)) {
      return false;
    }

    const projectDir = path.join(this.projectsRoot, projectId);
    if (fs.existsSync(projectDir)) {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
        return true;
      } catch (err) {
        console.error(`[ProjectStore] Failed to delete project "${projectId}":`, err);
        return false;
      }
    }
    return false;
  }
}
