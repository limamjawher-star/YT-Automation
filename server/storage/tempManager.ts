import fs from 'fs';
import path from 'path';
import { ITempManager } from './types.js';
import { pathValidation } from './pathValidation.js';

export class TempManager implements ITempManager {
  private projectsRoot: string;
  private defaultMaxAgeMs: number;

  constructor(projectsRoot: string, defaultMaxAgeMs: number = 60 * 60 * 1000) {
    this.projectsRoot = projectsRoot;
    this.defaultMaxAgeMs = defaultMaxAgeMs;
  }

  /**
   * Allocates a tracked temporary file inside the canonical project's temp/ directory.
   * Returns the file path and a cleanup callback function.
   */
  createTempFile(
    projectId: string,
    prefix: string = 'temp',
    extension: string = '.tmp'
  ): { filePath: string; cleanup: () => void } {
    if (!pathValidation.isValidProjectId(projectId)) {
      throw new Error(`Invalid project ID for temp file allocation: "${projectId}"`);
    }

    const safePrefix = pathValidation.sanitizeFilename(prefix || 'temp');
    const safeExt = extension.startsWith('.') ? extension : `.${extension}`;
    const projectDir = path.join(this.projectsRoot, projectId);
    const tempDir = path.join(projectDir, 'temp');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const uniqueId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const filename = `${safePrefix}_${uniqueId}${safeExt}`;
    const filePath = path.join(tempDir, filename);

    // Create empty file placeholder
    fs.closeSync(fs.openSync(filePath, 'w'));

    const cleanup = () => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Ignore errors during disposal
      }
    };

    return { filePath, cleanup };
  }

  /**
   * Cleans all temporary files in a single project's temp directory
   */
  cleanupProjectTemp(projectId: string): number {
    if (!pathValidation.isValidProjectId(projectId)) return 0;
    const tempDir = path.join(this.projectsRoot, projectId, 'temp');
    if (!fs.existsSync(tempDir)) return 0;

    let count = 0;
    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const fullPath = path.join(tempDir, file);
        try {
          fs.unlinkSync(fullPath);
          count++;
        } catch {
          // Ignore individual removal errors
        }
      }
    } catch {
      // Ignore read errors
    }
    return count;
  }

  /**
   * Scans all projects and removes abandoned temporary files older than maxAgeMs
   */
  cleanupAllAbandonedTemp(maxAgeMs: number = this.defaultMaxAgeMs): number {
    if (!fs.existsSync(this.projectsRoot)) return 0;

    let removedCount = 0;
    const now = Date.now();

    try {
      const projectEntries = fs.readdirSync(this.projectsRoot, { withFileTypes: true });

      for (const entry of projectEntries) {
        if (entry.isDirectory() && pathValidation.isValidProjectId(entry.name)) {
          const tempDir = path.join(this.projectsRoot, entry.name, 'temp');
          if (!fs.existsSync(tempDir)) continue;

          try {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
              const filePath = path.join(tempDir, file);
              try {
                const stats = fs.statSync(filePath);
                const age = now - stats.mtimeMs;
                if (age > maxAgeMs) {
                  fs.unlinkSync(filePath);
                  removedCount++;
                }
              } catch {
                // Ignore file stat/delete errors
              }
            }
          } catch {
            // Ignore temp dir read errors
          }
        }
      }
    } catch {
      // Ignore projects dir read errors
    }

    return removedCount;
  }
}
