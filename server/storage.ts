import fs from 'fs';
import path from 'path';
import { VideoProject } from '../src/types.js';

const STORAGE_ROOT = path.join(process.cwd(), 'storage');
const PROJECTS_DIR = path.join(STORAGE_ROOT, 'projects');

// Ensure base directories exist
if (!fs.existsSync(STORAGE_ROOT)) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
}
if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function getProjectDir(projectId: string): string {
  const dir = path.join(PROJECTS_DIR, projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const scenesDir = path.join(dir, 'scenes');
  if (!fs.existsSync(scenesDir)) {
    fs.mkdirSync(scenesDir, { recursive: true });
  }
  const audioDir = path.join(dir, 'audio');
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }
  return dir;
}

export function saveProject(project: VideoProject): void {
  const projectDir = getProjectDir(project.id);
  const filePath = path.join(projectDir, 'project.json');
  project.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
}

export function getProject(projectId: string): VideoProject | null {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  const filePath = path.join(projectDir, 'project.json');
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data) as VideoProject;
  } catch (err) {
    console.error(`Error loading project ${projectId}:`, err);
    return null;
  }
}

export function getAllProjects(): VideoProject[] {
  if (!fs.existsSync(PROJECTS_DIR)) {
    return [];
  }
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const projects: VideoProject[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const proj = getProject(entry.name);
      if (proj) {
        projects.push(proj);
      }
    }
  }

  // Sort newest first
  projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return projects;
}

export function deleteProject(projectId: string): boolean {
  const projectDir = path.join(PROJECTS_DIR, projectId);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
    return true;
  }
  return false;
}
