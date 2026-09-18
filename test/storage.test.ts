import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  PathValidationService,
  CANONICAL_PROJECT_SUBDIRS,
} from '../server/storage/pathValidation.js';
import { AtomicWriteService } from '../server/storage/atomicWrite.js';
import { ProjectStore } from '../server/storage/projectStore.js';
import { AssetStore } from '../server/storage/assetStore.js';
import { VersionStore } from '../server/storage/versionStore.js';
import { TempManager } from '../server/storage/tempManager.js';
import { VideoProject } from '../src/types.js';

describe('Storage Service: Path Validation & Security Hardening', () => {
  const validator = new PathValidationService();
  const testBaseDir = path.join(os.tmpdir(), `test_storage_val_${Date.now()}`);

  before(() => {
    fs.mkdirSync(testBaseDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should accept valid project IDs', () => {
    assert.strictEqual(validator.isValidProjectId('proj_12345'), true);
    assert.strictEqual(validator.isValidProjectId('proj_test-video_99'), true);
    assert.strictEqual(validator.isValidProjectId('video123'), true);
  });

  it('should reject invalid, dangerous, or traversal project IDs', () => {
    assert.strictEqual(validator.isValidProjectId('../etc/passwd'), false);
    assert.strictEqual(validator.isValidProjectId('../../proj'), false);
    assert.strictEqual(validator.isValidProjectId('/root/secret'), false);
    assert.strictEqual(validator.isValidProjectId('proj\\windows\\path'), false);
    assert.strictEqual(validator.isValidProjectId('proj\0nullbyte'), false);
    assert.strictEqual(validator.isValidProjectId(''), false);
    assert.strictEqual(validator.isValidProjectId('ab'), false); // Too short (<3)
    assert.strictEqual(validator.isValidProjectId('a'.repeat(65)), false); // Too long (>64)
    assert.strictEqual(validator.isValidProjectId('proj with spaces'), false);
  });

  it('should sanitize unsafe filenames and strip path separators', () => {
    assert.strictEqual(validator.sanitizeFilename('my_scene.png'), 'my_scene.png');
    assert.strictEqual(validator.sanitizeFilename('../../etc/secret.png'), 'secret.png');
    assert.strictEqual(validator.sanitizeFilename('clip#1:special?.mp4'), 'clip_1_special_.mp4');
  });

  it('should reject reserved system filenames', () => {
    assert.throws(() => validator.sanitizeFilename('.env'), /Reserved filename/);
    assert.throws(() => validator.sanitizeFilename('CON'), /Reserved filename/);
    assert.throws(() => validator.sanitizeFilename('.git'), /Reserved filename/);
    assert.throws(() => validator.sanitizeFilename('..'), /Invalid filename/);
  });

  it('should resolve safe relative paths without escaping base directory', () => {
    const safePath = validator.resolveSafePath(testBaseDir, 'scenes/scene_0.png');
    assert.strictEqual(safePath, path.join(testBaseDir, 'scenes', 'scene_0.png'));
  });

  it('should reject directory traversal attempts in resolveSafePath', () => {
    assert.throws(
      () => validator.resolveSafePath(testBaseDir, '../../etc/passwd'),
      /Directory traversal attempt detected/
    );
    assert.throws(
      () => validator.resolveSafePath(testBaseDir, 'sub/../../../../escaped'),
      /Directory traversal attempt detected/
    );
    assert.throws(
      () => validator.resolveSafePath(testBaseDir, 'file\0.png'),
      /Null byte injection/
    );
  });

  it('should create all canonical subdirectories for a project', () => {
    const projDir = path.join(testBaseDir, 'canonical_test_project');
    validator.ensureProjectCanonicalDirs(projDir);

    for (const subdir of CANONICAL_PROJECT_SUBDIRS) {
      const fullSubdir = path.join(projDir, subdir);
      assert.strictEqual(fs.existsSync(fullSubdir), true, `Missing subdir: ${subdir}`);
    }
  });
});

describe('Storage Service: Atomic JSON Writes & Recovery', () => {
  const atomic = new AtomicWriteService();
  const testDir = path.join(os.tmpdir(), `test_atomic_${Date.now()}`);

  before(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should atomically write JSON without leaving temporary files behind', () => {
    const filePath = path.join(testDir, 'data.json');
    const data = { message: 'hello atomic world', count: 42 };

    atomic.writeJsonAtomic(filePath, data);

    assert.strictEqual(fs.existsSync(filePath), true);
    const read = atomic.readJsonWithRecovery<typeof data>(filePath);
    assert.deepStrictEqual(read, data);

    // Verify no .tmp files remain
    const files = fs.readdirSync(testDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp.'));
    assert.strictEqual(tmpFiles.length, 0);
  });

  it('should recover from a corrupt primary file using a valid backup', () => {
    const filePath = path.join(testDir, 'recoverable.json');
    const validData = { status: 'safe_backup', timestamp: 12345 };

    // 1. First write valid data
    atomic.writeJsonAtomic(filePath, validData);

    // 2. Simulate a crash: manually create a valid .bak and corrupt primary file
    fs.copyFileSync(filePath, `${filePath}.bak`);
    fs.writeFileSync(filePath, '{ corrupted json ... truncate');

    // 3. Read with recovery
    const recovered = atomic.readJsonWithRecovery<typeof validData>(filePath);
    assert.notStrictEqual(recovered, null);
    assert.strictEqual(recovered?.status, 'safe_backup');
  });
});

describe('Storage Service: ProjectStore Lifecycle, Migration & Normalization', () => {
  const testRoot = path.join(os.tmpdir(), `test_proj_store_${Date.now()}`);
  let store: ProjectStore;

  before(() => {
    store = new ProjectStore({
      storageRoot: testRoot,
      projectsDir: path.join(testRoot, 'projects'),
    });
  });

  after(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should initialize a new project with canonical directory structure and modular JSON files', () => {
    const project = store.createProject({
      topic: 'Quantum Computing Explained',
      aspectRatio: '16:9',
      tone: 'Informative & Educational',
    });

    assert.ok(project.id.startsWith('proj_'));
    const projectDir = store.getProjectDir(project.id);

    // Verify canonical subdirectories
    for (const subdir of CANONICAL_PROJECT_SUBDIRS) {
      assert.strictEqual(fs.existsSync(path.join(projectDir, subdir)), true);
    }

    // Verify modular files
    assert.strictEqual(fs.existsSync(path.join(projectDir, 'project.json')), true);
    assert.strictEqual(fs.existsSync(path.join(projectDir, 'script.json')), true);
    assert.strictEqual(fs.existsSync(path.join(projectDir, 'scenes.json')), true);
    assert.strictEqual(fs.existsSync(path.join(projectDir, 'timeline.json')), true);
    assert.strictEqual(fs.existsSync(path.join(projectDir, 'research.json')), true);
    assert.strictEqual(fs.existsSync(path.join(projectDir, 'assets.json')), true);
  });

  it('should migrate and normalize legacy project.json format without breaking existing data', () => {
    const legacyId = 'proj_legacy_test_01';
    const legacyDir = path.join(testRoot, 'projects', legacyId);
    fs.mkdirSync(legacyDir, { recursive: true });

    // Legacy project with single project.json and flat root files
    const legacyData: any = {
      id: legacyId,
      title: 'Legacy Video Project',
      topic: 'AI Automation in 2026',
      aspectRatio: '16:9',
      tone: 'Engaging',
      visualStyle: 'Cinematic',
      voice: 'Kore',
      targetDurationMinutes: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      currentStage: 'assembly',
      status: 'ready',
      scenes: [
        {
          sceneNumber: 0,
          visualDescription: 'Futuristic cityscape',
          narration: 'The dawn of machine intelligence.',
          estimatedDurationSeconds: 6,
        },
      ],
      youtubeMetadata: {
        title: 'Legacy Video',
        description: 'Old description',
        tags: ['ai'],
        category: 'Tech',
      },
    };

    fs.writeFileSync(path.join(legacyDir, 'project.json'), JSON.stringify(legacyData, null, 2));
    // Simulate legacy root thumbnail and video
    fs.writeFileSync(path.join(legacyDir, 'thumbnail.png'), 'fake-png-data');
    fs.writeFileSync(path.join(legacyDir, 'video.mp4'), 'fake-mp4-data');

    // Load through ProjectStore - should automatically trigger normalization & migration
    const loaded = store.getProject(legacyId);
    assert.notStrictEqual(loaded, null);
    assert.strictEqual(loaded?.title, 'Legacy Video Project');

    // Verify canonical subdirectories were created
    for (const subdir of CANONICAL_PROJECT_SUBDIRS) {
      assert.strictEqual(fs.existsSync(path.join(legacyDir, subdir)), true);
    }

    // Verify modular files were created from existing project data
    assert.strictEqual(fs.existsSync(path.join(legacyDir, 'script.json')), true);
    assert.strictEqual(fs.existsSync(path.join(legacyDir, 'scenes.json')), true);
    assert.strictEqual(fs.existsSync(path.join(legacyDir, 'metadata.json')), true);
    assert.strictEqual(fs.existsSync(path.join(legacyDir, 'assets.json')), true);

    // Verify legacy assets were cataloged in assets.json
    const assets = store.assetStore.getAssets(legacyId);
    const thumbAsset = assets.find((a) => a.filename === 'thumbnail.png');
    const videoAsset = assets.find((a) => a.filename === 'video.mp4');
    assert.ok(thumbAsset, 'Legacy thumbnail not cataloged');
    assert.ok(videoAsset, 'Legacy video not cataloged');
  });

  it('should list all valid projects sorted by creation date descending', () => {
    const list = store.getAllProjects();
    assert.ok(list.length >= 2);
    // Verify descending order
    for (let i = 0; i < list.length - 1; i++) {
      const t1 = new Date(list[i].createdAt).getTime();
      const t2 = new Date(list[i + 1].createdAt).getTime();
      assert.ok(t1 >= t2);
    }
  });

  it('should delete project and completely remove its canonical folder', () => {
    const toDelete = store.createProject({ topic: 'Disposable Project' });
    const dir = store.getProjectDir(toDelete.id);
    assert.strictEqual(fs.existsSync(dir), true);

    const deleted = store.deleteProject(toDelete.id);
    assert.strictEqual(deleted, true);
    assert.strictEqual(fs.existsSync(dir), false);
    assert.strictEqual(store.getProject(toDelete.id), null);
  });
});

describe('Storage Service: AssetStore & Controlled Access', () => {
  const testRoot = path.join(os.tmpdir(), `test_asset_store_${Date.now()}`);
  let store: ProjectStore;
  let testProj: VideoProject;

  before(() => {
    store = new ProjectStore({ storageRoot: testRoot, projectsDir: path.join(testRoot, 'projects') });
    testProj = store.createProject({ topic: 'Asset Testing Project' });
  });

  after(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should save a binary asset into canonical folder and register in assets.json', () => {
    const dummyPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const asset = store.assetStore.saveAssetFile(testProj.id, 'scenes', 'scene_0.png', dummyPng);

    assert.strictEqual(asset.filename, 'scene_0.png');
    assert.strictEqual(asset.relativePath, 'scenes/scene_0.png');
    assert.strictEqual(asset.mimeType, 'image/png');
    assert.strictEqual(asset.type, 'image');

    const assets = store.assetStore.getAssets(testProj.id);
    assert.strictEqual(assets.length, 1);
    assert.strictEqual(assets[0].filename, 'scene_0.png');
  });

  it('should safely resolve allowed media asset paths', () => {
    const resolved = store.assetStore.resolveAssetPath(testProj.id, 'scenes/scene_0.png');
    assert.notStrictEqual(resolved, null);
    assert.strictEqual(resolved?.mimeType, 'image/png');
  });

  it('should reject resolution of sensitive internal files (.json, .ts, etc.)', () => {
    const jsonResolved = store.assetStore.resolveAssetPath(testProj.id, 'project.json');
    assert.strictEqual(jsonResolved, null);

    const missingResolved = store.assetStore.resolveAssetPath(testProj.id, 'nonexistent.png');
    assert.strictEqual(missingResolved, null);
  });
});

describe('Storage Service: VersionStore Snapshots & Rollback', () => {
  const testRoot = path.join(os.tmpdir(), `test_ver_store_${Date.now()}`);
  let store: ProjectStore;
  let testProj: VideoProject;

  before(() => {
    store = new ProjectStore({ storageRoot: testRoot, projectsDir: path.join(testRoot, 'projects') });
    testProj = store.createProject({ topic: 'Version Testing Project' });
  });

  after(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should create and list version snapshots', () => {
    const snap1 = store.versionStore.createSnapshot(testProj.id, 'initial_state', 'Baseline draft');
    assert.ok(snap1.versionId.startsWith('v_'));
    assert.strictEqual(snap1.label, 'initial_state');

    // Modify project
    testProj.title = 'Updated Title Before Render';
    testProj.currentStage = 'voiceover';
    store.saveProject(testProj);

    const snap2 = store.versionStore.createSnapshot(testProj.id, 'voiceover_ready', 'Voices recorded');

    const list = store.versionStore.listSnapshots(testProj.id);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].versionId, snap2.versionId); // Newest first
    assert.strictEqual(list[1].versionId, snap1.versionId);
  });

  it('should restore project to a previous snapshot state', () => {
    const list = store.versionStore.listSnapshots(testProj.id);
    const initialSnap = list.find((s) => s.label === 'initial_state');
    assert.ok(initialSnap);

    const restored = store.versionStore.restoreSnapshot(testProj.id, initialSnap.versionId);
    assert.strictEqual(restored.currentStage, 'topic');

    // Verify disk was updated
    const freshFromDisk = store.getProject(testProj.id);
    assert.strictEqual(freshFromDisk?.currentStage, 'topic');
  });
});

describe('Storage Service: TempManager & Abandoned Cleanup', () => {
  const testRoot = path.join(os.tmpdir(), `test_temp_store_${Date.now()}`);
  let store: ProjectStore;
  let testProj: VideoProject;

  before(() => {
    store = new ProjectStore({ storageRoot: testRoot, projectsDir: path.join(testRoot, 'projects') });
    testProj = store.createProject({ topic: 'Temp Testing Project' });
  });

  after(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should allocate managed temp files with immediate cleanup callback', () => {
    const { filePath, cleanup } = store.tempManager.createTempFile(testProj.id, 'clip', '.mp4');
    assert.strictEqual(fs.existsSync(filePath), true);
    assert.ok(filePath.includes('/temp/'));

    cleanup();
    assert.strictEqual(fs.existsSync(filePath), false);
  });

  it('should clean all temporary files in a project temp directory', () => {
    store.tempManager.createTempFile(testProj.id, 'temp1', '.tmp');
    store.tempManager.createTempFile(testProj.id, 'temp2', '.tmp');

    const cleaned = store.tempManager.cleanupProjectTemp(testProj.id);
    assert.strictEqual(cleaned, 2);

    const tempDir = path.join(store.getProjectDir(testProj.id), 'temp');
    assert.strictEqual(fs.readdirSync(tempDir).length, 0);
  });

  it('should clean abandoned temp files older than max age across projects', () => {
    const { filePath } = store.tempManager.createTempFile(testProj.id, 'abandoned', '.tmp');
    assert.strictEqual(fs.existsSync(filePath), true);

    // Backdate mtime by 2 hours
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    fs.utimesSync(filePath, twoHoursAgo / 1000, twoHoursAgo / 1000);

    const cleaned = store.tempManager.cleanupAllAbandonedTemp(60 * 60 * 1000); // 1 hr threshold
    assert.ok(cleaned >= 1);
    assert.strictEqual(fs.existsSync(filePath), false);
  });
});
