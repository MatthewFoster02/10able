// ============================================================
// Generate quiz questions using OpenAI
// Usage: npx tsx scripts/generate-questions.ts [--count 100] [--category "Film"]
// ============================================================

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const QUESTIONS_PATH = join(process.cwd(), "data", "questions.json");

const CATEGORIES = [
  "Geography",
  "History",
  "Science",
  "Sport",
  "Music",
  "Film",
  "Food & Drink",
  "Nature",
  "Technology",
  "Literature",
  "Television",
  "Awards & Records",
  "Business",
  "Art & Culture",
];

function loadExisting(): QuestionData[] {
  try {
    return JSON.parse(readFileSync(QUESTIONS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveQuestions(questions: QuestionData[]): void {
  writeFileSync(QUESTIONS_PATH, JSON.stringify(questions, null, 2));
  console.log(`Saved ${questions.length} questions to ${QUESTIONS_PATH}`);
}

async function generateBatch(
  category: string,
  count: number,
  existingQuestions: string[]
): Promise<QuestionData[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

  const existingList = existingQuestions.length > 0
    ? `\n\nAlready existing questions (DO NOT duplicate these):\n${existingQuestions.map((q) => `- ${q}`).join("\n")}`
    : "";

  const prompt = `Generate ${count} "Top 10" quiz questions for the category "${category}".

Each question must be a factual, verifiable Top 10 list where position 1 is the "most" or "first" (e.g. most populated, longest, first released).

For each question, provide:
- id: a URL-friendly slug (e.g. "longest-rivers")
- category: "${category}"
- question: the list title (e.g. "The 10 longest rivers in the world")
- description: a clarifying sentence explaining what position 1 means, any date context, and what format answers should be in
- answers: exactly 10 answers, each with:
  - position: 1-10 (1 = top/first/most)
  - answer: the primary name
  - aliases: 2-5 alternative names, abbreviations, common misspellings, or partial names a player might type
  - audio: "" (empty string)
- audio: { category: "", question: "", description: "" }

CRITICAL REQUIREMENTS:
1. The ranking order MUST be factually accurate and verifiable
2. Each list must have EXACTLY 10 answers
3. Aliases must include common ways people would type the answer (abbreviations, nicknames, partial names)
4. The id must be unique and descriptive
5. Questions should be interesting and varied — avoid obscure topics that most people couldn't answer
6. For time-sensitive lists (e.g. "most recent X"), specify the date cutoff in the description
${existingList}

Respond with ONLY a valid JSON array of question objects. No markdown, no explanation.`;

  console.log(`  Requesting ${count} questions for "${category}"...`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content: "You are a quiz question database generator. You produce factually accurate, well-researched Top 10 lists. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_completion_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty response from OpenAI");

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```json?\n?/, "").replace(/\n?```$/, "");

  const questions: QuestionData[] = JSON.parse(jsonStr);

  // Validate structure
  for (const q of questions) {
    if (!q.id || !q.category || !q.question || !q.answers || q.answers.length !== 10) {
      console.warn(`  Warning: Invalid question "${q.id || "unknown"}" — skipping`);
      continue;
    }
    // Ensure audio fields exist
    if (!q.audio) q.audio = { category: "", question: "", description: "" };
    for (const a of q.answers) {
      if (!a.audio) a.audio = "";
      if (!a.aliases) a.aliases = [];
    }
  }

  return questions.filter((q) => q.answers?.length === 10);
}

async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const catIdx = args.indexOf("--category");
  const targetCount = countIdx >= 0 ? parseInt(args[countIdx + 1], 10) : 100;
  const specificCategory = catIdx >= 0 ? args[catIdx + 1] : null;

  const existing = loadExisting();
  const existingIds = existing.map((q) => q.id);
  const existingTitles = existing.map((q) => q.question);

  console.log(`Current questions: ${existing.length}`);
  console.log(`Target: ${targetCount}`);

  if (existing.length >= targetCount) {
    console.log("Already have enough questions!");
    return;
  }

  const needed = targetCount - existing.length;
  const categories = specificCategory ? [specificCategory] : CATEGORIES;
  const perCategory = Math.ceil(needed / categories.length);

  let allNew: QuestionData[] = [];

  for (const category of categories) {
    const existingInCategory = existing.filter((q) => q.category === category).length;
    const toGenerate = Math.min(perCategory, needed - allNew.length);

    if (toGenerate <= 0) break;

    console.log(`\n[${category}] Generating ${toGenerate} questions (${existingInCategory} already exist)...`);

    try {
      const batch = await generateBatch(category, toGenerate, existingTitles);

      // Deduplicate
      const unique = batch.filter((q) => !existingIds.includes(q.id) && !allNew.some((n) => n.id === q.id));

      console.log(`  Got ${batch.length} questions, ${unique.length} are new`);
      allNew.push(...unique);

      // Save incrementally
      saveQuestions([...existing, ...allNew]);
    } catch (err: any) {
      console.error(`  Error generating for ${category}: ${err.message}`);
    }

    // Brief pause between API calls
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nDone! Total questions: ${existing.length + allNew.length}`);
}

main().catch(console.error);
