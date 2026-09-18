import { ChildProcess, exec, spawn } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export interface ProcessRunOptions {
  cwd?: string;
  signal?: AbortSignal;
  jobId?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Registry of active child processes indexed by jobId and global set.
 * Ensures that whenever a job is cancelled or an AbortSignal fires,
 * all associated FFmpeg processes are forcefully killed.
 */
class ProcessManager {
  private activeProcesses: Map<string, Set<ChildProcess>> = new Map();
  private allProcesses: Set<ChildProcess> = new Set();

  register(jobId: string | undefined, proc: ChildProcess): () => void {
    this.allProcesses.add(proc);
    if (jobId) {
      if (!this.activeProcesses.has(jobId)) {
        this.activeProcesses.set(jobId, new Set());
      }
      this.activeProcesses.get(jobId)!.add(proc);
    }

    const cleanup = () => {
      this.allProcesses.delete(proc);
      if (jobId && this.activeProcesses.has(jobId)) {
        const set = this.activeProcesses.get(jobId)!;
        set.delete(proc);
        if (set.size === 0) {
          this.activeProcesses.delete(jobId);
        }
      }
    };

    proc.once('exit', cleanup);
    proc.once('close', cleanup);
    proc.once('error', cleanup);

    return cleanup;
  }

  /**
   * Terminate all child processes associated with a given job ID.
   */
  terminateJobProcesses(jobId: string): number {
    const processes = this.activeProcesses.get(jobId);
    if (!processes || processes.size === 0) {
      return 0;
    }

    let count = 0;
    for (const proc of Array.from(processes)) {
      this.forceKillProcess(proc);
      count++;
    }
    this.activeProcesses.delete(jobId);
    return count;
  }

  /**
   * Forcefully terminates a child process and its process tree.
   */
  forceKillProcess(proc: ChildProcess): void {
    try {
      if (proc.killed || proc.exitCode !== null) return;

      // Send SIGTERM first
      try {
        proc.kill('SIGTERM');
      } catch {
        // Ignored
      }

      // If pid exists, attempt to kill process group or child
      if (proc.pid) {
        try {
          process.kill(-proc.pid, 'SIGKILL');
        } catch {
          // Process group kill may fail if not detached, fallback to direct pid kill
          try {
            process.kill(proc.pid, 'SIGKILL');
          } catch {
            // Already exited
          }
        }
      }

      // Hard SIGKILL fallback
      setTimeout(() => {
        try {
          if (!proc.killed && proc.exitCode === null) {
            proc.kill('SIGKILL');
          }
        } catch {
          // Ignored
        }
      }, 200).unref();
    } catch (err) {
      console.warn('[ProcessManager] Error killing child process:', err);
    }
  }

  /**
   * Executes a command string with AbortSignal support, child process tracking,
   * and guaranteed cleanup on cancellation.
   */
  async execCancellable(
    command: string,
    options: ProcessRunOptions = {}
  ): Promise<{ stdout: string; stderr: string }> {
    if (options.signal?.aborted) {
      const err = new Error('Process execution aborted before launch');
      err.name = 'AbortError';
      throw err;
    }

    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = exec(
        command,
        {
          cwd: options.cwd,
          timeout: options.timeoutMs,
          env: options.env || process.env,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          cleanup();
          if (error) {
            if (options.signal?.aborted || error.name === 'AbortError') {
              const abortErr = new Error('Process aborted');
              abortErr.name = 'AbortError';
              return reject(abortErr);
            }
            return reject(error);
          }
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      );

      const unregister = this.register(options.jobId, child);

      let abortHandler: (() => void) | null = null;
      if (options.signal) {
        abortHandler = () => {
          this.forceKillProcess(child);
          const abortErr = new Error('Process aborted by signal');
          abortErr.name = 'AbortError';
          reject(abortErr);
        };
        options.signal.addEventListener('abort', abortHandler, { once: true });
      }

      const cleanup = () => {
        unregister();
        if (options.signal && abortHandler) {
          options.signal.removeEventListener('abort', abortHandler);
        }
      };
    });
  }
}

export const processManager = new ProcessManager();
