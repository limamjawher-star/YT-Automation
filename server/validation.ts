import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import {
  ExplicitPipelineStageSchema,
  ProjectIdSchema,
  ProjectSettingsSchema,
  ProjectUpdateSchema,
  ProjectUpdate,
  VideoProject,
  VoiceNameSchema,
} from '../src/schemas/index.js';

// Standard Error Response Interface
export interface ApiErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

/**
 * Sends a structured, typed JSON error response
 */
export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  code: string = 'ERROR',
  details?: unknown
): Response {
  return res.status(statusCode).json({
    error: message,
    code,
    ...(details !== undefined ? { details } : {}),
  });
}

/**
 * Sends a successful JSON response
 */
export function sendSuccess<T>(res: Response, data: T, statusCode: number = 200): Response {
  return res.status(statusCode).json(data);
}

/**
 * Format Zod validation errors into a readable structure
 */
export function formatZodIssues(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}

// ==========================================
// Route Param & Query Schemas
// ==========================================

export const ProjectIdParamSchema = z.object({
  id: ProjectIdSchema,
});

export const SceneParamSchema = z.object({
  id: ProjectIdSchema,
  sceneIndex: z
    .string()
    .regex(/^\d+$/, 'Scene index must be a non-negative integer')
    .transform((val) => parseInt(val, 10)),
});

export const ProjectListQuerySchema = z.object({
  status: z.enum(['draft', 'generating', 'ready', 'error']).optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((val) => parseInt(val, 10))
    .optional(),
});

// ==========================================
// Route Body Schemas
// ==========================================

export const ProjectCreateSchema = ProjectSettingsSchema;
export { ProjectUpdateSchema };

export const RegenerateImageBodySchema = z
  .object({
    prompt: z.string().trim().min(1, 'Prompt cannot be empty').optional(),
  })
  .strict();

export const RegenerateAudioBodySchema = z
  .object({
    narration: z.string().trim().min(1, 'Narration cannot be empty').optional(),
    voice: VoiceNameSchema.optional(),
  })
  .strict();

export const VersionParamSchema = z.object({
  id: ProjectIdSchema,
  versionId: z.string().regex(/^v_[a-zA-Z0-9_-]+$/, 'Invalid version ID format'),
});

export const CreateVersionBodySchema = z
  .object({
    label: z.string().trim().min(1, 'Version label is required').max(100),
    description: z.string().max(500).optional(),
  })
  .strict();

export const JobIdParamSchema = z.object({
  id: z.string().regex(/^job_[a-zA-Z0-9_-]+$/, 'Invalid job ID format'),
});

export const CreatePipelineJobBodySchema = z
  .object({
    stages: z.array(ExplicitPipelineStageSchema).optional(),
    type: z.enum(['full_pipeline', 'stage']).optional(),
  })
  .strict();

export const RestartPipelineBodySchema = z
  .object({
    stage: ExplicitPipelineStageSchema,
  })
  .strict();

export const RetryStageBodySchema = z
  .object({
    stage: ExplicitPipelineStageSchema.optional(),
  })
  .strict();

// ==========================================
// Express Validation Middlewares
// ==========================================

export function validateParams<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      sendError(
        res,
        400,
        result.error.issues[0]?.message || 'Invalid URL parameters',
        'INVALID_PARAMS',
        formatZodIssues(result.error)
      );
      return;
    }
    req.params = result.data as any;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      sendError(
        res,
        400,
        result.error.issues[0]?.message || 'Invalid query parameters',
        'INVALID_QUERY',
        formatZodIssues(result.error)
      );
      return;
    }
    req.query = result.data as any;
    next();
  };
}

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendError(
        res,
        400,
        result.error.issues[0]?.message || 'Invalid request body',
        'INVALID_BODY',
        formatZodIssues(result.error)
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Applies only whitelisted fields to a project.
 * Completely replaces unsafe Object.assign and prevents mutation of server-controlled status/IDs.
 */
export function applyWhitelistedProjectUpdates(
  project: VideoProject,
  updates: ProjectUpdate
): VideoProject {
  if (updates.title !== undefined) project.title = updates.title;
  if (updates.topic !== undefined) project.topic = updates.topic;
  if (updates.aspectRatio !== undefined) project.aspectRatio = updates.aspectRatio;
  if (updates.tone !== undefined) project.tone = updates.tone;
  if (updates.visualStyle !== undefined) project.visualStyle = updates.visualStyle;
  if (updates.voice !== undefined) project.voice = updates.voice;
  if (updates.targetDurationMinutes !== undefined) {
    project.targetDurationMinutes = updates.targetDurationMinutes;
  }
  if (updates.researchStatus !== undefined) {
    project.researchStatus = updates.researchStatus;
  }
  if (updates.userProvidedSources !== undefined) {
    project.userProvidedSources = updates.userProvidedSources;
  }
  if (updates.userResearchNotes !== undefined) {
    project.userResearchNotes = updates.userResearchNotes;
  }
  if (updates.script !== undefined) project.script = updates.script;
  if (updates.youtubeMetadata !== undefined) {
    project.youtubeMetadata = updates.youtubeMetadata;
  }
  if (updates.scenes !== undefined) {
    project.scenes = updates.scenes;
  }

  project.updatedAt = new Date().toISOString();
  return project;
}
