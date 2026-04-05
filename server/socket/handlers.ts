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
import { ANSWER_TIMEOUT_SECONDS, OVERRULE_WINDOW_SECONDS } from "../../shared/constants";
import { checkAnswerLocal } from "../services/questions";
import { checkAnswerWithOpenAI } from "../services/openai";
import { generateAnswerAudio, generateWrongAnswerAudio, getPreGeneratedAnswerUrl } from "../services/elevenlabs";

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

      // Broadcast updated state to all
      broadcastState(io, room);
      broadcastPlayerStates(io, room);
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
        let lastState = "";
        room.gameActor.subscribe((snapshot: any) => {
          const currentState = snapshot.value as string;
          broadcastState(io, room);
          broadcastPlayerStates(io, room);

          // Play question audio when entering roundIntro
          if (currentState === "roundIntro" && lastState !== "roundIntro") {
            const ctx = snapshot.context;
            if (ctx?.currentQuestion) {
              const q = ctx.currentQuestion;
              // Queue: category announcement, then question, then description
              if (q.audio?.category) {
                io.to(room.code).emit("play_audio", { url: q.audio.category });
              }
              if (q.audio?.question) {
                io.to(room.code).emit("play_audio", { url: q.audio.question });
              }
              if (q.audio?.description) {
                io.to(room.code).emit("play_audio", { url: q.audio.description });
              }
            }
          }

          // Play audio for revealed answers during round end
          if (currentState === "roundEnd") {
            const ctx = snapshot.context;
            if (ctx?.lastRevealedPosition && ctx?.currentQuestion) {
              const answer = ctx.currentQuestion.answers.find(
                (a: any) => a.position === ctx.lastRevealedPosition
              );
              if (answer?.audio) {
                io.to(room.code).emit("play_audio", { url: answer.audio });
              }
            }
          }

          lastState = currentState;
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
      const gameState = getGameState(room);
      const isFinal = gameState === "finalRound";
      const isNonCaptainRound = gameState === "playerTurn";

      console.log(`[Room ${room.code}] Answer submitted: "${answer}" by ${socket.data.playerId}`);

      // Check for "already found" first (no overrule window needed)
      const localResult = checkAnswerLocal(answer, ctx.currentQuestion.answers, ctx.revealedPositions);
      if (!localResult.match && localResult.alreadyFound) {
        const alreadyFoundType = isFinal ? "FINAL_VALIDATED_ALREADY_FOUND" as const : "VALIDATED_ALREADY_FOUND" as const;
        room.gameActor.send({ type: alreadyFoundType } as any);
        return;
      }

      // For non-captain individual rounds with overrule available: pause for overrule window
      const canOverrule = isNonCaptainRound && !ctx.overruleUsedThisRound && ctx.correctCount < 5;
      if (canOverrule) {
        // Store the pending answer and enter overrule window
        room.gameActor.send({ type: "ANSWER_PENDING", answer });

        // Start 5-second overrule timeout
        setTimeout(() => {
          const currentState = getGameState(room);
          if (currentState === "overruleWindow") {
            console.log(`[Room ${room.code}] Overrule window expired, validating answer`);
            room.gameActor!.send({ type: "OVERRULE_TIMEOUT" });
            // Now validate the pending answer
            validateAndSendAnswer(io, room, answer, false);
          }
        }, OVERRULE_WINDOW_SECONDS * 1000);
        return;
      }

      // Immediate validation (captain round, final round, or overrule unavailable)
      await validateAndSendAnswer(io, room, answer, isFinal);
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

      // Transition machine to overruleInput
      room.gameActor.send({ type: "USE_OVERRULE" });

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
        } else if (!origResult.alreadyFound) {
          // Try Tier 2 for the original answer
          const remaining = ctx.currentQuestion.answers.filter((a) => !ctx.revealedPositions.has(a.position));
          const aiOrig = await checkAnswerWithOpenAI(originalAnswer, ctx.currentQuestion.category, ctx.currentQuestion.question, remaining, ctx.currentQuestion.id);
          if (aiOrig.match && aiOrig.position !== null && aiOrig.answerText) {
            originalWasCorrect = true;
            originalPosition = aiOrig.position;
            originalAnswerText = aiOrig.answerText;
          }
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

    // ── Final round vote ──────────────────────────────────────
    socket.on("vote_final_category", (data) => {
      const room = getPlayerRoom(socket);
      if (!room?.gameActor) return;

      const ctx = getGameContext(room);
      if (!ctx) return;

      const categoryIndex = data.categoryIndex;
      if (categoryIndex !== 0 && categoryIndex !== 1) return;

      room.gameActor.send({
        type: "VOTE_CATEGORY",
        playerId: socket.data.playerId!,
        categoryIndex,
      });

      // Check if all qualified players have voted
      const qualified = ctx.players.filter(
        (p) => p.status === "qualified" || p.status === "reinstated" || p.isCaptain
      );
      const newVotes = { ...ctx.finalVotes, [socket.data.playerId!]: categoryIndex };
      if (Object.keys(newVotes).length >= qualified.length) {
        room.gameActor.send({ type: "START_FINAL" });
        startTimerSync(io, room);
      }
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
  // Only start one persistent interval per room
  if (room.timerInterval) return;

  let lastSentDeadline: number | null = null;
  let timerFired = false;

  room.timerInterval = setInterval(() => {
    if (!room.gameActor) {
      clearInterval(room.timerInterval!);
      room.timerInterval = null;
      return;
    }

    const ctx = getGameContext(room);
    if (!ctx?.timerDeadline) {
      // No active timer — send 0 and wait
      return;
    }

    // Reset fired flag when deadline changes (new timer started)
    if (ctx.timerDeadline !== lastSentDeadline) {
      lastSentDeadline = ctx.timerDeadline;
      timerFired = false;
    }

    const secondsRemaining = Math.max(0, Math.ceil((ctx.timerDeadline - Date.now()) / 1000));
    io.to(room.code).emit("timer_sync", { secondsRemaining });

    if (secondsRemaining <= 0 && !timerFired) {
      timerFired = true;
      const gameState = getGameState(room);
      const isFinal = gameState === "finalRound";
      const isVote = gameState === "finalVote";
      if (isVote) {
        room.gameActor.send({ type: "VOTE_TIMER_EXPIRED" });
      } else if (isFinal) {
        room.gameActor.send({ type: "FINAL_TIMER_EXPIRED" });
      } else {
        room.gameActor.send({ type: "TIMER_EXPIRED" });
      }
    }
  }, 1000);
}

async function validateAndSendAnswer(
  io: AppServer,
  room: Room,
  answer: string,
  isFinal: boolean
): Promise<void> {
  if (!room.gameActor) return;
  const ctx = getGameContext(room);
  if (!ctx?.currentQuestion) return;

  const correctType = isFinal ? "FINAL_VALIDATED_CORRECT" as const : "VALIDATED_CORRECT" as const;
  const wrongType = isFinal ? "FINAL_VALIDATED_WRONG" as const : "VALIDATED_WRONG" as const;

  // Tier 1: Local match
  const localResult = checkAnswerLocal(answer, ctx.currentQuestion.answers, ctx.revealedPositions);

  if (localResult.match) {
    room.gameActor.send({ type: correctType, position: localResult.position, answerText: localResult.answerText } as any);
    const preGenUrl = getPreGeneratedAnswerUrl(ctx.currentQuestion.answers, localResult.position);
    generateAnswerAudio(localResult.position, localResult.answerText, preGenUrl).then((audio) => {
      if (audio) io.to(room.code).emit("play_audio", { url: audio });
    });
    return;
  }

  if (!localResult.match && localResult.alreadyFound) {
    const alreadyFoundType = isFinal ? "FINAL_VALIDATED_ALREADY_FOUND" as const : "VALIDATED_ALREADY_FOUND" as const;
    room.gameActor.send({ type: alreadyFoundType } as any);
    return;
  }

  // Tier 2: OpenAI fuzzy match
  const remainingAnswers = ctx.currentQuestion.answers.filter((a) => !ctx.revealedPositions.has(a.position));
  const aiResult = await checkAnswerWithOpenAI(
    answer, ctx.currentQuestion.category, ctx.currentQuestion.question, remainingAnswers, ctx.currentQuestion.id
  );

  if (aiResult.match && aiResult.position !== null && aiResult.answerText) {
    room.gameActor.send({ type: correctType, position: aiResult.position, answerText: aiResult.answerText } as any);
    const preGenUrl = getPreGeneratedAnswerUrl(ctx.currentQuestion.answers, aiResult.position);
    generateAnswerAudio(aiResult.position, aiResult.answerText, preGenUrl).then((audio) => {
      if (audio) io.to(room.code).emit("play_audio", { url: audio });
    });
  } else {
    room.gameActor.send({ type: wrongType } as any);
    generateWrongAnswerAudio(answer).then((audio) => {
      if (audio) io.to(room.code).emit("play_audio", { url: audio });
    });
  }
}
