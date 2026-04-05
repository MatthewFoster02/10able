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
import {
  joinRoomSchema,
  subscribeRoomSchema,
  captainPickPlayerSchema,
  submitAnswerSchema,
  useNominateSchema,
  nominateSuggestionSchema,
  useOverruleSchema,
  reinstatePlayerSchema,
} from "../../shared/validation";
import {
  createRoom,
  getRoom,
  joinRoom,
  disconnectPlayer,
  addDisplaySocket,
  removeDisplaySocket,
  buildLobbyRoomState,
  startGame,
  buildRoomStateFromGame,
  buildPlayerStateFromGame,
  getGameContext,
  getGameState,
  type Room,
} from "../game/rooms";
import { ANSWER_TIMEOUT_SECONDS } from "../../shared/constants";
import { checkAnswerLocal } from "../services/questions";
import { checkAnswerWithOpenAI } from "../services/openai";

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

      // Send current state (lobby or game)
      if (room.gameActor) {
        socket.emit("room_state", buildRoomStateFromGame(room));
      } else {
        socket.emit("room_state", buildLobbyRoomState(room));
      }
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

      // Broadcast updated state
      broadcastState(io, room);

      // Send targeted player state
      socket.emit("player_state", buildPlayerStateFromGame(room, result.player.id));
    });

    // ── Start game (captain only) ───────────────────────────
    socket.on("start_game", () => {
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

      console.log(`[Room ${room.code}] Game starting!`);

      startGame(room);

      // Set up state subscription — broadcast on every transition
      if (room.gameActor) {
        room.gameActor.subscribe((snapshot: any) => {
          broadcastState(io, room);
          broadcastPlayerStates(io, room);
        });

        // Start timer sync
        startTimerSync(io, room);
      }

      broadcastState(io, room);
      broadcastPlayerStates(io, room);
    });

    // ── Captain picks a player ──────────────────────────────
    socket.on("captain_pick_player", (data) => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const parsed = captainPickPlayerSchema.safeParse(data);
      if (!parsed.success) return;

      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (!player?.isCaptain) {
        socket.emit("game_error", { message: "Only the captain can pick players." });
        return;
      }

      console.log(`[Room ${room.code}] Captain picked player: ${parsed.data.playerId}`);
      room.gameActor.send({ type: "CAPTAIN_PICK", playerId: parsed.data.playerId });

      // Start timer for the picked player
      startTimerSync(io, room);
    });

    // ── Submit answer (Tier 1 + Tier 2 validation) ────────
    socket.on("submit_answer", async (data) => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const parsed = submitAnswerSchema.safeParse(data);
      if (!parsed.success) return;

      const ctx = getGameContext(room);
      if (!ctx || ctx.activePlayerId !== socket.data.playerId) {
        socket.emit("game_error", { message: "It's not your turn." });
        return;
      }

      if (!ctx.currentQuestion) return;

      const answer = parsed.data.answer;
      console.log(`[Room ${room.code}] Answer submitted: "${answer}" by ${socket.data.playerId}`);

      // Tier 1: Local match
      const localResult = checkAnswerLocal(
        answer,
        ctx.currentQuestion.answers,
        ctx.revealedPositions
      );

      if (localResult.match) {
        room.gameActor.send({
          type: "VALIDATED_CORRECT",
          position: localResult.position,
          answerText: localResult.answerText,
        });
        return;
      }

      if (localResult.alreadyFound) {
        room.gameActor.send({ type: "VALIDATED_ALREADY_FOUND" });
        return;
      }

      // Tier 2: OpenAI fuzzy match
      const remainingAnswers = ctx.currentQuestion.answers.filter(
        (a) => !ctx.revealedPositions.has(a.position)
      );

      const aiResult = await checkAnswerWithOpenAI(
        answer,
        ctx.currentQuestion.category,
        ctx.currentQuestion.question,
        remainingAnswers,
        ctx.currentQuestion.id
      );

      if (aiResult.match && aiResult.position !== null && aiResult.answerText) {
        room.gameActor.send({
          type: "VALIDATED_CORRECT",
          position: aiResult.position,
          answerText: aiResult.answerText,
        });
      } else {
        room.gameActor.send({ type: "VALIDATED_WRONG" });
      }
    });

    // ── Bank money ──────────────────────────────────────────
    socket.on("bank_money", () => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const ctx = getGameContext(room);
      if (!ctx || ctx.activePlayerId !== socket.data.playerId) {
        socket.emit("game_error", { message: "It's not your turn." });
        return;
      }

      console.log(`[Room ${room.code}] Player banking money`);
      room.gameActor.send({ type: "BANK" });
    });

    // ── Nominate ─────────────────────────────────────────────
    socket.on("use_nominate", (data) => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const parsed = useNominateSchema.safeParse(data);
      if (!parsed.success) return;

      const ctx = getGameContext(room);
      if (!ctx || ctx.activePlayerId !== socket.data.playerId) return;

      console.log(`[Room ${room.code}] Nominate: ${parsed.data.targetPlayerId}`);
      room.gameActor.send({ type: "USE_NOMINATE", targetPlayerId: parsed.data.targetPlayerId });

      // Notify the nominated player
      const targetSocketId = room.playerSockets.get(parsed.data.targetPlayerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("nominate_request");
      }
    });

    socket.on("nominate_suggestion", (data) => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const parsed = nominateSuggestionSchema.safeParse(data);
      if (!parsed.success) return;

      const ctx = getGameContext(room);
      if (!ctx || ctx.nominateTargetId !== socket.data.playerId) return;

      console.log(`[Room ${room.code}] Nominate suggestion: "${parsed.data.answer}"`);
      room.gameActor.send({ type: "NOMINATE_SUGGESTION", answer: parsed.data.answer });

      // Send suggestion to active player
      const activeSocketId = room.playerSockets.get(ctx.activePlayerId!);
      if (activeSocketId) {
        io.to(activeSocketId).emit("player_state", {
          ...buildPlayerStateFromGame(room, ctx.activePlayerId!),
          nominateSuggestion: parsed.data.answer,
        });
      }
    });

    socket.on("accept_nominate", async () => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const ctx = getGameContext(room);
      if (!ctx || ctx.activePlayerId !== socket.data.playerId) return;
      if (!ctx.nominateSuggestion || !ctx.currentQuestion) return;

      // Submit the nominated answer through normal validation
      room.gameActor.send({ type: "ACCEPT_NOMINATE" });

      // Now validate and submit the suggestion as a regular answer
      const answer = ctx.nominateSuggestion;
      const localResult = checkAnswerLocal(answer, ctx.currentQuestion.answers, ctx.revealedPositions);

      if (localResult.match) {
        room.gameActor.send({ type: "VALIDATED_CORRECT", position: localResult.position, answerText: localResult.answerText });
        return;
      }
      if (localResult.alreadyFound) {
        room.gameActor.send({ type: "VALIDATED_ALREADY_FOUND" });
        return;
      }

      const remainingAnswers = ctx.currentQuestion.answers.filter((a) => !ctx.revealedPositions.has(a.position));
      const aiResult = await checkAnswerWithOpenAI(answer, ctx.currentQuestion.category, ctx.currentQuestion.question, remainingAnswers, ctx.currentQuestion.id);

      if (aiResult.match && aiResult.position !== null && aiResult.answerText) {
        room.gameActor.send({ type: "VALIDATED_CORRECT", position: aiResult.position, answerText: aiResult.answerText });
      } else {
        room.gameActor.send({ type: "VALIDATED_WRONG" });
      }
    });

    socket.on("reject_nominate", () => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const ctx = getGameContext(room);
      if (!ctx || ctx.activePlayerId !== socket.data.playerId) return;

      room.gameActor.send({ type: "REJECT_NOMINATE" });
    });

    // ── Overrule ────────────────────────────────────────────
    socket.on("use_overrule", async (data) => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const parsed = useOverruleSchema.safeParse(data);
      if (!parsed.success) return;

      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (!player?.isCaptain) return;

      const ctx = getGameContext(room);
      if (!ctx || !ctx.currentQuestion) return;

      console.log(`[Room ${room.code}] Overrule with: "${parsed.data.replacementAnswer}"`);

      // First check the original pending answer
      const originalAnswer = ctx.pendingAnswer;
      let originalWasCorrect = false;
      let originalPosition: number | null = null;
      let originalAnswerText: string | null = null;

      if (originalAnswer) {
        const origResult = checkAnswerLocal(originalAnswer, ctx.currentQuestion.answers, ctx.revealedPositions);
        if (origResult.match) {
          originalWasCorrect = true;
          originalPosition = origResult.position;
          originalAnswerText = origResult.answerText;
        }
      }

      // Now validate captain's replacement answer
      const captainAnswer = parsed.data.replacementAnswer;
      const localResult = checkAnswerLocal(captainAnswer, ctx.currentQuestion.answers, ctx.revealedPositions);

      if (localResult.match) {
        room.gameActor.send({
          type: "OVERRULE_VALIDATED_CORRECT",
          position: localResult.position,
          answerText: localResult.answerText,
          originalWasCorrect,
          originalPosition,
          originalAnswerText,
        });
        return;
      }

      // Try Tier 2
      const remainingAnswers = ctx.currentQuestion.answers.filter((a) => !ctx.revealedPositions.has(a.position));
      const aiResult = await checkAnswerWithOpenAI(captainAnswer, ctx.currentQuestion.category, ctx.currentQuestion.question, remainingAnswers, ctx.currentQuestion.id);

      if (aiResult.match && aiResult.position !== null && aiResult.answerText) {
        room.gameActor.send({
          type: "OVERRULE_VALIDATED_CORRECT",
          position: aiResult.position,
          answerText: aiResult.answerText,
          originalWasCorrect,
          originalPosition,
          originalAnswerText,
        });
      } else {
        room.gameActor.send({
          type: "OVERRULE_VALIDATED_WRONG",
          originalWasCorrect,
          originalPosition,
          originalAnswerText,
        });
      }
    });

    // ── Reinstatement ───────────────────────────────────────
    socket.on("reinstate_player", (data) => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const parsed = reinstatePlayerSchema.safeParse(data);
      if (!parsed.success) return;

      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (!player?.isCaptain) return;

      console.log(`[Room ${room.code}] Reinstating player: ${parsed.data.playerId}`);
      room.gameActor.send({ type: "REINSTATE_PLAYER", playerId: parsed.data.playerId });
    });

    socket.on("continue_without_reinstate", () => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (!player?.isCaptain) return;

      room.gameActor.send({ type: "CONTINUE_WITHOUT_REINSTATE" });
    });

    // ── Continue from round end ───────────────────────────────
    socket.on("continue_reveal", () => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      // Only allow from captain or room display
      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (!player?.isCaptain && !socket.data.isRoomDisplay) {
        return;
      }

      console.log(`[Room ${room.code}] Continuing from round end`);
      room.gameActor.send({ type: "CONTINUE_REVEAL" });
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
              broadcastState(io, room);
            }
          }
        }
      }
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────

function getPlayerRoom(socket: AppSocket): Room | null {
  if (!socket.data.roomCode) return null;
  return getRoom(socket.data.roomCode) ?? null;
}

function broadcastState(io: AppServer, room: Room): void {
  const state = room.gameActor
    ? buildRoomStateFromGame(room)
    : buildLobbyRoomState(room);
  io.to(room.code).emit("room_state", state);
}

function broadcastPlayerStates(io: AppServer, room: Room): void {
  for (const player of room.players) {
    const socketId = room.playerSockets.get(player.id);
    if (socketId) {
      const playerState = buildPlayerStateFromGame(room, player.id);
      io.to(socketId).emit("player_state", playerState);
    }
  }
}

function startTimerSync(io: AppServer, room: Room): void {
  // Clear any existing timer
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }

  room.timerInterval = setInterval(() => {
    const ctx = getGameContext(room);
    if (!ctx?.timerDeadline) {
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }
      return;
    }

    const secondsRemaining = Math.max(0, Math.ceil((ctx.timerDeadline - Date.now()) / 1000));
    io.to(room.code).emit("timer_sync", { secondsRemaining });

    if (secondsRemaining <= 0) {
      // Timer expired
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }
      if (room.gameActor) {
        room.gameActor.send({ type: "TIMER_EXPIRED" });
      }
    }
  }, 1000);
}
