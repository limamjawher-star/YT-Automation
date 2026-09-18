import fs from 'fs';
import path from 'path';
import { IAtomicWriteService } from './types.js';

export class AtomicWriteService implements IAtomicWriteService {
  /**
   * Atomically writes JSON data to a file using write-to-temp-then-rename pattern.
   * Flushes to disk via fsync before renaming to guarantee durability.
   */
  writeJsonAtomic<T>(filePath: string, data: T): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const jsonString = JSON.stringify(data, null, 2);
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    const bakPath = `${filePath}.bak`;

    try {
      // 1. Write to temporary file
      const fd = fs.openSync(tmpPath, 'w');
      fs.writeSync(fd, jsonString, 0, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);

      // 2. If target already exists and is non-empty, keep a .bak for recovery
      if (fs.existsSync(filePath)) {
        try {
          fs.copyFileSync(filePath, bakPath);
        } catch {
          // Non-fatal if backup copy fails
        }
      }

      // 3. Atomic rename replaces the target file instantaneously
      fs.renameSync(tmpPath, filePath);

      // 4. Cleanup old backup once successful write is confirmed
      if (fs.existsSync(bakPath)) {
        try {
          fs.unlinkSync(bakPath);
        } catch {
          // Ignore
        }
      }
    } catch (err) {
      // Clean up temp file on failure
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // Ignore
        }
      }
      throw new Error(`Failed to atomically write JSON to "${filePath}": ${(err as Error).message}`);
    }
  }

  /**
   * Reads a JSON file with automatic fallback to .bak if corrupted or incomplete.
   * Cleans up orphaned .tmp files in the same directory.
   */
  readJsonWithRecovery<T>(filePath: string, validator?: (data: unknown) => boolean): T | null {
    if (!fs.existsSync(filePath)) {
      const bakPath = `${filePath}.bak`;
      if (fs.existsSync(bakPath)) {
        try {
          const bakData = fs.readFileSync(bakPath, 'utf8');
          const parsed = JSON.parse(bakData);
          if (!validator || validator(parsed)) {
            // Restore primary from valid backup
            fs.copyFileSync(bakPath, filePath);
            return parsed as T;
          }
        } catch {
          // Backup also corrupt
        }
      }
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content.trim()) {
        throw new Error('Empty file content');
      }
      const parsed = JSON.parse(content);
      if (validator && !validator(parsed)) {
        throw new Error('JSON failed schema/data validation');
      }
      return parsed as T;
    } catch (primaryErr) {
      console.warn(`[AtomicStore] Primary file corrupt: "${filePath}". Attempting recovery from backup...`);

      const bakPath = `${filePath}.bak`;
      if (fs.existsSync(bakPath)) {
        try {
          const bakContent = fs.readFileSync(bakPath, 'utf8');
          const parsedBak = JSON.parse(bakContent);
          if (!validator || validator(parsedBak)) {
            console.info(`[AtomicStore] Successfully recovered "${filePath}" from backup!`);
            fs.copyFileSync(bakPath, filePath);
            return parsedBak as T;
          }
        } catch (bakErr) {
          console.error(`[AtomicStore] Backup recovery also failed for "${filePath}":`, bakErr);
        }
      }

      return null;
    } finally {
      // Opportunistic cleanup of stray .tmp files in the directory
      this.cleanupStrayTmpFiles(path.dirname(filePath));
    }
  }

  /**
   * Removes stray .tmp.* files left behind by crashes or interrupted writes
   */
  private cleanupStrayTmpFiles(dir: string): void {
    if (!fs.existsSync(dir)) return;
    try {
      const files = fs.readdirSync(dir);
      const now = Date.now();
      for (const file of files) {
        if (file.includes('.tmp.')) {
          const fullPath = path.join(dir, file);
          try {
            const stats = fs.statSync(fullPath);
            // Delete tmp files older than 30 seconds
            if (now - stats.mtimeMs > 30000) {
              fs.unlinkSync(fullPath);
            }
          } catch {
            // Ignore
          }
        }
      }
    } catch {
      // Ignore
    }
  }
}

export const atomicWrite = new AtomicWriteService();
