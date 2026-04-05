"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import { usePlayerGameState } from "@/hooks/useGameState";
import { usePlayerStore } from "@/stores/player-store";

export default function PlayerGamePage() {
  const params = useParams<{ code: string }>();
  const roomCode = (params.code ?? "").toUpperCase();
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePlayerGameState(socket);

  const {
    phase,
    playerName,
    isCaptain,
    canStartGame,
    players,
    message,
  } = usePlayerStore();

  // Auto-rejoin on page load (e.g. after refresh)
  useEffect(() => {
    if (!connected || joined) return;

    const savedName =
      typeof window !== "undefined"
        ? sessionStorage.getItem("playerName")
        : null;

    if (!savedName) {
      router.push("/play");
      return;
    }

    socket.emit(
      "join_room",
      { roomCode, playerName: savedName },
      (response) => {
        if (response.ok) {
          setJoined(true);
          if (typeof window !== "undefined") {
            sessionStorage.setItem("playerId", response.playerId);
          }
        } else {
          setError(response.error);
        }
      }
    );
  }, [connected, joined, socket, roomCode, router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <p className="text-lg text-red-400">{error}</p>
        <button
          onClick={() => router.push("/play")}
          className="mt-4 text-amber-400 underline"
        >
          Back to Join
        </button>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-400">Reconnecting...</p>
      </div>
    );
  }

  // Lobby phase
  if (phase === "lobby") {
    return (
      <PlayerLobby
        roomCode={roomCode}
        playerName={playerName}
        isCaptain={isCaptain}
        canStartGame={canStartGame}
        players={players}
        onStartGame={() => socket.emit("start_game")}
      />
    );
  }

  // Other phases will be implemented in later commits
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <p className="text-lg text-slate-400">Game phase: {phase}</p>
      {message && <p className="mt-2 text-amber-400">{message}</p>}
    </div>
  );
}

function PlayerLobby({
  roomCode,
  playerName,
  isCaptain,
  canStartGame,
  players,
  onStartGame,
}: {
  roomCode: string;
  playerName: string;
  isCaptain: boolean;
  canStartGame: boolean;
  players: { id: string; name: string; isCaptain: boolean; connected: boolean }[];
  onStartGame: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-slate-500">
          Room
        </p>
        <p className="text-4xl font-black tracking-[0.2em] text-amber-400">
          {roomCode}
        </p>
      </div>

      <div className="text-center">
        <p className="text-slate-400">
          You are <span className="font-semibold text-white">{playerName}</span>
        </p>
        {isCaptain && (
          <p className="mt-1 text-sm text-amber-400">You are the Captain</p>
        )}
      </div>

      {/* Player list */}
      <div className="w-full max-w-sm">
        <h3 className="mb-3 text-center text-sm font-medium uppercase tracking-wider text-slate-500">
          Players
        </h3>
        <ul className="space-y-2">
          {players.map((p) => (
            <li
              key={p.id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                p.connected
                  ? "border-slate-700 bg-slate-900"
                  : "border-slate-800 bg-slate-900/50 opacity-50"
              }`}
            >
              <span className="font-medium">{p.name}</span>
              {p.isCaptain && (
                <span className="text-xs text-amber-400">Captain</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Start button (captain only) */}
      {isCaptain ? (
        <button
          onClick={onStartGame}
          disabled={!canStartGame}
          className="w-full max-w-sm rounded-lg bg-green-600 py-4 text-lg font-bold text-white transition hover:bg-green-500 disabled:opacity-50"
        >
          Start Game
        </button>
      ) : (
        <p className="text-slate-500">
          Waiting for the captain to start the game...
        </p>
      )}
    </div>
  );
}
