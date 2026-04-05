import { create } from "zustand";
import type { PlayerState } from "@shared/types";

const initialState: PlayerState = {
  phase: "lobby",
  playerId: "",
  playerName: "",
  isCaptain: false,
  isMyTurn: false,
  myStatus: "waiting",
  roomCode: "",
  currentRound: 0,
  totalRounds: 0,
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
  canStartGame: false,
  canPickPlayer: false,
  canReinstate: false,
  availablePlayers: [],
  eliminatedPlayers: [],
  nominateSuggestion: null,
  overrulePlayerAnswer: null,
  prizePot: 0,
  players: [],
  timerSeconds: null,
  finalVoteOptions: null,
  hasVoted: false,
  message: null,
};

export const usePlayerStore = create<PlayerState>()(() => initialState);
