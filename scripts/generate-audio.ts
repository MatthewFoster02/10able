// ============================================================
// Generate ElevenLabs audio for all questions
// Usage: npx tsx scripts/generate-audio.ts [--force] [--question-id "foo"]
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface QuestionAnswer {
  position: number;
  answer: string;
  aliases: string[];
  audio: string;
}

interface QuestionData {
  id: string;
  category: string;
  question: string;
  description: string;
  audio: { category: string; question: string; description: string };
  answers: QuestionAnswer[];
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = "bFt7EA8lqWlx3xT4kVAh";
const MODEL_ID = "eleven_multilingual_v2";
const QUESTIONS_PATH = join(process.cwd(), "data", "questions.json");
const AUDIO_DIR = join(process.cwd(), "public", "audio");
const DELAY_MS = 300; // delay between API calls
const MAX_RETRIES = 3;

function loadQuestions(): QuestionData[] {
  return JSON.parse(readFileSync(QUESTIONS_PATH, "utf-8"));
}

function saveQuestions(questions: QuestionData[]): void {
  writeFileSync(QUESTIONS_PATH, JSON.stringify(questions, null, 2));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function generateAndSave(text: string, outputPath: string): Promise<boolean> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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

      if (response.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`    Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        console.error(`    API error ${response.status}: ${await response.text()}`);
        if (attempt < MAX_RETRIES) {
          await sleep(1000);
          continue;
        }
        return false;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(outputPath, buffer);
      return true;
    } catch (err: any) {
      console.error(`    Error: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(1000);
        continue;
      }
      return false;
    }
  }
  return false;
}

async function processQuestion(
  question: QuestionData,
  force: boolean
): Promise<QuestionData> {
  const dir = join(AUDIO_DIR, question.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const updated = { ...question, audio: { ...question.audio }, answers: question.answers.map((a) => ({ ...a })) };

  const clips: { text: string; file: string; field: "category" | "question" | "description" | number }[] = [
    { text: `Our next category is... ${question.category}`, file: "category.mp3", field: "category" },
    { text: question.question, file: "question.mp3", field: "question" },
  ];

  if (question.description) {
    clips.push({ text: question.description, file: "description.mp3", field: "description" });
  }

  for (const a of question.answers) {
    clips.push({
      text: `Number ${a.position}... ${a.answer}`,
      file: `answer_${String(a.position).padStart(2, "0")}.mp3`,
      field: a.position,
    });
  }

  let generated = 0;
  let skipped = 0;

  for (const clip of clips) {
    const outputPath = join(dir, clip.file);
    const relativeUrl = `/audio/${question.id}/${clip.file}`;

    // Skip if file already exists and not forcing
    if (!force && existsSync(outputPath)) {
      // Still update the URL in case it's missing from JSON
      if (typeof clip.field === "number") {
        const answer = updated.answers.find((a) => a.position === clip.field);
        if (answer) answer.audio = relativeUrl;
      } else {
        updated.audio[clip.field] = relativeUrl;
      }
      skipped++;
      continue;
    }

    const ok = await generateAndSave(clip.text, outputPath);
    if (ok) {
      if (typeof clip.field === "number") {
        const answer = updated.answers.find((a) => a.position === clip.field);
        if (answer) answer.audio = relativeUrl;
      } else {
        updated.audio[clip.field] = relativeUrl;
      }
      generated++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`    Generated: ${generated}, Skipped: ${skipped}`);
  return updated;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const qIdIdx = args.indexOf("--question-id");
  const specificId = qIdIdx >= 0 ? args[qIdIdx + 1] : null;

  if (!ELEVENLABS_API_KEY) {
    console.error("Error: ELEVENLABS_API_KEY environment variable not set");
    process.exit(1);
  }

  if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });

  const questions = loadQuestions();
  const toProcess = specificId
    ? questions.filter((q) => q.id === specificId)
    : questions;

  console.log(`Processing ${toProcess.length} questions (force=${force})\n`);

  for (let i = 0; i < toProcess.length; i++) {
    const q = toProcess[i];
    const totalClips = 3 + q.answers.length; // category + question + description + answers
    console.log(`[${i + 1}/${toProcess.length}] "${q.id}" (${totalClips} clips)`);

    const updated = await processQuestion(q, force);

    // Update in the full array
    const idx = questions.findIndex((existing) => existing.id === q.id);
    if (idx >= 0) questions[idx] = updated;

    // Save after each question (crash resilience)
    saveQuestions(questions);
  }

  console.log(`\nDone! Audio generated for ${toProcess.length} questions.`);
}

main().catch(console.error);
