// ============================================================
// Socket.IO event handlers — bridge between clients and game logic
// ============================================================

import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../shared/events";
import type { PlayerState } from "../../shared/types";
import {
  joinRoomSchema,
  subscribeRoomSchema,
} from "../../shared/validation";
import {
  createRoom,
  getRoom,
  joinRoom,
  disconnectPlayer,
  addDisplaySocket,
  removeDisplaySocket,
  getSocketIdForPlayer,
  buildLobbyRoomState,
} from "../game/rooms";

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerHandlers(io: AppServer): void {
  io.on("connection", (socket: AppSocket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    socket.data.playerId = null;
    socket.data.roomCode = null;
    socket.data.isRoomDisplay = false;

    // ── Room creation (from Room Site) ──────────────────────
    socket.on("create_room", (callback) => {
      const room = createRoom();
      addDisplaySocket(room, socket.id);
      socket.data.roomCode = room.code;
      socket.data.isRoomDisplay = true;
      socket.join(room.code);

      console.log(`[Room] Created: ${room.code}`);
      callback({ ok: true, roomCode: room.code });

      // Send initial state
      io.to(room.code).emit("room_state", buildLobbyRoomState(room));
    });

    // ── Room subscription (Room Site viewing existing room) ─
    socket.on("subscribe_room", (data, callback) => {
      const parsed = subscribeRoomSchema.safeParse(data);
      if (!parsed.success) {
        callback({ ok: false, error: "Invalid room code." });
        return;
      }

      const room = getRoom(parsed.data.roomCode);
      if (!room) {
        callback({ ok: false, error: "Room not found." });
        return;
      }

      addDisplaySocket(room, socket.id);
      socket.data.roomCode = room.code;
      socket.data.isRoomDisplay = true;
      socket.join(room.code);

      callback({ ok: true });
      socket.emit("room_state", buildLobbyRoomState(room));
    });

    // ── Player joining (from Player Site) ───────────────────
    socket.on("join_room", (data, callback) => {
      const parsed = joinRoomSchema.safeParse(data);
      if (!parsed.success) {
        callback({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." });
        return;
      }

      const room = getRoom(parsed.data.roomCode);
      if (!room) {
        callback({ ok: false, error: "Room not found." });
        return;
      }

      const result = joinRoom(room, parsed.data.playerName, socket.id);
      if (!result.ok) {
        callback({ ok: false, error: result.error });
        return;
      }

      socket.data.playerId = result.player.id;
      socket.data.roomCode = room.code;
      socket.join(room.code);

      console.log(
        `[Room ${room.code}] Player ${result.isRejoin ? "rejoined" : "joined"}: ${result.player.name} (${result.player.id})`
      );

      callback({ ok: true, playerId: result.player.id });

      if (result.isRejoin) {
        io.to(room.code).emit("player_reconnected", { player: result.player });
      } else {
        io.to(room.code).emit("player_joined", { player: result.player });
      }

      // Broadcast updated room state to everyone
      const roomState = buildLobbyRoomState(room);
      io.to(room.code).emit("room_state", roomState);

      // Send targeted player state
      socket.emit("player_state", buildPlayerState(room, result.player.id));
    });

    // ── Start game (captain only) ───────────────────────────
    socket.on("start_game", () => {
      // Will be implemented in Phase 2 with the game machine
      const room = getPlayerRoom(socket);
      if (!room) return;

      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (!player?.isCaptain) {
        socket.emit("game_error", { message: "Only the captain can start the game." });
        return;
      }

      if (room.players.length < 2) {
        socket.emit("game_error", { message: "Need at least 2 players to start." });
        return;
      }

      console.log(`[Room ${room.code}] Game start requested by captain`);
      // Phase 2: machine.send({ type: 'START_GAME' })
    });

    // ── Disconnect ──────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);

      if (socket.data.roomCode) {
        const room = getRoom(socket.data.roomCode);
        if (room) {
          if (socket.data.isRoomDisplay) {
            removeDisplaySocket(room, socket.id);
          } else {
            const player = disconnectPlayer(room, socket.id);
            if (player) {
              console.log(`[Room ${room.code}] Player disconnected: ${player.name}`);
              io.to(room.code).emit("player_disconnected", { playerId: player.id });
              io.to(room.code).emit("room_state", buildLobbyRoomState(room));
            }
          }
        }
      }
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────

function getPlayerRoom(socket: AppSocket) {
  if (!socket.data.roomCode) return null;
  return getRoom(socket.data.roomCode) ?? null;
}

function buildPlayerState(room: ReturnType<typeof getRoom> extends infer R ? NonNullable<R> : never, playerId: string): PlayerState {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} not found in room ${room.code}`);
  }

  return {
    phase: room.phase,
    playerId: player.id,
    playerName: player.name,
    isCaptain: player.isCaptain,
    isMyTurn: false,
    myStatus: player.status,
    roomCode: room.code,
    currentRound: 0,
    totalRounds: room.players.length,
    activePlayerName: null,
    category: null,
    question: null,
    correctCount: 0,
    moneyLevel: 0,
    hasLife: true,
    canSubmitAnswer: false,
    canBank: false,
    canNominate: false,
    canOverrule: false,
    canStartGame: player.isCaptain && room.players.length >= 2,
    canPickPlayer: false,
    canReinstate: false,
    availablePlayers: [],
    eliminatedPlayers: [],
    nominateSuggestion: null,
    overrulePlayerAnswer: null,
    prizePot: 0,
    players: room.players,
    timerSeconds: null,
    finalVoteOptions: null,
    hasVoted: false,
    message: null,
  };
}
