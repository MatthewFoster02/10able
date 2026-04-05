"use client";

import type { BoardSlot } from "@shared/types";

export function Board({ board, question }: { board: BoardSlot[]; question: string | null }) {
  // Display board with position 1 at top, 10 at bottom
  const sorted = [...board].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col items-center gap-1">
      {question && (
        <h2 className="mb-4 text-center text-2xl font-bold text-white">
          {question}
        </h2>
      )}
      {sorted.map((slot) => (
        <div
          key={slot.position}
          className={`flex items-center transition-all duration-500 ${
            slot.revealed ? "gap-4" : "gap-3"
          }`}
          style={{
            // Pyramid shape: position 1 narrowest at top, 10 widest at bottom
            width: `${280 + (slot.position - 1) * 24}px`,
          }}
        >
          {/* Position number */}
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-lg font-black ${
              slot.revealed
                ? slot.ghosted
                  ? "bg-slate-700 text-slate-400"
                  : "bg-amber-500 text-slate-950"
                : "bg-slate-800 text-slate-500"
            }`}
          >
            {slot.position}
          </div>

          {/* Answer slot */}
          <div
            className={`flex h-12 flex-1 items-center rounded-lg px-4 text-lg font-semibold transition-all duration-500 ${
              slot.revealed
                ? slot.ghosted
                  ? "border border-slate-600 bg-slate-800/50 text-slate-400 italic"
                  : "border border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border border-slate-700 bg-slate-900 text-slate-700"
            }`}
          >
            {slot.revealed ? slot.answer : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
