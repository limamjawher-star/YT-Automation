# Local AI YouTube Video Automation Pipeline

> A fully automated, locally-hosted system that creates YouTube videos end-to-end using Google AI tools — from topic input to an upload-ready MP4 file — controlled through a local web dashboard.

---

## 🎯 Architecture & Google AI Pipeline

This pipeline runs entirely on `localhost` and relies 100% on official Google tools and local FFmpeg:

| Pipeline Stage | Technology | What it does |
| :--- | :--- | :--- |
| **1. Script Generation** | **Gemini 3.8 Flash** (`@google/genai`) | Analyzes topic, drafts click-worthy YouTube title, description with chapter timestamps, SEO tags, and full narration script. |
| **2. Scene Planning** | **Gemini 3.8 Flash** | Breaks script into scene cards with estimated spoken seconds, on-screen text, and detailed image prompts in the chosen art style. |
| **3. Visual Generation** | **Google Imagen / Gemini AI** | Synthesizes scene visuals in 16:9 widescreen or 9:16 vertical Shorts format. Includes single-scene prompt editing & regeneration. |
| **4. Voiceover (TTS)** | **Google Cloud / Gemini TTS** (`gemini-3.1-flash-tts-preview`) | Generates natural voice narration audio for each scene with voice selection (`Kore`, `Puck`, `Fenrir`, `Charon`, `Zephyr`). |
| **5. Video Assembly** | **Local FFmpeg** (open-source) | Combines images and narration audio with smooth Ken Burns pan/zoom motion, synchronizes subtitle overlays (`.srt`), and encodes to H.264 MP4. |
| **6. Local Storage** | **Local File System** (`storage/projects/`) | Saves video, thumbnails, scene images, audio, and metadata organized by project ID. |

---

## ⚡ Quickstart: Single Command to Launch

### 1. Prerequisites
- **Node.js** v20+ installed
- **FFmpeg** installed on your system (e.g., `sudo apt install ffmpeg` on Ubuntu/Debian, `brew install ffmpeg` on macOS, or `winget install Gyan.FFmpeg` on Windows).

### 2. Configure Your Google API Key
Create a `.env` file in the project root:

```env
# Google AI Studio / Gemini API Key
GEMINI_API_KEY="your_google_api_key_here"
```

> **Where to get your key:**
> Get a free API key at [Google AI Studio](https://aistudio.google.com/). A single key powers Gemini text reasoning, image synthesis, and TTS voiceover!

### 3. Install Dependencies
```bash
npm install
```

### 4. Start the Application
Run the unified single command:

```bash
npm run dev
```

Open your browser at:
```
http://localhost:3000
```

---

## 🖥️ Local Dashboard Features

1. **Topic Input & Creative Controls**:
   - Aspect ratio: `16:9` (Standard YouTube) or `9:16` (YouTube Shorts)
   - Tone: `Engaging & Fast-Paced`, `Informative & Educational`, `Dramatic & Storytelling`, `Humorous & Entertaining`, `Mysterious & Documentary`, `Motivational & Inspiring`
   - Visual Styles: `Cinematic Photorealism`, `Digital Concept Art`, `Anime & Manga`, `3D Pixar Animation`, `Dark Atmospheric Noir`, `Minimalist Motion Vector`
   - Voice models: `Kore`, `Puck`, `Fenrir`, `Charon`, `Zephyr`
   - Target duration: `30s`, `1 min`, `2 min`, `3 min`

2. **Real-Time Progress Tracker & Logs**:
   - Live stage stepper across the 5 production phases.
   - Terminal console showing FFmpeg encoding, audio synthesis, and clip stitching logs.

3. **Stage-by-Stage Preview & Regeneration**:
   - **Script view**: Review title, SEO tags, chapter timestamps, and edit scene narration directly.
   - **Visuals gallery**: Inspect prompts, expand images in lightbox, and click **"Regenerate Image"** for individual scenes without redoing the rest.
   - **Voiceover manager**: Play audio tracks per scene, edit text, and re-synthesize speech.
   - **Video player**: Embedded HTML5 player with duration badges, chapters, and download options.

4. **1-Click YouTube Studio Export**:
   - Copy Title (CTR-optimized)
   - Copy Description with auto-formatted chapter markers (`00:00 Intro`, `00:05 Scene 1`, etc.)
   - Copy Tags
   - Download Rendered Video (`.mp4`)
   - Download Custom Thumbnail (`.png`)

5. **Project Library & History**:
   - Saved projects are stored persistently in `./storage/projects/<project_id>/`.
   - Browse past projects, re-render, download assets, or delete older projects.

---

## 📁 Local Output Storage Structure

Generated assets are organized locally by project ID in `./storage/`:

```
storage/
└── projects/
    └── proj_1740000000_abcde/
        ├── project.json       # Full project config, script, and YouTube metadata
        ├── scenes/            # Individual scene images (scene_0.png, scene_1.png...)
        ├── audio/             # Individual scene audio clips (scene_0.wav, scene_1.wav...)
        ├── subtitles.srt      # Synchronized caption track
        ├── thumbnail.png      # Generated YouTube thumbnail
        └── video.mp4          # Final assembled video file ready for upload
```

---

## 🛠️ Code Structure

```
├── server.ts                  # Express server entry point + Vite middleware
├── server/
│   ├── gemini.ts              # Google Gemini API & TTS service
│   ├── ffmpeg.ts              # Local FFmpeg video & audio assembly engine
│   └── storage.ts             # Local project filesystem persistence
├── src/
│   ├── App.tsx                # Main pipeline dashboard controller
│   ├── types.ts               # TypeScript data models and pipeline interfaces
│   └── components/
│       ├── Header.tsx         # Top bar with local status & library controls
│       ├── StageProgressBar.tsx # 5-stage pipeline navigation tracker
│       ├── ProjectConfigForm.tsx # Setup form with topic presets & styles
│       ├── ScriptStageView.tsx # Script & YouTube metadata review
│       ├── VisualsStageView.tsx # Scene visual cards with prompt inspector
│       ├── VoiceoverStageView.tsx # TTS audio player & voice editor
│       ├── AssemblyStageView.tsx # Video player & YouTube copy exporter
│       ├── ProjectHistoryModal.tsx # Project library manager
│       └── SetupReadmeModal.tsx # In-app quickstart instructions
└── package.json
```

---

## 📜 License
Apache-2.0
