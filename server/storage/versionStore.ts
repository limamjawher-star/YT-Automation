import fs from 'fs';
import path from 'path';
import { IVersionStore, ProjectVersionSnapshot } from './types.js';
import { VideoProject } from '../../src/types.js';
import { pathValidation } from './pathValidation.js';
import { atomicWrite } from './atomicWrite.js';

export class VersionStore implements IVersionStore {
  private projectsRoot: string;
  private loadProjectFn: (id: string) => VideoProject | null;
  private saveProjectFn: (project: VideoProject) => void;

  constructor(
    projectsRoot: string,
    loadProjectFn: (id: string) => VideoProject | null,
    saveProjectFn: (project: VideoProject) => void
  ) {
    this.projectsRoot = projectsRoot;
    this.loadProjectFn = loadProjectFn;
    this.saveProjectFn = saveProjectFn;
  }

  private getVersionsDir(projectId: string): string {
    const dir = path.join(this.projectsRoot, projectId, 'versions');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Creates an immutable version snapshot of the current project state
   */
  createSnapshot(projectId: string, label: string, description?: string): ProjectVersionSnapshot {
    if (!pathValidation.isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID: "${projectId}"`);
    }

    const currentProject = this.loadProjectFn(projectId);
    if (!currentProject) {
      throw new Error(`Cannot create snapshot: project "${projectId}" not found`);
    }

    const safeLabel = pathValidation.sanitizeFilename(label.replace(/\s+/g, '_').toLowerCase());
    const timestamp = new Date().toISOString();
    const versionId = `v_${Date.now()}_${safeLabel}`;
    const filename = `${versionId}.json`;

    const snapshot: ProjectVersionSnapshot = {
      versionId,
      projectId,
      timestamp,
      label,
      description,
      stage: currentProject.currentStage,
      projectSnapshot: JSON.parse(JSON.stringify(currentProject)),
    };

    const versionsDir = this.getVersionsDir(projectId);
    const filePath = path.join(versionsDir, filename);
    atomicWrite.writeJsonAtomic(filePath, snapshot);

    return snapshot;
  }

  /**
   * Lists all version snapshots for a project, sorted newest first
   */
  listSnapshots(projectId: string): ProjectVersionSnapshot[] {
    if (!pathValidation.isValidProjectId(projectId)) return [];
    const versionsDir = this.getVersionsDir(projectId);
    if (!fs.existsSync(versionsDir)) return [];

    const snapshots: ProjectVersionSnapshot[] = [];
    try {
      const files = fs.readdirSync(versionsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(versionsDir, file);
          const snap = atomicWrite.readJsonWithRecovery<ProjectVersionSnapshot>(filePath);
          if (snap && snap.versionId) {
            snapshots.push(snap);
          }
        }
      }
    } catch {
      // Ignore read errors
    }

    return snapshots.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Retrieves a specific snapshot by ID
   */
  getSnapshot(projectId: string, versionId: string): ProjectVersionSnapshot | null {
    if (!pathValidation.isValidProjectId(projectId)) return null;
    const safeVersionId = pathValidation.sanitizeFilename(versionId);
    const versionsDir = this.getVersionsDir(projectId);
    const filePath = path.join(versionsDir, `${safeVersionId}.json`);
    return atomicWrite.readJsonWithRecovery<ProjectVersionSnapshot>(filePath);
  }

  /**
   * Restores a project to a previous snapshot state, creating an auto-rollback snapshot first
   */
  restoreSnapshot(projectId: string, versionId: string): VideoProject {
    const snapshot = this.getSnapshot(projectId, versionId);
    if (!snapshot) {
      throw new Error(`Snapshot "${versionId}" not found for project "${projectId}"`);
    }

    // Save auto-rollback snapshot of current state before overwriting
    try {
      this.createSnapshot(projectId, 'auto_pre_restore', `Automatic backup before restoring ${versionId}`);
    } catch (e) {
      console.warn('Could not create pre-restore snapshot:', e);
    }

    const restoredProject = JSON.parse(JSON.stringify(snapshot.projectSnapshot)) as VideoProject;
    restoredProject.updatedAt = new Date().toISOString();
    restoredProject.renderLogs = restoredProject.renderLogs || [];
    restoredProject.renderLogs.push(
      `[${new Date().toLocaleTimeString()}] Restored project to version "${snapshot.label}" (${snapshot.versionId})`
    );

    this.saveProjectFn(restoredProject);
    return restoredProject;
  }
}
