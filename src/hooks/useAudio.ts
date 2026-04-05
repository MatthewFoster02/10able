"use client";

import { useEffect, useRef, useCallback } from "react";
import type { AppSocket } from "./useSocket";

export function useAudioQueue(socket: AppSocket) {
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playNext = useCallback(() => {
    if (playingRef.current || queueRef.current.length === 0) return;

    const url = queueRef.current.shift()!;
    playingRef.current = true;

    const audio = new Audio(url);
    audioRef.current = audio;

    audio.onended = () => {
      playingRef.current = false;
      audioRef.current = null;
      // Small pause between clips for dramatic effect
      setTimeout(playNext, 500);
    };

    audio.onerror = () => {
      console.warn("[Audio] Error playing clip, skipping");
      playingRef.current = false;
      audioRef.current = null;
      playNext();
    };

    audio.play().catch(() => {
      // Autoplay blocked — skip silently
      playingRef.current = false;
      audioRef.current = null;
      playNext();
    });
  }, []);

  useEffect(() => {
    function onPlayAudio(data: { url: string }) {
      queueRef.current.push(data.url);
      playNext();
    }

    socket.on("play_audio", onPlayAudio);
    return () => {
      socket.off("play_audio", onPlayAudio);
      // Stop any playing audio on unmount
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [socket, playNext]);
}
