import fs from 'fs';
import path from 'path';
import { Scene, VideoAspectRatio } from '../src/types.js';
import { processManager, ProcessRunOptions } from './utils/processManager.js';

export { processManager };

export function terminateJobProcesses(jobId: string): number {
  return processManager.terminateJobProcesses(jobId);
}

export async function checkFfmpegInstalled(): Promise<boolean> {
  try {
    const { stdout } = await processManager.execCancellable('ffmpeg -version');
    return stdout.includes('ffmpeg version');
  } catch {
    return false;
  }
}

export async function getAudioDuration(
  audioPath: string,
  options: ProcessRunOptions = {}
): Promise<number> {
  try {
    const { stdout } = await processManager.execCancellable(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
      options
    );
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration) || duration <= 0) {
      return 5.0; // default fallback
    }
    return Math.round(duration * 100) / 100;
  } catch (err) {
    if (options.signal?.aborted) throw err;
    console.warn(`Could not probe audio duration for ${audioPath}, using fallback.`, err);
    return 5.0;
  }
}

export async function createSceneClip(
  imagePath: string,
  audioPath: string,
  outputPath: string,
  duration: number,
  aspectRatio: VideoAspectRatio,
  sceneNumber: number,
  onScreenText?: string,
  options: ProcessRunOptions = {}
): Promise<void> {
  if (options.signal?.aborted) {
    const err = new Error('Scene clip creation aborted');
    err.name = 'AbortError';
    throw err;
  }

  const isLandscape = aspectRatio === '16:9';
  const width = isLandscape ? 1920 : 1080;
  const height = isLandscape ? 1080 : 1920;
  const safeDuration = Math.max(duration, 2.5);
  const frames = Math.round(safeDuration * 25);

  // Alternating pan/zoom effect for visual dynamism
  const zoomStyles = [
    // Zoom in slowly towards center
    `zoompan=z='min(zoom+0.0008,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=25`,
    // Zoom out slowly from 1.15 to 1.0
    `zoompan=z='max(1.15-0.0008*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=25`,
    // Pan right slowly
    `zoompan=z=1.1:x='min(x+0.8,(iw-iw/zoom))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=25`,
    // Pan left slowly
    `zoompan=z=1.1:x='max((iw-iw/zoom)-0.8*on,0)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=25`,
  ];

  const motionFilter = zoomStyles[sceneNumber % zoomStyles.length];
  const baseFilter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${motionFilter}`;

  try {
    // Attempt with motion zoompan filter
    const cmd = `ffmpeg -y -loop 1 -t ${safeDuration} -i "${imagePath}" -i "${audioPath}" -vf "${baseFilter}" -c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${outputPath}"`;
    await processManager.execCancellable(cmd, options);
  } catch (zoomErr: any) {
    if (options.signal?.aborted || zoomErr?.name === 'AbortError') {
      throw zoomErr;
    }
    console.warn(`Zoompan filter failed for scene ${sceneNumber}, falling back to static scale:`, zoomErr);
    // Fallback without zoompan if memory/image geometry issues occur
    const fallbackFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
    const fallbackCmd = `ffmpeg -y -loop 1 -t ${safeDuration} -i "${imagePath}" -i "${audioPath}" -vf "${fallbackFilter}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${outputPath}"`;
    await processManager.execCancellable(fallbackCmd, options);
  }
}

export async function concatenateSceneClips(
  clipPaths: string[],
  outputVideoPath: string,
  projectDir: string,
  options: ProcessRunOptions = {}
): Promise<void> {
  const listFilePath = path.join(projectDir, 'concat_list.txt');
  const fileContent = clipPaths.map((p) => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(listFilePath, fileContent, 'utf8');

  try {
    const cmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${outputVideoPath}"`;
    await processManager.execCancellable(cmd, { ...options, cwd: projectDir });
  } finally {
    if (fs.existsSync(listFilePath)) {
      fs.unlinkSync(listFilePath);
    }
  }
}

export function generateSrtSubtitles(scenes: Scene[], srtPath: string): void {
  let currentTimeMs = 0;
  let srtContent = '';

  scenes.forEach((scene, index) => {
    const durationMs = Math.round((scene.actualDurationSeconds || scene.estimatedDurationSeconds || 5) * 1000);
    const startMs = currentTimeMs;
    const endMs = currentTimeMs + durationMs;
    currentTimeMs = endMs;

    const formatTimestamp = (ms: number): string => {
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      const millis = ms % 1000;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
    };

    const text = (scene.onScreenText || scene.narration || '').trim();
    if (text) {
      srtContent += `${index + 1}\n`;
      srtContent += `${formatTimestamp(startMs)} --> ${formatTimestamp(endMs)}\n`;
      srtContent += `${text}\n\n`;
    }
  });

  fs.writeFileSync(srtPath, srtContent, 'utf8');
}

export async function burnSubtitles(
  inputVideoPath: string,
  srtPath: string,
  outputVideoPath: string,
  projectDir: string,
  onDegraded?: (warning: string) => void,
  options: ProcessRunOptions = {}
): Promise<void> {
  try {
    // Escape path for ffmpeg subtitles filter
    const relativeSrt = path.relative(projectDir, srtPath).replace(/\\/g, '/');
    const cmd = `ffmpeg -y -i "${inputVideoPath}" -vf "subtitles=${relativeSrt}:force_style='Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=1,MarginV=35'" -c:a copy "${outputVideoPath}"`;
    await processManager.execCancellable(cmd, { ...options, cwd: projectDir });
  } catch (err: any) {
    if (options.signal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    const warnMsg = 'Subtitle burn-in filter skipped (font library or libass unavailable); exported clean video without burned captions.';
    console.warn(warnMsg, err);
    if (onDegraded) {
      onDegraded(warnMsg);
    }
    fs.copyFileSync(inputVideoPath, outputVideoPath);
  }
}

export async function createThumbnail(
  sourceImagePath: string,
  outputThumbnailPath: string,
  aspectRatio: VideoAspectRatio,
  options: ProcessRunOptions = {}
): Promise<void> {
  const isLandscape = aspectRatio === '16:9';
  const width = isLandscape ? 1280 : 1080;
  const height = isLandscape ? 720 : 1920;
  try {
    const cmd = `ffmpeg -y -i "${sourceImagePath}" -vf "scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}" -q:v 2 "${outputThumbnailPath}"`;
    await processManager.execCancellable(cmd, options);
  } catch (err: any) {
    if (options.signal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    console.warn('Could not generate resized thumbnail, copying source image:', err);
    if (fs.existsSync(sourceImagePath)) {
      fs.copyFileSync(sourceImagePath, outputThumbnailPath);
    }
  }
}

export async function generateFallbackSceneImage(
  outputPath: string,
  sceneNumber: number,
  topic: string,
  visualDescription: string,
  aspectRatio: VideoAspectRatio,
  options: ProcessRunOptions = {}
): Promise<void> {
  const isLandscape = aspectRatio === '16:9';
  const width = isLandscape ? 1920 : 1080;
  const height = isLandscape ? 1080 : 1920;

  const palettes = [
    { bg1: '#0f172a', bg2: '#1e293b', accent: '#38bdf8' },
    { bg1: '#18181b', bg2: '#27272a', accent: '#fbbf24' },
    { bg1: '#09090b', bg2: '#1c1917', accent: '#f43f5e' },
    { bg1: '#022c22', bg2: '#064e3b', accent: '#34d399' },
    { bg1: '#172554', bg2: '#1e3a8a', accent: '#60a5fa' },
    { bg1: '#311042', bg2: '#4a044e', accent: '#f472b6' },
  ];
  const p = palettes[sceneNumber % palettes.length];

  const escapeXml = (unsafe: string) =>
    unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const safeTopic = escapeXml(topic.slice(0, 60));
  const safeDesc = escapeXml(visualDescription.slice(0, 140));

  const svgContent = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${p.bg1}" />
      <stop offset="100%" stop-color="${p.bg2}" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.25" />
      <stop offset="100%" stop-color="${p.accent}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
  <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.4}" fill="url(#glow)" />
  
  <rect x="60" y="60" width="${width - 120}" height="${height - 120}" fill="none" stroke="${p.accent}" stroke-opacity="0.2" stroke-width="2" rx="20" />
  
  <rect x="${width / 2 - 120}" y="140" width="240" height="48" rx="24" fill="${p.accent}" fill-opacity="0.15" stroke="${p.accent}" stroke-width="1.5" />
  <text x="${width / 2}" y="171" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="700" fill="${p.accent}" text-anchor="middle" letter-spacing="3">SCENE ${sceneNumber + 1}</text>
  
  <text x="${width / 2}" y="${height / 2 - 20}" font-family="system-ui, -apple-system, sans-serif" font-size="${isLandscape ? 56 : 48}" font-weight="800" fill="#ffffff" text-anchor="middle">
    ${safeTopic}
  </text>
  
  <text x="${width / 2}" y="${height / 2 + 50}" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#cbd5e1" text-anchor="middle" font-weight="400">
    ${safeDesc}
  </text>
</svg>
  `;

  const svgPath = outputPath.replace(/\.png$/, '.svg');
  fs.writeFileSync(svgPath, svgContent, 'utf8');

  try {
    await processManager.execCancellable(`ffmpeg -y -i "${svgPath}" "${outputPath}"`, options);
    if (fs.existsSync(svgPath)) {
      fs.unlinkSync(svgPath);
    }
  } catch (err: any) {
    if (options.signal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    console.error('Failed to convert SVG to PNG with ffmpeg, saving raw SVG:', err);
  }
}

export async function generateFallbackAudio(
  outputPath: string,
  durationSeconds: number,
  text: string,
  options: ProcessRunOptions = {}
): Promise<void> {
  const duration = Math.max(durationSeconds || 4, 3);
  try {
    const googleTTSUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 150))}&tl=en&client=tw-ob`;
    const tempMp3 = outputPath.replace(/\.wav$/, '_temp.mp3');
    
    const res = await fetch(googleTTSUrl, {
      signal: options.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (res.ok) {
      const arrayBuf = await res.arrayBuffer();
      fs.writeFileSync(tempMp3, Buffer.from(arrayBuf));
      await processManager.execCancellable(`ffmpeg -y -i "${tempMp3}" -ar 24000 -ac 1 "${outputPath}"`, options);
      if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
      return;
    }
  } catch (fetchErr: any) {
    if (options.signal?.aborted || fetchErr?.name === 'AbortError') {
      throw fetchErr;
    }
    console.warn('Google Translate TTS endpoint fallback failed, synthesizing audio tone via FFmpeg:', fetchErr);
  }

  try {
    const cmd = `ffmpeg -y -f lavfi -i "sine=frequency=440:duration=${duration}" -af "volume=0.2" -ar 24000 -ac 1 "${outputPath}"`;
    await processManager.execCancellable(cmd, options);
  } catch (err: any) {
    if (options.signal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    console.error('Failed to generate fallback audio:', err);
  }
}
