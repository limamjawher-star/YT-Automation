import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getAiConfig } from './config.js';

export function computeDeterministicHash(input: Record<string, unknown>): string {
  // Canonical stringify with sorted keys
  const serialize = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(serialize);
    }
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, any> = {};
    for (const key of sortedKeys) {
      if (obj[key] !== undefined) {
        result[key] = serialize(obj[key]);
      }
    }
    return result;
  };

  const canonicalJson = JSON.stringify(serialize(input));
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

class AssetCacheManager {
  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private getTypeDir(type: 'image' | 'voice' | 'text'): string {
    const config = getAiConfig();
    const subDir = path.join(config.cacheDir, type);
    this.ensureDir(subDir);
    return subDir;
  }

  public isEnabled(): boolean {
    return getAiConfig().cacheEnabled;
  }

  /**
   * Check if asset exists in cache
   */
  public getCachedFilePath(type: 'image' | 'voice', hash: string, ext: string): string | null {
    if (!this.isEnabled()) return null;
    const cacheDir = this.getTypeDir(type);
    const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
    const filePath = path.join(cacheDir, `${hash}${normalizedExt}`);
    if (fs.existsSync(filePath)) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > 0) {
          return filePath;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Copy asset into cache
   */
  public saveFileToCache(type: 'image' | 'voice', hash: string, sourcePath: string, ext: string): string | null {
    if (!this.isEnabled()) return null;
    try {
      if (!fs.existsSync(sourcePath)) return null;
      const cacheDir = this.getTypeDir(type);
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      const cacheFilePath = path.join(cacheDir, `${hash}${normalizedExt}`);
      fs.copyFileSync(sourcePath, cacheFilePath);
      return cacheFilePath;
    } catch (err) {
      console.warn(`[AssetCache] Failed to save asset ${hash} to cache:`, err);
      return null;
    }
  }

  /**
   * Copy cached asset to destination target
   */
  public copyCachedFile(type: 'image' | 'voice', hash: string, targetPath: string, ext: string): boolean {
    if (!this.isEnabled()) return false;
    const cachedPath = this.getCachedFilePath(type, hash, ext);
    if (!cachedPath) return false;
    try {
      const targetDir = path.dirname(targetPath);
      this.ensureDir(targetDir);
      fs.copyFileSync(cachedPath, targetPath);
      return true;
    } catch (err) {
      console.warn(`[AssetCache] Failed to copy cached asset to ${targetPath}:`, err);
      return false;
    }
  }

  /**
   * Text cache retrieval
   */
  public getCachedText<T = any>(hash: string): T | null {
    if (!this.isEnabled()) return null;
    const cacheDir = this.getTypeDir('text');
    const jsonPath = path.join(cacheDir, `${hash}.json`);
    if (fs.existsSync(jsonPath)) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Save text result to cache
   */
  public saveTextToCache(hash: string, data: any): void {
    if (!this.isEnabled()) return;
    try {
      const cacheDir = this.getTypeDir('text');
      const jsonPath = path.join(cacheDir, `${hash}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[AssetCache] Failed to save text cache ${hash}:`, err);
    }
  }
}

export const assetCache = new AssetCacheManager();
