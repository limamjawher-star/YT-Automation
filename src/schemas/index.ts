import { z } from 'zod';

// ==========================================
// 1. Primitive & Enum Schemas
// ==========================================

export const VideoAspectRatioSchema = z.enum(['16:9', '9:16']);
export type VideoAspectRatio = z.infer<typeof VideoAspectRatioSchema>;

export const VideoToneSchema = z.enum([
  'Engaging & Fast-Paced',
  'Informative & Educational',
  'Dramatic & Storytelling',
  'Humorous & Entertaining',
  'Mysterious & Documentary',
  'Motivational & Inspiring',
]);
export type VideoTone = z.infer<typeof VideoToneSchema>;

export const VisualStyleSchema = z.enum([
  'Cinematic Photorealism',
  'Digital Concept Art',
  'Anime & Manga',
  '3D Pixar Style',
  'Dark Atmospheric Noir',
  'Minimalist Motion Vector',
]);
export type VisualStyle = z.infer<typeof VisualStyleSchema>;

export const VoiceNameSchema = z.enum(['Kore', 'Puck', 'Fenrir', 'Charon', 'Zephyr']);
export type VoiceName = z.infer<typeof VoiceNameSchema>;

export const ExplicitPipelineStageSchema = z.enum([
  'research',
  'story',
  'script',
  'scene_plan',
  'shot_plan',
  'visuals',
  'voiceover',
  'audio',
  'timeline',
  'captions',
  'thumbnail',
  'render',
  'qa',
  'completed',
]);
export type ExplicitPipelineStage = z.infer<typeof ExplicitPipelineStageSchema>;
export const EXPLICIT_PIPELINE_STAGES = ExplicitPipelineStageSchema.options;

export const PipelineStageSchema = z.enum([
  'research',
  'story',
  'script',
  'scene_plan',
  'shot_plan',
  'visuals',
  'voiceover',
  'audio',
  'timeline',
  'captions',
  'thumbnail',
  'render',
  'qa',
  'completed',
  // Backward-compatible legacy aliases
  'topic',
  'scenes',
  'assembly',
]);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const ProjectStatusSchema = z.enum(['draft', 'generating', 'ready', 'error']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectIdSchema = z
  .string()
  .min(3, 'Project ID must be at least 3 characters')
  .max(100, 'Project ID must be at most 100 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Project ID can only contain letters, numbers, hyphens, and underscores');

// ==========================================
// 2. YouTube Metadata & Chapters
// ==========================================

export const YouTubeChapterSchema = z.object({
  time: z.string().regex(/^\d{1,2}:\d{2}$/, 'Chapter timestamp must be in format MM:SS or M:SS'),
  title: z.string().min(1, 'Chapter title cannot be empty'),
});
export type YouTubeChapter = z.infer<typeof YouTubeChapterSchema>;

export const YouTubeMetadataSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').max(100, 'YouTube title cannot exceed 100 characters'),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  category: z.string().default('Entertainment'),
  chapters: z.array(YouTubeChapterSchema).default([]),
});
export type YouTubeMetadata = z.infer<typeof YouTubeMetadataSchema>;

// ==========================================
// 3. Scene Schema
// ==========================================

export const SceneSchema = z.object({
  id: z.string().min(1, 'Scene id is required'),
  sceneNumber: z.number().int().nonnegative('Scene number must be a non-negative integer'),
  narration: z.string().min(1, 'Narration cannot be empty'),
  visualDescription: z.string().default(''),
  imagePrompt: z.string().default(''),
  estimatedDurationSeconds: z.number().positive('Estimated duration must be positive'),
  actualDurationSeconds: z.number().positive().optional(),
  onScreenText: z.string().optional(),
  imageUrl: z.string().optional(),
  audioUrl: z.string().optional(),
  isGeneratingImage: z.boolean().optional(),
  isGeneratingAudio: z.boolean().optional(),
  status: z.enum(['pending', 'ready', 'error']).default('pending'),
  errorMessage: z.string().optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

// ==========================================
// 4. Shot Schema
// ==========================================

export const ShotSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string().min(1),
  shotNumber: z.number().int().positive(),
  cameraAngle: z.string().default('Eye Level'),
  movement: z.enum([
    'static',
    'slow_zoom_in',
    'slow_zoom_out',
    'pan_right',
    'pan_left',
    'tilt_up',
    'tilt_down',
  ]).default('slow_zoom_in'),
  description: z.string().min(1),
  durationSeconds: z.number().positive(),
  focalPoint: z.string().optional(),
});
export type Shot = z.infer<typeof ShotSchema>;

// ==========================================
// 5. Asset Schema
// ==========================================

export const AssetTypeSchema = z.enum(['image', 'audio', 'video', 'thumbnail', 'caption']);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  type: AssetTypeSchema,
  path: z.string().min(1),
  url: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

// ==========================================
// 6. Audio Asset Schema
// ==========================================

export const AudioAssetSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  sceneId: z.string().optional(),
  url: z.string().min(1),
  localPath: z.string().min(1),
  durationSeconds: z.number().positive(),
  voice: VoiceNameSchema,
  format: z.enum(['wav', 'mp3', 'aac', 'pcm']).default('wav'),
  sampleRate: z.number().int().positive().default(24000),
  channels: z.number().int().positive().default(1),
  bitDepth: z.number().int().positive().default(16).optional(),
});
export type AudioAsset = z.infer<typeof AudioAssetSchema>;

// ==========================================
// 7. Caption Schema
// ==========================================

export const CaptionSchema = z.object({
  index: z.number().int().positive(),
  startTimeSeconds: z.number().nonnegative(),
  endTimeSeconds: z.number().positive(),
  text: z.string().min(1),
  srtFormatted: z.string().optional(),
});
export type Caption = z.infer<typeof CaptionSchema>;

// ==========================================
// 8. Timeline Schema
// ==========================================

export const TimelineVideoClipSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  clipPath: z.string().min(1),
  durationSeconds: z.number().positive(),
});

export const TimelineAudioClipSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  audioPath: z.string().min(1),
  durationSeconds: z.number().positive(),
});

export const TimelineSchema = z.object({
  totalDurationSeconds: z.number().nonnegative(),
  fps: z.number().positive().default(25),
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  aspectRatio: VideoAspectRatioSchema,
  tracks: z.object({
    videoClips: z.array(TimelineVideoClipSchema),
    audioClips: z.array(TimelineAudioClipSchema),
    captions: z.array(CaptionSchema).optional(),
  }),
});
export type Timeline = z.infer<typeof TimelineSchema>;

// ==========================================
// 9. Research Result Schema & Structured Entities
// ==========================================

export const ResearchVerificationStatusSchema = z.enum([
  'verified',      // Supported / verified by source or user confirmation
  'needs_review',  // Generated or unconfirmed claim needing review (default for AI)
  'uncertain',     // Conflicting sources, speculative, or high uncertainty
]);
export type ResearchVerificationStatus = z.infer<typeof ResearchVerificationStatusSchema>;

export const ResearchFactSchema = z.object({
  id: z.string().min(1),
  fact: z.string().min(1),
  status: ResearchVerificationStatusSchema.default('needs_review'),
  source: z.string().optional(),
  notes: z.string().optional(),
});
export type ResearchFact = z.infer<typeof ResearchFactSchema>;

export const ResearchDateSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  event: z.string().min(1),
  status: ResearchVerificationStatusSchema.default('needs_review'),
  source: z.string().optional(),
});
export type ResearchDate = z.infer<typeof ResearchDateSchema>;

export const ResearchNameSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  status: ResearchVerificationStatusSchema.default('needs_review'),
});
export type ResearchName = z.infer<typeof ResearchNameSchema>;

export const ResearchNumberSchema = z.object({
  id: z.string().min(1),
  metric: z.string().min(1),
  value: z.string().min(1),
  context: z.string().min(1),
  status: ResearchVerificationStatusSchema.default('needs_review'),
  source: z.string().optional(),
});
export type ResearchNumber = z.infer<typeof ResearchNumberSchema>;

export const ResearchEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  timeframe: z.string().optional(),
  status: ResearchVerificationStatusSchema.default('needs_review'),
});
export type ResearchEvent = z.infer<typeof ResearchEventSchema>;

export const ResearchClaimSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  claimType: z.enum(['factual', 'speculative', 'contested']).default('factual'),
  status: ResearchVerificationStatusSchema.default('needs_review'),
  source: z.string().optional(),
  notes: z.string().optional(),
});
export type ResearchClaim = z.infer<typeof ResearchClaimSchema>;

export const ResearchSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  citationOrUrl: z.string().min(1),
  reliability: z.enum(['high', 'medium', 'low']).default('medium'),
  notes: z.string().optional(),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const ResearchUncertaintyFlagSchema = z.object({
  id: z.string().min(1),
  item: z.string().min(1),
  reason: z.string().min(1),
  level: z.enum(['high', 'medium', 'low']).default('medium'),
});
export type ResearchUncertaintyFlag = z.infer<typeof ResearchUncertaintyFlagSchema>;

export const ResearchOpenQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  context: z.string().optional(),
});
export type ResearchOpenQuestion = z.infer<typeof ResearchOpenQuestionSchema>;

export const ResearchStatusSchema = z.enum([
  'pending',
  'in_progress',
  'needs_review',
  'uncertain',
  'approved',
  'rejected',
]);
export type ResearchStatus = z.infer<typeof ResearchStatusSchema>;

export const ResearchResultSchema = z.object({
  topic: z.string().min(1),
  status: ResearchStatusSchema.default('needs_review'),
  summary: z.string().optional(),
  targetAudience: z.string().default('General audience and curious learners'),
  hookSuggestions: z.array(z.string()).default([]),
  keyPoints: z.array(z.string()).default([]),
  facts: z.array(ResearchFactSchema).default([]),
  dates: z.array(ResearchDateSchema).default([]),
  names: z.array(ResearchNameSchema).default([]),
  numbers: z.array(ResearchNumberSchema).default([]),
  events: z.array(ResearchEventSchema).default([]),
  claims: z.array(ResearchClaimSchema).default([]),
  sources: z.array(ResearchSourceSchema).default([]),
  uncertaintyFlags: z.array(ResearchUncertaintyFlagSchema).default([]),
  openQuestions: z.array(ResearchOpenQuestionSchema).default([]),
  userNotes: z.string().optional(),
  userProvidedSources: z.string().optional(),
  competitiveAngles: z.array(z.string()).optional(),
  recommendedLengthMinutes: z.number().positive().default(1.0),
  keywords: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
  approvedAt: z.string().optional(),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// ==========================================
// 10. Thumbnail Concept Schema
// ==========================================

export const ThumbnailConceptSchema = z.object({
  headline: z.string().min(1),
  visualFocalPoint: z.string().min(1),
  colorScheme: z.string().min(1),
  textOverlay: z.string().min(1),
  prompt: z.string().min(1),
  composition: z.string().optional(),
});
export type ThumbnailConcept = z.infer<typeof ThumbnailConceptSchema>;

// ==========================================
// 11. Pipeline Job & State Schemas
// ==========================================

export const StageProgressSchema = z.object({
  stage: PipelineStageSchema,
  status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
  progress: z.number().min(0).max(100),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});
export type StageProgress = z.infer<typeof StageProgressSchema>;

export const PipelineEventSchema = z.object({
  stage: PipelineStageSchema,
  status: z.enum(['started', 'progress', 'completed', 'error']),
  message: z.string(),
  progressPercent: z.number().min(0).max(100),
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type PipelineEvent = z.infer<typeof PipelineEventSchema>;

export const PipelineSseEventTypeSchema = z.enum([
  'job_started',
  'stage_started',
  'stage_progress',
  'asset_started',
  'asset_completed',
  'asset_failed',
  'warning',
  'log',
  'stage_completed',
  'job_paused',
  'job_cancelled',
  'job_failed',
  'job_completed',
]);
export type PipelineSseEventType = z.infer<typeof PipelineSseEventTypeSchema>;

export const PipelineStateSchema = z.object({
  jobId: z.string(),
  projectId: ProjectIdSchema,
  currentStage: PipelineStageSchema,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'paused']),
  progress: z.number().min(0).max(100),
  stages: z.record(z.string(), StageProgressSchema),
  events: z.array(PipelineEventSchema).default([]),
  currentStepMessage: z.string().optional(),
  researchStatus: z.enum(['pending', 'in_progress', 'needs_review', 'approved']).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const PipelineJobSchema = z.object({
  id: z.string().min(1),
  projectId: ProjectIdSchema,
  type: z.enum(['full_pipeline', 'stage']).default('full_pipeline'),
  stage: PipelineStageSchema,
  targetStages: z.array(PipelineStageSchema).optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'paused']),
  progress: z.number().min(0).max(100),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  error: z.string().optional(),
  state: PipelineStateSchema.optional(),
});
export type PipelineJob = z.infer<typeof PipelineJobSchema>;

// ==========================================
// 13. Project & Project Settings Schema
// ==========================================

export const ProjectSettingsSchema = z.object({
  topic: z.string().trim().min(1, 'Topic cannot be empty').max(500, 'Topic cannot exceed 500 characters'),
  aspectRatio: VideoAspectRatioSchema.default('16:9'),
  tone: VideoToneSchema.default('Engaging & Fast-Paced'),
  visualStyle: VisualStyleSchema.default('Cinematic Photorealism'),
  voice: VoiceNameSchema.default('Kore'),
  targetDurationMinutes: z.number().min(0.25, 'Duration must be at least 15 seconds (0.25m)').max(10, 'Duration cannot exceed 10 minutes').default(1),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  title: z.string().min(1),
  topic: z.string().min(1),
  aspectRatio: VideoAspectRatioSchema,
  tone: VideoToneSchema,
  visualStyle: VisualStyleSchema,
  voice: VoiceNameSchema,
  targetDurationMinutes: z.number().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentStage: PipelineStageSchema,
  status: ProjectStatusSchema,
  errorMessage: z.string().optional(),
  researchStatus: ResearchStatusSchema.default('pending').optional(),
  researchSummary: z.string().optional(),
  userProvidedSources: z.string().optional(),
  userResearchNotes: z.string().optional(),
  script: z.string().optional(),
  youtubeMetadata: YouTubeMetadataSchema.optional(),
  scenes: z.array(SceneSchema).default([]),
  finalVideoUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  totalDurationSeconds: z.number().optional(),
  renderProgress: z.number().min(0).max(100).optional(),
  renderLogs: z.array(z.string()).optional(),
});
export type VideoProject = z.infer<typeof ProjectSchema>;

// ==========================================
// 14. Whitelisted Update Schemas (Client Mutation)
// ==========================================

export const ProjectUpdateSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    topic: z.string().min(1).max(500).optional(),
    aspectRatio: VideoAspectRatioSchema.optional(),
    tone: VideoToneSchema.optional(),
    visualStyle: VisualStyleSchema.optional(),
    voice: VoiceNameSchema.optional(),
    targetDurationMinutes: z.number().min(0.25).max(10).optional(),
    researchStatus: ResearchStatusSchema.optional(),
    userProvidedSources: z.string().optional(),
    userResearchNotes: z.string().optional(),
    script: z.string().optional(),
    youtubeMetadata: YouTubeMetadataSchema.optional(),
    scenes: z.array(SceneSchema).optional(),
  })
  .strict();
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

// ==========================================
// 15. AI Structured Response Schemas
// ==========================================

export const AiScriptSceneResponseSchema = z.object({
  sceneNumber: z.number().int().nonnegative().optional(),
  narration: z.string().min(1, 'Narration cannot be empty'),
  visualDescription: z.string().default(''),
  imagePrompt: z.string().default(''),
  estimatedDurationSeconds: z.number().positive().default(6),
  onScreenText: z.string().default(''),
});

export const AiScriptResponseSchema = z.object({
  title: z.string().min(1, 'Title cannot be empty').default('Untitled Video'),
  category: z.string().default('Entertainment'),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  fullScript: z.string().optional(),
  scenes: z.array(AiScriptSceneResponseSchema).min(1, 'At least one scene is required'),
});
export type AiScriptResponse = z.infer<typeof AiScriptResponseSchema>;

export const RestartPipelineBodySchema = z.object({
  stage: ExplicitPipelineStageSchema,
});
export type RestartPipelineBody = z.infer<typeof RestartPipelineBodySchema>;

/**
 * Validates untrusted AI model output against AiScriptResponseSchema.
 * Never trust raw model JSON.
 */
export function validateAiScriptResponse(raw: unknown): {
  success: boolean;
  data?: AiScriptResponse;
  errors?: string[];
} {
  const result = AiScriptResponseSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const formattedErrors = result.error.issues.map(
    (issue) => `${issue.path.join('.')}: ${issue.message}`
  );
  return { success: false, errors: formattedErrors };
}
