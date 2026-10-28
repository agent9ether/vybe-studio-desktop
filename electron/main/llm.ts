import { getSettings, LLM_PRESETS } from "./settings";

// Lyrics / title / style generation through any OpenAI-compatible chat API
// (Ollama, LM Studio, OpenAI, OpenRouter, MiniMax, NVIDIA NIM, …).
// When no LLM is configured, built-in template songs are used instead.

export type LyricsRequest = {
  prompt: string;
  instrumental?: boolean;
  /** Compact = exactly 5 short sections (for engines with tight lyric limits). */
  compact?: boolean;
  customLyrics?: string;
};

export type LyricsResult = { title: string; style: string; lyrics: string; usedFallback?: boolean };

function extractJson(text: string): unknown {
  const trimmed = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 1. Try direct parse (response_format: json_object should give clean JSON)
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. Strip markdown code fences
  const cleaned = trimmed
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {}

  // 3. Extract first {...} block
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    const candidate = cleaned.substring(objStart, objEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        const fixed = candidate
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]")
          // eslint-disable-next-line no-control-regex -- strip stray control chars from model output
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
        return JSON.parse(fixed);
      } catch {}
    }
  }

  // 4. Plain lyrics fallback
  if (trimmed.includes("[Verse") || trimmed.includes("[Chorus") || trimmed.includes("[Intro")) {
    return { title: "New Song", style: "Pop", lyrics: trimmed };
  }

  // 5. Ultimate fallback (never crash!)
  return {
    title: "AI Draft",
    style: "Pop",
    lyrics: trimmed || "No lyrics were generated.",
  };
}

function normalizeLyrics(raw: string, isCompact: boolean): string {
  // Models occasionally return lyrics with HTML line breaks (<br>, <br/>, <br />)
  // or escaped newlines instead of real \n. Normalize before any further parsing.
  raw = raw
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\n/g, "\n");

  if (raw.toLowerCase().includes("[instrumental]")) {
    return "[instrumental]";
  }

  if (!isCompact) {
    // Keep full lyrics but format it beautifully (clean spacing and casing of section tags)
    const lines = raw.split("\n");
    const cleanedLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== "") {
          cleanedLines.push("");
        }
        continue;
      }

      const match = trimmed.match(/^\[([^\]]+)\]$/);
      if (match) {
        const tag = match[1].trim();
        // Capitalize first letter of each word in the tag (e.g. [Verse 1], [Pre-Chorus])
        const normalizedTag = tag
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        cleanedLines.push(`[${normalizedTag}]`);
      } else {
        cleanedLines.push(trimmed);
      }
    }
    let joined = cleanedLines.join("\n").trim();
    // Replace 3+ consecutive newlines with exactly 2
    joined = joined.replace(/\n{3,}/g, "\n\n");
    return joined;
  }

  // Split by line and extract sections
  const lines = raw.split("\n");
  const sections: { tag: string; lines: string[] }[] = [];
  let currentSection: { tag: string; lines: string[] } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (
        currentSection &&
        currentSection.lines.length > 0 &&
        currentSection.lines[currentSection.lines.length - 1] !== ""
      ) {
        currentSection.lines.push("");
      }
      continue;
    }

    const match = trimmed.match(/^\[([^\]]+)\]$/);
    if (match) {
      // It's a section tag! Normalize the tag name (strip numbers and lowercase/capitalize)
      let normalizedTag = match[1].toLowerCase().replace(/\d+/g, "").trim();
      if (normalizedTag.includes("intro")) normalizedTag = "Intro";
      else if (normalizedTag.includes("verse")) normalizedTag = "Verse";
      else if (normalizedTag.includes("chorus")) normalizedTag = "Chorus";
      else if (normalizedTag.includes("bridge")) normalizedTag = "Bridge";
      else if (normalizedTag.includes("outro")) normalizedTag = "Outro";
      else if (normalizedTag.includes("pre-chorus") || normalizedTag.includes("prechorus"))
        normalizedTag = "Verse"; // fallback pre-chorus to verse
      else normalizedTag = "Verse"; // default fallback

      currentSection = { tag: normalizedTag, lines: [] };
      sections.push(currentSection);
    } else {
      if (currentSection) {
        currentSection.lines.push(trimmed);
      } else {
        // Text before any section tag, let's treat it as an Intro section
        currentSection = { tag: "Intro", lines: [trimmed] };
        sections.push(currentSection);
      }
    }
  }

  // Clean empty lines at the end of each section
  for (const sec of sections) {
    while (sec.lines.length > 0 && sec.lines[sec.lines.length - 1] === "") {
      sec.lines.pop();
    }
  }

  // Group sections by their normalized tag name
  const grouped: Record<string, string[]> = {};
  for (const sec of sections) {
    if (!grouped[sec.tag]) {
      grouped[sec.tag] = sec.lines;
    } else {
      // Append lines to the existing group of this type
      grouped[sec.tag].push(...sec.lines);
    }
  }

  // We strictly want exactly: Intro, Verse, Chorus, Bridge, Outro
  const introLines = (grouped["Intro"] || []).filter((l) => l !== "");
  const verseLines = (grouped["Verse"] || []).filter((l) => l !== "");
  const chorusLines = (grouped["Chorus"] || []).filter((l) => l !== "");
  const bridgeLines = (grouped["Bridge"] || []).filter((l) => l !== "");
  const outroLines = (grouped["Outro"] || []).filter((l) => l !== "");

  const fallbackIntro = [
    "Hear the synthesizers start to rise,",
    "Waking up the sleeping summer skies.",
    "Get ready for a brand new sweet beat,",
    "Dancing in the middle of the street.",
  ];

  const fallbackVerse = [
    "In the neon glow of this silent street,",
    "Walking on memories, listening to the beat.",
    "Just another daydream of you and me,",
    "Hoping that one day we'll set it free.",
  ];

  const fallbackChorus = [
    "Oh, summer crush got me feeling so sweet,",
    "Swept away by the rhythm of the street,",
    "Underneath the stars, where we belong,",
    "Lost in the music of our favorite song.",
  ];

  const fallbackBridge = [
    "Hold on tight, let the feeling take flight,",
    "In the magic of the starry night,",
    "No more doubts, no more fears to hide,",
    "With you forever, right by my side.",
  ];

  const fallbackOutro = [
    "Lost in your light, we fade away,",
    "Into the dawn of a brighter day,",
    "Just you and me, the stars above,",
    "Locked forever in this summer love.",
  ];

  // Helper to ensure exactly 4 lines per section (by padding or slicing)
  const ensureFourLines = (lines: string[], fallback: string[]): string[] => {
    const clean = lines.filter((l) => l.trim() !== "");
    if (clean.length === 0) {
      return fallback.slice(0, 4);
    }
    // Pad if fewer than 4 lines
    while (clean.length < 4) {
      const nextFallback = fallback[clean.length % fallback.length];
      clean.push(nextFallback);
    }
    return clean.slice(0, 4);
  };

  const finalIntro = ensureFourLines(introLines, fallbackIntro);
  const finalVerse = ensureFourLines(verseLines, fallbackVerse);
  const finalChorus = ensureFourLines(chorusLines, fallbackChorus);
  const finalBridge = ensureFourLines(bridgeLines, fallbackBridge);
  const finalOutro = ensureFourLines(outroLines, fallbackOutro);

  // Build the unified result
  const resultBlocks = [
    `[Intro]\n${finalIntro.join("\n")}`,
    `[Verse]\n${finalVerse.join("\n")}`,
    `[Chorus]\n${finalChorus.join("\n")}`,
    `[Bridge]\n${finalBridge.join("\n")}`,
    `[Outro]\n${finalOutro.join("\n")}`,
  ];

  let joined = resultBlocks.join("\n\n");

  // Final length sanity check (under 580 characters)
  if (joined.length > 580) {
    joined = joined.slice(0, 570) + "\n...";
  }

  return joined;
}

function buildPrompts(data: LyricsRequest, isCompact: boolean) {
  const userPrompt = data.instrumental
    ? `Vibe: ${data.prompt}\n\nThis is an INSTRUMENTAL (no vocals). Set the 'lyrics' field to exactly: [instrumental]. Set 'style' to genres/moods that fit the vibe, and write a matching song 'title' in the JSON object.`
    : data.customLyrics
      ? `Vibe: ${data.prompt}\nCustom Lyrics:\n${data.customLyrics}\n\nAnalyze the prompt and custom lyrics above. Generate a song 'title' and a suitable 'style' (comma-separated genres/moods). Set the 'lyrics' field to exactly the custom lyrics provided.`
      : isCompact
        ? `Vibe: ${data.prompt}\n\nStrict Lyric Constraint:\n- The lyrics MUST consist of exactly one [Intro], one [Verse], one [Chorus], one [Bridge], and one [Outro] (strictly in that order, with no other sections or numbers, e.g. no [Verse 1], no [Verse 2], and no multiple choruses).\n- The tags must be EXACTLY "[Intro]", "[Verse]", "[Chorus]", "[Bridge]", and "[Outro]" without any numbers.\n- Each section MUST have EXACTLY 4 lines.\n- Keep lines relatively short (5 to 8 words per line) so the entire song fits well within the character count limit.`
        : `Vibe: ${data.prompt}\n\nGenerate beautiful, full-length, professional song lyrics. Structure the song with multiple verses and choruses, e.g. [Intro], [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Chorus], [Outro]. Write rich, meaningful lines with pure creative freedom.`;

  const systemPrompt =
    `You are a professional songwriting assistant with full creative freedom. Return ONLY a JSON object with 'title', 'style', and 'lyrics'.\n` +
    (data.customLyrics
      ? `Guidelines for Custom Lyrics:\n- You MUST analyze the custom lyrics and user prompt to generate a song 'title' and 'style'.\n- Set the 'lyrics' field EXACTLY to the provided custom lyrics. Do not modify or summarize them.\n- Respond ONLY with a valid JSON object. No markdown wrapping if possible.`
      : isCompact
        ? `Lyrics Guidelines:\n` +
          `- Structure: Exactly one [Intro], exactly one [Verse], exactly one [Chorus], exactly one [Bridge], and exactly one [Outro]. Strictly in that order. No other sections are allowed.\n` +
          `- Strictly Required Section Tags: You MUST use exactly these literal tags: "[Intro]", "[Verse]", "[Chorus]", "[Bridge]", and "[Outro]". Absolutely do NOT use numbers in tags (do NOT write [Verse 1], [Verse 2], or [Chorus 1]). Absolutely do NOT write multiple verses or multiple choruses. There must be exactly one of each of the five sections.\n` +
          `- Language Requirement: You MUST write everything entirely in standard English. Absolutely NO Chinese characters, symbols, or bilingual mixtures. Pure English only.\n` +
          `- Formatting: Separate each section with a blank line. Keep lines short, elegant, and highly rhythmic.\n` +
          `- Section Lengths: Every single section MUST have EXACTLY 4 lines (no more, no less). Keep each line relatively short (5 to 8 words).\n` +
          `- Structural Template Example:\n` +
          `[Intro]\n` +
          `Hear the synthesizers start to rise,\n` +
          `Waking up the sleeping summer skies.\n` +
          `Get ready for a brand new sweet beat,\n` +
          `Dancing in the middle of the street.\n\n` +
          `[Verse]\n` +
          `In the hush of night, we find our space,\n` +
          `Wrapped in moonlight's soft embrace.\n` +
          `Your whisper is like a velvet song,\n` +
          `In this tender moment where we belong.\n\n` +
          `[Chorus]\n` +
          `Just you and me, in this lazy jazz,\n` +
          `Our souls entwined, nothing else we ask.\n` +
          `In this serenade we sway and sigh,\n` +
          `Lost in this love beneath the starry sky.\n\n` +
          `[Bridge]\n` +
          `Your voice, a lullaby, soothes my soul,\n` +
          `In this night together we feel whole.\n` +
          `Each moment shared is a timeless flight,\n` +
          `In this gentle jazz we find our light.\n\n` +
          `[Outro]\n` +
          `Lost in your light we fade away,\n` +
          `Into the dawn of a brighter day,\n` +
          `Just you and me, the stars above,\n` +
          `Locked forever in this summer love.\n\n` +
          `- Creative Freedom: You may write about ANY topic including love, heartbreak, jazz, romance, partying, drinking, drugs, street life, hustle, money. Write authentically to whatever genre/vibe the user requests.\n` +
          `- ONLY HARD RESTRICTIONS: Do NOT write content that sexualizes minors, promotes terrorism/mass violence, or contains racial slurs or hate speech targeting ethnic/religious groups.\n` +
          `- Strict: Do NOT include <think> tags, reasoning, conversational filler, or introductory text. The 'lyrics' field MUST contain ONLY the pure song lyrics.\n` +
          `- Style: comma-separated genres/moods.\n` +
          `- Respond ONLY with a valid JSON object. No markdown wrapping if possible.`
        : `Lyrics Guidelines:\n` +
          `- Structure: Create a full-length, complete song. Standard structure preferred: [Intro], [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Chorus], [Outro].\n` +
          `- Formatting: Use uppercase bracketed tags for sections, e.g. [Intro], [Verse 1], [Chorus], [Bridge], [Outro]. Separate sections with blank lines.\n` +
          `- Language Requirement: You MUST write everything entirely in standard English. Absolutely NO Chinese characters, symbols, or bilingual mixtures. Pure English only.\n` +
          `- Creative Freedom: You may write about ANY topic including love, heartbreak, jazz, romance, partying, drinking, drugs, street life, hustle, money. Write authentically to whatever genre/vibe the user requests.\n` +
          `- ONLY HARD RESTRICTIONS: Do NOT write content that sexualizes minors, promotes terrorism/mass violence, or contains racial slurs or hate speech targeting ethnic/religious groups.\n` +
          `- Strict: Do NOT include <think> tags, reasoning, conversational filler, or introductory text. The 'lyrics' field MUST contain ONLY the pure song lyrics.\n` +
          `- Style: comma-separated genres/moods.\n` +
          `- Respond ONLY with a valid JSON object. No markdown wrapping if possible.`);
  return { userPrompt, systemPrompt };
}

function localFallback(data: LyricsRequest): string {
  const promptText = data.prompt;
  if (data.customLyrics) {
    return JSON.stringify({
      title: "Custom Creation",
      style: "Pop, Custom Style",
      lyrics: data.customLyrics,
    });
  }
  const p = promptText.toLowerCase();
  if (
    p.includes("sad") ||
    p.includes("cry") ||
    p.includes("pain") ||
    p.includes("heartbreak") ||
    p.includes("rain") ||
    p.includes("lonely")
  ) {
    return JSON.stringify({
      title: "Tears in the Rain",
      style: "Bedroom Pop, Sad, Melancholic, Chill",
      lyrics:
        "[Intro]\nSoft piano keys play low and sweet,\nMist is rising from the empty street.\nWaiting here under the cloudy gray,\nWishing you didn't have to walk away.\n\n[Verse]\nWatching raindrops slide down the glass,\nHoping these heavy feelings will pass.\nYour empty coffee mug sits on the floor,\nI guess you don't live here anymore.\n\n[Chorus]\nNow I'm dancing alone in the dark,\nTrying to find a brand new spark.\nBut all I see is your ghost in the room,\nLeft with this sweet and sorrowful gloom.\n\n[Bridge]\nI sent a text I shouldn't have made,\nWatching the screen as the colors fade.\nTwo blue checks and no reply,\nUnderneath this digital sky.\n\n[Outro]\nSo I'll just turn the music up high,\nKiss these painful memories goodbye.\nTears in the rain, washing away,\nInto a brighter, sunnier day.",
    });
  }
  if (
    p.includes("happy") ||
    p.includes("dance") ||
    p.includes("fun") ||
    p.includes("party") ||
    p.includes("club") ||
    p.includes("upbeat") ||
    p.includes("energy")
  ) {
    return JSON.stringify({
      title: "Electric Dreams",
      style: "Synthpop, Energetic, Dance, Happy",
      lyrics:
        "[Intro]\nBright synthesizers start to rise,\nWaking up the sleeping summer skies.\nFeel the bass beginning to beat,\nMoving down directly to your feet.\n\n[Verse]\nTurn up the bass, feel the floor shake,\nForget every single mistake we make.\nSpilling our drinks under neon glow,\nLetting the rhythm take full control.\n\n[Chorus]\nWe are alive in this electric dream,\nShining brighter than a silver beam.\nHold my hand, let's lose our minds,\nLeaving the worried world far behind.\n\n[Bridge]\nHear the synthesizer start to play,\nWashing all our heavy doubts away.\nOne, two, three, let the beat drop down,\nWe are the royalty of this town.\n\n[Outro]\nSo let's keep dancing until the sunrise,\nLooking directly into your bright eyes.\nElectric dreams that never will end,\nWith my favorite, closest friend.",
    });
  }
  if (
    p.includes("chill") ||
    p.includes("relax") ||
    p.includes("lofi") ||
    p.includes("study") ||
    p.includes("midnight") ||
    p.includes("slow") ||
    p.includes("sleep")
  ) {
    return JSON.stringify({
      title: "Midnight Coffee",
      style: "Lofi, Bedroom Pop, Chill, Mellow",
      lyrics:
        "[Intro]\nVinyl crackles spin around slow,\nWarm guitar strings beginning to glow.\nSip your drink and close your eyes,\nWatching the quiet purple skies.\n\n[Verse]\nBrewing coffee at a quarter to three,\nJust the quiet moonlight and me.\nLo-fi beats drifting through the air,\nRunning my fingers through my hair.\n\n[Chorus]\nIn this gentle, slow bedroom pop groove,\nWe don't even have to make a move.\nJust cozy blankets and a warm light,\nFloating away in the peaceful night.\n\n[Bridge]\nWhispering secrets under our breath,\nLoving this feeling to absolute death.\nThe clock is ticking but we don't care,\nWith this sweet magic everywhere.\n\n[Outro]\nSo let the record spin round and round,\nLost in this beautiful, cozy sound.\nMidnight coffee and sweet repose,\nThat's how our happy story goes.",
    });
  }
  // Default: Cute Bedroom Pop Summer Crush
  return JSON.stringify({
    title: "Summer Crush",
    style: "Bedroom Pop, Cute, Romantic, Sweet",
    lyrics:
      "[Intro]\nAcoustic strums in the warm breeze,\nGolden sunlight filter through trees.\nHolding a sweet icy lemonade stand,\nBest warm feeling in all the land.\n\n[Verse]\nSaw you laughing by the county fair,\nSpilled my sweet lemonade everywhere.\nMy face turned redder than a fresh tomato,\nTripped on my feet like a viral video.\n\n[Chorus]\nSummer crush got me totally twisted,\nAll the pretty butterflies have listed.\nYou make me act like a silly clown,\nSpinning my dizzy world upside down.\n\n[Bridge]\nScrolling through stories at midnight glow,\nHoping you'll notice me, nice and slow.\nSent you a meme, got a laughing sign,\nSuddenly everything is feeling fine.\n\n[Outro]\nSo let's stay connected in the sun,\nOur golden summer has just begun.\nSummer crush, won't you hold my hand,\nBest sweet feeling in all the land.",
  });
}

function llmConfig() {
  const { llm } = getSettings();
  if (llm.preset === "none" || !llm.baseUrl || !llm.model) return null;
  const preset = LLM_PRESETS[llm.preset];
  if (preset?.needsKey && !llm.apiKey) return null;
  return llm;
}

export async function chatCompletion(
  system: string,
  user: string,
  opts: { json?: boolean; temperature?: number } = {},
) {
  const llm = llmConfig();
  if (!llm) throw new Error("No language model configured. Set one up in Settings → Lyrics model.");
  const res = await fetch(`${llm.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      temperature: opts.temperature ?? 0.7,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403)
      throw new Error("The lyrics model rejected the API key.");
    if (res.status === 429)
      throw new Error("The lyrics model is rate-limited. Try again in a moment.");
    throw new Error(`Lyrics model error (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  return (json.choices?.[0]?.message?.content as string) ?? "";
}

export async function generateLyrics(data: LyricsRequest): Promise<LyricsResult> {
  const isCompact = !!data.compact;
  let content: string;
  let usedFallback = false;

  if (!llmConfig()) {
    content = localFallback(data);
    usedFallback = true;
  } else {
    const { userPrompt, systemPrompt } = buildPrompts(data, isCompact);
    try {
      content = await chatCompletion(systemPrompt, userPrompt, { json: true });
    } catch (e) {
      // Some local servers reject response_format; retry once without it.
      if (e instanceof Error && /response_format|json/i.test(e.message)) {
        content = await chatCompletion(systemPrompt, userPrompt);
      } else {
        throw e;
      }
    }
    if (!content) throw new Error("The lyrics model returned no content");
  }

  const parsed = extractJson(content) as Partial<LyricsResult>;
  if (typeof parsed?.lyrics !== "string")
    throw new Error("The lyrics model returned an unexpected format");

  // The model sometimes nests the whole JSON object inside `lyrics`.
  let rawLyrics = parsed.lyrics;
  for (let i = 0; i < 3; i++) {
    const t = rawLyrics.trim();
    if (!(t.startsWith("{") && t.endsWith("}"))) break;
    try {
      const inner = JSON.parse(t);
      if (inner && typeof inner.lyrics === "string") {
        rawLyrics = inner.lyrics;
        continue;
      }
    } catch {
      // not JSON
    }
    break;
  }

  return {
    title: String(parsed.title || "Untitled"),
    style: String(parsed.style || "Pop"),
    lyrics: data.instrumental ? "[instrumental]" : normalizeLyrics(rawLyrics, isCompact),
    usedFallback,
  };
}
