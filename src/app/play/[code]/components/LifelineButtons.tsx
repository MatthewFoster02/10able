"use client";

import { useState } from "react";
import type { PlayerState } from "@shared/types";

export function LifelineButtons({
  state,
  onNominate,
  onBank,
}: {
  state: PlayerState;
  onNominate: (targetPlayerId: string) => void;
  onBank: () => void;
}) {
  const [showNominateList, setShowNominateList] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {/* Bank button */}
      {state.canBank && (
        <button
          onClick={onBank}
          className="rounded-lg border-2 border-green-500 bg-green-500/10 py-4 text-lg font-bold text-green-400 transition hover:bg-green-500/20"
        >
          Bank {"\u00A3"}{state.moneyLevel.toLocaleString()}
        </button>
      )}

      {/* Nominate button */}
      {state.canNominate && (
        <>
          <button
            onClick={() => setShowNominateList(!showNominateList)}
            className="rounded-lg border border-blue-500 bg-blue-500/10 py-3 text-sm font-semibold text-blue-400 transition hover:bg-blue-500/20"
          >
            Nominate a teammate
          </button>
          {showNominateList && (
            <div className="space-y-2">
              {state.availablePlayers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onNominate(p.id);
                    setShowNominateList(false);
                  }}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-left font-medium text-white transition hover:border-blue-500"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Nominate suggestion received */}
      {state.nominateSuggestion && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
          <p className="text-sm text-blue-300">Nominated answer suggestion:</p>
          <p className="mt-1 text-lg font-bold text-white">{state.nominateSuggestion}</p>
        </div>
      )}
    </div>
  );
}

export function NominatedPlayerInput({
  onSubmit,
}: {
  onSubmit: (answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <p className="text-lg font-bold text-blue-400">You&apos;ve been nominated!</p>
        <p className="mt-1 text-sm text-slate-400">Suggest an answer:</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) {
            onSubmit(answer.trim());
            setAnswer("");
          }
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          placeholder="Your suggestion..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-4 text-lg text-white placeholder-slate-600 outline-none focus:border-blue-500"
          autoComplete="off"
          autoFocus
        />
        <button
          type="submit"
          disabled={!answer.trim()}
          className="rounded-lg bg-blue-500 px-6 py-4 text-lg font-bold text-white transition hover:bg-blue-400 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export function OverruleView({
  playerAnswer,
  onOverrule,
}: {
  playerAnswer: string;
  onOverrule: (replacementAnswer: string) => void;
}) {
  const [answer, setAnswer] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <p className="text-sm text-purple-300">Player answered:</p>
        <p className="text-xl font-bold text-white">&quot;{playerAnswer}&quot;</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) {
            onOverrule(answer.trim());
            setAnswer("");
          }
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          placeholder="Your replacement answer..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-4 text-lg text-white placeholder-slate-600 outline-none focus:border-purple-500"
          autoComplete="off"
          autoFocus
        />
        <button
          type="submit"
          disabled={!answer.trim()}
          className="rounded-lg bg-purple-500 px-6 py-4 text-lg font-bold text-white transition hover:bg-purple-400 disabled:opacity-50"
        >
          Overrule
        </button>
      </form>
    </div>
  );
}

export function ReinstatementView({
  eliminatedPlayers,
  onReinstate,
  onContinue,
}: {
  eliminatedPlayers: { id: string; name: string }[];
  onReinstate: (playerId: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <p className="text-lg font-bold text-amber-400">Reinstate a player?</p>
        <p className="mt-1 text-sm text-slate-400">
          This will lock your current money level
        </p>
      </div>

      <div className="space-y-2">
        {eliminatedPlayers.map((p) => (
          <button
            key={p.id}
            onClick={() => onReinstate(p.id)}
            className="w-full rounded-lg border border-green-600 bg-green-600/10 px-4 py-3 font-medium text-green-400 transition hover:bg-green-600/20"
          >
            Reinstate {p.name}
          </button>
        ))}
      </div>

      <button
        onClick={onContinue}
        className="rounded-lg border border-slate-600 bg-slate-900 py-3 font-medium text-slate-400 transition hover:bg-slate-800"
      >
        Continue without reinstating
      </button>
    </div>
  );
}
