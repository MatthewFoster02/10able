// ============================================================
// Room manager — creates/tracks rooms and player sessions
// ============================================================

import { ROOM_CODE_LENGTH, ROOM_CODE_CHARS, MAX_PLAYERS } from "../../shared/constants";
import type { Player, RoomState, GamePhase, BoardSlot, MoneyLadderTier, RoundResult } from "../../shared/types";

export interface Room {
  code: string;
  players: Player[];
  phase: GamePhase;
  createdAt: number;

  // Socket mappings: playerId -> socketId
  playerSockets: Map<string, string>;
  // Room display socket IDs
  displaySockets: Set<string>;
}

const rooms = new Map<string, Room>();

function generateRoomCode(): string {
  let code: string;
  do {
    code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function generatePlayerId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createRoom(): Room {
  const code = generateRoomCode();
  const room: Room = {
    code,
    players: [],
    phase: "lobby",
    createdAt: Date.now(),
    playerSockets: new Map(),
    displaySockets: new Set(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function deleteRoom(code: string): void {
  rooms.delete(code);
}

export type JoinResult =
  | { ok: true; player: Player; isRejoin: boolean }
  | { ok: false; error: string };

export function joinRoom(room: Room, playerName: string, socketId: string): JoinResult {
  const trimmedName = playerName.trim();

  // Check for rejoin — same name (case-insensitive)
  const existing = room.players.find(
    (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
  );

  if (existing) {
    // Rejoin: reassociate socket
    existing.connected = true;
    room.playerSockets.set(existing.id, socketId);
    return { ok: true, player: existing, isRejoin: true };
  }

  // New player
  if (room.phase !== "lobby") {
    return { ok: false, error: "Game already in progress. Use the same name to rejoin." };
  }

  if (room.players.length >= MAX_PLAYERS) {
    return { ok: false, error: "Room is full." };
  }

  // Check for duplicate name in active players
  if (room.players.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
    return { ok: false, error: "Name already taken in this room." };
  }

  const player: Player = {
    id: generatePlayerId(),
    name: trimmedName,
    isCaptain: room.players.length === 0, // first player is captain
    status: "waiting",
    roundPlayed: null,
    connected: true,
  };

  room.players.push(player);
  room.playerSockets.set(player.id, socketId);

  return { ok: true, player, isRejoin: false };
}

export function disconnectPlayer(room: Room, socketId: string): Player | null {
  for (const [playerId, sid] of room.playerSockets) {
    if (sid === socketId) {
      const player = room.players.find((p) => p.id === playerId);
      if (player) {
        player.connected = false;
        return player;
      }
    }
  }
  return null;
}

export function getSocketIdForPlayer(room: Room, playerId: string): string | undefined {
  return room.playerSockets.get(playerId);
}

export function addDisplaySocket(room: Room, socketId: string): void {
  room.displaySockets.add(socketId);
}

export function removeDisplaySocket(room: Room, socketId: string): void {
  room.displaySockets.delete(socketId);
}

export function buildLobbyRoomState(room: Room): RoomState {
  return {
    phase: room.phase,
    roomCode: room.code,
    players: room.players,
    currentRound: 0,
    totalRounds: room.players.length,
    activePlayerId: null,
    activePlayerName: null,
    category: null,
    question: null,
    description: null,
    board: [],
    prizePot: 0,
    currentRoundCorrectCount: 0,
    currentRoundMoneyLevel: 0,
    moneyLadder: [],
    nominatesRemaining: 3,
    overruleAvailable: false,
    overruleUsedThisRound: false,
    activePlayerHasLife: true,
    timerSeconds: null,
    finalVote: null,
    finalTurnOrder: [],
    finalCurrentTurnIndex: 0,
    roundHistory: [],
    message: null,
  };
}

export function getAllRooms(): Map<string, Room> {
  return rooms;
}
