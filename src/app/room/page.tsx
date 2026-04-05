"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

export default function RoomCreatePage() {
  const { socket, connected } = useSocket();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    if (!connected) return;
    setCreating(true);
    setError(null);

    socket.emit("create_room", (response) => {
      setCreating(false);
      if (response.ok) {
        router.push(`/room/${response.roomCode}`);
      } else {
        setError(response.error);
      }
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <h1 className="text-5xl font-bold tracking-tight text-amber-400">
        TENABLE
      </h1>
      <p className="text-slate-400">Host the game on a shared screen</p>

      <button
        onClick={handleCreate}
        disabled={!connected || creating}
        className="rounded-lg bg-amber-500 px-12 py-5 text-xl font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
      >
        {creating ? "Creating..." : "Create Room"}
      </button>

      {!connected && (
        <p className="text-sm text-red-400">Connecting to server...</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
