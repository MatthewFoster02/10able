"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import { usePlayerGameState } from "@/hooks/useGameState";
import { usePlayerStore } from "@/stores/player-store";
import { AnswerInput } from "./components/AnswerInput";
import { SpectatorView } from "./components/SpectatorView";
import {
  LifelineButtons,
  NominatedPlayerInput,
  OverruleView,
  ReinstatementView,
} from "./components/LifelineButtons";

export default function PlayerGamePage() {
  const params = useParams<{ code: string }>();
  const roomCode = (params.code ?? "").toUpperCase();
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);

  usePlayerGameState(socket);

  const state = usePlayerStore();

  // Timer sync
  useEffect(() => {
    function onTimerSync(data: { secondsRemaining: number }) {
      setTimerSeconds(data.secondsRemaining);
    }
    socket.on("timer_sync", onTimerSync);
    return () => {
      socket.off("timer_sync", onTimerSync);
    };
  }, [socket]);

  // Auto-rejoin on page load
  useEffect(() => {
    if (!connected || joined) return;

    const savedName =
      typeof window !== "undefined"
        ? sessionStorage.getItem("playerName")
        : null;

    if (!savedName) {
      router.push("/play");
      return;
    }

    socket.emit(
      "join_room",
      { roomCode, playerName: savedName },
      (response) => {
        if (response.ok) {
          setJoined(true);
          if (typeof window !== "undefined") {
            sessionStorage.setItem("playerId", response.playerId);
          }
        } else {
          setError(response.error);
        }
      }
    );
  }, [connected, joined, socket, roomCode, router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <p className="text-lg text-red-400">{error}</p>
        <button
          onClick={() => router.push("/play")}
          className="mt-4 text-amber-400 underline"
        >
          Back to Join
        </button>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-400">Reconnecting...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col px-6 py-8">
      <PlayerView state={state} socket={socket} timerSeconds={timerSeconds} />
    </div>
  );
}

function PlayerView({
  state,
  socket,
  timerSeconds,
}: {
  state: ReturnType<typeof usePlayerStore.getState>;
  socket: ReturnType<typeof useSocket>["socket"];
  timerSeconds: number | null;
}) {
  switch (state.phase) {
    case "lobby":
      return (
        <LobbyView
          state={state}
          onStartGame={() => socket.emit("start_game")}
        />
      );

    case "captain_picking":
      if (state.canPickPlayer) {
        return (
          <CaptainPickView
            state={state}
            onPick={(playerId) =>
              socket.emit("captain_pick_player", { playerId })
            }
          />
        );
      }
      return <SpectatorView state={state} />;

    case "round_intro":
      return <RoundIntroView state={state} />;

    case "individual_round":
    case "captain_round":
      // Nominated player sees suggestion input
      if (state.message?.includes("nominated")) {
        return (
          <div className="flex flex-1 flex-col justify-center">
            <NominatedPlayerInput
              onSubmit={(answer) => socket.emit("nominate_suggestion", { answer })}
            />
          </div>
        );
      }
      // Captain sees overrule window
      if (state.overrulePlayerAnswer && state.canOverrule) {
        return (
          <div className="flex flex-1 flex-col justify-center">
            <OverruleView
              playerAnswer={state.overrulePlayerAnswer}
              onOverrule={(answer) => socket.emit("use_overrule", { replacementAnswer: answer })}
            />
          </div>
        );
      }
      // Captain sees reinstatement offer
      if (state.canReinstate && state.eliminatedPlayers.length > 0) {
        return (
          <div className="flex flex-1 flex-col justify-center">
            <ReinstatementView
              eliminatedPlayers={state.eliminatedPlayers}
              onReinstate={(playerId) => socket.emit("reinstate_player", { playerId })}
              onContinue={() => socket.emit("continue_without_reinstate")}
            />
          </div>
        );
      }
      // Active player sees answer input
      if (state.canSubmitAnswer && state.isMyTurn) {
        return (
          <ActivePlayerView
            state={state}
            socket={socket}
            timerSeconds={timerSeconds}
          />
        );
      }
      return <SpectatorView state={state} />;

    case "round_end":
      return (
        <RoundEndView
          state={state}
          onContinue={() => socket.emit("continue_reveal")}
        />
      );

    case "game_over":
      return <GameOverView state={state} />;

    default:
      return <SpectatorView state={state} />;
  }
}

// ── Lobby ──────────────────────────────────────────────────

function LobbyView({
  state,
  onStartGame,
}: {
  state: ReturnType<typeof usePlayerStore.getState>;
  onStartGame: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-slate-500">Room</p>
        <p className="text-4xl font-black tracking-[0.2em] text-amber-400">
          {state.roomCode}
        </p>
      </div>

      <div className="text-center">
        <p className="text-slate-400">
          You are{" "}
          <span className="font-semibold text-white">{state.playerName}</span>
        </p>
        {state.isCaptain && (
          <p className="mt-1 text-sm text-amber-400">You are the Captain</p>
        )}
      </div>

      <div className="w-full max-w-sm">
        <h3 className="mb-3 text-center text-sm font-medium uppercase tracking-wider text-slate-500">
          Players
        </h3>
        <ul className="space-y-2">
          {state.players.map((p) => (
            <li
              key={p.id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                p.connected
                  ? "border-slate-700 bg-slate-900"
                  : "border-slate-800 bg-slate-900/50 opacity-50"
              }`}
            >
              <span className="font-medium">{p.name}</span>
              {p.isCaptain && (
                <span className="text-xs text-amber-400">Captain</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {state.canStartGame ? (
        <button
          onClick={onStartGame}
          className="w-full max-w-sm rounded-lg bg-green-600 py-4 text-lg font-bold text-white transition hover:bg-green-500"
        >
          Start Game
        </button>
      ) : state.isCaptain ? (
        <p className="text-slate-500">Need at least 2 players to start</p>
      ) : (
        <p className="text-slate-500">
          Waiting for the captain to start the game...
        </p>
      )}
    </div>
  );
}

// ── Round Intro ─────────────────────────────────────────────

function RoundIntroView({ state }: { state: ReturnType<typeof usePlayerStore.getState> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className="text-sm uppercase tracking-widest text-slate-500">
        Round {state.currentRound} of {state.totalRounds}
      </p>
      <h1 className="text-2xl font-bold text-amber-400">{state.category}</h1>
      <p className="text-lg text-white">{state.question}</p>
    </div>
  );
}

// ── Captain Pick ────────────────────────────────────────────

function CaptainPickView({
  state,
  onPick,
}: {
  state: ReturnType<typeof usePlayerStore.getState>;
  onPick: (playerId: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-slate-500">
          Round {state.currentRound}
        </p>
        <h2 className="mt-2 text-xl font-bold text-white">{state.category}</h2>
        <p className="mt-1 text-slate-400">{state.question}</p>
      </div>

      <p className="text-lg text-amber-300">Choose a player for this round:</p>

      <div className="w-full max-w-sm space-y-3">
        {state.availablePlayers.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-6 py-4 text-lg font-medium text-white transition hover:border-amber-500 hover:bg-amber-500/10"
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Active Player ───────────────────────────────────────────

function ActivePlayerView({
  state,
  socket,
  timerSeconds,
}: {
  state: ReturnType<typeof usePlayerStore.getState>;
  socket: ReturnType<typeof useSocket>["socket"];
  timerSeconds: number | null;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <p className="text-sm uppercase tracking-widest text-amber-400">
          Your Turn!
        </p>
        <p className="mt-1 text-lg text-white">{state.question}</p>
      </div>

      <AnswerInput
        onSubmit={(answer) => socket.emit("submit_answer", { answer })}
        onBank={() => {}}
        canBank={false}
        correctCount={state.correctCount}
        moneyLevel={state.moneyLevel}
        hasLife={state.hasLife}
        timerSeconds={timerSeconds}
      />

      {/* Nominate suggestion display */}
      {state.nominateSuggestion && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
          <p className="text-sm text-blue-300">Nominated suggestion:</p>
          <p className="mt-1 text-lg font-bold text-white">{state.nominateSuggestion}</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => socket.emit("accept_nominate")}
              className="flex-1 rounded-lg bg-green-600 py-2 font-semibold text-white"
            >
              Accept
            </button>
            <button
              onClick={() => socket.emit("reject_nominate")}
              className="flex-1 rounded-lg bg-slate-700 py-2 font-semibold text-slate-300"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Lifeline buttons */}
      <LifelineButtons
        state={state}
        onNominate={(targetPlayerId) => socket.emit("use_nominate", { targetPlayerId })}
        onBank={() => socket.emit("bank_money")}
      />
    </div>
  );
}

// ── Round End ───────────────────────────────────────────────

function RoundEndView({
  state,
  onContinue,
}: {
  state: ReturnType<typeof usePlayerStore.getState>;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className="text-sm uppercase tracking-widest text-slate-500">
        Round Complete
      </p>
      <p className="text-2xl font-bold text-white">
        Prize Pot:{" "}
        <span className="text-amber-400">
          {"\u00A3"}{state.prizePot.toLocaleString()}
        </span>
      </p>
      <p
        className={`text-sm ${
          state.myStatus === "qualified"
            ? "text-green-400"
            : state.myStatus === "eliminated"
              ? "text-red-400"
              : "text-slate-400"
        }`}
      >
        {state.myStatus === "qualified"
          ? "You qualified for the Final!"
          : state.myStatus === "eliminated"
            ? "You have been eliminated"
            : "Waiting for next round..."}
      </p>

      {state.isCaptain && (
        <button
          onClick={onContinue}
          className="mt-4 rounded-lg bg-amber-500 px-8 py-4 text-lg font-bold text-slate-950 transition hover:bg-amber-400"
        >
          Continue
        </button>
      )}
    </div>
  );
}

// ── Game Over ───────────────────────────────────────────────

function GameOverView({ state }: { state: ReturnType<typeof usePlayerStore.getState> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <h1 className="text-4xl font-black text-amber-400">GAME OVER</h1>
      <p className="text-xl text-white">
        Total Prize:{" "}
        <span className="font-bold text-amber-400">
          {"\u00A3"}{state.prizePot.toLocaleString()}
        </span>
      </p>
    </div>
  );
}
