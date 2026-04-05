"use client";

import type { Player } from "@shared/types";

export function PlayerList({
  players,
  activePlayerId,
}: {
  players: Player[];
  activePlayerId: string | null;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {players.map((player) => {
        const isActive = player.id === activePlayerId;
        const isEliminated =
          player.status === "eliminated" || player.status === "eliminated_final";

        return (
          <div
            key={player.id}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 transition-all ${
              isActive
                ? "border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10"
                : isEliminated
                  ? "border-red-900/50 bg-red-950/30 opacity-50"
                  : player.status === "qualified"
                    ? "border-green-700/50 bg-green-950/30"
                    : "border-slate-700 bg-slate-900"
            } ${!player.connected ? "opacity-40" : ""}`}
          >
            {/* Status indicator */}
            <div
              className={`h-2.5 w-2.5 rounded-full ${
                isActive
                  ? "animate-pulse bg-amber-400"
                  : isEliminated
                    ? "bg-red-500"
                    : player.status === "qualified"
                      ? "bg-green-500"
                      : player.connected
                        ? "bg-slate-500"
                        : "bg-slate-700"
              }`}
            />

            <span
              className={`text-sm font-medium ${
                isActive
                  ? "text-amber-300"
                  : isEliminated
                    ? "text-red-400 line-through"
                    : "text-white"
              }`}
            >
              {player.name}
            </span>

            {player.isCaptain && (
              <span className="text-xs text-amber-400">C</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
