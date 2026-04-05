import { create } from "zustand";
import type { RoomState } from "@shared/types";

const initialState: RoomState = {
  phase: "lobby",
  roomCode: "",
  players: [],
  currentRound: 0,
  totalRounds: 0,
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

export const useRoomStore = create<RoomState>()(() => initialState);
