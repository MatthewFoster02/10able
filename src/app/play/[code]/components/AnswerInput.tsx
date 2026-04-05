"use client";

import { useState, useRef, useEffect } from "react";

export function AnswerInput({
  onSubmit,
  onBank,
  canBank,
  correctCount,
  moneyLevel,
  hasLife,
  timerSeconds,
}: {
  onSubmit: (answer: string) => void;
  onBank: () => void;
  canBank: boolean;
  correctCount: number;
  moneyLevel: number;
  hasLife: boolean;
  timerSeconds: number | null;
}) {
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    onSubmit(answer.trim());
    setAnswer("");
    inputRef.current?.focus();
  }

  const isUrgent = timerSeconds !== null && timerSeconds <= 10;

  return (
    <div className="flex flex-col gap-4">
      {/* Status bar */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-white">
            {correctCount}/10 correct
          </span>
          <span className={hasLife ? "text-red-400" : "text-slate-600"}>
            {hasLife ? "\u2764 Life" : "\u2661 No life"}
          </span>
        </div>
        <span className="font-bold text-amber-400">
          {"\u00A3"}{moneyLevel.toLocaleString()}
        </span>
      </div>

      {/* Timer */}
      {timerSeconds !== null && (
        <div
          className={`text-center text-3xl font-black ${
            isUrgent ? "animate-pulse text-red-500" : "text-white"
          }`}
        >
          {timerSeconds}s
        </div>
      )}

      {/* Answer input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="Type your answer..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-4 text-lg text-white placeholder-slate-600 outline-none focus:border-amber-500"
          autoComplete="off"
          autoCapitalize="off"
        />
        <button
          type="submit"
          disabled={!answer.trim()}
          className="rounded-lg bg-amber-500 px-6 py-4 text-lg font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
        >
          Submit
        </button>
      </form>

      {/* Bank button */}
      {canBank && (
        <button
          onClick={onBank}
          className="rounded-lg border-2 border-green-500 bg-green-500/10 py-4 text-lg font-bold text-green-400 transition hover:bg-green-500/20"
        >
          Bank {"\u00A3"}{moneyLevel.toLocaleString()}
        </button>
      )}
    </div>
  );
}
