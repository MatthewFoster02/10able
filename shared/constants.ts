// ============================================================
// Game constants shared between server and client
// ============================================================

// Money earned per correct answer count (index = correct answers)
// 0-4 correct = £0, 5 = £1000, etc.
export const MONEY_LADDER = [0, 0, 0, 0, 0, 1000, 2500, 5000, 10000, 15000, 25000] as const;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

export const ANSWER_TIMEOUT_SECONDS = 60;
export const OVERRULE_WINDOW_SECONDS = 5;
export const FINAL_VOTE_TIMEOUT_SECONDS = 60;

export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O to avoid confusion

export const MIN_CORRECT_TO_BANK = 5;
export const NOMINATES_PER_GAME = 3;

export const DEFAULT_FINAL_PRIZE = 500; // £500 if no money banked

export const ANSWERS_PER_LIST = 10;
