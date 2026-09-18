/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './schemas/index.js';

export interface SystemStatus {
  hasGeminiKey: boolean;
  hasFfmpeg: boolean;
  storagePath: string;
  activeProjectsCount: number;
}

export interface PipelineProgressEvent {
  stage: import('./schemas/index.js').PipelineStage;
  status: 'started' | 'progress' | 'completed' | 'error';
  message: string;
  progressPercent: number;
  data?: Record<string, unknown>;
}
