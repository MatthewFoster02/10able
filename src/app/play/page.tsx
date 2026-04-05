"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

function getSavedName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("tenablePlayerName") ?? "";
}

export default function PlayerJoinPage() {
  const { socket, connected } = useSocket();
  const router = useRouter();
  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");

  useEffect(() => {
    setPlayerName(getSavedName());
  }, []);
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
          if (typeof window !== "undefined") {
            localStorage.setItem("tenablePlayerName", playerName.trim());
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
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <h1 className="mb-2 text-5xl font-black text-amber-400">TENABLE</h1>
      <p className="mb-10 text-slate-400">Enter the room code to join</p>

      <form
        onSubmit={handleJoin}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <input
          type="text"
          placeholder="ROOM CODE"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          maxLength={4}
          className="rounded-xl border-2 border-slate-700 bg-slate-900 px-5 py-5 text-center text-3xl font-black uppercase tracking-[0.3em] text-white placeholder-slate-700 outline-none transition focus:border-amber-500"
          autoComplete="off"
          inputMode="text"
        />
        <input
          type="text"
          placeholder="Your Name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={20}
          className="rounded-xl border-2 border-slate-700 bg-slate-900 px-5 py-5 text-center text-xl text-white placeholder-slate-700 outline-none transition focus:border-amber-500"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={
            !connected || joining || !roomCode.trim() || !playerName.trim()
          }
          className="mt-2 rounded-xl bg-amber-500 py-5 text-xl font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 disabled:opacity-40 disabled:shadow-none"
        >
          {joining ? "Joining..." : "Join Game"}
        </button>
      </form>

      {!connected && (
        <p className="mt-6 text-sm text-red-400 animate-pulse">
          Connecting to server...
        </p>
      )}
      {error && (
        <p className="mt-6 text-sm text-red-400 animate-shake">{error}</p>
      )}
    </div>
  );
}
