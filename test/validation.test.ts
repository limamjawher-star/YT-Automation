import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectIdSchema,
  ProjectSettingsSchema,
  ProjectUpdateSchema,
  SceneSchema,
  ShotSchema,
  AssetSchema,
  AudioAssetSchema,
  CaptionSchema,
  TimelineSchema,
  ResearchResultSchema,
  YouTubeMetadataSchema,
  ThumbnailConceptSchema,
  PipelineJobSchema,
  PipelineEventSchema,
  ProjectSchema,
  AiScriptResponseSchema,
  validateAiScriptResponse,
} from '../src/schemas/index.js';
import {
  ProjectIdParamSchema,
  SceneParamSchema,
  RegenerateImageBodySchema,
  RegenerateAudioBodySchema,
  applyWhitelistedProjectUpdates,
} from '../server/validation.js';

describe('Data Integrity Layer: AI Response Validation', () => {
  it('should accept valid AI structured script payload', () => {
    const validAiPayload = {
      title: 'The Secrets of Black Holes',
      category: 'Science & Technology',
      description: 'An in-depth documentary exploring singularities and space-time curvature.',
      tags: ['blackholes', 'astronomy', 'space', 'science'],
      fullScript: 'What lies beyond the event horizon? Today we explore the edge of reality.',
      scenes: [
        {
          sceneNumber: 0,
          narration: 'What lies beyond the event horizon? Today we explore the edge of reality.',
          visualDescription: 'Deep space view of a glowing accretion disk around a supermassive black hole.',
          imagePrompt: 'Supermassive black hole with luminous golden accretion disk, 8k cinematic.',
          estimatedDurationSeconds: 6,
          onScreenText: 'The Void Beckons',
        },
        {
          sceneNumber: 1,
          narration: 'Inside, gravitational forces become infinite as matter compresses into a point.',
          visualDescription: 'Close-up visualization of distorted space-time lattice.',
          imagePrompt: 'Gravitational lensing bending starlight into Einstein rings.',
          estimatedDurationSeconds: 7,
          onScreenText: 'Singularity',
        },
      ],
    };

    const result = validateAiScriptResponse(validAiPayload);
    assert.equal(result.success, true);
    assert.ok(result.data);
    assert.equal(result.data.title, 'The Secrets of Black Holes');
    assert.equal(result.data.scenes.length, 2);
  });

  it('should reject malformed AI response with missing required scenes', () => {
    const missingScenes = {
      title: 'Incomplete Script',
      description: 'Missing scenes array completely',
    };

    const result = validateAiScriptResponse(missingScenes);
    assert.equal(result.success, false);
    assert.ok(result.errors && result.errors.length > 0);
  });

  it('should reject AI response with empty scenes array', () => {
    const emptyScenes = {
      title: 'Empty Video',
      scenes: [],
    };

    const result = validateAiScriptResponse(emptyScenes);
    assert.equal(result.success, false);
    assert.ok(result.errors?.some((e) => e.includes('At least one scene is required')));
  });

  it('should reject AI scenes with empty narration or wrong types', () => {
    const invalidSceneTypes = {
      title: 'Broken Types',
      scenes: [
        {
          narration: '', // Empty narration
          estimatedDurationSeconds: 'not-a-number', // Wrong type
        },
      ],
    };

    const result = validateAiScriptResponse(invalidSceneTypes);
    assert.equal(result.success, false);
    assert.ok(result.errors && result.errors.length > 0);
  });
});

describe('Data Integrity Layer: Project ID & URL Param Validation', () => {
  it('should validate standard project IDs', () => {
    const validId = 'proj_1720000000_abc12';
    const parsed = ProjectIdSchema.safeParse(validId);
    assert.equal(parsed.success, true);
  });

  it('should reject path traversal and malicious project IDs', () => {
    const maliciousIds = [
      '../etc/passwd',
      '..\\windows\\system32',
      'proj 123',
      'proj/../../secret',
      'proj;rm -rf /',
      'ab', // too short (< 3)
      '',
    ];

    for (const badId of maliciousIds) {
      const parsed = ProjectIdSchema.safeParse(badId);
      assert.equal(parsed.success, false, `Expected ID "${badId}" to be rejected`);
    }
  });

  it('should reject invalid scene index params', () => {
    const invalidSceneParams = [
      { id: 'proj_12345', sceneIndex: '-1' },
      { id: 'proj_12345', sceneIndex: 'abc' },
      { id: 'proj_12345', sceneIndex: '2.5' },
      { id: 'proj_12345', sceneIndex: '' },
    ];

    for (const params of invalidSceneParams) {
      const result = SceneParamSchema.safeParse(params);
      assert.equal(result.success, false);
    }
  });

  it('should accept and transform valid scene index params', () => {
    const result = SceneParamSchema.safeParse({ id: 'proj_12345', sceneIndex: '4' });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.sceneIndex, 4);
      assert.equal(typeof result.data.sceneIndex, 'number');
    }
  });
});

describe('Data Integrity Layer: Route Request Hardening & Field Whitelisting', () => {
  it('should accept valid project creation input', () => {
    const validCreate = {
      topic: 'Quantum Computing Explained',
      aspectRatio: '16:9' as const,
      tone: 'Engaging & Fast-Paced' as const,
      visualStyle: 'Cinematic Photorealism' as const,
      voice: 'Kore' as const,
      targetDurationMinutes: 2,
    };

    const parsed = ProjectSettingsSchema.safeParse(validCreate);
    assert.equal(parsed.success, true);
  });

  it('should reject empty or whitespace-only project topic', () => {
    const invalidCreate = {
      topic: '   ',
    };

    const parsed = ProjectSettingsSchema.safeParse(invalidCreate);
    assert.equal(parsed.success, false);
  });

  it('should strictly reject unauthorized fields in project update requests', () => {
    const unauthorizedPayload = {
      title: 'Hacked Project Title',
      status: 'completed', // Server-controlled!
      currentStage: 'assembly', // Server-controlled!
      id: 'proj_new_id', // Immutable!
      renderLogs: ['Injected log'], // Server-controlled!
    };

    const result = ProjectUpdateSchema.safeParse(unauthorizedPayload);
    assert.equal(result.success, false);
    // Verify that unrecognized keys caused the validation failure
    if (!result.success) {
      const issueCodes = result.error.issues.map((i) => i.code);
      assert.ok(issueCodes.includes('unrecognized_keys'));
    }
  });

  it('should allow legitimate user edits to whitelisted fields', () => {
    const allowedPayload = {
      title: 'Updated Title by User',
      script: 'Updated script text.',
      tone: 'Dramatic & Storytelling' as const,
    };

    const result = ProjectUpdateSchema.safeParse(allowedPayload);
    assert.equal(result.success, true);
  });

  it('should apply whitelisted updates without mutating server-controlled status', () => {
    const baseProject: import('../src/types.js').VideoProject = {
      id: 'proj_test_001',
      title: 'Initial Title',
      topic: 'Original Topic',
      aspectRatio: '16:9',
      tone: 'Engaging & Fast-Paced',
      visualStyle: 'Cinematic Photorealism',
      voice: 'Kore',
      targetDurationMinutes: 1,
      createdAt: '2026-09-18T00:00:00.000Z',
      updatedAt: '2026-09-18T00:00:00.000Z',
      currentStage: 'script',
      status: 'draft',
      scenes: [],
      renderLogs: ['Initial created'],
    };

    const safeUpdates = {
      title: 'Safe Modified Title',
      script: 'New safe script',
    };

    const updated = applyWhitelistedProjectUpdates(baseProject, safeUpdates);
    assert.equal(updated.title, 'Safe Modified Title');
    assert.equal(updated.script, 'New safe script');
    assert.equal(updated.id, 'proj_test_001'); // Not modified
    assert.equal(updated.status, 'draft'); // Not modified
    assert.equal(updated.currentStage, 'script'); // Not modified
  });
});

describe('Data Integrity Layer: Core Schema Specifications', () => {
  it('should validate Scene schema', () => {
    const validScene = {
      id: 'scene-0-12345',
      sceneNumber: 0,
      narration: 'A journey through time.',
      visualDescription: 'Clock melting in the desert.',
      imagePrompt: 'Surrealist clock melting in desert.',
      estimatedDurationSeconds: 5,
      status: 'pending' as const,
    };
    assert.equal(SceneSchema.safeParse(validScene).success, true);
  });

  it('should validate Shot schema', () => {
    const validShot = {
      id: 'shot-1',
      sceneId: 'scene-1',
      shotNumber: 1,
      cameraAngle: 'Wide Angle',
      movement: 'slow_zoom_in' as const,
      description: 'Wide shot of mountains',
      durationSeconds: 3.5,
    };
    assert.equal(ShotSchema.safeParse(validShot).success, true);
  });

  it('should validate Asset and AudioAsset schemas', () => {
    const validAsset = {
      id: 'asset-1',
      projectId: 'proj_12345',
      type: 'image' as const,
      path: '/storage/projects/proj_12345/scenes/scene_0.png',
      url: '/storage/projects/proj_12345/scenes/scene_0.png',
      mimeType: 'image/png',
      createdAt: new Date().toISOString(),
    };
    assert.equal(AssetSchema.safeParse(validAsset).success, true);

    const validAudio = {
      id: 'audio-1',
      projectId: 'proj_12345',
      sceneId: 'scene-0',
      url: '/storage/projects/proj_12345/audio/scene_0.wav',
      localPath: '/storage/projects/proj_12345/audio/scene_0.wav',
      durationSeconds: 6.2,
      voice: 'Kore' as const,
      format: 'wav' as const,
      sampleRate: 24000,
      channels: 1,
    };
    assert.equal(AudioAssetSchema.safeParse(validAudio).success, true);
  });

  it('should validate Caption and Timeline schemas', () => {
    const validCaption = {
      index: 1,
      startTimeSeconds: 0,
      endTimeSeconds: 3.5,
      text: 'Welcome to this documentary.',
    };
    assert.equal(CaptionSchema.safeParse(validCaption).success, true);

    const validTimeline = {
      totalDurationSeconds: 12.5,
      fps: 25,
      resolution: { width: 1920, height: 1080 },
      aspectRatio: '16:9' as const,
      tracks: {
        videoClips: [
          { sceneIndex: 0, clipPath: 'scene_0.mp4', durationSeconds: 6.0 },
          { sceneIndex: 1, clipPath: 'scene_1.mp4', durationSeconds: 6.5 },
        ],
        audioClips: [
          { sceneIndex: 0, audioPath: 'scene_0.wav', durationSeconds: 6.0 },
          { sceneIndex: 1, audioPath: 'scene_1.wav', durationSeconds: 6.5 },
        ],
      },
    };
    assert.equal(TimelineSchema.safeParse(validTimeline).success, true);
  });

  it('should validate ResearchResult, YouTubeMetadata, and ThumbnailConcept schemas', () => {
    const validResearch = {
      topic: 'Dark Energy',
      hookSuggestions: ['95% of the universe is missing.'],
      keyPoints: ['Accelerating expansion', 'Cosmological constant', 'Cosmic fate'],
      targetAudience: 'Science enthusiasts',
      recommendedLengthMinutes: 3,
    };
    assert.equal(ResearchResultSchema.safeParse(validResearch).success, true);

    const validYt = {
      title: 'Dark Energy: Why The Universe Expands Faster',
      description: 'The complete guide to dark energy.',
      tags: ['science', 'astronomy', 'universe'],
      category: 'Science & Technology',
      chapters: [{ time: '00:00', title: 'Introduction' }],
    };
    assert.equal(YouTubeMetadataSchema.safeParse(validYt).success, true);

    const validThumbnail = {
      headline: 'THE COSMIC PUZZLE',
      visualFocalPoint: 'Glowing violet cosmic web against black void',
      colorScheme: 'Electric purple and obsidian',
      textOverlay: '95% UNKNOWN',
      prompt: 'Surreal visual of universe expanding into eternity',
    };
    assert.equal(ThumbnailConceptSchema.safeParse(validThumbnail).success, true);
  });

  it('should validate PipelineJob and PipelineEvent schemas', () => {
    const validJob = {
      id: 'job-1',
      projectId: 'proj_12345',
      stage: 'assembly' as const,
      status: 'running' as const,
      progress: 65,
      createdAt: new Date().toISOString(),
    };
    assert.equal(PipelineJobSchema.safeParse(validJob).success, true);

    const validEvent = {
      stage: 'visuals' as const,
      status: 'progress' as const,
      message: 'Generating image for scene 2 of 4',
      progressPercent: 50,
      timestamp: new Date().toISOString(),
    };
    assert.equal(PipelineEventSchema.safeParse(validEvent).success, true);
  });
});
