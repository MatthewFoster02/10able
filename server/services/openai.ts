// ============================================================
// Tier 2 answer validation — OpenAI intelligent matching
// ============================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TIMEOUT_MS = 3000;

// Cache: `${questionId}:${normalizedAnswer}` -> { match, position }
const matchCache = new Map<string, { match: boolean; position: number | null; answerText: string | null }>();

interface AnswerCandidate {
  position: number;
  answer: string;
  aliases: string[];
}

export async function checkAnswerWithOpenAI(
  submittedAnswer: string,
  category: string,
  question: string,
  remainingAnswers: AnswerCandidate[],
  questionId: string
): Promise<{ match: boolean; position: number | null; answerText: string | null }> {
  if (!OPENAI_API_KEY) {
    console.warn("[OpenAI] No API key configured, falling back to no match");
    return { match: false, position: null, answerText: null };
  }

  const normalized = submittedAnswer.trim().toLowerCase();
  const cacheKey = `${questionId}:${normalized}`;

  // Check cache
  const cached = matchCache.get(cacheKey);
  if (cached) {
    console.log(`[OpenAI] Cache hit for "${submittedAnswer}" -> ${cached.match ? `match #${cached.position}` : "no match"}`);
    return cached;
  }

  const answerList = remainingAnswers
    .map((a) => `Position ${a.position}: "${a.answer}" (also accepted: ${a.aliases.join(", ") || "none"})`)
    .join("\n");

  const prompt = `You are a quiz answer validator for a game show called "Tenable".

Category: ${category}
Question: ${question}

The player submitted: "${submittedAnswer}"

Here are the remaining (unrevealed) answers on the list:
${answerList}

Does the player's answer match any of the remaining answers? Consider:
- Misspellings and typos
- Abbreviations (e.g. "USA" for "United States")
- Alternative names (e.g. "Everest" for "Mount Everest")
- Partial names that clearly identify the answer
- Colloquial references

However, do NOT match vaguely related answers. The answer must genuinely refer to the same thing.

Respond with ONLY valid JSON (no markdown):
{"match": true, "position": <number>} or {"match": false}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 50,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[OpenAI] API error: ${response.status}`);
      return { match: false, position: null, answerText: null };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      console.error("[OpenAI] Empty response");
      return { match: false, position: null, answerText: null };
    }

    const parsed = JSON.parse(content);

    if (parsed.match && typeof parsed.position === "number") {
      const matchedAnswer = remainingAnswers.find((a) => a.position === parsed.position);
      const result = {
        match: true as const,
        position: parsed.position,
        answerText: matchedAnswer?.answer ?? null,
      };
      matchCache.set(cacheKey, result);
      console.log(`[OpenAI] Match: "${submittedAnswer}" -> #${parsed.position} (${matchedAnswer?.answer})`);
      return result;
    }

    const result = { match: false as const, position: null, answerText: null };
    matchCache.set(cacheKey, result);
    console.log(`[OpenAI] No match for "${submittedAnswer}"`);
    return result;
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn(`[OpenAI] Timeout after ${TIMEOUT_MS}ms for "${submittedAnswer}"`);
    } else {
      console.error(`[OpenAI] Error:`, err.message);
    }
    return { match: false, position: null, answerText: null };
  }
}
