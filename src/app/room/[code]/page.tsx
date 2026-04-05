"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import { useRoomGameState } from "@/hooks/useGameState";
import { useRoomStore } from "@/stores/room-store";

export default function RoomDisplayPage() {
  const params = useParams<{ code: string }>();
  const roomCode = (params.code ?? "").toUpperCase();
  const { socket, connected } = useSocket();
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRoomGameState(socket);
  const { phase, players } = useRoomStore();

  useEffect(() => {
    if (!connected || subscribed) return;

    socket.emit("subscribe_room", { roomCode }, (response) => {
      if (response.ok) {
        setSubscribed(true);
      } else {
        setError(response.error);
      }
    });
  }, [connected, subscribed, socket, roomCode]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-xl text-red-400">{error}</p>
      </div>
    );
  }

  if (!subscribed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-xl text-slate-400">Connecting to room...</p>
      </div>
    );
  }

  // Lobby phase — show room code and player list
  if (phase === "lobby") {
    return <LobbyDisplay roomCode={roomCode} />;
  }

  // Other phases will be added in later commits
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-xl text-slate-400">Game phase: {phase}</p>
    </div>
  );
}

function LobbyDisplay({ roomCode }: { roomCode: string }) {
  const players = useRoomStore((s) => s.players);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-12">
      {/* Room code */}
      <div className="text-center">
        <p className="text-lg uppercase tracking-widest text-slate-500">
          Room Code
        </p>
        <p className="mt-2 text-8xl font-black tracking-[0.3em] text-amber-400">
          {roomCode}
        </p>
        <p className="mt-4 text-slate-500">
          Go to <span className="text-white">/play</span> on your phone and
          enter this code
        </p>
      </div>

      {/* Player list */}
      <div className="w-full max-w-md">
        <h2 className="mb-4 text-center text-xl font-semibold text-slate-300">
          Players ({players.length}/5)
        </h2>
        {players.length === 0 ? (
          <p className="text-center text-slate-600">
            Waiting for players to join...
          </p>
        ) : (
          <ul className="space-y-3">
            {players.map((player) => (
              <li
                key={player.id}
                className={`flex items-center justify-between rounded-lg border px-6 py-4 ${
                  player.connected
                    ? "border-slate-700 bg-slate-900"
                    : "border-slate-800 bg-slate-900/50 opacity-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-medium">{player.name}</span>
                  {player.isCaptain && (
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold uppercase text-amber-400">
                      Captain
                    </span>
                  )}
                </div>
                {!player.connected && (
                  <span className="text-sm text-red-400">Disconnected</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Waiting message */}
      <p className="text-slate-500">
        Waiting for the captain to start the game...
      </p>
    </div>
  );
}
