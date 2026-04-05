// ============================================================
// XState v5 game state machine — the heart of the game logic
// ============================================================

import { setup, assign, fromCallback, type ActorRefFrom } from "xstate";
import type { QuestionData, Player, BoardSlot, RoundResult } from "../../shared/types";
import {
  MONEY_LADDER,
  ANSWER_TIMEOUT_SECONDS,
  MIN_CORRECT_TO_BANK,
  NOMINATES_PER_GAME,
  ANSWERS_PER_LIST,
} from "../../shared/constants";
import { getRandomQuestion, checkAnswerLocal } from "../services/questions";

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

  // Round history
  roundHistory: RoundResult[];

  // Timer
  timerDeadline: number | null;

  // Round order: which non-captain players have been picked
  playOrder: string[]; // playerIds in order they were picked
}

// ── Events ───────────────────────────────────────────────────

export type GameEvent =
  | { type: "START_GAME" }
  | { type: "CAPTAIN_PICK"; playerId: string }
  | { type: "SUBMIT_ANSWER"; answer: string }
  | { type: "BANK" }
  | { type: "TIMER_EXPIRED" }
  | { type: "CONTINUE_REVEAL" }
  | { type: "REVEAL_COMPLETE" };

// ── Helper functions ─────────────────────────────────────────

function buildMoneyLadder(reinstatements: number): number[] {
  // Each reinstatement removes the highest remaining tier
  const ladder = [...MONEY_LADDER];
  for (let i = 0; i < reinstatements; i++) {
    // Find the highest non-zero value and set it to the value below
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
    initGame: assign(({ context }) => {
      const totalRounds = context.players.length;
      return {
        totalRounds,
        currentRound: 1,
        nominatesRemaining: NOMINATES_PER_GAME,
        prizePot: 0,
        roundHistory: [],
        playOrder: [],
        usedQuestionIds: [],
      };
    }),

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
        players,
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
      };
    }),

    processAnswer: assign(({ context, event }) => {
      if (event.type !== "SUBMIT_ANSWER" || !context.currentQuestion) return {};

      const result = checkAnswerLocal(
        event.answer,
        context.currentQuestion.answers,
        context.revealedPositions
      );

      if (!result.match) {
        if (result.alreadyFound) {
          // Already found — no penalty, reset timer
          return {
            timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
          };
        }

        // Wrong answer
        if (context.activePlayerHasLife) {
          // Life absorbs the wrong answer
          return {
            activePlayerHasLife: false,
            timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
          };
        }

        // No life — elimination
        const players = context.players.map((p) =>
          p.id === context.activePlayerId
            ? { ...p, status: "eliminated" as const }
            : p
        );

        return {
          players,
          timerDeadline: null,
        };
      }

      // Correct answer
      const newRevealed = new Set(context.revealedPositions);
      newRevealed.add(result.position);

      const newBoard = context.board.map((slot) =>
        slot.position === result.position
          ? {
              ...slot,
              answer: result.answerText,
              revealed: true,
              revealedByPlayer: context.activePlayerId,
            }
          : slot
      );

      const newCorrectCount = context.correctCount + 1;

      return {
        board: newBoard,
        revealedPositions: newRevealed,
        correctCount: newCorrectCount,
        timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
      };
    }),

    handleTimerExpired: assign(({ context }) => {
      // Timer expiry = wrong answer
      if (context.activePlayerHasLife) {
        return {
          activePlayerHasLife: false,
          timerDeadline: Date.now() + ANSWER_TIMEOUT_SECONDS * 1000,
        };
      }

      // No life — elimination
      const players = context.players.map((p) =>
        p.id === context.activePlayerId
          ? { ...p, status: "eliminated" as const }
          : p
      );

      return {
        players,
        timerDeadline: null,
      };
    }),

    bankMoney: assign(({ context }) => {
      const amount = getMoneyForCorrectCount(context.moneyLadder, context.correctCount);
      const players = context.players.map((p) =>
        p.id === context.activePlayerId
          ? { ...p, status: "qualified" as const }
          : p
      );

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

    recordElimination: assign(({ context }) => ({
      roundHistory: [
        ...context.roundHistory,
        {
          roundNumber: context.currentRound,
          playerId: context.activePlayerId!,
          playerName:
            context.players.find((p) => p.id === context.activePlayerId)?.name ?? "",
          correctCount: context.correctCount,
          moneyBanked: 0,
          eliminated: true,
          listId: context.currentQuestion?.id ?? "",
        },
      ],
      timerDeadline: null,
    })),

    advanceRound: assign(({ context }) => ({
      currentRound: context.currentRound + 1,
    })),
  },

  guards: {
    isCorrectAnswer: ({ context, event }) => {
      if (event.type !== "SUBMIT_ANSWER" || !context.currentQuestion) return false;
      const result = checkAnswerLocal(
        event.answer,
        context.currentQuestion.answers,
        context.revealedPositions
      );
      return result.match;
    },

    isAlreadyFound: ({ context, event }) => {
      if (event.type !== "SUBMIT_ANSWER" || !context.currentQuestion) return false;
      const result = checkAnswerLocal(
        event.answer,
        context.currentQuestion.answers,
        context.revealedPositions
      );
      return !result.match && "alreadyFound" in result && result.alreadyFound;
    },

    hasLife: ({ context }) => context.activePlayerHasLife,

    canBank: ({ context }) => context.correctCount >= MIN_CORRECT_TO_BANK,

    allAnswersFound: ({ context }) => context.correctCount >= ANSWERS_PER_LIST,

    isPlayerEliminated: ({ context }) => {
      const player = context.players.find((p) => p.id === context.activePlayerId);
      return player?.status === "eliminated";
    },

    isCaptainRound: ({ context }) => context.currentRound === context.totalRounds,

    hasMoreRounds: ({ context }) => context.currentRound < context.totalRounds,

    validPickTarget: ({ context, event }) => {
      if (event.type !== "CAPTAIN_PICK") return false;
      const available = getNextUnplayedNonCaptain(context.players, context.playOrder);
      return available.some((p) => p.id === event.playerId);
    },

    onlyOnePlayerLeft: ({ context }) => {
      const available = getNextUnplayedNonCaptain(context.players, context.playOrder);
      return available.length === 1;
    },
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
    roundHistory: [],
    timerDeadline: null,
    playOrder: [],
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
      // Show category and question, then transition based on round type
      after: {
        3000: [
          {
            target: "captainRound",
            guard: "isCaptainRound",
          },
          {
            target: "captainPicking",
          },
        ],
      },
    },

    captainPicking: {
      // Captain chooses which player tackles this round
      on: {
        CAPTAIN_PICK: {
          target: "playerTurn",
          guard: "validPickTarget",
          actions: ["assignPlayer"],
        },
      },
    },

    playerTurn: {
      // Active player is answering
      on: {
        SUBMIT_ANSWER: [
          {
            // Already found — no penalty, stay in turn
            guard: "isAlreadyFound",
            target: "playerTurn",
            actions: ["processAnswer"],
            reenter: true,
          },
          {
            // Correct answer — check if all found
            guard: "isCorrectAnswer",
            target: "answerReveal",
            actions: ["processAnswer"],
          },
          {
            // Wrong answer — process and check if eliminated
            target: "answerResult",
            actions: ["processAnswer"],
          },
        ],
        BANK: {
          guard: "canBank",
          target: "roundEnd",
          actions: ["bankMoney"],
        },
        TIMER_EXPIRED: {
          target: "answerResult",
          actions: ["handleTimerExpired"],
        },
      },
    },

    answerReveal: {
      // Brief pause to show the correct answer on the board
      always: [
        {
          target: "roundEnd",
          guard: "allAnswersFound",
          actions: ["bankMoney"],
        },
        {
          target: "playerTurn",
        },
      ],
    },

    answerResult: {
      // After a wrong answer — check elimination
      always: [
        {
          target: "roundEnd",
          guard: "isPlayerEliminated",
          actions: ["recordElimination"],
        },
        {
          // Had life, continue
          target: "playerTurn",
        },
      ],
    },

    captainRound: {
      // Captain's turn — same mechanics but no overrule
      entry: ["assignCaptain"],
      on: {
        SUBMIT_ANSWER: [
          {
            guard: "isAlreadyFound",
            target: "captainRound",
            actions: ["processAnswer"],
            reenter: true,
          },
          {
            guard: "isCorrectAnswer",
            target: "captainAnswerReveal",
            actions: ["processAnswer"],
          },
          {
            target: "captainAnswerResult",
            actions: ["processAnswer"],
          },
        ],
        BANK: {
          guard: "canBank",
          target: "roundEnd",
          actions: ["bankMoney"],
        },
        TIMER_EXPIRED: {
          target: "captainAnswerResult",
          actions: ["handleTimerExpired"],
        },
      },
    },

    captainAnswerReveal: {
      always: [
        {
          target: "roundEnd",
          guard: "allAnswersFound",
          actions: ["bankMoney"],
        },
        {
          target: "captainRound",
        },
      ],
    },

    captainAnswerResult: {
      always: [
        {
          target: "roundEnd",
          guard: "isPlayerEliminated",
          actions: ["recordElimination"],
        },
        {
          target: "captainRound",
        },
      ],
    },

    roundEnd: {
      // Show full board with reveals, then advance
      on: {
        CONTINUE_REVEAL: [
          {
            target: "roundIntro",
            guard: "hasMoreRounds",
            actions: ["advanceRound", "setupRound"],
          },
          {
            target: "gameOver",
          },
        ],
      },
    },

    gameOver: {
      type: "final",
    },
  },
});

export type GameMachine = typeof gameMachine;
export type GameActor = ActorRefFrom<typeof gameMachine>;
