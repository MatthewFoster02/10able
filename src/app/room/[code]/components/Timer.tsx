"use client";

import { useEffect, useState } from "react";
import type { AppSocket } from "@/hooks/useSocket";

export function Timer({
  socket,
  initialSeconds,
}: {
  socket: AppSocket;
  initialSeconds: number | null;
}) {
  const [seconds, setSeconds] = useState(initialSeconds ?? 0);

  useEffect(() => {
    if (initialSeconds !== null) {
      setSeconds(initialSeconds);
    }
  }, [initialSeconds]);

  useEffect(() => {
    function onTimerSync(data: { secondsRemaining: number }) {
      setSeconds(data.secondsRemaining);
    }

    socket.on("timer_sync", onTimerSync);
    return () => {
      socket.off("timer_sync", onTimerSync);
    };
  }, [socket]);

  if (initialSeconds === null && seconds <= 0) return null;

  const isUrgent = seconds <= 10;
  const isCritical = seconds <= 5;

  return (
    <div className="flex flex-col items-center">
      <div
        className={`flex h-24 w-24 items-center justify-center rounded-full border-4 text-4xl font-black transition-colors ${
          isCritical
            ? "animate-pulse border-red-500 text-red-500"
            : isUrgent
              ? "border-amber-500 text-amber-400"
              : "border-slate-600 text-white"
        }`}
      >
        {seconds}
      </div>
      <span className="mt-1 text-xs uppercase tracking-wider text-slate-500">
        Seconds
      </span>
    </div>
  );
}
