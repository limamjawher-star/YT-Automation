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
  hasApiKey,
} from './server/gemini.js';
import {
  deleteProject,
  getAllProjects,
  getProject,
  getProjectDir,
  saveProject,
} from './server/storage.js';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Static storage for project assets (audio, images, videos, thumbnails)
  const storageDir = path.join(process.cwd(), 'storage');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  app.use('/storage', express.static(storageDir));

  // --- API Routes ---

  // System Status Check
  app.get('/api/status', async (req, res) => {
    const ffmpegOk = await checkFfmpegInstalled();
    const apiKeyOk = hasApiKey();
    const all = getAllProjects();
    res.json({
      hasGeminiKey: apiKeyOk,
      hasFfmpeg: ffmpegOk,
      storagePath: storageDir,
      activeProjectsCount: all.length,
    });
  });

  // Get all projects
  app.get('/api/projects', (req, res) => {
    const projects = getAllProjects();
    res.json(projects);
  });

  // Create new project
  app.post('/api/projects', (req, res) => {
    const { topic, aspectRatio, tone, visualStyle, voice, targetDurationMinutes } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    const id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newProject: VideoProject = {
      id,
      title: topic.slice(0, 60),
      topic,
      aspectRatio: aspectRatio || '16:9',
      tone: tone || 'Engaging & Fast-Paced',
      visualStyle: visualStyle || 'Cinematic Photorealism',
      voice: voice || 'Kore',
      targetDurationMinutes: Number(targetDurationMinutes) || 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentStage: 'topic',
      status: 'draft',
      scenes: [],
      renderLogs: [`Project created: "${topic}"`],
    };

    saveProject(newProject);
    res.json(newProject);
  });

  // Get single project
  app.get('/api/projects/:id', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  });

  // Delete project
  app.delete('/api/projects/:id', (req, res) => {
    const success = deleteProject(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json({ success: true });
  });

  // Update project settings or manual edits
  app.patch('/api/projects/:id', (req, res) => {
    const project = getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    Object.assign(project, req.body, { updatedAt: new Date().toISOString() });
    saveProject(project);
    res.json(project);
  });

  // Stage 1: Generate Script & Scene Plan
  app.post('/api/projects/:id/generate-script', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    try {
      project.status = 'generating';
      project.currentStage = 'script';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Generating script and storyboard with Gemini 3.8 Flash...`);
      saveProject(project);

      const result = await generateScriptAndScenes({
        topic: project.topic,
        tone: project.tone,
        visualStyle: project.visualStyle,
        aspectRatio: project.aspectRatio,
        targetDurationMinutes: project.targetDurationMinutes,
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

      res.json(project);
    } catch (err: any) {
      console.error('Error generating script:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Failed to generate script';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[Error] Script generation failed: ${project.errorMessage}`);
      saveProject(project);
      res.status(500).json({ error: project.errorMessage, project });
    }
  });

  // Stage 2: Generate All Visuals
  app.post('/api/projects/:id/generate-images', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.scenes || project.scenes.length === 0) {
      return res.status(400).json({ error: 'No scenes found. Generate script first.' });
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

      res.json(project);
    } catch (err: any) {
      console.error('Error generating images:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Failed to generate visual assets';
      saveProject(project);
      res.status(500).json({ error: project.errorMessage, project });
    }
  });

  // Regenerate a single scene image (with optional edited prompt)
  app.post('/api/projects/:id/scenes/:sceneIndex/regenerate-image', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const sceneIndex = parseInt(req.params.sceneIndex, 10);
    const scene = project.scenes[sceneIndex];
    if (!scene) return res.status(404).json({ error: 'Scene not found' });

    const { prompt } = req.body;
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

      res.json({ project, scene });
    } catch (err: any) {
      scene.isGeneratingImage = false;
      saveProject(project);
      res.status(500).json({ error: err?.message || 'Failed to regenerate image' });
    }
  });

  // Stage 3: Generate Voiceover Narration (Google TTS)
  app.post('/api/projects/:id/generate-voiceover', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.scenes || project.scenes.length === 0) {
      return res.status(400).json({ error: 'No scenes found' });
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

      res.json(project);
    } catch (err: any) {
      console.error('Error generating voiceover:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Failed to generate voiceover';
      saveProject(project);
      res.status(500).json({ error: project.errorMessage, project });
    }
  });

  // Regenerate voiceover for a single scene
  app.post('/api/projects/:id/scenes/:sceneIndex/regenerate-audio', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const sceneIndex = parseInt(req.params.sceneIndex, 10);
    const scene = project.scenes[sceneIndex];
    if (!scene) return res.status(404).json({ error: 'Scene not found' });

    const { narration, voice } = req.body;
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

      res.json({ project, scene });
    } catch (err: any) {
      scene.isGeneratingAudio = false;
      saveProject(project);
      res.status(500).json({ error: err?.message || 'Failed to regenerate audio' });
    }
  });

  // Stage 4: Video Assembly & Rendering via FFmpeg
  app.post('/api/projects/:id/assemble-video', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.scenes || project.scenes.length === 0) {
      return res.status(400).json({ error: 'No scenes to assemble' });
    }

    const projectDir = getProjectDir(project.id);
    const scenesDir = path.join(projectDir, 'scenes');
    const audioDir = path.join(projectDir, 'audio');

    try {
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

      // Step 1: Render individual scene clips with dynamic Ken Burns motion
      const clipPaths: string[] = [];
      for (let i = 0; i < project.scenes.length; i++) {
        const scene = project.scenes[i];
        const imgPath = path.join(scenesDir, `scene_${i}.png`);
        const audioPath = path.join(audioDir, `scene_${i}.wav`);
        const clipPath = path.join(projectDir, `scene_clip_${i}.mp4`);

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

      const rawConcatVideoPath = path.join(projectDir, 'full_video_raw.mp4');
      await concatenateSceneClips(clipPaths, rawConcatVideoPath, projectDir);

      // Step 3: Generate synchronized Subtitles
      const srtPath = path.join(projectDir, 'subtitles.srt');
      generateSrtSubtitles(project.scenes, srtPath);

      // Step 4: Burn-in subtitles (or produce final video)
      project.renderLogs.push(`[FFmpeg] Applying styled subtitles and final encoding...`);
      project.renderProgress = 85;
      saveProject(project);

      const finalVideoPath = path.join(projectDir, 'video.mp4');
      await burnSubtitles(rawConcatVideoPath, srtPath, finalVideoPath, projectDir);

      // Step 5: Generate YouTube Thumbnail
      const firstImg = path.join(scenesDir, 'scene_0.png');
      const thumbPath = path.join(projectDir, 'thumbnail.png');
      if (fs.existsSync(firstImg)) {
        await createThumbnail(firstImg, thumbPath, project.aspectRatio);
        project.thumbnailUrl = `/storage/projects/${project.id}/thumbnail.png?t=${Date.now()}`;
      }

      // Cleanup temporary clips
      for (const cp of clipPaths) {
        if (fs.existsSync(cp)) fs.unlinkSync(cp);
      }
      if (fs.existsSync(rawConcatVideoPath)) fs.unlinkSync(rawConcatVideoPath);

      project.finalVideoUrl = `/storage/projects/${project.id}/video.mp4?t=${Date.now()}`;
      project.renderProgress = 100;
      project.currentStage = 'completed';
      project.status = 'ready';
      project.errorMessage = undefined;
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Video successfully rendered! Ready for YouTube upload.`);
      saveProject(project);

      res.json(project);
    } catch (err: any) {
      console.error('Error assembling video:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'FFmpeg video assembly failed';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[Error] Assembly failed: ${project.errorMessage}`);
      saveProject(project);
      res.status(500).json({ error: project.errorMessage, project });
    }
  });

  // Complete One-Click Automated Pipeline: Run all stages sequentially
  app.post('/api/projects/:id/run-pipeline', async (req, res) => {
    const project = getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    try {
      project.status = 'generating';
      project.errorMessage = undefined;
      project.renderLogs = [`[${new Date().toLocaleTimeString()}] Initiating Full Automated Pipeline...`];
      saveProject(project);

      // Stage 1: Script
      project.currentStage = 'script';
      project.renderProgress = 10;
      project.renderLogs.push('Stage 1/4: Generating script and storyboard with Gemini...');
      saveProject(project);

      const scriptRes = await generateScriptAndScenes({
        topic: project.topic,
        tone: project.tone,
        visualStyle: project.visualStyle,
        aspectRatio: project.aspectRatio,
        targetDurationMinutes: project.targetDurationMinutes,
      });

      project.title = scriptRes.title;
      project.script = scriptRes.script;
      project.youtubeMetadata = scriptRes.youtubeMetadata;
      project.scenes = scriptRes.scenes;
      project.renderLogs.push(`Stage 1 Complete: Generated ${project.scenes.length} scenes.`);
      saveProject(project);

      // Stage 2: Visuals
      project.currentStage = 'visuals';
      project.renderProgress = 30;
      project.renderLogs.push('Stage 2/4: Generating scene visuals with Google Imagen / Gemini...');
      saveProject(project);

      const projectDir = getProjectDir(project.id);
      const scenesDir = path.join(projectDir, 'scenes');
      for (let i = 0; i < project.scenes.length; i++) {
        const imgPath = path.join(scenesDir, `scene_${i}.png`);
        const imgUrl = await generateSceneImage(project, i, imgPath);
        project.scenes[i].imageUrl = imgUrl;
        project.scenes[i].status = 'ready';
        saveProject(project);
      }
      project.thumbnailUrl = project.scenes[0]?.imageUrl;
      project.renderLogs.push(`Stage 2 Complete: Visuals generated.`);
      saveProject(project);

      // Stage 3: Voiceover (TTS)
      project.currentStage = 'voiceover';
      project.renderProgress = 55;
      project.renderLogs.push(`Stage 3/4: Generating voiceover narration with Google TTS ("${project.voice}")...`);
      saveProject(project);

      const audioDir = path.join(projectDir, 'audio');
      let totalDuration = 0;
      for (let i = 0; i < project.scenes.length; i++) {
        const wavPath = path.join(audioDir, `scene_${i}.wav`);
        const { audioUrl, duration } = await generateSceneVoiceover(project, i, wavPath, project.voice);
        project.scenes[i].audioUrl = audioUrl;
        project.scenes[i].actualDurationSeconds = duration;
        totalDuration += duration;
        saveProject(project);
      }
      project.totalDurationSeconds = Math.round(totalDuration * 10) / 10;
      project.renderLogs.push(`Stage 3 Complete: Audio synthesized (${project.totalDurationSeconds}s total).`);
      saveProject(project);

      // Stage 4: FFmpeg Assembly
      project.currentStage = 'assembly';
      project.renderProgress = 75;
      project.renderLogs.push('Stage 4/4: Assembling video with FFmpeg, motion effects, and subtitles...');
      saveProject(project);

      const clipPaths: string[] = [];
      for (let i = 0; i < project.scenes.length; i++) {
        const scene = project.scenes[i];
        const imgPath = path.join(scenesDir, `scene_${i}.png`);
        const audioPath = path.join(audioDir, `scene_${i}.wav`);
        const clipPath = path.join(projectDir, `scene_clip_${i}.mp4`);
        const duration = scene.actualDurationSeconds || 5.0;

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

      const rawConcatVideoPath = path.join(projectDir, 'full_video_raw.mp4');
      await concatenateSceneClips(clipPaths, rawConcatVideoPath, projectDir);

      const srtPath = path.join(projectDir, 'subtitles.srt');
      generateSrtSubtitles(project.scenes, srtPath);

      const finalVideoPath = path.join(projectDir, 'video.mp4');
      await burnSubtitles(rawConcatVideoPath, srtPath, finalVideoPath, projectDir);

      const firstImg = path.join(scenesDir, 'scene_0.png');
      const thumbPath = path.join(projectDir, 'thumbnail.png');
      if (fs.existsSync(firstImg)) {
        await createThumbnail(firstImg, thumbPath, project.aspectRatio);
        project.thumbnailUrl = `/storage/projects/${project.id}/thumbnail.png?t=${Date.now()}`;
      }

      // Cleanup temp clips
      for (const cp of clipPaths) {
        if (fs.existsSync(cp)) fs.unlinkSync(cp);
      }
      if (fs.existsSync(rawConcatVideoPath)) fs.unlinkSync(rawConcatVideoPath);

      project.finalVideoUrl = `/storage/projects/${project.id}/video.mp4?t=${Date.now()}`;
      project.renderProgress = 100;
      project.currentStage = 'completed';
      project.status = 'ready';
      project.renderLogs.push(`[${new Date().toLocaleTimeString()}] Pipeline completed! Video ready for YouTube.`);
      saveProject(project);

      res.json(project);
    } catch (err: any) {
      console.error('Error running full pipeline:', err);
      project.status = 'error';
      project.errorMessage = err?.message || 'Pipeline failed';
      project.renderLogs = project.renderLogs || [];
      project.renderLogs.push(`[Error] Pipeline failed: ${project.errorMessage}`);
      saveProject(project);
      res.status(500).json({ error: project.errorMessage, project });
    }
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
