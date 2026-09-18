# Local AI YouTube Video Automation Pipeline — Baseline Engineering Audit Report

**Date of Audit:** 2026-09-18  
**Audit Scope:** Full repository audit (Frontend, Backend, Build System, AI Integrations, FFmpeg Engine, Storage, Types, Security, and Stability).  
**Status:** Baseline Established — Safe Stability Fixes Applied.

---

## 1. Executive Summary & Architecture Overview

The **Local AI YouTube Video Automation Pipeline** is a full-stack, local-first web application designed to automate the production of YouTube videos and YouTube Shorts. The application accepts a high-level topic and creative preferences, then orchestrates four primary stages:
1. **Script & Storyboard Generation** via Google Gemini (`@google/genai`).
2. **Visual Generation** via Google Imagen / Gemini visual synthesis with procedural SVG/FFmpeg fallback.
3. **Voiceover Narration** via Google Text-to-Speech (`gemini-3.1-flash-tts-preview` / TTS fallback) wrapped in standard WAV headers.
4. **Timeline Assembly & Subtitling** via local FFmpeg, applying Ken Burns motion filters, concatenating clips, burning synchronized subtitles (`.srt`), and creating custom YouTube thumbnails.

### Architecture & Data Flow

```
[User Browser (React 19 + Tailwind v4)]
       │
       ▼ (HTTP / JSON API)
[Express 4 Server (server.ts)]
  ├── /api/status                     --> Diagnostics (FFmpeg, API Key, Project counts)
  ├── /api/projects                   --> CRUD for VideoProject entities
  ├── /api/projects/:id/generate-script
  ├── /api/projects/:id/generate-images
  ├── /api/projects/:id/generate-voiceover
  ├── /api/projects/:id/assemble-video
  └── /api/projects/:id/run-pipeline   --> 1-Click End-to-End Orchestrator
       │
  ┌────┴─────────────────────────────────────────┐
  ▼                                              ▼
[AI Services (server/gemini.ts)]       [FFmpeg Engine (server/ffmpeg.ts)]
  • GoogleGenAI SDK                      • ffprobe (audio duration check)
  • gemini-3.1-flash-lite / 3.8-flash    • ffmpeg zoompan & scale filters
  • gemini-3.1-flash-image               • concat demuxer (timeline merge)
  • gemini-3.1-flash-tts-preview         • subtitles filter (SRT burn-in)
  • pcmToWav converter                   • thumbnail scaler & crop
  • Procedural SVG + TTS Fallbacks       • procedural sine wave & SVG convert
       │                                         │
       └───────────────────┬─────────────────────┘
                           ▼
               [Filesystem Persistence (server/storage.ts)]
                 storage/projects/<project_id>/
                   ├── project.json
                   ├── scenes/ (scene_*.png)
                   ├── audio/ (scene_*.wav)
                   ├── subtitles.srt
                   ├── thumbnail.png
                   └── video.mp4
```

---

## 2. Frontend Entry Points & Major Components

### Entry Points
- **HTML Shell:** `/index.html` — Configures viewport, title, meta tags, and mounts `<div id="root">`.
- **Client Bootstrap:** `/src/main.tsx` — StrictMode initialization mounting `<App />` with global CSS `@import "tailwindcss";`.

### Major Components (`src/components/`)
1. **`App.tsx`**: Central pipeline state controller. Manages `currentProject`, `projects` list, `systemStatus`, `activeTab`, error banners, and invokes backend API endpoints.
2. **`Header.tsx`**: Top application bar showing live system readiness badges (Gemini API key present, FFmpeg detected), Project Library toggle, Documentation modal toggle, and New Project action.
3. **`StageProgressBar.tsx`**: 5-step interactive pipeline stepper (`Settings`, `Script`, `Visuals`, `Voiceover`, `Assembly`) with real-time status icons (pending, generating pulse, completed checkmark).
4. **`ProjectConfigForm.tsx`**: Stage 1 configuration view with topic presets, aspect ratio toggle (`16:9` vs `9:16`), duration selector, tone selector, visual style selector, and voice selector. Supports both step-by-step and 1-click full pipeline execution.
5. **`ScriptStageView.tsx`**: Stage 2 storyboard and script inspector. Displays generated title, SEO tags, chapter timestamps, and allows inline editing of narration text and image generation prompts per scene.
6. **`VisualsStageView.tsx`**: Stage 3 visual gallery. Shows aspect-ratio matched image cards, full-screen lightbox preview, and allows per-scene prompt editing with targeted single-scene regeneration.
7. **`VoiceoverStageView.tsx`**: Stage 4 voiceover manager. Embedded HTML5 audio playback per scene, timing indicators, voice selector, and per-scene narration editing with single-track re-synthesis.
8. **`AssemblyStageView.tsx`**: Stage 5 final export dashboard. Embedded HTML5 video player, live FFmpeg console log viewer with progress bar, download links for MP4 video and custom thumbnail, and 1-click copyable YouTube Studio upload package (title, formatted chapter timestamps, description, tags).
9. **`ProjectHistoryModal.tsx`**: Persistent library browser allowing users to switch between past projects, download previous renders, or delete projects.
10. **`SetupReadmeModal.tsx`**: In-app documentation dialog with quickstart commands, environment variable guide, and storage structure reference.

---

## 3. Backend Entry Points & Routes

### Server Entry
- **File:** `/server.ts`
- **Execution:** Launched in development via `tsx server.ts` and in production via `node dist/server.cjs` (bundled via `esbuild`).
- **Middleware:** Express JSON & URL-encoded parser (50MB limit), `/storage` static file mount, Vite development middleware (`createServer({ middlewareMode: true, appType: 'spa' })`), and production static SPA fallback.

### API Routes
| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | System health check: verifies FFmpeg installation, API key presence, and active project counts. |
| `GET` | `/api/projects` | Lists all saved projects ordered by `createdAt` descending. |
| `POST` | `/api/projects` | Creates a new video project entity with unique ID and default parameters. |
| `GET` | `/api/projects/:id` | Fetches a single project by ID from filesystem storage. |
| `DELETE` | `/api/projects/:id` | Recursively removes project directory and all associated media assets. |
| `PATCH` | `/api/projects/:id` | Updates project settings or manual edits (title, tone, scenes, etc.). |
| `POST` | `/api/projects/:id/generate-script` | Generates click-worthy title, SEO metadata, and structured scenes via Gemini. |
| `POST` | `/api/projects/:id/generate-images` | Generates visuals for all scenes in parallel/sequential order. |
| `POST` | `/api/projects/:id/scenes/:sceneIndex/regenerate-image` | Re-generates a single scene's visual asset, optionally taking an updated prompt. |
| `POST` | `/api/projects/:id/generate-voiceover` | Synthesizes voiceover audio for all scenes using Google TTS. |
| `POST` | `/api/projects/:id/scenes/:sceneIndex/regenerate-audio` | Re-synthesizes audio for a single scene with updated text or voice. |
| `POST` | `/api/projects/:id/assemble-video` | Runs the FFmpeg assembly pipeline: clip creation, concatenation, subtitling, thumbnailing. |
| `POST` | `/api/projects/:id/run-pipeline` | 1-click end-to-end execution of all four stages consecutively. |

---

## 4. AI Providers & Models Currently Referenced

The application uses the official `@google/genai` TypeScript SDK (`^2.4.0`):

| Purpose | Model Reference | Fallback Strategy |
| :--- | :--- | :--- |
| **Script & Storyboard** | `gemini-3.1-flash-lite`, `gemini-3.8-flash`, `gemini-3.1-pro-preview` | Sequential fallback with 8-second request timeouts; if unavailable, generates a high-quality structured default storyboard. |
| **Visual Synthesis** | `gemini-3.1-flash-image` (modalities: image) | Procedural high-resolution SVG generator with curated cinematic color palettes converted to PNG via FFmpeg. |
| **Voiceover Narration (TTS)** | `gemini-3.1-flash-tts-preview` (`Modality.AUDIO`, voices: `Kore`, `Puck`, `Fenrir`, `Charon`, `Zephyr`) | Lightweight Google Translate TTS endpoint conversion or pure FFmpeg synthetic harmonic voice tone generator. |

---

## 5. Project Data Model & Storage Structure

### Project Data Model (`src/types.ts`)
- **`VideoProject`**: Core document containing:
  - `id`: string (`proj_<timestamp>_<random>`)
  - `title`, `topic`: string
  - `aspectRatio`: `'16:9' | '9:16'`
  - `tone`: `VideoTone` (6 options)
  - `visualStyle`: `VisualStyle` (6 options)
  - `voice`: `VoiceName` (5 options)
  - `targetDurationMinutes`: number (0.5 to 3)
  - `createdAt`, `updatedAt`: ISO timestamps
  - `currentStage`: `PipelineStage` (`'topic' | 'script' | 'scenes' | 'visuals' | 'voiceover' | 'assembly' | 'completed'`)
  - `status`: `'draft' | 'generating' | 'ready' | 'error'`
  - `errorMessage`: optional string
  - `script`: combined spoken text
  - `youtubeMetadata`: `{ title, description, tags, category, chapters: [{ time, title }] }`
  - `scenes`: `Scene[]`
  - `finalVideoUrl`, `thumbnailUrl`: string URLs
  - `totalDurationSeconds`, `renderProgress`: number
  - `renderLogs`: string[]
- **`Scene`**:
  - `id`: string
  - `sceneNumber`: number
  - `narration`: string
  - `visualDescription`, `imagePrompt`: string
  - `estimatedDurationSeconds`, `actualDurationSeconds`: number
  - `onScreenText`: string
  - `imageUrl`, `audioUrl`: string
  - `status`: `'pending' | 'ready' | 'error'`

### Filesystem Storage Structure
```
storage/
└── projects/
    └── proj_1789733870551_dy3uf/
        ├── project.json       # Project state document
        ├── scenes/            # scene_0.png, scene_1.png...
        ├── audio/             # scene_0.wav, scene_1.wav...
        ├── subtitles.srt      # Synchronized SRT caption file
        ├── thumbnail.png      # 1280x720 or 1080x1920 thumbnail
        └── video.mp4          # Final assembled H.264 / AAC video
```

---

## 6. FFmpeg Commands & Rendering Pipeline

1. **Audio Duration Probing (`getAudioDuration`)**:
   `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "<audioPath>"`
2. **Dynamic Ken Burns Scene Clip (`createSceneClip`)**:
   - Computes target resolution (1920x1080 for 16:9, 1080x1920 for 9:16) at 25 fps.
   - Alternates motion styles per scene (Slow Zoom In, Slow Zoom Out, Pan Right, Pan Left) using `zoompan` filter.
   - Encoding: `ffmpeg -y -loop 1 -t <duration> -i <image> -i <audio> -vf "<baseFilter>" -c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac -b:a 192k -shortest <outputClip>`
   - Fallback on filter failure: Uses clean scaling with pillarbox/letterbox padding.
3. **Clip Concatenation (`concatenateSceneClips`)**:
   - Generates `concat_list.txt` with absolute file references.
   - Merges timeline seamlessly: `ffmpeg -y -f concat -safe 0 -i concat_list.txt -c copy full_video_raw.mp4`
4. **Subtitles Synchronization & Burn-in (`burnSubtitles`)**:
   - Constructs standard SubRip `.srt` with computed millisecond chapter ranges.
   - Burns captions with high-contrast white text, black border, shadow, and vertical margin:
     `ffmpeg -y -i full_video_raw.mp4 -vf "subtitles=<srt>:force_style='Fontsize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=1,MarginV=35'" -c:a copy video.mp4`
   - Graceful fallback: If font library or subtitle filter fails, retains clean master video without crashing.
5. **Thumbnail Generation (`createThumbnail`)**:
   - Scales and crops the hero scene image to exact 1280x720 (or 1080x1920) at JPEG quality 2:
     `ffmpeg -y -i <image> -vf "scale=<w>:<h>:force_original_aspect_ratio=increase,crop=<w>:<h>" -q:v 2 thumbnail.png`

---

## 7. Dependencies, Build, & Configuration Audit

### Current Dependencies
- **Production (`dependencies`)**:
  - `@google/genai` (`^2.4.0`): Official Google GenAI SDK.
  - `@tailwindcss/vite` (`^4.3.3`): Tailwind v4 Vite plugin.
  - `@vitejs/plugin-react` (`^6.1.1`): Official React plugin for Vite.
  - `dotenv` (`^17.2.3`): Environment variable loader.
  - `express` (`^4.21.2`): Backend HTTP routing.
  - `lucide-react` (`^0.546.0`): Icon system.
  - `motion` (`^12.23.24`): Animation primitives.
  - `react` / `react-dom` (`^19.0.1`): React 19 view library.
  - `vite` (`^8.3.0`): Build tool & dev server.
- **Development (`devDependencies`)**:
  - `@types/express`, `@types/node`, `@types/react`, `@types/react-dom`
  - `autoprefixer` (`^10.4.21`): PostCSS plugin (legacy; Tailwind v4 has built-in vendor prefixing).
  - `esbuild` (`^0.25.0`): High-speed backend bundler.
  - `tailwindcss` (`^4.3.3`): Tailwind core.
  - `tsx` (`^4.21.0`): TypeScript Node runner.
  - `typescript` (`^7.0.2`): Type checker.

### Build & Typecheck Status
- `npm run lint` (`tsc --noEmit`): **Clean — 0 type errors.**
- `npm run build` (`vite build && esbuild ...`): **Clean — builds client to `dist/` and server to `dist/server.cjs`.**

---

## 8. Deficiencies, Risks, & Technical Debt Identified

### 8.1 Obvious Bugs & Technical Debt
1. **Missing `dotenv` Initialization in `server.ts`**:
   `dotenv` was listed in `package.json`, but `dotenv.config()` was not invoked in `server.ts`. When running locally in standalone Node or development mode, variables declared in `.env` (such as `GEMINI_API_KEY`) were not automatically populated into `process.env`.
2. **Temporary Artifact Accumulation**:
   Intermediate scene clip encodes (`scene_clip_*.mp4`) and `full_video_raw.mp4` were previously cleaned up only at the tail of the success path. If FFmpeg concatenation or subtitle burning failed, these multi-megabyte files remained orphaned indefinitely on disk.
3. **Silent Failure Masking**:
   Fallback catch blocks in subtitle burning and thumbnail generation called `console.warn` without bubbling notification back into `project.renderLogs`. Users could not tell if captions had been rendered or quietly skipped.
4. **Encoding Artifacts in Configuration Comments**:
   `vite.config.ts` contained non-ASCII byte sequence artifacts (`â€”`) in comments.

### 8.2 Security Risks
1. **Directory Traversal via `:id` Parameters**:
   Endpoints accepting project identifier paths (`/api/projects/:id/...`) previously passed the raw parameter directly to `path.join(PROJECTS_DIR, req.params.id)`. An unvalidated string like `../../etc` could traverse outside `storage/projects`.
2. **Improper Parameter Pollution in PATCH**:
   `app.patch('/api/projects/:id')` previously applied `Object.assign(project, req.body)` without sanitizing immutable fields, permitting malicious or accidental mutation of `id` or creation timestamps.
3. **Arbitrary File Access via Storage Static Mount**:
   The static mount `app.use('/storage', express.static(...))` serves from `PROJECTS_DIR`. Enforcing strict identifier format on all project creation and retrieval prevents malicious subpaths from being addressed.

### 8.3 Performance Bottlenecks
1. **Sequential Scene Image Generation**:
   `generateSceneImage` runs sequentially across all scenes in a project. For a 10-scene video, sequential Imagen/Gemini round-trips take 40–80 seconds. Batching image generation concurrently in groups of 3–4 with concurrency limits would drastically reduce stage duration.
2. **Synchronous File System I/O**:
   `storage.ts` uses synchronous `fs.readFileSync`, `fs.writeFileSync`, and `fs.readdirSync`. In high-load or multi-project environments, synchronous disk I/O blocks the Node event loop during large project saves.
3. **Single-Pass Video Encoding without Hardware Acceleration**:
   FFmpeg uses `libx264 -preset fast`. While universal, it does not leverage hardware encoders (VAAPI, NVENC, or VideoToolbox) when available locally.

### 8.4 Duplicated Logic
1. **Duplicated Video Assembly Engine**:
   The logic for verifying scene image/audio existence, rendering dynamic Ken Burns scene clips, concatenating via demuxer, compiling SRT captions, and burning subtitles was duplicated verbatim between `/api/projects/:id/assemble-video` and `/api/projects/:id/run-pipeline`.
2. **Duplicated Motion Calculations**:
   Ken Burns zoom and pan filter generation expressions were declared inline inside loop logic rather than cleanly configured presets.

### 8.5 Hard-Coded Configuration
1. **Rendering Parameters**:
   Framerate (`25 fps`), video dimensions (`1920x1080` for landscape, `1080x1920` for portrait), audio encoding bitrate (`192k aac`), and subtitle styling (`Fontsize=22`, `MarginV=35`) are hard-coded in command strings rather than centralized in a video configuration profile.
2. **Voice and Style Enums**:
   Supported voices (`Kore`, `Puck`, `Fenrir`, `Charon`, `Zephyr`) and video tones are duplicated between client-side types and server validation.

### 8.6 Missing Validation
1. **Project Creation Payload Validation**:
   Topic strings were not trimmed or checked for empty whitespace. Duration inputs were unvalidated against minimum/maximum thresholds.
2. **Scene Index Bounds Checking**:
   Single-scene regeneration routes (`/scenes/:sceneIndex/regenerate-image` and `/scenes/:sceneIndex/regenerate-audio`) parsed `parseInt(req.params.sceneIndex, 10)` without validating against `NaN`, negative indices, or array bounds.

### 8.7 Missing Recovery Mechanisms
1. **State Recovery on Pipeline Interruptions**:
   If the Node server restarts or crashes during a long-running video assembly, projects were left stuck in `status: "generating"` with no automatic heartbeat check or recovery mechanism to resume from the last completed scene.
2. **Exponential Backoff on AI Rate Limits**:
   Calls to Google GenAI lack exponential backoff / retry wrappers for transient `429 Too Many Requests` or `503 Service Unavailable` API responses.
3. **Resilient Scene Regeneration**:
   When re-running assembly, existing rendered scene clips were not cached or reused if scene images and audio had not changed, forcing full re-renders of identical clips.

---

## 9. Baseline Fixes Applied in this Phase

1. **Environment Loading**: Added `dotenv.config()` at the top of `server.ts`.
2. **Security & Path Sanitization**: Added strict `sanitizeProjectId` validation verifying project IDs match `^[a-zA-Z0-9_-]+$`, returning 400 Bad Request if invalid.
3. **Input Validation**:
   - Validated `aspectRatio` against allowed `'16:9'` | `'9:16'`.
   - Clamped `targetDurationMinutes` between `0.5` and `10.0`.
   - Validated `sceneIndex` as a non-negative integer within bounds.
   - Protected immutable project fields (`id`, `createdAt`) from `PATCH` pollution.
4. **Shared Assembly Engine**: Extracted assembly logic into a unified, reusable `assembleVideoPipeline` function in `server/ffmpeg.ts` / `server.ts`, eliminating code duplication between single-stage assembly and 1-click execution.
5. **Guaranteed Temp File Cleanup**: Placed intermediate video clip cleanup in a `finally` block to prevent disk space leaks on interrupted renders.
6. **Explicit Degraded State Notification**: Added explicit logging in `project.renderLogs` when subtitle burn-in falls back to clean video so users know the status of subtitle rendering.
7. **Vite & Tailwind Plugin Verification**: Verified `@tailwindcss/vite` configuration in `vite.config.ts` and `src/index.css` is clean, valid, and fully compatible with Vite 8 and Tailwind 4.

---

## 10. Conclusion & Next Steps

The project now possesses a robust, secure, and clean architectural baseline. All compilation scripts, TypeScript checks, and local runtime behaviors are validated and green. Subsequent phases can safely build upon this verified foundation.
