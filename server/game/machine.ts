// ============================================================
// XState v5 game state machine — the heart of the game logic
// ============================================================

import { setup, assign, type ActorRefFrom } from "xstate";
import type { QuestionData, Player, BoardSlot, RoundResult } from "../../shared/types";
import {
  MONEY_LADDER,
  ANSWER_TIMEOUT_SECONDS,
  MIN_CORRECT_TO_BANK,
  NOMINATES_PER_GAME,
  ANSWERS_PER_LIST,
  OVERRULE_WINDOW_SECONDS,
} from "../../shared/constants";
import { getRandomQuestion, getTwoRandomQuestionsWithDifferentCategories } from "../services/questions";

// ── Context ──────────────────────────────────────────────────

export interface GameContext {
  roomCode: string;
  players: Player[];

  // Round tracking
  currentRound: number; // 1-indexed
  totalRounds: number;
  usedQuestionIds: string[];

  // Active round state
  activePlayerId: string | null;
  currentQuestion: QuestionData | null;
  board: BoardSlot[];
  revealedPositions: Set<number>;
  correctCount: number;
  activePlayerHasLife: boolean;

  // Money
  prizePot: number;
  moneyLadder: number[];
  reinstatementCount: number;

  // Lifelines
  nominatesRemaining: number;
  overruleUsedThisRound: boolean;

  // Nominate state
  nominateTargetId: string | null;
  nominateSuggestion: string | null;

  // Overrule state
  pendingAnswer: string | null;
  overruleActive: boolean;

  // Reinstatement
  reinstatedPlayerIds: string[];

  // Round history
  roundHistory: RoundResult[];

  // Timer
  timerDeadline: number | null;

  // Round order
  playOrder: string[];

  // Final round
  finalVoteOptions: [QuestionData, QuestionData] | null;
  finalVotes: Record<string, number>; // playerId -> 0 or 1
  finalTurnOrder: string[]; // playerIds in turn order
  finalCurrentTurnIndex: number;
  gameWon: boolean;
  gameResult: { won: boolean; prizeAmount: number; winners: string[] } | null;
}

// ── Events ───────────────────────────────────────────────────

export type GameEvent =
  | { type: "START_GAME" }
  | { type: "CAPTAIN_PICK"; playerId: string }
  | { type: "ANSWER_PENDING"; answer: string }
  | { type: "BANK" }
  | { type: "TIMER_EXPIRED" }
  | { type: "OVERRULE_TIMEOUT" }
  | { type: "CONTINUE_REVEAL" }
  | { type: "VALIDATED_CORRECT"; position: number; answerText: string }
  | { type: "VALIDATED_WRONG" }
  | { type: "VALIDATED_ALREADY_FOUND" }
  // Nominate
  | { type: "USE_NOMINATE"; targetPlayerId: string }
  | { type: "NOMINATE_SUGGESTION"; answer: string }
  | { type: "ACCEPT_NOMINATE" }
  | { type: "REJECT_NOMINATE" }
  // Overrule
  | { type: "USE_OVERRULE" }
  | { type: "OVERRULE_VALIDATED_CORRECT"; position: number; answerText: string; originalWasCorrect: boolean; originalPosition: number | null; originalAnswerText: string | null }
  | { type: "OVERRULE_VALIDATED_WRONG"; originalWasCorrect: boolean; originalPosition: number | null; originalAnswerText: string | null }
  | { type: "SKIP_OVERRULE" }
  // Reinstatement
  | { type: "REINSTATE_PLAYER"; playerId: string }
  | { type: "CONTINUE_WITHOUT_REINSTATE" }
  // Final round
  | { type: "VOTE_CATEGORY"; playerId: string; categoryIndex: number }
  | { type: "VOTE_TIMER_EXPIRED" }
  | { type: "START_FINAL" }
  | { type: "FINAL_VALIDATED_CORRECT"; position: number; answerText: string }
  | { type: "FINAL_VALIDATED_WRONG" }
  | { type: "FINAL_VALIDATED_ALREADY_FOUND" }
  | { type: "FINAL_TIMER_EXPIRED" };

// ── Helper functions ─────────────────────────────────────────

function buildMoneyLadder(reinstatements: number): number[] {
  const ladder = [...MONEY_LADDER];
  for (let i = 0; i < reinstatements; i++) {
    for (let j = ladder.length - 1; j >= 0; j--) {
      if (ladder[j] > 0) {
        ladder[j] = j > 0 ? ladder[j - 1] : 0;
        break;
      }
    }
  }
  return ladder;
}

function getMoneyForCorrectCount(ladder: number[], count: number): number {
  if (count < 0 || count >= ladder.length) return ladder[ladder.length - 1] ?? 0;
  return ladder[count] ?? 0;
}

function createEmptyBoard(): BoardSlot[] {
  return Array.from({ length: ANSWERS_PER_LIST }, (_, i) => ({
    position: i + 1,
    answer: null,
    revealed: false,
    revealedByPlayer: null,
    ghosted: false,
  }));
}

function getNextUnplayedNonCaptain(players: Player[], playOrder: string[]): Player[] {
  return players.filter(
    (p) => !p.isCaptain && !playOrder.includes(p.id) && p.status !== "eliminated"
  );
}

function getCaptain(players: Player[]): Player | undefined {
  return players.find((p) => p.isCaptain);
}

// ── Machine definition ───────────────────────────────────────

export const gameMachine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
    input: {} as { roomCode: string; players: Player[] },
  },
  actions: {
    initGame: assign(({ context }) => ({
      totalRounds: context.players.length,
      currentRound: 1,
      nominatesRemaining: NOMINATES_PER_GAME,
      prizePot: 0,
      roundHistory: [],
      playOrder: [],
      usedQuestionIds: [],
      reinstatedPlayerIds: [],
    })),

    setupRound: assign(({ context }) => {
      const question = getRandomQuestion(context.usedQuestionIds);
      if (!question) throw new Error("No more questions available");

      return {
        currentQuestion: question,
        board: createEmptyBoard(),
        revealedPositions: new Set<number>(),
        correctCount: 0,
        activePlayerHasLife: true,
        overruleUsedThisRound: false,
        moneyLadder: buildMoneyLadder(0),
        reinstatementCount: 0,
        timerDeadline: null,
        activePlayerId: null,
        nominateTargetId: null,
        nominateSuggestion: null,
        pendingAnswer: null,
        overruleActive: false,
        reinstatedPlayerIds: [],
        usedQuestionIds: [...context.usedQuestionIds, question.id],
      };
    }),

    assignPlayer: assign(({ context, event }) => {
      if (event.type !== "CAPTAIN_PICK") return {};
      const playerId = event.playerId;
      const players = context.players.map((p) =>
        p.id === playerId ? { ...p, status: "active" as const, roundPlayed: context.currentRound } : p
      );
      return {
        activePlayerId: playerId,
        activePlayerHasLife: true,
        players,
        playOrder: [...context.playOrder, playerId],
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
      };
    }),

    assignCaptain: assign(({ context }) => {
      const captain = getCaptain(context.players);
      if (!captain) throw new Error("No captain found");
      const players = context.players.map((p) =>
        p.id === captain.id ? { ...p, status: "active" as const, roundPlayed: context.currentRound } : p
      );
      return {
        activePlayerId: captain.id,
        activePlayerHasLife: true,
        players,
        reinstatedPlayerIds: [],
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
      };
    }),

    processValidatedCorrect: assign(({ context, event }) => {
      if (event.type !== "VALIDATED_CORRECT") return {};
      const newRevealed = new Set(context.revealedPositions);
      newRevealed.add(event.position);
      const newBoard = context.board.map((slot) =>
        slot.position === event.position
          ? { ...slot, answer: event.answerText, revealed: true, revealedByPlayer: context.activePlayerId }
          : slot
      );
      return {
        board: newBoard,
        revealedPositions: newRevealed,
        correctCount: context.correctCount + 1,
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
      };
    }),

    processValidatedWrong: assign(({ context }) => {
      if (context.activePlayerHasLife) {
        return {
          activePlayerHasLife: false,
          timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
        };
      }
      // Captain is never eliminated in individual rounds
      const isCaptainRound = context.currentRound === context.totalRounds;
      if (isCaptainRound) {
        // Captain loses life but isn't eliminated — round just ends
        return {
          timerDeadline: null,
        };
      }
      const players = context.players.map((p) =>
        p.id === context.activePlayerId ? { ...p, status: "eliminated" as const } : p
      );
      return { players, timerDeadline: null };
    }),

    processValidatedAlreadyFound: assign(() => ({
      timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
    })),

    handleTimerExpired: assign(({ context }) => {
      if (context.activePlayerHasLife) {
        return {
          activePlayerHasLife: false,
          timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
        };
      }
      const isCaptainRound = context.currentRound === context.totalRounds;
      if (isCaptainRound) {
        return { timerDeadline: null };
      }
      const players = context.players.map((p) =>
        p.id === context.activePlayerId ? { ...p, status: "eliminated" as const } : p
      );
      return { players, timerDeadline: null };
    }),

    bankMoney: assign(({ context }) => {
      const amount = getMoneyForCorrectCount(context.moneyLadder, context.correctCount);
      // Confirm any reinstatements
      const players = context.players.map((p) => {
        if (p.id === context.activePlayerId) {
          return { ...p, status: "qualified" as const };
        }
        // Reinstated players become qualified
        if (context.reinstatedPlayerIds.includes(p.id)) {
          return { ...p, status: "reinstated" as const };
        }
        return p;
      });
      return {
        prizePot: context.prizePot + amount,
        players,
        timerDeadline: null,
        roundHistory: [
          ...context.roundHistory,
          {
            roundNumber: context.currentRound,
            playerId: context.activePlayerId!,
            playerName: players.find((p) => p.id === context.activePlayerId)?.name ?? "",
            correctCount: context.correctCount,
            moneyBanked: amount,
            eliminated: false,
            listId: context.currentQuestion?.id ?? "",
          },
        ],
      };
    }),

    recordElimination: assign(({ context }) => {
      // If captain's round, void reinstatements
      const isCaptainRound = context.currentRound === context.totalRounds;
      let players = context.players;
      if (isCaptainRound && context.reinstatedPlayerIds.length > 0) {
        players = players.map((p) =>
          context.reinstatedPlayerIds.includes(p.id)
            ? { ...p, status: "eliminated" as const }
            : p
        );
      }
      return {
        players,
        roundHistory: [
          ...context.roundHistory,
          {
            roundNumber: context.currentRound,
            playerId: context.activePlayerId!,
            playerName: context.players.find((p) => p.id === context.activePlayerId)?.name ?? "",
            correctCount: context.correctCount,
            moneyBanked: 0,
            eliminated: true,
            listId: context.currentQuestion?.id ?? "",
          },
        ],
        timerDeadline: null,
      };
    }),

    advanceRound: assign(({ context }) => ({
      currentRound: context.currentRound + 1,
    })),

    // ── Nominate actions ────────────────────────────────────
    startNominate: assign(({ context, event }) => {
      if (event.type !== "USE_NOMINATE") return {};
      return {
        nominateTargetId: event.targetPlayerId,
        nominateSuggestion: null,
        nominatesRemaining: context.nominatesRemaining - 1,
      };
    }),

    receiveNominateSuggestion: assign(({ context, event }) => {
      if (event.type !== "NOMINATE_SUGGESTION") return {};
      return { nominateSuggestion: event.answer };
    }),

    clearNominate: assign(() => ({
      nominateTargetId: null,
      nominateSuggestion: null,
    })),

    // ── Overrule actions ────────────────────────────────────
    processOverruleResult: assign(({ context, event }) => {
      if (event.type !== "OVERRULE_VALIDATED_CORRECT" && event.type !== "OVERRULE_VALIDATED_WRONG") return {};

      const updates: Partial<GameContext> = {
        overruleUsedThisRound: true,
        overruleActive: false,
        pendingAnswer: null,
      };

      if (event.originalWasCorrect && event.originalPosition !== null && event.originalAnswerText) {
        // Original was correct — show ghosted on board, no credit
        updates.board = context.board.map((slot) =>
          slot.position === event.originalPosition
            ? { ...slot, answer: event.originalAnswerText!, revealed: true, ghosted: true, revealedByPlayer: null }
            : slot
        );
        const newRevealed = new Set(context.revealedPositions);
        newRevealed.add(event.originalPosition);
        updates.revealedPositions = newRevealed;
        // Don't increment correctCount — no credit given
      }

      if (event.type === "OVERRULE_VALIDATED_CORRECT") {
        // Captain's answer is correct
        const newRevealed = new Set(updates.revealedPositions ?? context.revealedPositions);
        newRevealed.add(event.position);
        updates.revealedPositions = newRevealed;
        updates.board = (updates.board ?? context.board).map((slot) =>
          slot.position === event.position
            ? { ...slot, answer: event.answerText, revealed: true, revealedByPlayer: context.activePlayerId, ghosted: false }
            : slot
        );
        updates.correctCount = context.correctCount + 1;
        updates.timerDeadline = Date.now() + ANSWER_TIMEOUT_SECONDS * 1000;
      } else {
        // Captain's answer is also wrong — costs the player
        if (context.activePlayerHasLife) {
          updates.activePlayerHasLife = false;
          updates.timerDeadline = Date.now() + ANSWER_TIMEOUT_SECONDS * 1000;
        } else {
          updates.players = context.players.map((p) =>
            p.id === context.activePlayerId ? { ...p, status: "eliminated" as const } : p
          );
          updates.timerDeadline = null;
        }
      }

      return updates;
    }),

    markOverruleUsed: assign(() => ({
      overruleUsedThisRound: true,
      overruleActive: false,
      pendingAnswer: null,
    })),

    // ── Reinstatement actions ───────────────────────────────
    reinstatePlayer: assign(({ context, event }) => {
      if (event.type !== "REINSTATE_PLAYER") return {};
      const newReinstatementCount = context.reinstatementCount + 1;
      return {
        reinstatedPlayerIds: [...context.reinstatedPlayerIds, event.playerId],
        players: context.players.map((p) =>
          p.id === event.playerId ? { ...p, status: "reinstated" as const } : p
        ),
        reinstatementCount: newReinstatementCount,
        moneyLadder: buildMoneyLadder(newReinstatementCount),
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
      };
    }),

    continueWithoutReinstate: assign(() => ({
      timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
    })),

    storePendingAnswer: assign(({ context, event }) => {
      if (event.type !== "ANSWER_PENDING") return {};
      return {
        pendingAnswer: event.answer,
        overruleActive: true,
      };
    }),

    clearPendingAnswer: assign(() => ({
      pendingAnswer: null,
      overruleActive: false,
    })),

    revealAllAnswers: assign(({ context }) => {
      if (!context.currentQuestion) return {};
      const board = context.board.map((slot) => {
        if (slot.revealed) return slot;
        const answer = context.currentQuestion!.answers.find((a) => a.position === slot.position);
        return {
          ...slot,
          answer: answer?.answer ?? null,
          revealed: true,
          revealedByPlayer: null,
        };
      });
      return { board };
    }),

    revealNextAnswer: assign(({ context }) => {
      if (!context.currentQuestion) return {};
      // Find the highest-position unrevealed slot (bottom to top: 10, 9, 8...)
      const unrevealed = context.board
        .filter((slot) => !slot.revealed)
        .sort((a, b) => b.position - a.position);
      if (unrevealed.length === 0) return {};
      const next = unrevealed[0];
      const answer = context.currentQuestion.answers.find((a) => a.position === next.position);
      const board = context.board.map((slot) =>
        slot.position === next.position
          ? { ...slot, answer: answer?.answer ?? null, revealed: true, revealedByPlayer: null }
          : slot
      );
      return { board };
    }),

    // ── Final round actions ─────────────────────────────────
    setupFinalVote: assign(({ context }) => {
      // Pick 2 random questions with different categories for voting
      const pair = getTwoRandomQuestionsWithDifferentCategories(context.usedQuestionIds);
      if (!pair) throw new Error("Not enough questions for final vote");
      const [available, available2] = pair;

      return {
        finalVoteOptions: [available, available2] as [QuestionData, QuestionData],
        finalVotes: {},
        timerDeadline: Date.now() + 60 * 1000, // 60 second vote
      };
    }),

    recordVote: assign(({ context, event }) => {
      if (event.type !== "VOTE_CATEGORY") return {};
      return {
        finalVotes: { ...context.finalVotes, [event.playerId]: event.categoryIndex },
      };
    }),

    resolveFinalVote: assign(({ context }) => {
      if (!context.finalVoteOptions) return {};

      // Count votes
      let count0 = 0;
      let count1 = 0;
      for (const vote of Object.values(context.finalVotes)) {
        if (vote === 0) count0++;
        else count1++;
      }

      // Tie = captain's choice wins
      const captain = getCaptain(context.players);
      let chosenIndex = count0 >= count1 ? 0 : 1;
      if (count0 === count1 && captain) {
        const captainVote = context.finalVotes[captain.id];
        if (captainVote !== undefined) {
          chosenIndex = captainVote;
        }
      }

      const chosenQuestion = context.finalVoteOptions[chosenIndex];

      // Build turn order: captain first, then others in round order
      const qualified = context.players.filter(
        (p) => p.status === "qualified" || p.status === "reinstated" || p.isCaptain
      );
      const captainPlayer = qualified.find((p) => p.isCaptain);
      const others = qualified
        .filter((p) => !p.isCaptain)
        .sort((a, b) => (a.roundPlayed ?? 0) - (b.roundPlayed ?? 0));
      const turnOrder = [
        ...(captainPlayer ? [captainPlayer.id] : []),
        ...others.map((p) => p.id),
      ];

      return {
        currentQuestion: chosenQuestion,
        board: createEmptyBoard(),
        revealedPositions: new Set<number>(),
        correctCount: 0,
        finalTurnOrder: turnOrder,
        finalCurrentTurnIndex: 0,
        activePlayerId: turnOrder[0] ?? null,
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
        usedQuestionIds: [...context.usedQuestionIds, chosenQuestion.id],
      };
    }),

    advanceFinalTurn: assign(({ context }) => {
      // Find next non-eliminated player
      let nextIndex = context.finalCurrentTurnIndex + 1;
      while (nextIndex < context.finalTurnOrder.length) {
        const pid = context.finalTurnOrder[nextIndex];
        const player = context.players.find((p) => p.id === pid);
        if (player && player.status !== "eliminated_final") break;
        nextIndex++;
      }
      // Wrap around
      if (nextIndex >= context.finalTurnOrder.length) {
        nextIndex = 0;
        while (nextIndex < context.finalTurnOrder.length) {
          const pid = context.finalTurnOrder[nextIndex];
          const player = context.players.find((p) => p.id === pid);
          if (player && player.status !== "eliminated_final") break;
          nextIndex++;
        }
      }
      const nextPlayerId = context.finalTurnOrder[nextIndex] ?? null;
      return {
        finalCurrentTurnIndex: nextIndex,
        activePlayerId: nextPlayerId,
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
      };
    }),

    processFinalCorrect: assign(({ context, event }) => {
      if (event.type !== "FINAL_VALIDATED_CORRECT") return {};
      const newRevealed = new Set(context.revealedPositions);
      newRevealed.add(event.position);
      const newBoard = context.board.map((slot) =>
        slot.position === event.position
          ? { ...slot, answer: event.answerText, revealed: true, revealedByPlayer: context.activePlayerId }
          : slot
      );
      return {
        board: newBoard,
        revealedPositions: newRevealed,
        correctCount: context.correctCount + 1,
      };
    }),

    eliminateFinalPlayer: assign(({ context }) => ({
      players: context.players.map((p) =>
        p.id === context.activePlayerId ? { ...p, status: "eliminated_final" as const } : p
      ),
      timerDeadline: null,
    })),

    setGameWon: assign(({ context }) => {
      const winners = context.players
        .filter((p) => p.status !== "eliminated" && p.status !== "eliminated_final")
        .map((p) => p.name);
      const prizeAmount = context.prizePot || 500;
      return {
        gameWon: true,
        gameResult: { won: true, prizeAmount, winners },
      };
    }),

    setGameLost: assign(({ context }) => ({
      gameWon: false,
      prizePot: 0,
      gameResult: { won: false, prizeAmount: 0, winners: [] },
    })),
  },

  guards: {
    hasLife: ({ context }) => context.activePlayerHasLife,
    canBank: ({ context }) => context.correctCount >= MIN_CORRECT_TO_BANK,
    allAnswersFound: ({ context }) => context.correctCount >= ANSWERS_PER_LIST,
    isPlayerEliminated: ({ context }) => {
      const player = context.players.find((p) => p.id === context.activePlayerId);
      return player?.status === "eliminated";
    },
    isCaptainRound: ({ context }) => context.currentRound === context.totalRounds,
    isCaptainRoundAndNotEliminated: ({ context }) => {
      // Captain is never truly eliminated in their round — round just ends
      const isCaptainRound = context.currentRound === context.totalRounds;
      if (!isCaptainRound) return false;
      return !context.activePlayerHasLife; // second wrong answer ends captain round
    },
    hasMoreRounds: ({ context }) => context.currentRound < context.totalRounds,
    validPickTarget: ({ context, event }) => {
      if (event.type !== "CAPTAIN_PICK") return false;
      const available = getNextUnplayedNonCaptain(context.players, context.playOrder);
      return available.some((p) => p.id === event.playerId);
    },
    canNominate: ({ context }) =>
      context.nominatesRemaining > 0 && context.correctCount < MIN_CORRECT_TO_BANK,
    canOverrule: ({ context }) =>
      !context.overruleUsedThisRound &&
      context.correctCount < MIN_CORRECT_TO_BANK &&
      context.currentRound !== context.totalRounds, // not in captain's round
    canReinstate: ({ context }) => {
      if (context.currentRound !== context.totalRounds) return false;
      if (context.correctCount < MIN_CORRECT_TO_BANK) return false;
      const eliminated = context.players.filter(
        (p) => p.status === "eliminated" && !context.reinstatedPlayerIds.includes(p.id)
      );
      return eliminated.length > 0;
    },
    isOverruleCorrect: ({ event }) =>
      event.type === "OVERRULE_VALIDATED_CORRECT",
    allFinalAnswersFound: ({ context }) =>
      context.correctCount >= ANSWERS_PER_LIST,
    allFinalPlayersEliminated: ({ context }) => {
      const alive = context.finalTurnOrder.filter((pid) => {
        const p = context.players.find((pl) => pl.id === pid);
        return p && p.status !== "eliminated_final";
      });
      return alive.length === 0;
    },
    allBoardRevealed: ({ context }) =>
      context.board.every((slot) => slot.revealed),
    hasQualifiedPlayers: ({ context }) =>
      context.players.some((p) => p.status === "qualified" || p.status === "reinstated" || p.isCaptain),
  },
}).createMachine({
  id: "tenable",
  initial: "lobby",
  context: ({ input }) => ({
    roomCode: input.roomCode,
    players: input.players,
    currentRound: 0,
    totalRounds: 0,
    usedQuestionIds: [],
    activePlayerId: null,
    currentQuestion: null,
    board: createEmptyBoard(),
    revealedPositions: new Set<number>(),
    correctCount: 0,
    activePlayerHasLife: true,
    prizePot: 0,
    moneyLadder: [...MONEY_LADDER],
    reinstatementCount: 0,
    nominatesRemaining: NOMINATES_PER_GAME,
    overruleUsedThisRound: false,
    nominateTargetId: null,
    nominateSuggestion: null,
    pendingAnswer: null,
    overruleActive: false,
    reinstatedPlayerIds: [],
    roundHistory: [],
    timerDeadline: null,
    playOrder: [],
    finalVoteOptions: null,
    finalVotes: {},
    finalTurnOrder: [],
    finalCurrentTurnIndex: 0,
    gameWon: false,
    gameResult: null,
  }),

  states: {
    lobby: {
      on: {
        START_GAME: {
          target: "roundIntro",
          actions: ["initGame", "setupRound"],
        },
      },
    },

    roundIntro: {
      after: {
        3000: [
          { target: "captainRound", guard: "isCaptainRound", actions: ["assignCaptain"] },
          { target: "captainPicking" },
        ],
      },
    },

    captainPicking: {
      on: {
        CAPTAIN_PICK: {
          target: "playerTurn",
          guard: "validPickTarget",
          actions: ["assignPlayer"],
        },
      },
    },

    // ── Individual round states ─────────────────────────────

    playerTurn: {
      on: {
        ANSWER_PENDING: {
          // Non-captain round + overrule available → pause for captain
          guard: "canOverrule",
          target: "overruleWindow",
          actions: ["storePendingAnswer"],
        },
        VALIDATED_ALREADY_FOUND: {
          target: "playerTurn",
          actions: ["processValidatedAlreadyFound"],
          reenter: true,
        },
        VALIDATED_CORRECT: {
          target: "answerReveal",
          actions: ["processValidatedCorrect"],
        },
        VALIDATED_WRONG: {
          target: "answerResult",
          actions: ["processValidatedWrong"],
        },
        BANK: {
          guard: "canBank",
          target: "roundEnd",
          actions: ["bankMoney"],
        },
        TIMER_EXPIRED: {
          target: "answerResult",
          actions: ["handleTimerExpired"],
        },
        USE_NOMINATE: {
          guard: "canNominate",
          target: "nominateWaiting",
          actions: ["startNominate"],
        },
      },
    },

    answerReveal: {
      always: [
        { target: "roundEnd", guard: "allAnswersFound", actions: ["bankMoney"] },
        { target: "playerTurn" },
      ],
    },

    answerResult: {
      always: [
        { target: "roundEnd", guard: "isPlayerEliminated", actions: ["recordElimination"] },
        { target: "playerTurn" },
      ],
    },

    // ── Nominate states ─────────────────────────────────────

    nominateWaiting: {
      // Waiting for nominated player to submit suggestion
      on: {
        NOMINATE_SUGGESTION: {
          target: "nominateResponse",
          actions: ["receiveNominateSuggestion"],
        },
        TIMER_EXPIRED: {
          target: "playerTurn",
          actions: ["clearNominate"],
        },
      },
    },

    nominateResponse: {
      // Active player accepts or rejects the suggestion
      on: {
        ACCEPT_NOMINATE: {
          // The suggestion will be submitted as a regular answer by the handler
          target: "playerTurn",
          actions: ["clearNominate"],
        },
        REJECT_NOMINATE: {
          target: "playerTurn",
          actions: ["clearNominate"],
        },
        TIMER_EXPIRED: {
          target: "playerTurn",
          actions: ["clearNominate"],
        },
      },
    },

    // ── Overrule states ─────────────────────────────────────

    overruleWindow: {
      // 5-second window for captain to overrule before answer is validated
      // The pending answer is stored in context.pendingAnswer
      // OVERRULE_TIMEOUT or SKIP_OVERRULE: validate the pending answer (handler does this)
      // VALIDATED_* events come from the handler after validating the pending answer
      on: {
        USE_OVERRULE: {
          target: "overruleInput",
        },
        OVERRULE_TIMEOUT: {
          // Captain didn't overrule — validate the pending answer
          // The handler will validate and send VALIDATED_* events to playerTurn
          target: "playerTurn",
          actions: ["clearPendingAnswer"],
        },
        SKIP_OVERRULE: {
          target: "playerTurn",
          actions: ["clearPendingAnswer"],
        },
      },
    },

    overruleInput: {
      // Captain entering replacement answer
      on: {
        OVERRULE_VALIDATED_CORRECT: {
          target: "overruleResult",
          actions: ["processOverruleResult"],
        },
        OVERRULE_VALIDATED_WRONG: {
          target: "overruleResult",
          actions: ["processOverruleResult"],
        },
        TIMER_EXPIRED: {
          target: "playerTurn",
          actions: ["markOverruleUsed"],
        },
      },
    },

    overruleResult: {
      always: [
        { target: "roundEnd", guard: "allAnswersFound", actions: ["bankMoney"] },
        { target: "roundEnd", guard: "isPlayerEliminated", actions: ["recordElimination"] },
        { target: "playerTurn" },
      ],
    },

    // ── Captain round states ────────────────────────────────

    captainRound: {
      on: {
        VALIDATED_ALREADY_FOUND: {
          target: "captainRound",
          actions: ["processValidatedAlreadyFound"],
          reenter: true,
        },
        VALIDATED_CORRECT: [
          {
            // All found -> bank
            target: "captainAnswerReveal",
            actions: ["processValidatedCorrect"],
          },
        ],
        VALIDATED_WRONG: {
          target: "captainAnswerResult",
          actions: ["processValidatedWrong"],
        },
        BANK: {
          guard: "canBank",
          target: "roundEnd",
          actions: ["bankMoney"],
        },
        TIMER_EXPIRED: {
          target: "captainAnswerResult",
          actions: ["handleTimerExpired"],
        },
        USE_NOMINATE: {
          guard: "canNominate",
          target: "captainNominateWaiting",
          actions: ["startNominate"],
        },
      },
    },

    captainAnswerReveal: {
      always: [
        { target: "roundEnd", guard: "allAnswersFound", actions: ["bankMoney"] },
        // Check if reinstatement is available
        { target: "reinstatementOffer", guard: "canReinstate" },
        { target: "captainRound" },
      ],
    },

    captainAnswerResult: {
      always: [
        // Second wrong answer = round ends (timerDeadline is null when round should end)
        {
          target: "roundEnd",
          guard: ({ context }) => context.timerDeadline === null,
          actions: ["recordElimination"],
        },
        // Life was consumed but play continues
        { target: "captainRound" },
      ],
    },

    captainNominateWaiting: {
      on: {
        NOMINATE_SUGGESTION: {
          target: "captainNominateResponse",
          actions: ["receiveNominateSuggestion"],
        },
        TIMER_EXPIRED: {
          target: "captainRound",
          actions: ["clearNominate"],
        },
      },
    },

    captainNominateResponse: {
      on: {
        ACCEPT_NOMINATE: {
          target: "captainRound",
          actions: ["clearNominate"],
        },
        REJECT_NOMINATE: {
          target: "captainRound",
          actions: ["clearNominate"],
        },
        TIMER_EXPIRED: {
          target: "captainRound",
          actions: ["clearNominate"],
        },
      },
    },

    // ── Reinstatement ───────────────────────────────────────

    reinstatementOffer: {
      on: {
        REINSTATE_PLAYER: {
          target: "captainRound",
          actions: ["reinstatePlayer"],
        },
        CONTINUE_WITHOUT_REINSTATE: {
          target: "captainRound",
          actions: ["continueWithoutReinstate"],
        },
      },
    },

    // ── Round end ───────────────────────────────────────────

    roundEnd: {
      on: {
        CONTINUE_REVEAL: [
          // If unrevealed answers remain, reveal next one (bottom to top)
          { target: "roundEnd", guard: ({ context }) => !context.board.every((s) => s.revealed), actions: ["revealNextAnswer"], reenter: true },
          // All revealed — advance to next round or final
          { target: "roundIntro", guard: "hasMoreRounds", actions: ["advanceRound", "setupRound"] },
          { target: "finalVote", actions: ["setupFinalVote"] },
        ],
      },
    },

    // ── Final round states ──────────────────────────────────

    finalVote: {
      on: {
        VOTE_CATEGORY: {
          target: "finalVote",
          actions: ["recordVote"],
          reenter: true,
        },
        VOTE_TIMER_EXPIRED: {
          target: "finalRound",
          actions: ["resolveFinalVote"],
        },
        START_FINAL: {
          target: "finalRound",
          actions: ["resolveFinalVote"],
        },
      },
    },

    finalRound: {
      on: {
        FINAL_VALIDATED_CORRECT: [
          {
            target: "finalRoundWin",
            guard: ({ context, event }) => {
              if (event.type !== "FINAL_VALIDATED_CORRECT") return false;
              return context.correctCount + 1 >= ANSWERS_PER_LIST;
            },
            actions: ["processFinalCorrect"],
          },
          {
            target: "finalTurnAdvance",
            actions: ["processFinalCorrect"],
          },
        ],
        FINAL_VALIDATED_WRONG: {
          target: "finalElimination",
          actions: ["eliminateFinalPlayer"],
        },
        FINAL_VALIDATED_ALREADY_FOUND: {
          target: "finalRound",
          reenter: true,
        },
        FINAL_TIMER_EXPIRED: {
          target: "finalElimination",
          actions: ["eliminateFinalPlayer"],
        },
      },
    },

    finalTurnAdvance: {
      always: [
        { target: "finalRound", actions: ["advanceFinalTurn"] },
      ],
    },

    finalElimination: {
      always: [
        { target: "finalRoundLose", guard: "allFinalPlayersEliminated" },
        { target: "finalRound", actions: ["advanceFinalTurn"] },
      ],
    },

    finalRoundWin: {
      entry: ["setGameWon"],
      type: "final",
    },

    finalRoundLose: {
      entry: ["setGameLost", "revealAllAnswers"],
      type: "final",
    },

    gameOver: {
      type: "final",
    },
  },
});

export type GameMachine = typeof gameMachine;
export type GameActor = ActorRefFrom<typeof gameMachine>;
