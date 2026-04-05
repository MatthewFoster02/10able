import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 px-6">
      <div className="text-center">
        <h1 className="text-7xl font-black tracking-tight text-amber-400 sm:text-8xl">
          TENABLE
        </h1>
        <p className="mt-3 text-lg text-slate-400">The Top 10 Quiz Game</p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Link
          href="/room"
          className="rounded-xl bg-amber-500 px-10 py-5 text-center text-lg font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400 hover:shadow-amber-400/30"
        >
          Host a Game
        </Link>
        <Link
          href="/play"
          className="rounded-xl border-2 border-slate-600 px-10 py-5 text-center text-lg font-bold text-white transition hover:border-slate-400 hover:bg-slate-900"
        >
          Join a Game
        </Link>
      </div>
    </div>
  );
}
