// ============================================================
// Question bank loader
// ============================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { QuestionData } from "../../shared/types";

let questionBank: QuestionData[] | null = null;

export function loadQuestions(): QuestionData[] {
  if (questionBank) return questionBank;

  const filePath = join(process.cwd(), "data", "questions.json");
  const raw = readFileSync(filePath, "utf-8");
  questionBank = JSON.parse(raw) as QuestionData[];
  return questionBank;
}

export function getRandomQuestion(excludeIds: string[]): QuestionData | null {
  const questions = loadQuestions();
  const available = questions.filter((q) => !excludeIds.includes(q.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

export function getQuestionById(id: string): QuestionData | null {
  const questions = loadQuestions();
  return questions.find((q) => q.id === id) ?? null;
}

// Tier 1 answer validation: local string matching
export function checkAnswerLocal(
  answer: string,
  questionAnswers: QuestionData["answers"],
  revealedPositions: Set<number>
): { match: true; position: number; answerText: string } | { match: false; alreadyFound: boolean } {
  const normalized = answer.trim().toLowerCase();

  for (const qa of questionAnswers) {
    const candidates = [qa.answer, ...qa.aliases].map((s) => s.toLowerCase().trim());

    if (candidates.some((c) => c === normalized)) {
      if (revealedPositions.has(qa.position)) {
        return { match: false, alreadyFound: true };
      }
      return { match: true, position: qa.position, answerText: qa.answer };
    }
  }

  return { match: false, alreadyFound: false };
}
