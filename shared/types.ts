// ============================================================
// Core domain types shared between server and client
// ============================================================

export interface Player {
  id: string;
  name: string;
  isCaptain: boolean;
  status: PlayerStatus;
  roundPlayed: number | null;
  connected: boolean;
}

export type PlayerStatus =
  | "waiting"
  | "active"
  | "qualified"
  | "eliminated"
  | "reinstated"
  | "eliminated_final";

export type GamePhase =
  | "lobby"
  | "round_intro"
  | "captain_picking"
  | "individual_round"
  | "round_end"
  | "captain_round"
  | "final_vote"
  | "final_round"
  | "game_over";

export interface BoardSlot {
  position: number; // 1-10
  answer: string | null; // null if not yet revealed
  revealed: boolean;
  revealedByPlayer: string | null;
  ghosted: boolean; // for overruled correct answers
}

export interface MoneyLadderTier {
  correctCount: number;
  amount: number;
  active: boolean; // currently highlighted
  locked: boolean; // below threshold
}

// What the Room Site display receives
export interface RoomState {
  phase: GamePhase;
  roomCode: string;
  players: Player[];
  currentRound: number;
  totalRounds: number;
  activePlayerId: string | null;
  activePlayerName: string | null;

  // Board
  category: string | null;
  question: string | null;
  description: string | null;
  board: BoardSlot[];

  // Money
  prizePot: number;
  currentRoundCorrectCount: number;
  currentRoundMoneyLevel: number;
  moneyLadder: MoneyLadderTier[];

  // Lifelines
  nominatesRemaining: number;
  overruleAvailable: boolean;
  overruleUsedThisRound: boolean;
  activePlayerHasLife: boolean;

  // Timer
  timerSeconds: number | null;

  // Final vote
  finalVote: {
    options: [string, string];
    votes: Record<string, number>;
    deadline: number;
  } | null;

  // Final round
  finalTurnOrder: string[];
  finalCurrentTurnIndex: number;

  // Round history
  roundHistory: RoundResult[];

  // Messages / announcements
  message: string | null;
}

// What each player's phone receives (targeted per-player)
export interface PlayerState {
  phase: GamePhase;
  playerId: string;
  playerName: string;
  isCaptain: boolean;
  isMyTurn: boolean;
  myStatus: PlayerStatus;

  // Game context
  roomCode: string;
  currentRound: number;
  totalRounds: number;
  activePlayerName: string | null;
  category: string | null;
  question: string | null;

  // My round stats (when active)
  correctCount: number;
  moneyLevel: number;
  hasLife: boolean;

  // Available actions
  canSubmitAnswer: boolean;
  canBank: boolean;
  canNominate: boolean;
  canOverrule: boolean;
  canStartGame: boolean;
  canPickPlayer: boolean;
  canReinstate: boolean;

  // Contextual data
  availablePlayers: Pick<Player, "id" | "name">[]; // for captain picking / nominate
  eliminatedPlayers: Pick<Player, "id" | "name">[]; // for reinstatement
  nominateSuggestion: string | null; // suggestion from nominated player
  overrulePlayerAnswer: string | null; // answer to potentially overrule

  // Prize
  prizePot: number;
  players: Player[];

  // Timer
  timerSeconds: number | null;

  // Final vote
  finalVoteOptions: [string, string] | null;
  hasVoted: boolean;

  // Message
  message: string | null;
}

export interface RoundResult {
  roundNumber: number;
  playerId: string;
  playerName: string;
  correctCount: number;
  moneyBanked: number;
  eliminated: boolean;
  listId: string;
}

// Question data model
export interface QuestionAnswer {
  position: number;
  answer: string;
  aliases: string[];
  audio: string;
}

export interface QuestionData {
  id: string;
  category: string;
  question: string;
  description: string;
  audio: {
    category: string;
    question: string;
    description: string;
  };
  answers: QuestionAnswer[];
}
