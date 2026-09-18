import fs from 'fs';
import path from 'path';
import { IAssetStore, ProjectAssetRecord } from './types.js';
import { pathValidation, CANONICAL_PROJECT_SUBDIRS } from './pathValidation.js';
import { atomicWrite } from './atomicWrite.js';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.json': 'application/json',
};

const ALLOWED_ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.wav',
  '.mp3',
  '.mp4',
  '.srt',
  '.vtt',
]);

export class AssetStore implements IAssetStore {
  private projectsRoot: string;

  constructor(projectsRoot: string) {
    this.projectsRoot = projectsRoot;
  }

  private getAssetsJsonPath(projectId: string): string {
    return path.join(this.projectsRoot, projectId, 'assets.json');
  }

  /**
   * Returns all registered assets for a project from assets.json
   */
  getAssets(projectId: string): ProjectAssetRecord[] {
    if (!pathValidation.isValidProjectId(projectId)) return [];
    const assetsPath = this.getAssetsJsonPath(projectId);
    const records = atomicWrite.readJsonWithRecovery<ProjectAssetRecord[]>(assetsPath);
    return Array.isArray(records) ? records : [];
  }

  /**
   * Registers or updates an asset in assets.json
   */
  registerAsset(
    projectId: string,
    assetInput: Omit<ProjectAssetRecord, 'createdAt'>
  ): ProjectAssetRecord {
    if (!pathValidation.isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID: "${projectId}"`);
    }

    const currentAssets = this.getAssets(projectId);
    const existingIndex = currentAssets.findIndex(
      (a) => a.relativePath === assetInput.relativePath || a.id === assetInput.id
    );

    const assetRecord: ProjectAssetRecord = {
      ...assetInput,
      createdAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      currentAssets[existingIndex] = assetRecord;
    } else {
      currentAssets.push(assetRecord);
    }

    const assetsPath = this.getAssetsJsonPath(projectId);
    atomicWrite.writeJsonAtomic(assetsPath, currentAssets);
    return assetRecord;
  }

  /**
   * Gets a specific asset record by relative path
   */
  getAssetByPath(projectId: string, relativePath: string): ProjectAssetRecord | null {
    const assets = this.getAssets(projectId);
    const normalized = relativePath.replace(/^[/\\]+/, '');
    return assets.find((a) => a.relativePath === normalized) || null;
  }

  /**
   * Saves a binary asset to disk in the canonical directory and registers it
   */
  saveAssetFile(
    projectId: string,
    category: string,
    filename: string,
    buffer: Buffer,
    mimeType?: string
  ): ProjectAssetRecord {
    if (!pathValidation.isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID: "${projectId}"`);
    }

    const safeFilename = pathValidation.sanitizeFilename(filename);
    const safeCategory = pathValidation.sanitizeFilename(category);

    const projectDir = path.join(this.projectsRoot, projectId);
    const categoryDir = path.join(projectDir, safeCategory);
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    const targetPath = path.join(categoryDir, safeFilename);
    fs.writeFileSync(targetPath, buffer);

    const ext = path.extname(safeFilename).toLowerCase();
    const resolvedMime = mimeType || MIME_MAP[ext] || 'application/octet-stream';
    const relativePath = `${safeCategory}/${safeFilename}`;
    const publicUrl = `/storage/projects/${projectId}/${relativePath}`;

    let assetType: ProjectAssetRecord['type'] = 'image';
    if (ext === '.wav' || ext === '.mp3') assetType = 'audio';
    else if (ext === '.mp4') assetType = 'video';
    else if (ext === '.srt' || ext === '.vtt') assetType = 'subtitle';
    else if (safeCategory === 'thumbnails') assetType = 'thumbnail';

    return this.registerAsset(projectId, {
      id: `asset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      projectId,
      type: assetType,
      relativePath,
      publicUrl,
      filename: safeFilename,
      sizeBytes: buffer.length,
      mimeType: resolvedMime,
    });
  }

  /**
   * Resolves a relative asset path safely, checking bounds and mime type.
   * Throws on directory traversal or disallowed extensions.
   */
  resolveAssetPath(projectId: string, relativePath: string): { absolutePath: string; mimeType: string } | null {
    if (!pathValidation.isValidProjectId(projectId)) {
      return null;
    }

    const projectDir = path.join(this.projectsRoot, projectId);
    if (!fs.existsSync(projectDir)) {
      return null;
    }

    const safePath = pathValidation.resolveSafePath(projectDir, relativePath);
    if (!fs.existsSync(safePath)) {
      return null;
    }

    const ext = path.extname(safePath).toLowerCase();
    // Disallow serving sensitive files like .json or hidden files via asset route
    if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) {
      return null;
    }

    const mimeType = MIME_MAP[ext] || 'application/octet-stream';
    return { absolutePath: safePath, mimeType };
  }

  /**
   * Scans project directories and synchronizes assets.json with the filesystem
   */
  scanAndSyncAssets(projectId: string): ProjectAssetRecord[] {
    if (!pathValidation.isValidProjectId(projectId)) return [];
    const projectDir = path.join(this.projectsRoot, projectId);
    if (!fs.existsSync(projectDir)) return [];

    const discovered: ProjectAssetRecord[] = [];

    // Scan canonical folders
    const foldersToScan = ['scenes', 'audio', 'thumbnails', 'renders', 'captions', 'music', 'sfx'];

    for (const folder of foldersToScan) {
      const folderPath = path.join(projectDir, folder);
      if (!fs.existsSync(folderPath)) continue;

      try {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (!ALLOWED_ASSET_EXTENSIONS.has(ext)) continue;

          const filePath = path.join(folderPath, file);
          const stats = fs.statSync(filePath);
          const relativePath = `${folder}/${file}`;

          let assetType: ProjectAssetRecord['type'] = 'image';
          if (ext === '.wav' || ext === '.mp3') assetType = 'audio';
          else if (ext === '.mp4') assetType = 'video';
          else if (ext === '.srt' || ext === '.vtt') assetType = 'subtitle';
          else if (folder === 'thumbnails') assetType = 'thumbnail';

          discovered.push({
            id: `asset_${Buffer.from(relativePath).toString('base64url').slice(0, 16)}`,
            projectId,
            type: assetType,
            relativePath,
            publicUrl: `/storage/projects/${projectId}/${relativePath}`,
            filename: file,
            sizeBytes: stats.size,
            mimeType: MIME_MAP[ext] || 'application/octet-stream',
            createdAt: stats.birthtime.toISOString(),
          });
        }
      } catch {
        // Ignore read errors
      }
    }

    // Also check root for legacy files (thumbnail.png, video.mp4, subtitles.srt)
    const legacyFiles = [
      { name: 'thumbnail.png', type: 'thumbnail' as const, mime: 'image/png' },
      { name: 'video.mp4', type: 'video' as const, mime: 'video/mp4' },
      { name: 'subtitles.srt', type: 'subtitle' as const, mime: 'text/plain; charset=utf-8' },
    ];

    for (const lf of legacyFiles) {
      const lfPath = path.join(projectDir, lf.name);
      if (fs.existsSync(lfPath)) {
        const stats = fs.statSync(lfPath);
        discovered.push({
          id: `asset_legacy_${lf.name.replace('.', '_')}`,
          projectId,
          type: lf.type,
          relativePath: lf.name,
          publicUrl: `/storage/projects/${projectId}/${lf.name}`,
          filename: lf.name,
          sizeBytes: stats.size,
          mimeType: lf.mime,
          createdAt: stats.birthtime.toISOString(),
        });
      }
    }

    const assetsPath = this.getAssetsJsonPath(projectId);
    atomicWrite.writeJsonAtomic(assetsPath, discovered);
    return discovered;
  }
}
