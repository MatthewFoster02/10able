"use client";

import { useEffect } from "react";
import type { AppSocket } from "./useSocket";
import { useRoomStore } from "@/stores/room-store";
import { usePlayerStore } from "@/stores/player-store";

export function useRoomGameState(socket: AppSocket) {
  useEffect(() => {
    socket.on("room_state", (state) => {
      useRoomStore.setState(state);
    });

    socket.on("player_joined", (data) => {
      useRoomStore.setState((prev) => ({
        players: [...prev.players, data.player],
      }));
    });

    socket.on("player_disconnected", (data) => {
      useRoomStore.setState((prev) => ({
        players: prev.players.map((p) =>
          p.id === data.playerId ? { ...p, connected: false } : p
        ),
      }));
    });

    socket.on("player_reconnected", (data) => {
      useRoomStore.setState((prev) => ({
        players: prev.players.map((p) =>
          p.id === data.player.id ? data.player : p
        ),
      }));
    });

    return () => {
      socket.off("room_state");
      socket.off("player_joined");
      socket.off("player_disconnected");
      socket.off("player_reconnected");
    };
  }, [socket]);
}

export function usePlayerGameState(socket: AppSocket) {
  useEffect(() => {
    socket.on("player_state", (state) => {
      usePlayerStore.setState(state);
    });

    socket.on("game_error", (data) => {
      usePlayerStore.setState({ message: data.message });
    });

    return () => {
      socket.off("player_state");
      socket.off("game_error");
    };
  }, [socket]);
}
