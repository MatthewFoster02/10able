// ============================================================
// Room manager — creates/tracks rooms and player sessions
// ============================================================

import { createActor, type AnyActorRef } from "xstate";
import { ROOM_CODE_LENGTH, ROOM_CODE_CHARS, MAX_PLAYERS, MONEY_LADDER, ANSWER_TIMEOUT_SECONDS } from "../../shared/constants";
import type { Player, RoomState, PlayerState, GamePhase, BoardSlot, MoneyLadderTier, RoundResult } from "../../shared/types";
import { gameMachine, type GameContext } from "./machine";

export interface Room {
  code: string;
  players: Player[];
  phase: GamePhase;
  createdAt: number;

  // Socket mappings: playerId -> socketId
  playerSockets: Map<string, string>;
  // Room display socket IDs
  displaySockets: Set<string>;

  // Game actor (null until game starts)
  gameActor: AnyActorRef | null;
  // Timer interval for countdown sync
  timerInterval: ReturnType<typeof setInterval> | null;
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
    gameActor: null,
    timerInterval: null,
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

// ── Game actor management ────────────────────────────────────

export function startGame(room: Room): void {
  if (room.gameActor) return; // already started

  const actor = createActor(gameMachine, {
    input: {
      roomCode: room.code,
      players: [...room.players],
    },
  });

  room.gameActor = actor;
  actor.start();
  actor.send({ type: "START_GAME" });
}

export function getGameContext(room: Room): GameContext | null {
  if (!room.gameActor) return null;
  const snapshot = room.gameActor.getSnapshot();
  return snapshot.context as GameContext;
}

export function getGameState(room: Room): string | null {
  if (!room.gameActor) return null;
  const snapshot = room.gameActor.getSnapshot();
  return snapshot.value as string;
}

// Map XState state to our GamePhase
function mapStateToPhase(state: string): GamePhase {
  const mapping: Record<string, GamePhase> = {
    lobby: "lobby",
    roundIntro: "round_intro",
    captainPicking: "captain_picking",
    playerTurn: "individual_round",
    answerReveal: "individual_round",
    answerResult: "individual_round",
    nominateWaiting: "individual_round",
    nominateResponse: "individual_round",
    overruleWindow: "individual_round",
    overruleInput: "individual_round",
    overruleResult: "individual_round",
    captainRound: "captain_round",
    captainAnswerReveal: "captain_round",
    captainAnswerResult: "captain_round",
    captainNominateWaiting: "captain_round",
    captainNominateResponse: "captain_round",
    reinstatementOffer: "captain_round",
    roundEnd: "round_end",
    gameOver: "game_over",
  };
  return mapping[state] ?? "lobby";
}

export function buildRoomStateFromGame(room: Room): RoomState {
  const ctx = getGameContext(room);
  const state = getGameState(room);

  if (!ctx || !state) return buildLobbyRoomState(room);

  const phase = mapStateToPhase(state);
  const activePlayer = ctx.players.find((p) => p.id === ctx.activePlayerId);

  const timerSeconds = ctx.timerDeadline
    ? Math.max(0, Math.ceil((ctx.timerDeadline - Date.now()) / 1000))
    : null;

  return {
    phase,
    roomCode: room.code,
    players: ctx.players,
    currentRound: ctx.currentRound,
    totalRounds: ctx.totalRounds,
    activePlayerId: ctx.activePlayerId,
    activePlayerName: activePlayer?.name ?? null,
    category: ctx.currentQuestion?.category ?? null,
    question: ctx.currentQuestion?.question ?? null,
    description: ctx.currentQuestion?.description ?? null,
    board: ctx.board,
    prizePot: ctx.prizePot,
    currentRoundCorrectCount: ctx.correctCount,
    currentRoundMoneyLevel: ctx.moneyLadder[ctx.correctCount] ?? 0,
    moneyLadder: ctx.moneyLadder.map((amount, i) => ({
      correctCount: i,
      amount,
      active: i === ctx.correctCount,
      locked: i < 5,
    })),
    nominatesRemaining: ctx.nominatesRemaining,
    overruleAvailable: !ctx.overruleUsedThisRound && phase === "individual_round",
    overruleUsedThisRound: ctx.overruleUsedThisRound,
    activePlayerHasLife: ctx.activePlayerHasLife,
    timerSeconds,
    finalVote: null,
    finalTurnOrder: [],
    finalCurrentTurnIndex: 0,
    roundHistory: ctx.roundHistory,
    message: null,
  };
}

export function buildPlayerStateFromGame(room: Room, playerId: string): PlayerState {
  const ctx = getGameContext(room);
  const state = getGameState(room);

  if (!ctx || !state) {
    // Fall back to lobby state
    const player = room.players.find((p) => p.id === playerId);
    return {
      phase: "lobby",
      playerId,
      playerName: player?.name ?? "",
      isCaptain: player?.isCaptain ?? false,
      isMyTurn: false,
      myStatus: player?.status ?? "waiting",
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
      canStartGame: player?.isCaptain === true && room.players.length >= 2,
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

  const phase = mapStateToPhase(state);
  const player = ctx.players.find((p) => p.id === playerId);
  const activePlayer = ctx.players.find((p) => p.id === ctx.activePlayerId);
  const isMyTurn = ctx.activePlayerId === playerId;
  const isCaptain = player?.isCaptain ?? false;

  const isPlayerTurnState = ["playerTurn", "captainRound"].includes(state);
  const isNominateState = ["nominateWaiting", "nominateResponse", "captainNominateWaiting", "captainNominateResponse"].includes(state);

  const timerSeconds = ctx.timerDeadline
    ? Math.max(0, Math.ceil((ctx.timerDeadline - Date.now()) / 1000))
    : null;

  // Available players for captain picking or nominating
  const availablePlayers =
    state === "captainPicking"
      ? ctx.players
          .filter((p) => !p.isCaptain && !ctx.playOrder.includes(p.id) && p.status !== "eliminated")
          .map((p) => ({ id: p.id, name: p.name }))
      : isMyTurn && isPlayerTurnState
        ? ctx.players
            .filter((p) => p.id !== playerId && p.status !== "eliminated" && p.status !== "eliminated_final")
            .map((p) => ({ id: p.id, name: p.name }))
        : [];

  const eliminatedPlayers = state === "reinstatementOffer" && isCaptain
    ? ctx.players
        .filter((p) => p.status === "eliminated" && !ctx.reinstatedPlayerIds.includes(p.id))
        .map((p) => ({ id: p.id, name: p.name }))
    : [];

  // Nominate/overrule availability
  const canNominate = isMyTurn && isPlayerTurnState &&
    ctx.nominatesRemaining > 0 && ctx.correctCount < 5;
  const canOverrule = isCaptain && !isMyTurn &&
    !ctx.overruleUsedThisRound && ctx.correctCount < 5 &&
    ctx.currentRound !== ctx.totalRounds;
  const canReinstate = isCaptain && state === "reinstatementOffer";

  // Is the nominated player this player?
  const isNominated = ctx.nominateTargetId === playerId && isNominateState;

  return {
    phase,
    playerId,
    playerName: player?.name ?? "",
    isCaptain,
    isMyTurn,
    myStatus: player?.status ?? "waiting",
    roomCode: room.code,
    currentRound: ctx.currentRound,
    totalRounds: ctx.totalRounds,
    activePlayerName: activePlayer?.name ?? null,
    category: ctx.currentQuestion?.category ?? null,
    question: ctx.currentQuestion?.question ?? null,
    correctCount: isMyTurn ? ctx.correctCount : 0,
    moneyLevel: isMyTurn ? (ctx.moneyLadder[ctx.correctCount] ?? 0) : 0,
    hasLife: isMyTurn ? ctx.activePlayerHasLife : false,
    canSubmitAnswer: (isMyTurn && isPlayerTurnState) || isNominated,
    canBank: isMyTurn && isPlayerTurnState && ctx.correctCount >= 5,
    canNominate,
    canOverrule,
    canStartGame: false,
    canPickPlayer: isCaptain && state === "captainPicking",
    canReinstate,
    availablePlayers,
    eliminatedPlayers,
    nominateSuggestion: isMyTurn ? ctx.nominateSuggestion : null,
    overrulePlayerAnswer: isCaptain && state === "overruleWindow" ? ctx.pendingAnswer : null,
    prizePot: ctx.prizePot,
    players: ctx.players,
    timerSeconds,
    finalVoteOptions: null,
    hasVoted: false,
    message: isNominated ? "You've been nominated! Submit a suggestion." : null,
  };
}
