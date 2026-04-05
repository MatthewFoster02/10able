"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

export default function PlayerJoinPage() {
  const { socket, connected } = useSocket();
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!connected || !roomCode.trim() || !playerName.trim()) return;

    setJoining(true);
    setError(null);

    socket.emit(
      "join_room",
      { roomCode: roomCode.toUpperCase(), playerName: playerName.trim() },
      (response) => {
        setJoining(false);
        if (response.ok) {
          // Store player info for reconnection
          if (typeof window !== "undefined") {
            sessionStorage.setItem("playerId", response.playerId);
            sessionStorage.setItem("playerName", playerName.trim());
          }
          router.push(`/play/${roomCode.toUpperCase()}`);
        } else {
          setError(response.error);
        }
      }
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <h1 className="mb-2 text-4xl font-bold text-amber-400">TENABLE</h1>
      <p className="mb-8 text-slate-400">Join a game</p>

      <form
        onSubmit={handleJoin}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <input
          type="text"
          placeholder="Room Code"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          maxLength={4}
          className="rounded-lg border border-slate-700 bg-slate-900 px-5 py-4 text-center text-2xl font-bold uppercase tracking-[0.2em] text-white placeholder-slate-600 outline-none focus:border-amber-500"
          autoComplete="off"
        />
        <input
          type="text"
          placeholder="Your Name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={20}
          className="rounded-lg border border-slate-700 bg-slate-900 px-5 py-4 text-center text-lg text-white placeholder-slate-600 outline-none focus:border-amber-500"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={
            !connected || joining || !roomCode.trim() || !playerName.trim()
          }
          className="rounded-lg bg-amber-500 py-4 text-lg font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
        >
          {joining ? "Joining..." : "Join Game"}
        </button>
      </form>

      {!connected && (
        <p className="mt-4 text-sm text-red-400">Connecting to server...</p>
      )}
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  );
}
