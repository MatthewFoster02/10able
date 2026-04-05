// ============================================================
// Zod schemas for runtime validation of socket payloads
// ============================================================

import { z } from "zod";
import { ROOM_CODE_LENGTH, MAX_PLAYERS } from "./constants";

export const roomCodeSchema = z
  .string()
  .length(ROOM_CODE_LENGTH)
  .regex(/^[A-Z]+$/, "Room code must be uppercase letters");

export const playerNameSchema = z
  .string()
  .min(1, "Name is required")
  .max(20, "Name must be 20 characters or less")
  .trim();

export const joinRoomSchema = z.object({
  roomCode: roomCodeSchema,
  playerName: playerNameSchema,
});

export const subscribeRoomSchema = z.object({
  roomCode: roomCodeSchema,
});

export const submitAnswerSchema = z.object({
  answer: z.string().min(1).max(200).trim(),
});

export const captainPickPlayerSchema = z.object({
  playerId: z.string().min(1),
});

export const useNominateSchema = z.object({
  targetPlayerId: z.string().min(1),
});

export const nominateSuggestionSchema = z.object({
  answer: z.string().min(1).max(200).trim(),
});

export const useOverruleSchema = z.object({
  replacementAnswer: z.string().min(1).max(200).trim(),
});

export const reinstatePlayerSchema = z.object({
  playerId: z.string().min(1),
});

export const voteFinalCategorySchema = z.object({
  categoryIndex: z.number().int().min(0).max(1),
});
