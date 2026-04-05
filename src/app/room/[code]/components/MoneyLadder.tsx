"use client";

import type { MoneyLadderTier } from "@shared/types";
import { MIN_CORRECT_TO_BANK } from "@shared/constants";

export function MoneyLadder({
  ladder,
  correctCount,
}: {
  ladder: MoneyLadderTier[];
  correctCount: number;
}) {
  // Show tiers from 5 (first bankable) to 10
  const visibleTiers = ladder.filter((t) => t.correctCount >= MIN_CORRECT_TO_BANK);

  return (
    <div className="flex flex-col gap-1">
      <h3 className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
        Money Ladder
      </h3>
      {visibleTiers
        .sort((a, b) => b.correctCount - a.correctCount)
        .map((tier) => {
          const isReached = correctCount >= tier.correctCount;
          const isCurrent = correctCount === tier.correctCount;

          return (
            <div
              key={tier.correctCount}
              className={`flex items-center justify-between rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                isCurrent
                  ? "bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20"
                  : isReached
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-slate-900 text-slate-600"
              }`}
            >
              <span>{tier.correctCount} correct</span>
              <span>
                {"\u00A3"}
                {tier.amount.toLocaleString()}
              </span>
            </div>
          );
        })}
    </div>
  );
}
