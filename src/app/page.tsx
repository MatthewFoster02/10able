import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <h1 className="text-6xl font-bold tracking-tight text-amber-400">
        TENABLE
      </h1>
      <p className="text-lg text-slate-400">The Top 10 Quiz Game</p>
      <div className="flex gap-4">
        <Link
          href="/room"
          className="rounded-lg bg-amber-500 px-8 py-4 text-lg font-semibold text-slate-950 transition hover:bg-amber-400"
        >
          Host a Game
        </Link>
        <Link
          href="/play"
          className="rounded-lg border border-slate-600 px-8 py-4 text-lg font-semibold text-white transition hover:border-slate-400"
        >
          Join a Game
        </Link>
      </div>
    </div>
  );
}
