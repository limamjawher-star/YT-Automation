import { GoogleGenAI, Modality, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { Scene, VideoAspectRatio, VideoProject, VideoTone, VisualStyle, VoiceName, YouTubeMetadata } from '../src/types.js';
import { generateFallbackAudio, generateFallbackSceneImage, getAudioDuration } from './ffmpeg.js';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  return new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function hasApiKey(): boolean {
  return !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
}

// Convert PCM buffer into standard 44-byte WAV header format
export function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  if (pcmBuffer.slice(0, 4).toString() === 'RIFF') {
    return pcmBuffer; // Already has RIFF WAV header
  }
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

export async function generateScriptAndScenes(params: {
  topic: string;
  tone: VideoTone;
  visualStyle: VisualStyle;
  aspectRatio: VideoAspectRatio;
  targetDurationMinutes: number;
}): Promise<{
  title: string;
  script: string;
  youtubeMetadata: YouTubeMetadata;
  scenes: Scene[];
}> {
  const ai = getAiClient();
  const sceneCount = params.targetDurationMinutes <= 0.5 ? 3 : params.targetDurationMinutes <= 1 ? 4 : 6;

  const systemInstruction = `You are an elite YouTube Video Director & Scriptwriter specializing in automated YouTube production.
Your goal is to produce an engaging, high-retention video concept with:
1. A click-worthy YouTube title (no clickbait disappointment, high curiosity).
2. An SEO-optimized YouTube description with summary, chapter timestamps, and tags.
3. Relevant YouTube tags (12-18 tags).
4. A full spoken script divided into exactly ${sceneCount} distinct scenes.
5. For each scene:
   - narration: natural, conversational voiceover text that will be spoken by AI TTS.
   - visualDescription: vivid explanation of what is shown.
   - imagePrompt: highly detailed visual generation prompt tailored for an AI image generator in the "${params.visualStyle}" style, with photographic/artistic lighting, composition, and framing. Aspect ratio is ${params.aspectRatio}.
   - estimatedDurationSeconds: realistic speaking duration (approx 2.5 to 3.2 words per second).
   - onScreenText: punchy 3-7 word caption or headline for on-screen overlay.`;

  const userPrompt = `Create a complete YouTube video production package for:
Topic: "${params.topic}"
Tone: ${params.tone}
Visual Art Style: ${params.visualStyle}
Format: ${params.aspectRatio === '9:16' ? 'Vertical (YouTube Shorts)' : 'Horizontal (Standard YouTube 16:9)'}
Target Duration: ${params.targetDurationMinutes * 60} seconds total across ${sceneCount} scenes.`;

  let responseText = '';
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'];

  for (const model of candidateModels) {
    try {
      const callPromise = ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction,
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'YouTube video title' },
              category: { type: Type.STRING, description: 'YouTube category' },
              description: { type: Type.STRING, description: 'YouTube description with hashtags' },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'SEO tags'
              },
              fullScript: { type: Type.STRING, description: 'Full narration script combined' },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sceneNumber: { type: Type.INTEGER },
                    narration: { type: Type.STRING },
                    visualDescription: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING },
                    estimatedDurationSeconds: { type: Type.NUMBER },
                    onScreenText: { type: Type.STRING },
                  },
                  required: ['sceneNumber', 'narration', 'visualDescription', 'imagePrompt', 'estimatedDurationSeconds', 'onScreenText']
                }
              }
            },
            required: ['title', 'category', 'description', 'tags', 'fullScript', 'scenes']
          }
        }
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after 8s for ${model}`)), 8000)
      );

      const response = await Promise.race([callPromise, timeoutPromise]);
      if (response.text) {
        responseText = response.text;
        break;
      }
    } catch (err: any) {
      console.warn(`Model ${model} failed:`, err?.message || err);
    }
  }

  let parsed: any = {};
  if (responseText) {
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse Gemini JSON:', e);
    }
  }

  // If both models were unavailable or error occurred, construct an engaging structured script
  if (!parsed.scenes || parsed.scenes.length === 0) {
    const defaultTitle = `${params.topic}: Everything You Need to Know`;
    const defaultTags = [
      params.topic.split(' ')[0],
      'YouTubeAutomation',
      'AIVideo',
      'Explainers',
      params.visualStyle.replace(/\s+/g, ''),
      'Educational',
      'DeepDive'
    ];
    
    parsed = {
      title: defaultTitle,
      category: 'Science & Technology',
      description: `Welcome to this deep dive into ${params.topic}. In this video, we break down the core mechanisms, historical discoveries, and surprising truths that make this so fascinating. Don't forget to like and subscribe for more AI-powered documentaries!`,
      tags: defaultTags,
      fullScript: `Have you ever wondered about ${params.topic}? Today we uncover how it works, what the latest research reveals, and why it changes our understanding of the world.`,
      scenes: Array.from({ length: sceneCount }, (_, idx) => {
        const sceneTitles = ['The Mystery Revealed', 'How It Actually Works', 'Deep Scientific Mechanism', 'The Future Impact'];
        const sceneName = sceneTitles[idx % sceneTitles.length];
        return {
          sceneNumber: idx,
          narration: idx === 0 
            ? `Have you ever wondered about ${params.topic}? The answer is far more astonishing than most people think.`
            : idx === sceneCount - 1
            ? `Understanding ${params.topic} gives us a powerful new perspective. What do you think? Leave a comment below and subscribe!`
            : `Here is where things get truly interesting. Looking closely at the underlying process reveals astonishing detail and precision.`,
          visualDescription: `Dramatic wide shot highlighting ${params.topic} with ${params.visualStyle} atmosphere and volumetric lighting.`,
          imagePrompt: `${params.topic}, ${params.visualStyle} style, cinematic composition, breathtaking volumetric lighting, 8k resolution, photorealistic details, trending on ArtStation, aspect ratio ${params.aspectRatio}.`,
          estimatedDurationSeconds: 6,
          onScreenText: sceneName,
        };
      })
    };
  }

  // Compute chapter timestamps for YouTube description
  let cumulativeSeconds = 0;
  const chapters: { time: string; title: string }[] = [];
  const scenes: Scene[] = (parsed.scenes || []).map((s: any, idx: number) => {
    const minutes = Math.floor(cumulativeSeconds / 60);
    const secs = Math.floor(cumulativeSeconds % 60);
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    chapters.push({
      time: timeStr,
      title: s.onScreenText || `Scene ${idx + 1}`
    });

    const duration = Number(s.estimatedDurationSeconds) || 5;
    cumulativeSeconds += duration;

    return {
      id: `scene-${idx}-${Date.now()}`,
      sceneNumber: idx,
      narration: s.narration || '',
      visualDescription: s.visualDescription || '',
      imagePrompt: s.imagePrompt || '',
      estimatedDurationSeconds: duration,
      onScreenText: s.onScreenText || '',
      status: 'pending' as const,
    };
  });

  return {
    title: parsed.title || `${params.topic} Explained`,
    script: parsed.fullScript || scenes.map(s => s.narration).join(' '),
    youtubeMetadata: {
      title: parsed.title || `${params.topic} Explained`,
      description: parsed.description || '',
      tags: parsed.tags || [params.topic, 'AI Video', 'YouTube Automation'],
      category: parsed.category || 'Education',
      chapters,
    },
    scenes,
  };
}

export async function generateSceneImage(
  project: VideoProject,
  sceneIndex: number,
  outputPngPath: string,
  customPrompt?: string
): Promise<string> {
  const scene = project.scenes[sceneIndex];
  if (!scene) throw new Error(`Scene ${sceneIndex} not found`);

  const promptToUse = customPrompt || scene.imagePrompt || scene.visualDescription;
  const fullPrompt = `${promptToUse}. Style: ${project.visualStyle}. High resolution, 4k quality, dramatic lighting, cinematic framing, masterpiece composition. No text, no watermarks.`;
  const ai = getAiClient();

  const aspectRatioVal = project.aspectRatio === '9:16' ? '9:16' : '16:9';

  try {
    // Attempt Gemini / Imagen visual generation
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image',
      contents: {
        parts: [{ text: fullPrompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatioVal,
        },
      },
    });

    const candidate = response.candidates?.[0];
    let base64Image: string | null = null;

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          base64Image = part.inlineData.data;
          break;
        }
      }
    }

    if (base64Image) {
      const buffer = Buffer.from(base64Image, 'base64');
      fs.writeFileSync(outputPngPath, buffer);
      return `/storage/projects/${project.id}/scenes/${path.basename(outputPngPath)}?t=${Date.now()}`;
    }
  } catch (err: any) {
    console.warn(`Gemini image generation encountered error for scene ${sceneIndex}, falling back to stylized graphic:`, err?.message || err);
  }

  // Graceful fallback to rich procedural visual render via FFmpeg SVG
  await generateFallbackSceneImage(
    outputPngPath,
    sceneIndex,
    project.topic,
    scene.visualDescription || scene.onScreenText || scene.narration,
    project.aspectRatio
  );

  return `/storage/projects/${project.id}/scenes/${path.basename(outputPngPath)}?t=${Date.now()}`;
}

export async function generateSceneVoiceover(
  project: VideoProject,
  sceneIndex: number,
  outputWavPath: string,
  voice: VoiceName = 'Kore'
): Promise<{ audioUrl: string; duration: number }> {
  const scene = project.scenes[sceneIndex];
  if (!scene) throw new Error(`Scene ${sceneIndex} not found`);

  const narrationText = scene.narration.trim();
  if (!narrationText) {
    throw new Error(`Scene ${sceneIndex} has no narration text`);
  }

  const ai = getAiClient();

  try {
    // Use Gemini TTS preview model
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-tts-preview',
      contents: [{ parts: [{ text: narrationText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    const candidate = response.candidates?.[0];
    const inlineData = candidate?.content?.parts?.[0]?.inlineData;

    if (inlineData?.data) {
      const rawBuffer = Buffer.from(inlineData.data, 'base64');
      // Wrap PCM in standard 24kHz 16-bit mono WAV header
      const wavBuffer = pcmToWav(rawBuffer, 24000, 1, 16);
      fs.writeFileSync(outputWavPath, wavBuffer);

      const duration = await getAudioDuration(outputWavPath);
      return {
        audioUrl: `/storage/projects/${project.id}/audio/${path.basename(outputWavPath)}?t=${Date.now()}`,
        duration,
      };
    }
  } catch (err: any) {
    console.warn(`Gemini TTS generation error for scene ${sceneIndex}:`, err?.message || err);
  }

  // Graceful fallback audio via Google Translate TTS endpoint or FFmpeg tone generator
  await generateFallbackAudio(outputWavPath, scene.estimatedDurationSeconds || 4, narrationText);
  const duration = await getAudioDuration(outputWavPath);

  return {
    audioUrl: `/storage/projects/${project.id}/audio/${path.basename(outputWavPath)}?t=${Date.now()}`,
    duration,
  };
}
