// ============================================================
// Typed Socket.IO events — the contract between server and clients
// ============================================================

import type { RoomState, PlayerState, Player } from "./types";

// Player Site / Room Site → Server
export interface ClientToServerEvents {
  // Room management
  create_room: (callback: (response: { ok: true; roomCode: string } | { ok: false; error: string }) => void) => void;
  join_room: (
    data: { roomCode: string; playerName: string },
    callback: (response: { ok: true; playerId: string } | { ok: false; error: string }) => void
  ) => void;
  subscribe_room: (
    data: { roomCode: string },
    callback: (response: { ok: true } | { ok: false; error: string }) => void
  ) => void;

  // Game flow (from Player Site)
  start_game: () => void;
  captain_pick_player: (data: { playerId: string }) => void;
  submit_answer: (data: { answer: string }) => void;
  bank_money: () => void;

  // Lifelines
  use_nominate: (data: { targetPlayerId: string }) => void;
  nominate_suggestion: (data: { answer: string }) => void;
  accept_nominate: () => void;
  reject_nominate: () => void;
  use_overrule: (data: { replacementAnswer: string }) => void;
  reinstate_player: (data: { playerId: string }) => void;
  continue_without_reinstate: () => void;

  // Final round
  vote_final_category: (data: { categoryIndex: number }) => void;

  // Round end advancement
  continue_reveal: () => void;

  // Heartbeat
  room_heartbeat: () => void;
}

// Server → Room Site / Player Sites
export interface ServerToClientEvents {
  // State broadcasts
  room_state: (state: RoomState) => void;
  player_state: (state: PlayerState) => void;

  // Targeted player events
  your_turn: () => void;
  turn_ended: () => void;
  nominate_request: () => void;
  overrule_window: (data: { playerAnswer: string }) => void;
  reinstate_available: (data: { eliminatedPlayers: Pick<Player, "id" | "name">[] }) => void;

  // Answer results
  answer_result: (data: {
    correct: boolean;
    answer: string;
    position: number | null;
    alreadyFound: boolean;
    lifeUsed: boolean;
  }) => void;

  // Audio
  play_audio: (data: { url: string }) => void;

  // Timer
  timer_sync: (data: { secondsRemaining: number }) => void;

  // Lobby
  player_joined: (data: { player: Player }) => void;
  player_disconnected: (data: { playerId: string }) => void;
  player_reconnected: (data: { player: Player }) => void;

  // Errors
  game_error: (data: { message: string }) => void;
}

// Inter-server events (Socket.IO internals)
export interface InterServerEvents {}

// Per-socket data
export interface SocketData {
  playerId: string | null;
  roomCode: string | null;
  isRoomDisplay: boolean;
}
