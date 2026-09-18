import path from 'path';
import fs from 'fs';
import { IPathValidationService } from './types.js';

export const CANONICAL_PROJECT_SUBDIRS = [
  'scenes',
  'audio',
  'music',
  'sfx',
  'captions',
  'thumbnails',
  'renders',
  'temp',
  'versions',
] as const;

export type CanonicalSubdir = (typeof CANONICAL_PROJECT_SUBDIRS)[number];

const SAFE_PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;
const RESERVED_NAMES = new Set([
  '.',
  '..',
  '.env',
  '.git',
  '.gitignore',
  'node_modules',
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export class PathValidationService implements IPathValidationService {
  /**
   * Validates project ID format strictly to avoid directory traversal
   */
  isValidProjectId(id: string): boolean {
    if (!id || typeof id !== 'string') return false;
    if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
      return false;
    }
    return SAFE_PROJECT_ID_REGEX.test(id);
  }

  /**
   * Sanitizes and validates a filename, rejecting path traversal characters
   */
  sanitizeFilename(name: string): string {
    if (!name || typeof name !== 'string') {
      throw new Error('Invalid filename: empty or non-string');
    }

    // Strip any directory traversal or path separators
    const base = path.basename(name).replace(/\0/g, '').trim();

    if (!base || base === '.' || base === '..') {
      throw new Error(`Invalid filename: "${name}"`);
    }

    const lower = base.toLowerCase();
    const nameWithoutExt = lower.split('.')[0] || '';
    if (RESERVED_NAMES.has(lower) || RESERVED_NAMES.has(nameWithoutExt)) {
      throw new Error(`Reserved filename is not allowed: "${name}"`);
    }

    // Only allow alphanumeric, underscore, hyphen, dot
    const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!sanitized) {
      throw new Error(`Sanitized filename became empty from: "${name}"`);
    }

    return sanitized;
  }

  /**
   * Resolves an untrusted relative path against a trusted base directory.
   * Throws an error if the resolved path escapes the base directory.
   */
  resolveSafePath(baseDir: string, untrustedRelativePath: string): string {
    if (!baseDir || typeof baseDir !== 'string') {
      throw new Error('Base directory is required');
    }
    if (!untrustedRelativePath || typeof untrustedRelativePath !== 'string') {
      throw new Error('Relative path is required');
    }
    if (untrustedRelativePath.includes('\0')) {
      throw new Error('Null byte injection detected in path');
    }

    const canonicalBase = path.resolve(baseDir);
    // Strip leading slashes to prevent root-relative escape
    const cleanRelative = untrustedRelativePath.replace(/^[/\\]+/, '');
    const targetPath = path.resolve(canonicalBase, cleanRelative);

    // Ensure the resolved target is within the canonical base directory
    const relative = path.relative(canonicalBase, targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Directory traversal attempt detected: "${untrustedRelativePath}" outside "${baseDir}"`);
    }

    return targetPath;
  }

  /**
   * Ensures all canonical subdirectories for a project exist
   */
  ensureProjectCanonicalDirs(projectDir: string): void {
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    for (const subdir of CANONICAL_PROJECT_SUBDIRS) {
      const fullSubdirPath = path.join(projectDir, subdir);
      if (!fs.existsSync(fullSubdirPath)) {
        fs.mkdirSync(fullSubdirPath, { recursive: true });
      }
    }
  }
}

export const pathValidation = new PathValidationService();
