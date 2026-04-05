"use client";

import type { BoardSlot } from "@shared/types";

export function Board({ board, question }: { board: BoardSlot[]; question: string | null }) {
  const sorted = [...board].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {question && (
        <h2 className="mb-6 text-center text-2xl font-bold text-white animate-fade-in">
          {question}
        </h2>
      )}
      {sorted.map((slot) => (
        <div
          key={slot.position}
          className="board-slot flex items-center gap-3"
          style={{
            width: `${260 + (slot.position - 1) * 28}px`,
          }}
        >
          {/* Position number */}
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-lg font-black transition-all duration-500 ${
              slot.revealed
                ? slot.ghosted
                  ? "bg-slate-700 text-slate-400"
                  : "bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30"
                : "bg-slate-800/80 text-slate-500 border border-slate-700"
            }`}
          >
            {slot.position}
          </div>

          {/* Answer slot */}
          <div
            className={`flex h-14 flex-1 items-center rounded-lg px-5 text-lg font-semibold transition-all duration-500 ${
              slot.revealed
                ? slot.ghosted
                  ? "border border-slate-600/50 bg-slate-800/30 text-slate-500 italic"
                  : "border border-amber-500/40 bg-gradient-to-r from-amber-500/15 to-amber-500/5 text-amber-200 animate-slide-in"
                : "border border-slate-700/60 bg-slate-900/60 text-transparent"
            }`}
          >
            {slot.revealed ? slot.answer : "\u00A0"}
          </div>
        </div>
      ))}
    </div>
  );
}
