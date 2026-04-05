// ============================================================
// ElevenLabs TTS service — voice generation and caching
// ============================================================

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = "bFt7EA8lqWlx3xT4kVAh";
const MODEL_ID = "eleven_multilingual_v2";

// In-memory cache: text -> base64 audio
const audioCache = new Map<string, string>();

export async function generateSpeech(text: string): Promise<string | null> {
  if (!ELEVENLABS_API_KEY) {
    console.warn("[ElevenLabs] No API key configured");
    return null;
  }

  // Check cache
  const cached = audioCache.get(text);
  if (cached) return cached;

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error(`[ElevenLabs] API error: ${response.status}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:audio/mpeg;base64,${base64}`;

    // Cache it
    audioCache.set(text, dataUrl);
    console.log(`[ElevenLabs] Generated speech for: "${text.substring(0, 50)}..."`);

    return dataUrl;
  } catch (err: any) {
    console.error(`[ElevenLabs] Error:`, err.message);
    return null;
  }
}

// Pre-generate common phrases
export async function pregenerateQuestionAudio(
  category: string,
  question: string,
  description: string
): Promise<{ category: string | null; question: string | null; description: string | null }> {
  const [catAudio, qAudio, descAudio] = await Promise.all([
    generateSpeech(`Our next category is... ${category}`),
    generateSpeech(question),
    description ? generateSpeech(description) : Promise.resolve(null),
  ]);

  return { category: catAudio, question: qAudio, description: descAudio };
}

export async function generateAnswerAudio(
  position: number,
  answer: string,
  preGeneratedUrl?: string
): Promise<string | null> {
  // Use pre-generated audio file if available
  if (preGeneratedUrl) return preGeneratedUrl;
  return generateSpeech(`Number ${position}... ${answer}`);
}

export async function generateWrongAnswerAudio(answer: string): Promise<string | null> {
  return generateSpeech(`${answer}... is not on the list`);
}

// Get pre-generated audio URL for a question's answer
export function getPreGeneratedAnswerUrl(
  questionAnswers: { position: number; audio: string }[],
  position: number
): string | undefined {
  const answer = questionAnswers.find((a) => a.position === position);
  return answer?.audio || undefined;
}
