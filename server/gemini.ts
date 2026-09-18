import { Type } from '@google/genai';
import path from 'path';
import {
  AiScriptResponse,
  ResearchResult,
  ResearchResultSchema,
  Scene,
  validateAiScriptResponse,
  VideoAspectRatio,
  VideoProject,
  VideoTone,
  VisualStyle,
  VoiceName,
  YouTubeMetadata,
  YouTubeMetadataSchema,
} from '../src/types.js';
import {
  getTextProvider,
  getImageProvider,
  getVoiceProvider,
  getAiConfig,
  aiLogger,
  concurrencyManager,
  assetCache,
} from './ai/index.js';
import { pcmToWavBuffer } from './ai/providers/googleVoiceProvider.js';

export {
  getTextProvider,
  getImageProvider,
  getVoiceProvider,
  getAiConfig,
  aiLogger,
  concurrencyManager,
  assetCache,
};

export interface AiExecutionOptions {
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void;
  skipCache?: boolean;
}

export function hasApiKey(): boolean {
  return !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0;
}

// Re-export PCM to WAV converter
export function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  return pcmToWavBuffer(pcmBuffer, sampleRate, channels, bitsPerSample);
}

export async function generateScriptAndScenes(
  params: {
    topic: string;
    tone: VideoTone;
    visualStyle: VisualStyle;
    aspectRatio: VideoAspectRatio;
    targetDurationMinutes: number;
    research?: ResearchResult;
  },
  options: AiExecutionOptions = {}
): Promise<{
  title: string;
  script: string;
  youtubeMetadata: YouTubeMetadata;
  scenes: Scene[];
}> {
  if (options.signal?.aborted) {
    const err = new Error('Script generation aborted');
    err.name = 'AbortError';
    throw err;
  }

  const sceneCount = params.targetDurationMinutes <= 0.5 ? 3 : params.targetDurationMinutes <= 1 ? 4 : 6;

  // Grounding block from approved/reviewed research
  let researchGroundingText = '';
  if (params.research) {
    const r = params.research;
    const verifiedFacts = r.facts?.filter(f => f.status === 'verified').map(f => f.fact) || [];
    const reviewedFacts = r.facts?.map(f => `[${f.status}] ${f.fact}`) || [];
    const dates = r.dates?.map(d => `${d.date}: ${d.event}`) || [];
    const names = r.names?.map(n => `${n.name} (${n.role})`) || [];
    const numbers = r.numbers?.map(n => `${n.metric}: ${n.value} (${n.context})`) || [];
    const events = r.events?.map(e => `${e.title}: ${e.description}`) || [];
    const claims = r.claims?.map(c => `[${c.claimType} - ${c.status}] ${c.claim}`) || [];
    const uncertainties = r.uncertaintyFlags?.map(u => `${u.item} (Flag: ${u.reason})`) || [];
    const questions = r.openQuestions?.map(q => q.question) || [];

    researchGroundingText = `
APPROVED RESEARCH BRIEF & GROUND TRUTH (STRICT COMPLIANCE MANDATE):
- Verified/Supported Facts: ${verifiedFacts.length > 0 ? verifiedFacts.join('; ') : 'None marked verified by user yet. Use reviewed facts.'}
- Reviewed Facts: ${reviewedFacts.join('; ') || 'N/A'}
- Key Chronology & Dates: ${dates.join('; ') || 'N/A'}
- Key Names & Historical/Domain Figures: ${names.join('; ') || 'N/A'}
- Key Metrics & Numerical Evidence: ${numbers.join('; ') || 'N/A'}
- Important Events: ${events.join('; ') || 'N/A'}
- Claims (Factual vs Speculative): ${claims.join('; ') || 'N/A'}
- CRITICAL UNCERTAINTIES & NUANCE: ${uncertainties.join('; ') || 'None noted'}
- Open Questions to Address: ${questions.join('; ') || 'N/A'}
- User Research Notes: ${r.userNotes || 'None'}
- User Provided Sources: ${r.userProvidedSources || 'None'}

GROUNDING INSTRUCTIONS:
1. Ground the script strictly in the factual data, dates, figures, and numbers from the research brief above.
2. DO NOT present uncertain, speculative, or contested claims as established facts. Frame them with journalistic accuracy and investigative intrigue.
3. Weave the specific dates, names, and numbers into the voiceover narration.
`;
  }

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
   - onScreenText: punchy 3-7 word caption or headline for on-screen overlay.
${researchGroundingText ? '\nYou MUST strictly incorporate the provided research brief and respect all uncertainty boundaries.' : ''}`;

  const prompt = `Topic: "${params.topic}"
Tone: ${params.tone}
Visual Style: ${params.visualStyle}
Aspect Ratio: ${params.aspectRatio}
Target Duration: ${params.targetDurationMinutes} minute(s)
Scene Count: exactly ${sceneCount} scenes.
${researchGroundingText}`;

  const scriptSchema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      category: { type: Type.STRING },
      description: { type: Type.STRING },
      tags: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
      },
      fullScript: { type: Type.STRING },
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
          required: [
            'sceneNumber',
            'narration',
            'visualDescription',
            'imagePrompt',
            'estimatedDurationSeconds',
            'onScreenText',
          ],
        },
      },
    },
    required: ['title', 'description', 'tags', 'scenes'],
  };

  let validatedAiData: AiScriptResponse | null = null;

  if (hasApiKey()) {
    try {
      const textProvider = getTextProvider();
      const result = await textProvider.generateStructured<AiScriptResponse>(
        {
          prompt,
          systemInstruction,
          schema: scriptSchema,
          validator: (raw) => validateAiScriptResponse(raw),
          operation: 'script_and_scenes_generation',
        },
        options
      );
      validatedAiData = result.data;
    } catch (err: any) {
      if (options.signal?.aborted || err?.name === 'AbortError') {
        throw err;
      }
      console.warn('[AI] Script generation via TextProvider failed, using structured fallback:', err?.message || err);
    }
  }

  // If AI output was unavailable or failed schema validation, construct an engaging structured fallback
  let scriptPayload: AiScriptResponse;
  if (validatedAiData && validatedAiData.scenes && validatedAiData.scenes.length > 0) {
    scriptPayload = validatedAiData;
  } else {
    const defaultTitle = `${params.topic}: Everything You Need to Know`;
    const defaultTags = [
      params.topic.split(' ')[0],
      'YouTubeAutomation',
      'AIVideo',
      'Explainers',
      params.visualStyle.replace(/\s+/g, ''),
      'Educational',
      'DeepDive',
    ];

    // Build fallback scenes utilizing research when available
    const r = params.research;
    const keyFactText = r?.facts?.[0]?.fact || `The core mechanisms behind ${params.topic}`;
    const keyDateText = r?.dates?.[0] ? `in ${r.dates[0].date}, when ${r.dates[0].event}` : `throughout its documented evolution`;
    const keyMetricText = r?.numbers?.[0] ? `${r.numbers[0].metric} measuring ${r.numbers[0].value}` : `significant measurable shifts`;
    const keyNameText = r?.names?.[0] ? `pioneered by figures like ${r.names[0].name}` : `shaped by leading experts and researchers`;

    scriptPayload = {
      title: defaultTitle,
      category: 'Science & Technology',
      description: `In this comprehensive guide, we explore the verified facts and critical questions surrounding ${params.topic}.\n\nTimestamps and deep dive breakdowns included.\n\n#${params.topic.replace(/\s+/g, '')} #AI #Automation`,
      tags: defaultTags,
      fullScript: '',
      scenes: Array.from({ length: sceneCount }).map((_, i) => {
        const secDuration = Math.round((params.targetDurationMinutes * 60) / sceneCount);
        let sceneNarration = '';
        let sceneOverlay = '';

        if (i === 0) {
          sceneNarration = `What if everything you thought you knew about ${params.topic} was only part of the story? Today, we examine the grounded facts and surprising numbers.`;
          sceneOverlay = `The Truth About ${params.topic}`;
        } else if (i === 1) {
          sceneNarration = `First, consider the historical context: ${keyDateText}, ${keyNameText}. This marked a pivotal inflection point that changed everything.`;
          sceneOverlay = `The Pivotal Turning Point`;
        } else if (i === sceneCount - 1) {
          sceneNarration = `As open questions remain and research continues, ${params.topic} stands as a defining challenge. Subscribe for further deep dive investigations.`;
          sceneOverlay = 'The Final Verdict';
        } else {
          sceneNarration = `Looking closely at the data, ${keyFactText}. Analysts highlight ${keyMetricText}, proving how foundational this development has become.`;
          sceneOverlay = `Key Evidence & Metrics`;
        }

        return {
          sceneNumber: i,
          narration: sceneNarration,
          visualDescription: `Cinematic visualization illustrating key concepts of ${params.topic}, scene ${i + 1}`,
          imagePrompt: `Cinematic high-detail scene representing ${params.topic}, part ${i + 1}, modern lighting, detailed atmosphere, ${params.visualStyle} aesthetic, highly rendered`,
          estimatedDurationSeconds: Math.max(4, secDuration),
          onScreenText: sceneOverlay,
        };
      }),
    };
  }

  let cumulativeSeconds = 0;
  const chapters: { time: string; title: string }[] = [];
  const scenes: Scene[] = (scriptPayload.scenes || []).map((s, idx) => {
    const minutes = Math.floor(cumulativeSeconds / 60);
    const secs = Math.floor(cumulativeSeconds % 60);
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    chapters.push({
      time: timeStr,
      title: s.onScreenText || `Scene ${idx + 1}`,
    });

    const duration = Math.max(1, Number(s.estimatedDurationSeconds) || 5);
    cumulativeSeconds += duration;

    const rawScene: Scene = {
      id: `scene-${idx}-${Date.now()}`,
      sceneNumber: idx,
      narration: (s.narration || '').trim() || `Scene ${idx + 1} narration.`,
      visualDescription: s.visualDescription || '',
      imagePrompt: s.imagePrompt || '',
      estimatedDurationSeconds: duration,
      onScreenText: (s.onScreenText || '').trim() || `Scene ${idx + 1}`,
      status: 'pending',
    };

    return rawScene;
  });

  const parsedYoutubeMetadata: YouTubeMetadata = {
    title: (scriptPayload.title || `${params.topic} Explained`).slice(0, 100),
    description: scriptPayload.description || '',
    tags: scriptPayload.tags && scriptPayload.tags.length > 0
      ? scriptPayload.tags
      : [params.topic, 'AI Video', 'YouTube Automation'],
    category: scriptPayload.category || 'Education',
    chapters,
  };

  return {
    title: parsedYoutubeMetadata.title,
    script: scriptPayload.fullScript || scenes.map((s) => s.narration).join(' '),
    youtubeMetadata: YouTubeMetadataSchema.parse(parsedYoutubeMetadata),
    scenes,
  };
}

export async function generateSceneImage(
  project: VideoProject,
  sceneIndex: number,
  outputPngPath: string,
  customPrompt?: string,
  options: AiExecutionOptions = {}
): Promise<string> {
  if (options.signal?.aborted) {
    const err = new Error('Image generation aborted');
    err.name = 'AbortError';
    throw err;
  }

  const scene = project.scenes[sceneIndex];
  if (!scene) throw new Error(`Scene ${sceneIndex} not found`);

  const promptToUse = customPrompt || scene.imagePrompt || scene.visualDescription;
  const imageProvider = getImageProvider();

  await imageProvider.generateImage(
    {
      prompt: promptToUse,
      visualStyle: project.visualStyle,
      aspectRatio: project.aspectRatio === '9:16' ? '9:16' : '16:9',
      outputFilePath: outputPngPath,
      operation: `scene_image_${sceneIndex}`,
    },
    options
  );

  return `/storage/projects/${project.id}/scenes/${path.basename(outputPngPath)}?t=${Date.now()}`;
}

export async function generateSceneVoiceover(
  project: VideoProject,
  sceneIndex: number,
  outputWavPath: string,
  voice: VoiceName = 'Kore',
  options: AiExecutionOptions = {}
): Promise<{ audioUrl: string; duration: number }> {
  if (options.signal?.aborted) {
    const err = new Error('Voiceover generation aborted');
    err.name = 'AbortError';
    throw err;
  }

  const scene = project.scenes[sceneIndex];
  if (!scene) throw new Error(`Scene ${sceneIndex} not found`);

  const narrationText = scene.narration.trim();
  if (!narrationText) {
    throw new Error(`Scene ${sceneIndex} has no narration text`);
  }

  const voiceProvider = getVoiceProvider();
  const result = await voiceProvider.generateVoice(
    {
      text: narrationText,
      voiceName: voice,
      outputFilePath: outputWavPath,
      estimatedDurationSeconds: scene.estimatedDurationSeconds || 5,
      operation: `scene_voice_${sceneIndex}`,
    },
    options
  );

  return {
    audioUrl: `/storage/projects/${project.id}/audio/${path.basename(outputWavPath)}?t=${Date.now()}`,
    duration: result.durationSeconds,
  };
}

export async function generateTopicResearch(
  params: {
    topic: string;
    tone?: string;
    targetDurationMinutes?: number;
    userProvidedSources?: string;
    userResearchNotes?: string;
  },
  options: AiExecutionOptions = {}
): Promise<ResearchResult> {
  const genId = (prefix: string, idx: number) => `${prefix}-${Date.now()}-${idx}`;

  const cleanSources = params.userProvidedSources?.trim() || '';
  const cleanNotes = params.userResearchNotes?.trim() || '';

  // Realistic, provider-agnostic fallback research with strict integrity (needs_review / uncertain)
  const fallbackResearch: ResearchResult = {
    topic: params.topic,
    status: 'needs_review',
    targetAudience: 'General audience, creators, researchers, and curious learners',
    summary: `Structured factual brief on "${params.topic}". All generated claims and data points require editorial verification before final publication.`,
    hookSuggestions: [
      `The untold truth about ${params.topic}`,
      `Why everything you know about ${params.topic} is wrong`,
      `The surprising reality behind ${params.topic}`,
    ],
    keyPoints: [
      `Core fundamentals and underlying mechanisms of ${params.topic}`,
      `Historical milestones and pivotal inflection points`,
      `Measurable economic, technological, and societal impacts`,
      `Open questions and active points of debate in the domain`,
    ],
    facts: [
      {
        id: genId('fact', 1),
        fact: `${params.topic} has developed through distinct technological and conceptual cycles.`,
        status: 'needs_review',
        source: cleanSources ? 'User-provided documentation' : 'General scientific consensus & domain literature',
        notes: 'Needs confirmation of specific terminology',
      },
      {
        id: genId('fact', 2),
        fact: `Modern implementations of ${params.topic} rely on distributed computational models and structured evaluation benchmarks.`,
        status: 'needs_review',
        source: 'Technical literature & industry whitepapers',
      },
      {
        id: genId('fact', 3),
        fact: `Leading practitioners observe a high variance in real-world efficacy depending on operational constraints.`,
        status: 'uncertain',
        source: 'Empirical case studies',
        notes: 'Conflicting benchmarks reported across different cohorts',
      },
    ],
    dates: [
      {
        id: genId('date', 1),
        date: 'Recent Era',
        event: `Initial public breakthroughs and foundational architectures introduced for ${params.topic}.`,
        status: 'needs_review',
        source: 'Historical archives',
      },
      {
        id: genId('date', 2),
        date: 'Current Cycle',
        event: `Rapid scaling and commercialization efforts across the ${params.topic} ecosystem.`,
        status: 'needs_review',
        source: 'Industry reports',
      },
    ],
    names: [
      {
        id: genId('name', 1),
        name: 'Domain Specialists & Research Group Authors',
        role: `Pioneers behind key theoretical breakthroughs in ${params.topic}.`,
        status: 'needs_review',
      },
    ],
    numbers: [
      {
        id: genId('num', 1),
        metric: 'Annual Growth / Adoption Rate',
        value: 'Multi-fold expansion',
        context: `Reflects surging interest and capital allocation into ${params.topic}.`,
        status: 'needs_review',
        source: 'Market analysis datasets',
      },
      {
        id: genId('num', 2),
        metric: 'Efficiency Benchmark',
        value: '30% - 70%',
        context: `Estimated productivity improvements reported in preliminary pilots.`,
        status: 'uncertain',
        source: 'Vendor whitepapers',
      },
    ],
    events: [
      {
        id: genId('evt', 1),
        title: 'The Breakthrough Disclosure',
        description: `Release of foundational research and open benchmarks demonstrating the viability of ${params.topic}.`,
        timeframe: 'Inception Phase',
        status: 'needs_review',
      },
      {
        id: genId('evt', 2),
        title: 'Mainstream Adoption Wave',
        description: `Widespread deployment across consumer and enterprise environments.`,
        timeframe: 'Current Period',
        status: 'needs_review',
      },
    ],
    claims: [
      {
        id: genId('claim', 1),
        claim: `${params.topic} represents a paradigm shift rather than an incremental optimization.`,
        claimType: 'contested',
        status: 'needs_review',
        source: 'Industry perspectives',
        notes: 'Proponents argue paradigm shift; skeptics point to historical precedent.',
      },
      {
        id: genId('claim', 2),
        claim: `Long-term operational costs will decrease exponentially as tooling matures.`,
        claimType: 'speculative',
        status: 'uncertain',
        source: 'Theoretical forecasts',
        notes: 'Speculative projection based on historical compute curves.',
      },
    ],
    sources: cleanSources
      ? [
          {
            id: genId('src', 1),
            title: 'User-Provided Reference Material',
            citationOrUrl: cleanSources.slice(0, 150),
            reliability: 'high',
            notes: 'Supplied directly by creator',
          },
        ]
      : [
          {
            id: genId('src', 1),
            title: 'Comprehensive Domain Literature & Peer-Reviewed Proceedings',
            citationOrUrl: `Standard academic & trade references on ${params.topic}`,
            reliability: 'medium',
            notes: 'Primary literature review needed',
          },
        ],
    uncertaintyFlags: [
      {
        id: genId('unc', 1),
        item: `Long-term reproducibility of preliminary findings in ${params.topic}`,
        reason: 'Empirical data remains limited to short observation windows and specialized testbeds.',
        level: 'high',
      },
      {
        id: genId('unc', 2),
        item: 'Exact timeline for complete widespread saturation',
        reason: 'Subject to external economic and regulatory headwinds.',
        level: 'medium',
      },
    ],
    openQuestions: [
      {
        id: genId('q', 1),
        question: `What are the second-order societal consequences if ${params.topic} accelerates unchecked?`,
        context: 'Ethical and economic distribution',
      },
      {
        id: genId('q', 2),
        question: `How will regulatory frameworks evolve to govern ${params.topic}?`,
        context: 'Global policy landscape',
      },
    ],
    userNotes: cleanNotes,
    userProvidedSources: cleanSources,
    competitiveAngles: ['Deep-dive explanation', 'Myth-busting perspective', 'Cinematic investigative storytelling'],
    recommendedLengthMinutes: params.targetDurationMinutes || 1.0,
    keywords: [params.topic.toLowerCase(), 'explained', 'science', 'facts', 'guide', 'deep dive'],
    updatedAt: new Date().toISOString(),
  };

  if (!hasApiKey()) {
    return fallbackResearch;
  }

  try {
    const textProvider = getTextProvider();
    const systemInstruction = `You are a meticulous, provider-agnostic documentary research director and fact-checker.
Your mission is to compile an authoritative, structured research dossier on the provided topic.

CRITICAL INTEGRITY & FACT-CHECKING MANDATE:
- "DO NOT present generated claims as verified facts."
- You MUST classify every generated item (facts, dates, names, numbers, events, claims) with status 'needs_review' or 'uncertain'.
- NEVER assign status 'verified' to any item in your output. The 'verified' label is exclusively reserved for human review and confirmed empirical ground truth.
- Flag any contested assertions, speculations, or empirical uncertainties transparently under uncertaintyFlags and claims.
- If user-provided sources or research notes are provided, incorporate them faithfully into the research dossier.`;

    const userSourceNotice = cleanSources ? `\nUser Provided Sources:\n${cleanSources}` : '';
    const userNotesNotice = cleanNotes ? `\nUser Research Notes:\n${cleanNotes}` : '';

    const prompt = `Topic: "${params.topic}"
Tone: ${params.tone || 'Engaging & Fast-Paced'}
Target Duration: ${params.targetDurationMinutes || 1} minutes${userSourceNotice}${userNotesNotice}

Please produce a comprehensive structured research object with:
1. summary (clear 2-3 sentence overview)
2. targetAudience
3. hookSuggestions (3 compelling viral angles)
4. keyPoints (3-5 core takeaways)
5. facts: array of { id, fact, status: 'needs_review' | 'uncertain', source, notes }
6. dates: array of { id, date, event, status: 'needs_review' | 'uncertain', source }
7. names: array of { id, name, role, status: 'needs_review' | 'uncertain' }
8. numbers: array of { id, metric, value, context, status: 'needs_review' | 'uncertain', source }
9. events: array of { id, title, description, timeframe, status: 'needs_review' | 'uncertain' }
10. claims: array of { id, claim, claimType: 'factual' | 'speculative' | 'contested', status: 'needs_review' | 'uncertain', source, notes }
11. sources: array of { id, title, citationOrUrl, reliability: 'high' | 'medium' | 'low', notes }
12. uncertaintyFlags: array of { id, item, reason, level: 'high' | 'medium' | 'low' }
13. openQuestions: array of { id, question, context }`;

    const researchSchema = {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING },
        summary: { type: Type.STRING },
        targetAudience: { type: Type.STRING },
        hookSuggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
        facts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              fact: { type: Type.STRING },
              status: { type: Type.STRING },
              source: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ['id', 'fact', 'status'],
          },
        },
        dates: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              date: { type: Type.STRING },
              event: { type: Type.STRING },
              status: { type: Type.STRING },
              source: { type: Type.STRING },
            },
            required: ['id', 'date', 'event', 'status'],
          },
        },
        names: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              name: { type: Type.STRING },
              role: { type: Type.STRING },
              status: { type: Type.STRING },
            },
            required: ['id', 'name', 'role', 'status'],
          },
        },
        numbers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              metric: { type: Type.STRING },
              value: { type: Type.STRING },
              context: { type: Type.STRING },
              status: { type: Type.STRING },
              source: { type: Type.STRING },
            },
            required: ['id', 'metric', 'value', 'context', 'status'],
          },
        },
        events: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              timeframe: { type: Type.STRING },
              status: { type: Type.STRING },
            },
            required: ['id', 'title', 'description', 'status'],
          },
        },
        claims: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              claim: { type: Type.STRING },
              claimType: { type: Type.STRING },
              status: { type: Type.STRING },
              source: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ['id', 'claim', 'status'],
          },
        },
        sources: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              citationOrUrl: { type: Type.STRING },
              reliability: { type: Type.STRING },
              notes: { type: Type.STRING },
            },
            required: ['id', 'title', 'citationOrUrl'],
          },
        },
        uncertaintyFlags: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              item: { type: Type.STRING },
              reason: { type: Type.STRING },
              level: { type: Type.STRING },
            },
            required: ['id', 'item', 'reason', 'level'],
          },
        },
        openQuestions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              question: { type: Type.STRING },
              context: { type: Type.STRING },
            },
            required: ['id', 'question'],
          },
        },
      },
      required: ['topic', 'hookSuggestions', 'keyPoints', 'facts', 'claims', 'uncertaintyFlags'],
    };

    const result = await textProvider.generateStructured<any>(
      {
        prompt,
        systemInstruction,
        schema: researchSchema,
        validator: (raw) => {
          if (!raw || typeof raw !== 'object') {
            return { success: false, errors: 'Research payload is not an object' };
          }
          return { success: true, data: raw };
        },
        operation: 'topic_research',
      },
      options
    );

    const rawData = result.data;

    // MANDATORY INTEGRITY SANITIZATION:
    // "Do not present generated claims as verified facts."
    // Ensure that NO generated item is marked 'verified'.
    const sanitizeStatus = (status: any): 'needs_review' | 'uncertain' => {
      return status === 'uncertain' ? 'uncertain' : 'needs_review';
    };

    const sanitizedData: ResearchResult = {
      topic: rawData.topic || params.topic,
      status: 'needs_review',
      targetAudience: rawData.targetAudience || 'General audience, creators, and curious learners',
      summary: rawData.summary || `Research brief on ${params.topic}`,
      hookSuggestions: Array.isArray(rawData.hookSuggestions) && rawData.hookSuggestions.length > 0
        ? rawData.hookSuggestions
        : fallbackResearch.hookSuggestions,
      keyPoints: Array.isArray(rawData.keyPoints) && rawData.keyPoints.length > 0
        ? rawData.keyPoints
        : fallbackResearch.keyPoints,
      facts: (rawData.facts || []).map((f: any, i: number) => ({
        id: f.id || genId('fact', i + 1),
        fact: String(f.fact || ''),
        status: sanitizeStatus(f.status),
        source: f.source ? String(f.source) : undefined,
        notes: f.notes ? String(f.notes) : undefined,
      })),
      dates: (rawData.dates || []).map((d: any, i: number) => ({
        id: d.id || genId('date', i + 1),
        date: String(d.date || ''),
        event: String(d.event || ''),
        status: sanitizeStatus(d.status),
        source: d.source ? String(d.source) : undefined,
      })),
      names: (rawData.names || []).map((n: any, i: number) => ({
        id: n.id || genId('name', i + 1),
        name: String(n.name || ''),
        role: String(n.role || ''),
        status: sanitizeStatus(n.status),
      })),
      numbers: (rawData.numbers || []).map((num: any, i: number) => ({
        id: num.id || genId('num', i + 1),
        metric: String(num.metric || ''),
        value: String(num.value || ''),
        context: String(num.context || ''),
        status: sanitizeStatus(num.status),
        source: num.source ? String(num.source) : undefined,
      })),
      events: (rawData.events || []).map((e: any, i: number) => ({
        id: e.id || genId('evt', i + 1),
        title: String(e.title || ''),
        description: String(e.description || ''),
        timeframe: e.timeframe ? String(e.timeframe) : undefined,
        status: sanitizeStatus(e.status),
      })),
      claims: (rawData.claims || []).map((c: any, i: number) => ({
        id: c.id || genId('claim', i + 1),
        claim: String(c.claim || ''),
        claimType: ['factual', 'speculative', 'contested'].includes(c.claimType) ? c.claimType : 'factual',
        status: sanitizeStatus(c.status),
        source: c.source ? String(c.source) : undefined,
        notes: c.notes ? String(c.notes) : undefined,
      })),
      sources: (rawData.sources || []).map((s: any, i: number) => ({
        id: s.id || genId('src', i + 1),
        title: String(s.title || ''),
        citationOrUrl: String(s.citationOrUrl || ''),
        reliability: ['high', 'medium', 'low'].includes(s.reliability) ? s.reliability : 'medium',
        notes: s.notes ? String(s.notes) : undefined,
      })),
      uncertaintyFlags: (rawData.uncertaintyFlags || []).map((u: any, i: number) => ({
        id: u.id || genId('unc', i + 1),
        item: String(u.item || ''),
        reason: String(u.reason || ''),
        level: ['high', 'medium', 'low'].includes(u.level) ? u.level : 'medium',
      })),
      openQuestions: (rawData.openQuestions || []).map((q: any, i: number) => ({
        id: q.id || genId('q', i + 1),
        question: String(q.question || ''),
        context: q.context ? String(q.context) : undefined,
      })),
      userNotes: cleanNotes,
      userProvidedSources: cleanSources,
      competitiveAngles: Array.isArray(rawData.competitiveAngles) ? rawData.competitiveAngles : fallbackResearch.competitiveAngles,
      recommendedLengthMinutes: Number(rawData.recommendedLengthMinutes) || params.targetDurationMinutes || 1.0,
      keywords: Array.isArray(rawData.keywords) ? rawData.keywords : fallbackResearch.keywords,
      updatedAt: new Date().toISOString(),
    };

    // If user provided sources, ensure they are in the sources list
    if (cleanSources && !sanitizedData.sources.some(s => s.citationOrUrl.includes(cleanSources.slice(0, 30)))) {
      sanitizedData.sources.unshift({
        id: genId('src', 0),
        title: 'User-Provided Reference',
        citationOrUrl: cleanSources,
        reliability: 'high',
        notes: 'Supplied directly by user',
      });
    }

    return sanitizedData;
  } catch (err: any) {
    if (options.signal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    console.warn('[AI] Research generation failed, using structured fallback:', err);
  }

  return fallbackResearch;
}
