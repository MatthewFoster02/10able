"use client";

import { useEffect, useState } from "react";
import type { AppSocket } from "@/hooks/useSocket";
import { ANSWER_TIMEOUT_SECONDS } from "@shared/constants";

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
  const progress = seconds / ANSWER_TIMEOUT_SECONDS;

  // SVG circle parameters
  const size = 100;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={size} height={size} className="-rotate-90">
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgb(30 41 59)" // slate-800
            strokeWidth={strokeWidth}
          />
          {/* Progress ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={
              isCritical
                ? "rgb(239 68 68)" // red-500
                : isUrgent
                  ? "rgb(245 158 11)" // amber-500
                  : "rgb(100 116 139)" // slate-500
            }
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        {/* Number overlay */}
        <div
          className={`absolute inset-0 flex items-center justify-center text-3xl font-black ${
            isCritical
              ? "animate-pulse text-red-500"
              : isUrgent
                ? "text-amber-400"
                : "text-white"
          }`}
        >
          {seconds}
        </div>
      </div>
      <span className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">
        seconds
      </span>
    </div>
  );
}
