import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { VideoProject } from './src/types.js';
import {
  burnSubtitles,
  checkFfmpegInstalled,
  createSceneClip,
  createThumbnail,
  concatenateSceneClips,
  generateSrtSubtitles,
} from './server/ffmpeg.js';
import {
  generateSceneImage,
  generateSceneVoiceover,
  generateScriptAndScenes,
  generateTopicResearch,
  hasApiKey,
  getAiConfig,
  aiLogger,
  concurrencyManager,
  assetCache,
} from './server/gemini.js';
import { ResearchResult, ResearchResultSchema } from './src/schemas/index.js';
import {
  deleteProject,
  getAllProjects,
  getProject,
  getProjectDir,
  isValidProjectId,
  saveProject,
  projectStore,
  assetStore,
  versionStore,
  tempManager,
  pathValidation,
} from './server/storage.js';
import {
  ProjectIdParamSchema,
  SceneParamSchema,
  ProjectListQuerySchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  RegenerateImageBodySchema,
  RegenerateAudioBodySchema,
  VersionParamSchema,
  CreateVersionBodySchema,
  JobIdParamSchema,
  CreatePipelineJobBodySchema,
  RestartPipelineBodySchema,
  RetryStageBodySchema,
  validateParams,
  validateQuery,
  validateBody,
  sendError,
  sendSuccess,
  applyWhitelistedProjectUpdates,
} from './server/validation.js';
import {
  globalPipelineEngine,
  globalJobStore,
  globalPipelineEvents,
  ORDERED_PIPELINE_STAGES,
  ExplicitPipelineStage,
} from './server/pipeline/index.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Startup maintenance: Clean up any abandoned temporary files from previous sessions
  try {
    const cleanedCount = tempManager.cleanupAllAbandonedTemp();
    if (cleanedCount > 0) {
      console.log(`[Storage] Cleaned up ${cleanedCount} abandoned temporary files on startup.`);
    }
  } catch (cleanErr) {
    console.warn('[Storage] Startup cleanup warning:', cleanErr);
  }

  // Controlled Asset Serving Route (Replaces unrestricted static /storage exposure)
  // Strictly enforces: safe project ID validation, no path traversal, allowed asset extensions only,
  // preventing sensitive files (.json, .env, hidden files, temp files) from exposure.
  app.get('/storage/projects/:id/*', validateParams(ProjectIdParamSchema), (req, res) => {
    const projectId = req.params.id;
    const rawParam = (req.params as any)[0] || (req.params as any).assetPath;
    const requestedPath = rawParam || req.path.replace(new RegExp(`^/storage/projects/${projectId}/`), '');

    if (!requestedPath || requestedPath.includes('\0')) {
      return sendError(res, 400, 'Invalid asset path', 'INVALID_ASSET_PATH');
    }

    // Block internal state, configuration, and ephemeral temp directories
    const normalized = requestedPath.replace(/^[/\\]+/, '').toLowerCase();
    if (
      normalized.endsWith('.json') ||
      normalized.startsWith('temp/') ||
      normalized.startsWith('temp\\') ||
      normalized.startsWith('versions/') ||
      normalized.startsWith('versions\\') ||
      normalized.includes('.env') ||
      normalized.startsWith('.')
    ) {
      return sendError(
        res,
        403,
        'Direct access to internal project configuration or temporary files is forbidden',
        'FORBIDDEN_FILE_ACCESS'
      );
    }

    const resolved = assetStore.resolveAssetPath(projectId, requestedPath);
    if (!resolved) {
      // Backward-compatibility check for legacy root files (video.mp4, thumbnail.png, subtitles.srt)
      const projectDir = getProjectDir(projectId);
      try {
        const safeRootPath = pathValidation.resolveSafePath(projectDir, requestedPath);
        if (fs.existsSync(safeRootPath) && !requestedPath.endsWith('.json')) {
          const ext = path.extname(safeRootPath).toLowerCase();
          const mime =
            ext === '.mp4'
              ? 'video/mp4'
              : ext === '.png'
              ? 'image/png'
              : ext === '.wav'
              ? 'audio/wav'
              : ext === '.srt'
              ? 'text/plain; charset=utf-8'
              : 'application/octet-stream';
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.type(mime);
          return res.sendFile(safeRootPath);
        }
      } catch {
        return sendError(res, 403, 'Forbidden path access', 'PATH_TRAVERSAL_REJECTED');
      }
      return sendError(res, 404, 'Asset not found', 'ASSET_NOT_FOUND');
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(resolved.mimeType);
    res.sendFile(resolved.absolutePath);
  });

  // --- API Routes ---

  // System Status Check
  app.get('/api/status', async (req, res) => {
    const ffmpegOk = await checkFfmpegInstalled();
    const apiKeyOk = hasApiKey();
    const all = getAllProjects();
    const storageDir = path.join(process.cwd(), 'storage');
    res.json({
      hasGeminiKey: apiKeyOk,
      hasFfmpeg: ffmpegOk,
      storagePath: storageDir,
      activeProjectsCount: all.length,
    });
  });

  // Helper: Assemble video clips, subtitles, and thumbnail
  async function assembleProjectVideo(project: VideoProject): Promise<VideoProject> {
    if (!project.scenes || project.scenes.length === 0) {
      throw new Error('No scenes to assemble');
    }

    const projectDir = getProjectDir(project.id);
    const scenesDir = path.join(projectDir, 'scenes');
    const audioDir = path.join(projectDir, 'audio');

    project.status = 'generating';
    project.currentStage = 'assembly';
    project.renderProgress = 10;
    project.renderLogs = project.renderLogs || [];
    project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Starting FFmpeg video rendering pipeline...`);
    saveProject(project);

    // Verify each scene has image and audio; generate fallbacks if missing
    for (let i = 0; i < project.scenes.length; i++) {
      const imgPath = path.join(scenesDir, `scene_${i}.png`);
      if (!fs.existsSync(imgPath)) {
        project.renderLogs.push(`Generating visual for scene ${i + 1}...`);
        project.scenes[i].imageUrl = await generateSceneImage(project, i, imgPath);
      }

      const audioPath = path.join(audioDir, `scene_${i}.wav`);
      if (!fs.existsSync(audioPath)) {
        project.renderLogs.push(`Generating voiceover for scene ${i + 1}...`);
        const resAudio = await generateSceneVoiceover(project, i, audioPath, project.voice);
        project.scenes[i].audioUrl = resAudio.audioUrl;
        project.scenes[i].actualDurationSeconds = resAudio.duration;
      }
    }

    const tempDir = path.join(projectDir, 'temp');
    const rendersDir = path.join(projectDir, 'renders');
    const thumbnailsDir = path.join(projectDir, 'thumbnails');
    const captionsDir = path.join(projectDir, 'captions');

    const clipPaths: string[] = [];
    const rawConcatVideoPath = path.join(tempDir, `full_video_raw_${Date.now()}.mp4`);

    try {
      // Step 1: Render individual scene clips with dynamic Ken Burns motion into temp/
      for (let i = 0; i < project.scenes.length; i++) {
        const scene = project.scenes[i];
        const imgPath = path.join(scenesDir, `scene_${i}.png`);
        const audioPath = path.join(audioDir, `scene_${i}.wav`);
        const clipPath = path.join(tempDir, `scene_clip_${i}_${Date.now()}.mp4`);

        const duration = scene.actualDurationSeconds || scene.estimatedDurationSeconds || 5.0;

        project.renderLogs.push(`[FFmpeg] Rendering Scene ${i + 1}/${project.scenes.length} clip with dynamic motion...`);
        project.renderProgress = Math.round(15 + (i / project.scenes.length) * 45);
        saveProject(project);

        await createSceneClip(
          imgPath,
          audioPath,
          clipPath,
          duration,
          project.aspectRatio,
          i,
          scene.onScreenText
        );
        clipPaths.push(clipPath);
      }

      // Step 2: Concatenate scene clips
      project.renderLogs.push(`[FFmpeg] Concatenating ${clipPaths.length} scene clips into master timeline...`);
      project.renderProgress = 70;
      saveProject(project);

      await concatenateSceneClips(clipPaths, rawConcatVideoPath, tempDir);

      // Step 3: Generate synchronized Subtitles in captions/ and root
      const srtPathCanonical = path.join(captionsDir, 'subtitles.srt');
      const srtPathRoot = path.join(projectDir, 'subtitles.srt');
      generateSrtSubtitles(project.scenes, srtPathCanonical);
      try {
        fs.copyFileSync(srtPathCanonical, srtPathRoot);
      } catch {
        // Non-fatal
      }

      // Step 4: Burn-in subtitles into renders/video.mp4 and root video.mp4
      project.renderLogs.push(`[FFmpeg] Applying styled subtitles and final encoding...`);
      project.renderProgress = 85;
      saveProject(project);

      const finalVideoPathCanonical = path.join(rendersDir, 'video.mp4');
      const finalVideoPathRoot = path.join(projectDir, 'video.mp4');
      await burnSubtitles(rawConcatVideoPath, srtPathCanonical, finalVideoPathCanonical, tempDir, (warnMsg) => {
        project.renderLogs = project.renderLogs || [];
        project.renderLogs.push(`[Notice] ${warnMsg}`);
        saveProject(project);
      });
      try {
        fs.copyFileSync(finalVideoPathCanonical, finalVideoPathRoot);
      } catch {
        // Non-fatal
      }

      // Step 5: Generate YouTube Thumbnail in thumbnails/ and root
      const firstImg = path.join(scenesDir, 'scene_0.png');
      const thumbPathCanonical = path.join(thumbnailsDir, 'thumbnail.png');
      const thumbPathRoot = path.join(projectDir, 'thumbnail.png');
      if (fs.existsSync(firstImg)) {
        await createThumbnail(firstImg, thumbPathCanonical, project.aspectRatio);
        try {
          fs.copyFileSync(thumbPathCanonical, thumbPathRoot);
        } catch {
          // Non-fatal
        }
        project.thumbnailUrl = `/storage/projects/${project.id}/thumbnail.png?t=${Date.now()}`;
      }

      project.finalVideoUrl = `/storage/projects/${project.id}/video.mp4?t=${Date.now()}`;
      project.renderProgress = 100;
      project.currentStage = 'completed';
      project.status = 'ready';
      project.errorMessage = undefined;
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Video successfully rendered! Ready for YouTube upload.`);

      // Sync and catalog assets
      assetStore.scanAndSyncAssets(project.id);
      saveProject(project);

      return project;
    } finally {
      // Guaranteed cleanup of temp files in temp/ directory
      tempManager.cleanupProjectTemp(project.id);
    }
  }

  // Get all projects
  app.get('/api/projects', validateQuery(ProjectListQuerySchema), (req, res) => {
    let projects = getAllProjects();
    const query = req.query as { status?: string; limit?: number };
    if (query.status) {
      projects = projects.filter((p) => p.status === query.status);
    }
    if (query.limit && query.limit > 0) {
      projects = projects.slice(0, query.limit);
    }
    sendSuccess(res, projects);
  });

  // Create new project
  app.post('/api/projects', validateBody(ProjectCreateSchema), (req, res) => {
    const { topic, aspectRatio, tone, visualStyle, voice, targetDurationMinutes } = req.body;

    const id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newProject: VideoProject = {
      id,
      title: topic.slice(0, 60),
      topic,
      aspectRatio,
      tone,
      visualStyle,
      voice,
      targetDurationMinutes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentStage: 'topic',
      status: 'draft',
      scenes: [],
      renderLogs: [`Project created: "${topic}"`],
    };

    saveProject(newProject);
    sendSuccess(res, newProject, 201);
  });

  // Get single project
  app.get('/api/projects/:id', validateParams(ProjectIdParamSchema), (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    }
    sendSuccess(res, project);
  });

  // Delete project
  app.delete('/api/projects/:id', validateParams(ProjectIdParamSchema), (req, res) => {
    const success = deleteProject(req.params.id);
    if (!success) {
      return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    }
    sendSuccess(res, { success: true });
  });

  // Update project settings or manual edits (Whitelisted & Strict: No arbitrary mutation, no status tampering)
  app.patch(
    '/api/projects/:id',
    validateParams(ProjectIdParamSchema),
    validateBody(ProjectUpdateSchema),
    (req, res) => {
      const project = getProject(req.params.id);
      if (!project) {
        return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
      }

      const updatedProject = applyWhitelistedProjectUpdates(project, req.body);
      saveProject(updatedProject);
      sendSuccess(res, updatedProject);
    }
  );

  // Asset Catalog: Retrieve catalog of all registered project media assets
  app.get('/api/projects/:id/assets', validateParams(ProjectIdParamSchema), (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    const assets = assetStore.getAssets(project.id);
    sendSuccess(res, assets);
  });

  // Version Store: List all saved version snapshots for a project
  app.get('/api/projects/:id/versions', validateParams(ProjectIdParamSchema), (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    const snapshots = versionStore.listSnapshots(project.id);
    sendSuccess(res, snapshots);
  });

  // Version Store: Create on-demand version snapshot
  app.post(
    '/api/projects/:id/versions',
    validateParams(ProjectIdParamSchema),
    validateBody(CreateVersionBodySchema),
    (req, res) => {
      const project = getProject(req.params.id);
      if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
      const { label, description } = req.body;
      const snapshot = versionStore.createSnapshot(project.id, label, description);
      sendSuccess(res, snapshot, 201);
    }
  );

  // Version Store: Restore project from a snapshot
  app.post(
    '/api/projects/:id/versions/:versionId/restore',
    validateParams(VersionParamSchema),
    (req, res) => {
      const project = getProject(req.params.id);
      if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
      try {
        const restored = versionStore.restoreSnapshot(project.id, req.params.versionId);
        sendSuccess(res, restored);
      } catch (err: any) {
        sendError(res, 404, err?.message || 'Failed to restore snapshot', 'SNAPSHOT_NOT_FOUND');
      }
    }
  );

  // Stage 0: Research (Dedicated Stage before Scripting)
  app.get('/api/projects/:id/research', validateParams(ProjectIdParamSchema), (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

    const research = projectStore.readProjectModular<ResearchResult>(project.id, 'research');
    sendSuccess(res, {
      research,
      researchStatus: project.researchStatus || research?.status || 'draft',
      userProvidedSources: project.userProvidedSources || '',
      userResearchNotes: project.userResearchNotes || '',
    });
  });

  // Stage 0: Generate or refresh structured research dossier
  app.post('/api/projects/:id/generate-research', validateParams(ProjectIdParamSchema), async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

    try {
      project.status = 'generating';
      project.currentStage = 'research';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Compiling structured research dossier for "${project.topic}"...`);
      saveProject(project);

      const research = await generateTopicResearch({
        topic: project.topic,
        tone: project.tone,
        targetDurationMinutes: project.targetDurationMinutes,
        userProvidedSources: project.userProvidedSources,
        userResearchNotes: project.userResearchNotes,
      });

      // Save research separately from script in research.json
      projectStore.saveProjectModular(project.id, 'research', research);

      project.researchStatus = research.status || 'needs_review';
      project.researchSummary = research.summary;
      project.status = 'ready';
      project.renderLogs.push(
        `[${new Date().toLocaleTimeString()}] Research compiled: ${research.facts?.length || 0} facts, ${research.claims?.length || 0} claims, ${research.uncertaintyFlags?.length || 0} uncertainties flagged.`
      );
      saveProject(project);

      sendSuccess(res, { project, research });
    } catch (err: any) {
      console.error('Error generating research:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Failed to generate research';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[Error] Research generation failed: ${project.errorMessage}`);
      saveProject(project);
      sendError(res, 500, project.errorMessage || 'Failed to generate research', 'RESEARCH_GEN_FAILED', { project });
    }
  });

  // Stage 0: Edit/update research notes, claims, verification statuses before scripting
  app.put('/api/projects/:id/research', validateParams(ProjectIdParamSchema), async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

    try {
      const parsed = ResearchResultSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, 'Invalid research object schema', 'INVALID_RESEARCH_PAYLOAD', parsed.error);
      }

      const updatedResearch = parsed.data;
      updatedResearch.updatedAt = new Date().toISOString();

      // Store research separately from script in modular research.json
      projectStore.saveProjectModular(project.id, 'research', updatedResearch);

      project.researchStatus = updatedResearch.status || project.researchStatus || 'needs_review';
      project.researchSummary = updatedResearch.summary || project.researchSummary;
      if (typeof updatedResearch.userNotes === 'string') {
        project.userResearchNotes = updatedResearch.userNotes;
      }
      if (typeof updatedResearch.userProvidedSources === 'string') {
        project.userProvidedSources = updatedResearch.userProvidedSources;
      }

      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Research dossier updated and saved.`);
      saveProject(project);

      sendSuccess(res, { project, research: updatedResearch });
    } catch (err: any) {
      sendError(res, 500, err?.message || 'Failed to update research notes', 'RESEARCH_UPDATE_FAILED');
    }
  });

  // Stage 0: Approve research dossier before scripting
  app.post('/api/projects/:id/research/approve', validateParams(ProjectIdParamSchema), async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

    let research = projectStore.readProjectModular<any>(project.id, 'research');
    if (!research) {
      research = await generateTopicResearch({
        topic: project.topic,
        tone: project.tone,
        targetDurationMinutes: project.targetDurationMinutes,
        userProvidedSources: project.userProvidedSources,
        userResearchNotes: project.userResearchNotes,
      });
    }

    research.status = 'approved';
    research.approvedAt = new Date().toISOString();
    projectStore.saveProjectModular(project.id, 'research', research);

    project.researchStatus = 'approved';
    project.renderLogs = project.renderLogs || [];
    project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Research brief approved for script generation.`);
    saveProject(project);

    sendSuccess(res, { project, research });
  });

  // Stage 1: Generate Script & Scene Plan (uses approved research object rather than raw topic alone)
  app.post('/api/projects/:id/generate-script', validateParams(ProjectIdParamSchema), async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

    try {
      project.status = 'generating';
      project.currentStage = 'script';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Generating script and storyboard with Gemini 3.8 Flash...`);
      saveProject(project);

      // Load approved or reviewed research object
      const research = projectStore.readProjectModular<any>(project.id, 'research');

      const result = await generateScriptAndScenes({
        topic: project.topic,
        tone: project.tone,
        visualStyle: project.visualStyle,
        aspectRatio: project.aspectRatio,
        targetDurationMinutes: project.targetDurationMinutes,
        research,
      });

      project.title = result.title;
      project.script = result.script;
      project.youtubeMetadata = result.youtubeMetadata;
      project.scenes = result.scenes;
      project.currentStage = 'scenes';
      project.status = 'ready';
      project.errorMessage = undefined;
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Script generated with ${result.scenes.length} planned scenes.`);
      saveProject(project);

      sendSuccess(res, project);
    } catch (err: any) {
      console.error('Error generating script:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Failed to generate script';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[Error] Script generation failed: ${project.errorMessage}`);
      saveProject(project);
      sendError(res, 500, project.errorMessage || 'Failed to generate script', 'SCRIPT_GEN_FAILED', { project });
    }
  });

  // Stage 2: Generate All Visuals
  app.post('/api/projects/:id/generate-images', validateParams(ProjectIdParamSchema), async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    if (!project.scenes || project.scenes.length === 0) {
      return sendError(res, 400, 'No scenes found. Generate script first.', 'NO_SCENES');
    }

    const projectDir = getProjectDir(project.id);
    const scenesDir = path.join(projectDir, 'scenes');

    try {
      project.status = 'generating';
      project.currentStage = 'visuals';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Starting visual generation for ${project.scenes.length} scenes...`);
      saveProject(project);

      for (let i = 0; i < project.scenes.length; i++) {
        const scene = project.scenes[i];
        scene.isGeneratingImage = true;
        saveProject(project);

        const imgPath = path.join(scenesDir, `scene_${i}.png`);
        const imgUrl = await generateSceneImage(project, i, imgPath);

        scene.imageUrl = imgUrl;
        scene.isGeneratingImage = false;
        scene.status = 'ready';
        project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Scene ${i + 1}/${project.scenes.length} image generated.`);
        saveProject(project);
      }

      project.thumbnailUrl = project.scenes[0]?.imageUrl;
      project.currentStage = 'visuals';
      project.status = 'ready';
      project.errorMessage = undefined;
      saveProject(project);

      sendSuccess(res, project);
    } catch (err: any) {
      console.error('Error generating images:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Failed to generate visual assets';
      saveProject(project);
      sendError(res, 500, project.errorMessage || 'Failed to generate visual assets', 'IMAGE_GEN_FAILED', { project });
    }
  });

  // Regenerate a single scene image (with optional edited prompt)
  app.post(
    '/api/projects/:id/scenes/:sceneIndex/regenerate-image',
    validateParams(SceneParamSchema),
    validateBody(RegenerateImageBodySchema),
    async (req, res) => {
      const { id, sceneIndex } = req.params as unknown as { id: string; sceneIndex: number };
      const project = getProject(id);
      if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

      if (!project.scenes || sceneIndex >= project.scenes.length) {
        return sendError(res, 400, `Scene index ${sceneIndex} out of bounds (max: ${project.scenes?.length ? project.scenes.length - 1 : 0})`, 'INVALID_SCENE_INDEX');
      }
      const scene = project.scenes[sceneIndex];

      const { prompt } = req.body as { prompt?: string };
      if (prompt) {
        scene.imagePrompt = prompt;
      }

      const projectDir = getProjectDir(project.id);
      const scenesDir = path.join(projectDir, 'scenes');
      const imgPath = path.join(scenesDir, `scene_${sceneIndex}.png`);

      try {
        scene.isGeneratingImage = true;
        saveProject(project);

        const imgUrl = await generateSceneImage(project, sceneIndex, imgPath, prompt);
        scene.imageUrl = imgUrl;
        scene.isGeneratingImage = false;
        project.renderLogs = project.renderLogs || [];
        project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Regenerated image for Scene ${sceneIndex + 1}.`);
        saveProject(project);

        sendSuccess(res, { project, scene });
      } catch (err: any) {
        scene.isGeneratingImage = false;
        saveProject(project);
        sendError(res, 500, err?.message || 'Failed to regenerate image', 'IMAGE_REGEN_FAILED');
      }
    }
  );

  // Stage 3: Generate Voiceover Narration (Google TTS)
  app.post('/api/projects/:id/generate-voiceover', validateParams(ProjectIdParamSchema), async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    if (!project.scenes || project.scenes.length === 0) {
      return sendError(res, 400, 'No scenes found', 'NO_SCENES');
    }

    const projectDir = getProjectDir(project.id);
    const audioDir = path.join(projectDir, 'audio');

    try {
      project.status = 'generating';
      project.currentStage = 'voiceover';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Synthesizing narration with Google TTS voice "${project.voice}"...`);
      saveProject(project);

      let totalDuration = 0;

      for (let i = 0; i < project.scenes.length; i++) {
        const scene = project.scenes[i];
        scene.isGeneratingAudio = true;
        saveProject(project);

        const wavPath = path.join(audioDir, `scene_${i}.wav`);
        const { audioUrl, duration } = await generateSceneVoiceover(project, i, wavPath, project.voice);

        scene.audioUrl = audioUrl;
        scene.actualDurationSeconds = duration;
        scene.isGeneratingAudio = false;
        totalDuration += duration;
        project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Scene ${i + 1}/${project.scenes.length} audio synthesized (${duration}s).`);
        saveProject(project);
      }

      project.totalDurationSeconds = Math.round(totalDuration * 10) / 10;
      project.currentStage = 'voiceover';
      project.status = 'ready';
      project.errorMessage = undefined;
      saveProject(project);

      sendSuccess(res, project);
    } catch (err: any) {
      console.error('Error generating voiceover:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Failed to generate voiceover';
      saveProject(project);
      sendError(res, 500, project.errorMessage || 'Failed to generate voiceover', 'VOICEOVER_GEN_FAILED', { project });
    }
  });

  // Regenerate voiceover for a single scene
  app.post(
    '/api/projects/:id/scenes/:sceneIndex/regenerate-audio',
    validateParams(SceneParamSchema),
    validateBody(RegenerateAudioBodySchema),
    async (req, res) => {
      const { id, sceneIndex } = req.params as unknown as { id: string; sceneIndex: number };
      const project = getProject(id);
      if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

      if (!project.scenes || sceneIndex >= project.scenes.length) {
        return sendError(res, 400, `Scene index ${sceneIndex} out of bounds (max: ${project.scenes?.length ? project.scenes.length - 1 : 0})`, 'INVALID_SCENE_INDEX');
      }
      const scene = project.scenes[sceneIndex];

      const { narration, voice } = req.body as { narration?: string; voice?: import('./src/types.js').VoiceName };
      if (narration) scene.narration = narration;
      if (voice) project.voice = voice;

      const projectDir = getProjectDir(project.id);
      const audioDir = path.join(projectDir, 'audio');
      const wavPath = path.join(audioDir, `scene_${sceneIndex}.wav`);

      try {
        scene.isGeneratingAudio = true;
        saveProject(project);

        const { audioUrl, duration } = await generateSceneVoiceover(project, sceneIndex, wavPath, project.voice);
        scene.audioUrl = audioUrl;
        scene.actualDurationSeconds = duration;
        scene.isGeneratingAudio = false;

        // Recalculate total duration
        project.totalDurationSeconds = project.scenes.reduce(
          (sum, s) => sum + (s.actualDurationSeconds || s.estimatedDurationSeconds || 5),
          0
        );
        project.renderLogs = project.renderLogs || [];
        project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Regenerated audio for Scene ${sceneIndex + 1}.`);
        saveProject(project);

        sendSuccess(res, { project, scene });
      } catch (err: any) {
        scene.isGeneratingAudio = false;
        saveProject(project);
        sendError(res, 500, err?.message || 'Failed to regenerate audio', 'AUDIO_REGEN_FAILED');
      }
    }
  );

  // Stage 4: Video Assembly & Rendering via FFmpeg
  app.post('/api/projects/:id/assemble-video', validateParams(ProjectIdParamSchema), async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    if (!project.scenes || project.scenes.length === 0) {
      return sendError(res, 400, 'No scenes to assemble', 'NO_SCENES');
    }

    try {
      const updatedProject = await assembleProjectVideo(project);
      sendSuccess(res, updatedProject);
    } catch (err: any) {
      console.error('Error assembling video:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'FFmpeg video assembly failed';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[Error] Assembly failed: ${project.errorMessage}`);
      saveProject(project);
      sendError(res, 500, project.errorMessage || 'FFmpeg video assembly failed', 'ASSEMBLY_FAILED', { project });
    }
  });

  // ==========================================
  // Pipeline Engine & Job Architecture Routes
  // ==========================================

  // Start asynchronous pipeline job (returns immediately with 202 and jobId)
  const handlePipelineStart = (req: express.Request, res: express.Response) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

    try {
      const stages = req.body?.stages as ExplicitPipelineStage[] | undefined;
      const type = req.body?.type || 'full_pipeline';
      const job = globalPipelineEngine.startJob(project.id, { type, stages });

      // Return immediately - DO NOT hold HTTP request open
      sendSuccess(
        res,
        {
          jobId: job.id,
          status: job.status,
          stage: job.stage,
          progress: job.progress,
          job,
          project: getProject(project.id) || project,
        },
        202
      );
    } catch (err: any) {
      console.error('Error initiating pipeline job:', err);
      sendError(res, 500, err?.message || 'Failed to start pipeline job', 'PIPELINE_START_FAILED');
    }
  };

  // Primary endpoint: POST /api/projects/:id/pipeline
  app.post(
    '/api/projects/:id/pipeline',
    validateParams(ProjectIdParamSchema),
    validateBody(CreatePipelineJobBodySchema.optional()),
    handlePipelineStart
  );

  // Backward-compatible alias: POST /api/projects/:id/run-pipeline
  app.post(
    '/api/projects/:id/run-pipeline',
    validateParams(ProjectIdParamSchema),
    validateBody(CreatePipelineJobBodySchema.optional()),
    handlePipelineStart
  );

  // Backward-compatible alias: POST /api/projects/:id/generate-all
  app.post(
    '/api/projects/:id/generate-all',
    validateParams(ProjectIdParamSchema),
    validateBody(CreatePipelineJobBodySchema.optional()),
    handlePipelineStart
  );

  // Query specific job status by Job ID
  app.get('/api/jobs/:id', validateParams(JobIdParamSchema), (req, res) => {
    const job = globalPipelineEngine.getJob(req.params.id);
    if (!job) return sendError(res, 404, 'Job not found', 'JOB_NOT_FOUND');
    sendSuccess(res, job);
  });

  // Query all jobs for a project
  app.get('/api/projects/:id/jobs', validateParams(ProjectIdParamSchema), (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    const jobs = globalPipelineEngine.getJobsForProject(project.id);
    sendSuccess(res, jobs);
  });

  // Query currently active (queued/running) job for a project
  app.get('/api/projects/:id/jobs/active', validateParams(ProjectIdParamSchema), (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');
    const activeJob = globalPipelineEngine.getActiveJobForProject(project.id);
    sendSuccess(res, { activeJob });
  });

  // Cancel an active job
  app.post('/api/jobs/:id/cancel', validateParams(JobIdParamSchema), (req, res) => {
    const success = globalPipelineEngine.cancelJob(req.params.id);
    if (!success) {
      return sendError(res, 400, 'Job cannot be cancelled or is no longer active', 'JOB_NOT_CANCELLABLE');
    }
    sendSuccess(res, { cancelled: true, jobId: req.params.id });
  });

  // Pause an active job
  app.post('/api/jobs/:id/pause', validateParams(JobIdParamSchema), (req, res) => {
    const success = globalPipelineEngine.pauseJob(req.params.id);
    if (!success) {
      return sendError(res, 400, 'Job cannot be paused or is not currently running', 'JOB_NOT_PAUSABLE');
    }
    sendSuccess(res, { paused: true, jobId: req.params.id });
  });

  // Resume or retry a failed job
  app.post('/api/jobs/:id/retry-failed', validateParams(JobIdParamSchema), (req, res) => {
    try {
      const newJob = globalPipelineEngine.retryFailedJob(req.params.id);
      sendSuccess(res, { retried: true, job: newJob, jobId: newJob.id }, 202);
    } catch (err: any) {
      sendError(res, 400, err?.message || 'Failed to retry job', 'JOB_RETRY_FAILED');
    }
  });

  // Query job event stream history
  app.get('/api/jobs/:id/events', validateParams(JobIdParamSchema), (req, res) => {
    const job = globalPipelineEngine.getJob(req.params.id);
    if (!job) return sendError(res, 404, 'Job not found', 'JOB_NOT_FOUND');
    sendSuccess(res, job.state?.events || []);
  });

  // Server-Sent Events (SSE) stream for real-time job updates
  app.get('/api/jobs/:id/stream', validateParams(JobIdParamSchema), (req, res) => {
    const jobId = req.params.id;
    const job = globalPipelineEngine.getJob(jobId);
    if (!job) return sendError(res, 404, 'Job not found', 'JOB_NOT_FOUND');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Send initial snapshot so client is immediately synchronized
    res.write(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`);

    const listener = (envelope: any) => {
      if (envelope.jobId === jobId) {
        res.write(`event: ${envelope.event}\ndata: ${JSON.stringify(envelope.data || envelope)}\n\n`);
      }
    };

    globalPipelineEvents.on('sse_event', listener);

    const pingTimer = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(pingTimer);
      globalPipelineEvents.off('sse_event', listener);
    });
  });

  // Server-Sent Events (SSE) stream for real-time project pipeline updates
  app.get('/api/projects/:id/pipeline/stream', validateParams(ProjectIdParamSchema), (req, res) => {
    const projectId = req.params.id;
    const project = getProject(projectId);
    if (!project) return sendError(res, 404, 'Project not found', 'PROJECT_NOT_FOUND');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Send initial snapshot of project & active job
    const activeJob = globalPipelineEngine.getActiveJobForProject(projectId);
    res.write(`event: snapshot\ndata: ${JSON.stringify({ project, activeJob })}\n\n`);

    const listener = (envelope: any) => {
      if (envelope.projectId === projectId || (envelope.data && envelope.data.projectId === projectId)) {
        res.write(`event: ${envelope.event}\ndata: ${JSON.stringify(envelope.data || envelope)}\n\n`);
      }
    };

    globalPipelineEvents.on('sse_event', listener);

    const pingTimer = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(pingTimer);
      globalPipelineEvents.off('sse_event', listener);
    });
  });

  // Operational Control: Cancel active pipeline for project
  app.post('/api/projects/:id/pipeline/cancel', validateParams(ProjectIdParamSchema), (req, res) => {
    const activeJob = globalPipelineEngine.getActiveJobForProject(req.params.id);
    if (!activeJob) {
      return sendError(res, 400, 'No active job running for this project', 'NO_ACTIVE_JOB');
    }
    const success = globalPipelineEngine.cancelJob(activeJob.id);
    sendSuccess(res, { cancelled: success, jobId: activeJob.id });
  });

  // Operational Control: Pause active pipeline for project
  app.post('/api/projects/:id/pipeline/pause', validateParams(ProjectIdParamSchema), (req, res) => {
    const activeJob = globalPipelineEngine.getActiveJobForProject(req.params.id);
    if (!activeJob) {
      return sendError(res, 400, 'No active job running for this project', 'NO_ACTIVE_JOB');
    }
    const success = globalPipelineEngine.pauseJob(activeJob.id);
    sendSuccess(res, { paused: success, jobId: activeJob.id });
  });

  // Operational Control: Resume from last successful checkpoint
  app.post('/api/projects/:id/pipeline/resume', validateParams(ProjectIdParamSchema), (req, res) => {
    try {
      const job = globalPipelineEngine.resumeFromCheckpoint(req.params.id);
      sendSuccess(res, { resumed: true, job, jobId: job.id, project: getProject(req.params.id) }, 202);
    } catch (err: any) {
      console.error('Error resuming from checkpoint:', err);
      sendError(res, 500, err?.message || 'Failed to resume from checkpoint', 'RESUME_FAILED');
    }
  });

  // Operational Control: Retry current / failed stage
  app.post(
    '/api/projects/:id/pipeline/retry-stage',
    validateParams(ProjectIdParamSchema),
    validateBody(RetryStageBodySchema.optional()),
    (req, res) => {
      try {
        const stage = req.body?.stage as ExplicitPipelineStage | undefined;
        const job = globalPipelineEngine.retryStage(req.params.id, stage);
        sendSuccess(res, { retried: true, job, jobId: job.id, stage: job.stage }, 202);
      } catch (err: any) {
        console.error('Error retrying stage:', err);
        sendError(res, 500, err?.message || 'Failed to retry stage', 'RETRY_STAGE_FAILED');
      }
    }
  );

  // Operational Control: Restart from selected stage
  app.post(
    '/api/projects/:id/pipeline/restart',
    validateParams(ProjectIdParamSchema),
    validateBody(RestartPipelineBodySchema),
    (req, res) => {
      try {
        const stage = req.body.stage as ExplicitPipelineStage;
        const job = globalPipelineEngine.restartFromStage(req.params.id, stage);
        sendSuccess(res, { restarted: true, job, jobId: job.id, stage }, 202);
      } catch (err: any) {
        console.error('Error restarting from stage:', err);
        sendError(res, 500, err?.message || 'Failed to restart from stage', 'RESTART_FAILED');
      }
    }
  );

  // Centralized AI Configuration & Observability Routes
  app.get('/api/ai/status', (_req, res) => {
    sendSuccess(res, {
      config: getAiConfig(),
      concurrency: concurrencyManager.getStatus(),
      cacheEnabled: assetCache.isEnabled(),
      hasApiKey: hasApiKey(),
    });
  });

  app.get('/api/ai/logs', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    sendSuccess(res, {
      logs: aiLogger.getRecentLogs(limit),
    });
  });

  // Mount Vite middleware for development, static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Local AI YouTube Video Automation Pipeline running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
