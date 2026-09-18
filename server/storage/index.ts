import path from 'path';
import { ProjectStore } from './projectStore.js';
import { pathValidation } from './pathValidation.js';
import { atomicWrite } from './atomicWrite.js';
import { VideoProject } from '../../src/types.js';

// Central configuration
const STORAGE_ROOT = path.join(process.cwd(), 'storage');
const PROJECTS_DIR = path.join(STORAGE_ROOT, 'projects');

// Singleton project store instance
export const projectStore = new ProjectStore({
  storageRoot: STORAGE_ROOT,
  projectsDir: PROJECTS_DIR,
  tempTtlMs: 60 * 60 * 1000, // 1 hour max age for abandoned temp files
});

// Singletons for individual domain services
export const assetStore = projectStore.assetStore;
export const versionStore = projectStore.versionStore;
export const tempManager = projectStore.tempManager;
export { pathValidation, atomicWrite };

// Export classes and types
export * from './types.js';
export { ProjectStore } from './projectStore.js';
export { AssetStore } from './assetStore.js';
export { VersionStore } from './versionStore.js';
export { TempManager } from './tempManager.js';
export { PathValidationService } from './pathValidation.js';
export { AtomicWriteService } from './atomicWrite.js';

// ==========================================
// Backwards Compatibility Functions
// ==========================================

export function isValidProjectId(projectId: string): boolean {
  return pathValidation.isValidProjectId(projectId);
}

export function getProjectDir(projectId: string): string {
  return projectStore.getProjectDir(projectId);
}

export function saveProject(project: VideoProject): void {
  projectStore.saveProject(project);
}

export function getProject(projectId: string): VideoProject | null {
  return projectStore.getProject(projectId);
}

export function getAllProjects(): VideoProject[] {
  return projectStore.getAllProjects();
}

export function deleteProject(projectId: string): boolean {
  return projectStore.deleteProject(projectId);
}
