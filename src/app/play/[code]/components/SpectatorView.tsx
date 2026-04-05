"use client";

import type { PlayerState } from "@shared/types";

export function SpectatorView({ state }: { state: PlayerState }) {
  const statusLabel =
    state.myStatus === "qualified"
      ? "Qualified for the Final!"
      : state.myStatus === "eliminated"
        ? "Eliminated"
        : state.myStatus === "waiting"
          ? "Waiting to play"
          : "";

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      {/* Current game info */}
      <div>
        <p className="text-sm uppercase tracking-widest text-slate-500">
          Round {state.currentRound} of {state.totalRounds}
        </p>
        {state.category && (
          <p className="mt-1 text-lg text-slate-300">{state.category}</p>
        )}
      </div>

      {/* Who's playing */}
      {state.activePlayerName && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-4">
          <p className="text-sm text-slate-500">Now Playing</p>
          <p className="text-xl font-bold text-white">
            {state.activePlayerName}
          </p>
        </div>
      )}

      {/* My status */}
      <div
        className={`rounded-lg px-6 py-3 text-sm font-medium ${
          state.myStatus === "qualified"
            ? "bg-green-950/30 text-green-400"
            : state.myStatus === "eliminated"
              ? "bg-red-950/30 text-red-400"
              : "bg-slate-900 text-slate-400"
        }`}
      >
        {statusLabel}
      </div>

      {/* Prize pot */}
      <div>
        <p className="text-sm text-slate-500">Prize Pot</p>
        <p className="text-2xl font-bold text-amber-400">
          {"\u00A3"}{state.prizePot.toLocaleString()}
        </p>
      </div>
    </div>
  );
}
