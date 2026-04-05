// ============================================================
// Interactive question verification CLI
// Usage: npx tsx scripts/verify-questions.ts [--unverified-only] [--category "Film"]
// ============================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

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

const QUESTIONS_PATH = join(process.cwd(), "data", "questions.json");
const VERIFIED_PATH = join(process.cwd(), "data", "questions-verified.json");

function loadQuestions(): QuestionData[] {
  return JSON.parse(readFileSync(QUESTIONS_PATH, "utf-8"));
}

function saveQuestions(questions: QuestionData[]): void {
  writeFileSync(QUESTIONS_PATH, JSON.stringify(questions, null, 2));
}

function loadVerified(): Record<string, boolean> {
  if (!existsSync(VERIFIED_PATH)) return {};
  try {
    return JSON.parse(readFileSync(VERIFIED_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveVerified(verified: Record<string, boolean>): void {
  writeFileSync(VERIFIED_PATH, JSON.stringify(verified, null, 2));
}

function formatQuestion(q: QuestionData, index: number, total: number): string {
  const lines: string[] = [];
  lines.push(`\n${"=".repeat(60)}`);
  lines.push(`  Question ${index + 1} of ${total}  |  ID: ${q.id}`);
  lines.push(`${"=".repeat(60)}`);
  lines.push(`  Category:    ${q.category}`);
  lines.push(`  Question:    ${q.question}`);
  lines.push(`  Description: ${q.description}`);
  lines.push(`  ${"─".repeat(50)}`);

  for (const a of q.answers) {
    const aliasStr = a.aliases.length > 0 ? `  (aliases: ${a.aliases.join(", ")})` : "";
    lines.push(`  ${String(a.position).padStart(2, " ")}. ${a.answer}${aliasStr}`);
  }

  lines.push(`  ${"─".repeat(50)}`);
  const hasAudio = q.audio.question !== "";
  lines.push(`  Audio: ${hasAudio ? "generated" : "not generated"}`);

  return lines.join("\n");
}

async function prompt(rl: ReturnType<typeof createInterface>, message: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(message, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const unverifiedOnly = args.includes("--unverified-only");
  const catIdx = args.indexOf("--category");
  const specificCategory = catIdx >= 0 ? args[catIdx + 1] : null;

  let questions = loadQuestions();
  const verified = loadVerified();

  // Filter
  let toReview = questions.map((q, i) => ({ question: q, index: i }));
  if (unverifiedOnly) {
    toReview = toReview.filter(({ question }) => !verified[question.id]);
  }
  if (specificCategory) {
    toReview = toReview.filter(({ question }) =>
      question.category.toLowerCase() === specificCategory.toLowerCase()
    );
  }

  const verifiedCount = Object.values(verified).filter(Boolean).length;
  console.log(`\nTotal questions: ${questions.length}`);
  console.log(`Already verified: ${verifiedCount}`);
  console.log(`To review: ${toReview.length}`);

  if (toReview.length === 0) {
    console.log("Nothing to review!");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let accepted = 0;
  let skipped = 0;
  let deleted = 0;
  const deletedIds: string[] = [];

  for (let i = 0; i < toReview.length; i++) {
    const { question: q } = toReview[i];

    console.log(formatQuestion(q, i, toReview.length));

    const isVerified = verified[q.id];
    const statusStr = isVerified ? " (already verified)" : "";

    const action = await prompt(
      rl,
      `\n  [a]ccept${statusStr}  [s]kip  [d]elete  [q]uit > `
    );

    switch (action.toLowerCase()) {
      case "a":
      case "accept":
        verified[q.id] = true;
        saveVerified(verified);
        accepted++;
        console.log(`  -> Accepted`);
        break;

      case "d":
      case "delete":
        deletedIds.push(q.id);
        delete verified[q.id];
        saveVerified(verified);
        deleted++;
        console.log(`  -> Marked for deletion`);
        break;

      case "q":
      case "quit":
        console.log("\nQuitting...");
        // Apply deletions before exit
        if (deletedIds.length > 0) {
          questions = questions.filter((q) => !deletedIds.includes(q.id));
          saveQuestions(questions);
          console.log(`Deleted ${deletedIds.length} questions.`);
        }
        rl.close();
        console.log(`\nSession: ${accepted} accepted, ${skipped} skipped, ${deleted} deleted`);
        return;

      case "s":
      case "skip":
      default:
        skipped++;
        console.log(`  -> Skipped`);
        break;
    }
  }

  // Apply deletions
  if (deletedIds.length > 0) {
    questions = questions.filter((q) => !deletedIds.includes(q.id));
    saveQuestions(questions);
  }

  rl.close();

  const totalVerified = Object.values(verified).filter(Boolean).length;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Session complete!`);
  console.log(`  Accepted: ${accepted}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Deleted:  ${deleted}`);
  console.log(`  Total verified: ${totalVerified} / ${questions.length}`);
  console.log(`${"=".repeat(60)}`);
}

main().catch(console.error);
