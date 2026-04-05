"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import { useRoomGameState } from "@/hooks/useGameState";
import { useRoomStore } from "@/stores/room-store";
import { Board } from "./components/Board";
import { MoneyLadder } from "./components/MoneyLadder";
import { Timer } from "./components/Timer";
import { PlayerList } from "./components/PlayerList";

export default function RoomDisplayPage() {
  const params = useParams<{ code: string }>();
  const roomCode = (params.code ?? "").toUpperCase();
  const { socket, connected } = useSocket();
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useRoomGameState(socket);
  const state = useRoomStore();

  useEffect(() => {
    if (!connected || subscribed) return;

    socket.emit("subscribe_room", { roomCode }, (response) => {
      if (response.ok) {
        setSubscribed(true);
      } else {
        setError(response.error);
      }
    });
  }, [connected, subscribed, socket, roomCode]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-xl text-red-400">{error}</p>
      </div>
    );
  }

  if (!subscribed) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-xl text-slate-400">Connecting to room...</p>
      </div>
    );
  }

  return <RoomView roomCode={roomCode} />;
}

function RoomView({ roomCode }: { roomCode: string }) {
  const { socket } = useSocket();
  const state = useRoomStore();

  switch (state.phase) {
    case "lobby":
      return <LobbyDisplay roomCode={roomCode} players={state.players} />;
    case "round_intro":
      return <RoundIntroDisplay state={state} />;
    case "captain_picking":
      return <CaptainPickingDisplay state={state} />;
    case "individual_round":
    case "captain_round":
      return <ActiveRoundDisplay state={state} socket={socket} />;
    case "round_end":
      return <RoundEndDisplay state={state} socket={socket} roomCode={roomCode} />;
    case "final_vote":
      return <FinalVoteDisplay state={state} />;
    case "final_round":
      return <FinalRoundDisplay state={state} socket={socket} />;
    case "game_over":
      return <GameOverDisplay state={state} />;
    default:
      return (
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-xl text-slate-400">Phase: {state.phase}</p>
        </div>
      );
  }
}

// ── Lobby ──────────────────────────────────────────────────

function LobbyDisplay({
  roomCode,
  players,
}: {
  roomCode: string;
  players: typeof useRoomStore extends (s: any) => infer R ? any : any;
}) {
  const { players: playerList } = useRoomStore();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-12">
      <div className="text-center">
        <p className="text-lg uppercase tracking-widest text-slate-500">
          Room Code
        </p>
        <p className="mt-2 text-8xl font-black tracking-[0.3em] text-amber-400">
          {roomCode}
        </p>
        <p className="mt-4 text-slate-500">
          Go to <span className="text-white">/play</span> on your phone and
          enter this code
        </p>
      </div>

      <div className="w-full max-w-md">
        <h2 className="mb-4 text-center text-xl font-semibold text-slate-300">
          Players ({playerList.length}/5)
        </h2>
        {playerList.length === 0 ? (
          <p className="text-center text-slate-600">
            Waiting for players to join...
          </p>
        ) : (
          <ul className="space-y-3">
            {playerList.map((player) => (
              <li
                key={player.id}
                className={`flex items-center justify-between rounded-lg border px-6 py-4 ${
                  player.connected
                    ? "border-slate-700 bg-slate-900"
                    : "border-slate-800 bg-slate-900/50 opacity-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-medium">{player.name}</span>
                  {player.isCaptain && (
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold uppercase text-amber-400">
                      Captain
                    </span>
                  )}
                </div>
                {!player.connected && (
                  <span className="text-sm text-red-400">Disconnected</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-slate-500">
        Waiting for the captain to start the game...
      </p>
    </div>
  );
}

// ── Round Intro ─────────────────────────────────────────────

function RoundIntroDisplay({ state }: { state: ReturnType<typeof useRoomStore.getState> }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-slate-500">
          Round {state.currentRound} of {state.totalRounds}
        </p>
        <h1 className="mt-4 text-4xl font-bold text-amber-400">
          {state.category}
        </h1>
        <p className="mt-4 text-2xl text-white">{state.question}</p>
        {state.description && (
          <p className="mt-3 text-lg text-slate-400">{state.description}</p>
        )}
      </div>

      <PlayerList players={state.players} activePlayerId={null} />
    </div>
  );
}

// ── Captain Picking ─────────────────────────────────────────

function CaptainPickingDisplay({ state }: { state: ReturnType<typeof useRoomStore.getState> }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-slate-500">
          Round {state.currentRound} of {state.totalRounds}
        </p>
        <h2 className="mt-2 text-2xl font-bold text-white">
          {state.category}
        </h2>
        <p className="mt-2 text-lg text-slate-400">{state.question}</p>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-8 py-4">
        <p className="text-lg text-amber-300">
          Captain is choosing a player...
        </p>
      </div>

      <PlayerList players={state.players} activePlayerId={null} />
    </div>
  );
}

// ── Active Round ────────────────────────────────────────────

function ActiveRoundDisplay({
  state,
  socket,
}: {
  state: ReturnType<typeof useRoomStore.getState>;
  socket: ReturnType<typeof useSocket>["socket"];
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar: round info + prize pot */}
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div className="text-sm text-slate-500">
          Round {state.currentRound}/{state.totalRounds}
          {state.phase === "captain_round" && (
            <span className="ml-2 text-amber-400">Captain&apos;s Round</span>
          )}
        </div>
        <div className="text-right">
          <span className="text-sm text-slate-500">Prize Pot: </span>
          <span className="text-lg font-bold text-amber-400">
            {"\u00A3"}{state.prizePot.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 items-start justify-center gap-8 px-8 pt-6">
        {/* Left side: Board */}
        <div className="flex-1">
          <Board board={state.board} question={state.question} />
        </div>

        {/* Right side: Timer, Money, Lifelines */}
        <div className="flex w-64 flex-col gap-6">
          {/* Active player */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Now Playing
            </p>
            <p className="mt-1 text-xl font-bold text-white">
              {state.activePlayerName}
            </p>
          </div>

          {/* Timer */}
          <Timer socket={socket} initialSeconds={state.timerSeconds} />

          {/* Money Ladder */}
          <MoneyLadder
            ladder={state.moneyLadder}
            correctCount={state.currentRoundCorrectCount}
          />

          {/* Lifeline indicators */}
          <div className="space-y-2">
            {/* Life */}
            <div className="flex items-center gap-2 text-sm">
              <span className={state.activePlayerHasLife ? "text-red-400" : "text-slate-700"}>
                {state.activePlayerHasLife ? "\u2764" : "\u2661"}
              </span>
              <span className={state.activePlayerHasLife ? "text-slate-300" : "text-slate-600 line-through"}>
                Life
              </span>
            </div>

            {/* Nominates */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-blue-400">
                {"N"} {state.nominatesRemaining}/3
              </span>
            </div>

            {/* Overrule */}
            {state.phase !== "captain_round" && (
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={
                    state.overruleAvailable ? "text-purple-400" : "text-slate-600"
                  }
                >
                  {state.overruleUsedThisRound ? "Overrule (used)" : "Overrule"}
                </span>
              </div>
            )}
          </div>

          {/* Correct count / money */}
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-center">
            <p className="text-3xl font-black text-white">
              {state.currentRoundCorrectCount}
            </p>
            <p className="text-xs text-slate-500">Correct Answers</p>
            <p className="mt-2 text-lg font-bold text-amber-400">
              {"\u00A3"}{state.currentRoundMoneyLevel.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom: Player status bar */}
      <div className="border-t border-slate-800 px-6 py-4">
        <PlayerList players={state.players} activePlayerId={state.activePlayerId} />
      </div>
    </div>
  );
}

// ── Round End ───────────────────────────────────────────────

function RoundEndDisplay({
  state,
  socket,
  roomCode,
}: {
  state: ReturnType<typeof useRoomStore.getState>;
  socket: ReturnType<typeof useSocket>["socket"];
  roomCode: string;
}) {
  const lastRound = state.roundHistory[state.roundHistory.length - 1];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-slate-500">
          Round {state.currentRound} Complete
        </p>

        {lastRound && (
          <div className="mt-4">
            <p className="text-xl text-white">{lastRound.playerName}</p>
            {lastRound.eliminated ? (
              <p className="mt-2 text-2xl font-bold text-red-400">
                Eliminated — {"\u00A3"}0 banked
              </p>
            ) : (
              <p className="mt-2 text-2xl font-bold text-green-400">
                {"\u00A3"}{lastRound.moneyBanked.toLocaleString()} banked!
              </p>
            )}
          </div>
        )}

        <p className="mt-6 text-lg text-slate-400">
          Total Prize Pot:{" "}
          <span className="font-bold text-amber-400">
            {"\u00A3"}{state.prizePot.toLocaleString()}
          </span>
        </p>
      </div>

      {/* Full board reveal */}
      <Board board={state.board} question={state.question} />

      <PlayerList players={state.players} activePlayerId={null} />
    </div>
  );
}

// ── Final Vote ──────────────────────────────────────────────

function FinalVoteDisplay({ state }: { state: ReturnType<typeof useRoomStore.getState> }) {
  if (!state.finalVote) return null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <p className="text-sm uppercase tracking-widest text-slate-500">
        The Final Round
      </p>
      <h2 className="text-3xl font-bold text-white">Choose a Category</h2>

      <div className="flex gap-6">
        {state.finalVote.options.map((option, i) => {
          const voteCount = Object.values(state.finalVote!.votes).filter((v) => v === i).length;
          return (
            <div
              key={i}
              className="flex flex-col items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-12 py-8"
            >
              <p className="text-2xl font-bold text-amber-400">{option}</p>
              <p className="text-4xl font-black text-white">{voteCount}</p>
              <p className="text-sm text-slate-500">votes</p>
            </div>
          );
        })}
      </div>

      <Timer socket={useSocket().socket} initialSeconds={state.timerSeconds} />
      <PlayerList players={state.players} activePlayerId={null} />
    </div>
  );
}

// ── Final Round ─────────────────────────────────────────────

function FinalRoundDisplay({
  state,
  socket,
}: {
  state: ReturnType<typeof useRoomStore.getState>;
  socket: ReturnType<typeof useSocket>["socket"];
}) {
  // Show turn order
  const turnOrderPlayers = state.finalTurnOrder.map((pid) =>
    state.players.find((p) => p.id === pid)
  ).filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <div className="text-sm">
          <span className="text-red-400 font-semibold">THE FINAL</span>
        </div>
        <div className="text-right">
          <span className="text-sm text-slate-500">Playing for: </span>
          <span className="text-lg font-bold text-amber-400">
            {"\u00A3"}{state.prizePot.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 items-start justify-center gap-8 px-8 pt-6">
        <div className="flex-1">
          <Board board={state.board} question={state.question} />
        </div>

        <div className="flex w-64 flex-col gap-6">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-slate-500">Now Playing</p>
            <p className="mt-1 text-xl font-bold text-white">{state.activePlayerName}</p>
          </div>

          <Timer socket={socket} initialSeconds={state.timerSeconds} />

          {/* Turn order */}
          <div>
            <h3 className="mb-2 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">
              Turn Order
            </h3>
            <div className="space-y-1">
              {turnOrderPlayers.map((p) => {
                if (!p) return null;
                const isActive = p.id === state.activePlayerId;
                const isOut = p.status === "eliminated_final";
                return (
                  <div
                    key={p.id}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${
                      isActive
                        ? "bg-amber-500/20 text-amber-300"
                        : isOut
                          ? "text-slate-700 line-through"
                          : "text-slate-400"
                    }`}
                  >
                    {p.name}
                    {isActive && " \u25C0"}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-center">
            <p className="text-3xl font-black text-white">
              {state.currentRoundCorrectCount}
            </p>
            <p className="text-xs text-slate-500">Correct Answers</p>
          </div>
        </div>
      </div>

      {/* Bottom: Player status bar */}
      <div className="border-t border-slate-800 px-6 py-4">
        <PlayerList players={state.players} activePlayerId={state.activePlayerId} />
      </div>
    </div>
  );
}

// ── Game Over ───────────────────────────────────────────────

function GameOverDisplay({ state }: { state: ReturnType<typeof useRoomStore.getState> }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <h1 className="text-5xl font-black text-amber-400">GAME OVER</h1>

      {state.message && (
        <p className="text-2xl font-bold text-white">{state.message}</p>
      )}

      <div className="text-center">
        <p className="text-2xl text-white">
          Total Prize Pot:{" "}
          <span className="font-bold text-amber-400">
            {"\u00A3"}{state.prizePot.toLocaleString()}
          </span>
        </p>
      </div>

      {/* Round history */}
      <div className="w-full max-w-md space-y-2">
        {state.roundHistory.map((round) => (
          <div
            key={round.roundNumber}
            className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
              round.eliminated
                ? "border-red-900/50 bg-red-950/20"
                : "border-green-900/50 bg-green-950/20"
            }`}
          >
            <div>
              <span className="text-sm text-slate-500">
                R{round.roundNumber}
              </span>{" "}
              <span className="font-medium text-white">{round.playerName}</span>
            </div>
            <span
              className={`font-semibold ${round.eliminated ? "text-red-400" : "text-green-400"}`}
            >
              {round.eliminated
                ? "Eliminated"
                : `\u00A3${round.moneyBanked.toLocaleString()}`}
            </span>
          </div>
        ))}
      </div>

      <PlayerList players={state.players} activePlayerId={null} />
    </div>
  );
}
