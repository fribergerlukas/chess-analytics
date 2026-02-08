"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";

interface StatsData {
  totalGames: number;
  results: {
    wins: number;
    losses: number;
    draws: number;
    winRate: number;
    lossRate: number;
    drawRate: number;
  };
  accuracy: {
    white: number | null;
    black: number | null;
    overall: number | null;
  };
}

interface GameData {
  id: number;
  endTime: string;
  timeControl: string;
  result: "WIN" | "LOSS" | "DRAW";
  accuracyWhite: number | null;
  accuracyBlack: number | null;
}

const TIME_CATEGORIES = [
  { label: "Bullet", value: "bullet" },
  { label: "Blitz", value: "blitz" },
  { label: "Rapid", value: "rapid" },
];

const API_BASE = "http://localhost:3000";

export default function Home() {
  const [username, setUsername] = useState("");
  const [timeCategory, setTimeCategory] = useState("bullet");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [games, setGames] = useState<GameData[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [queriedUser, setQueriedUser] = useState("");

  async function fetchStats(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");
    setStats(null);
    setGames([]);
    setRating(null);
    setStatusMsg("Importing games from chess.com...");

    try {
      // Import games from chess.com first
      const importBody: Record<string, string> = { username: trimmed, timeCategory };
      const importRes = await fetch(`${API_BASE}/import/chesscom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importBody),
      });
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importRes.status})`);
      }

      // Fetch rating from chess.com
      try {
        const ratingRes = await fetch(
          `https://api.chess.com/pub/player/${encodeURIComponent(trimmed)}/stats`
        );
        if (ratingRes.ok) {
          const d = await ratingRes.json();
          const key = `chess_${timeCategory}`;
          setRating(d[key]?.last?.rating ?? null);
        }
      } catch {
        // Rating fetch is non-critical
      }

      // Now fetch stats
      setStatusMsg("Fetching stats...");
      const params = new URLSearchParams();
      params.set("timeCategory", timeCategory);

      const qs = params.toString();
      const url = `${API_BASE}/users/${encodeURIComponent(trimmed)}/stats${qs ? `?${qs}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data: StatsData = await res.json();
      setStats(data);
      setQueriedUser(trimmed);

      // Fetch game list
      const gamesUrl = `${API_BASE}/users/${encodeURIComponent(trimmed)}/games?limit=40`;
      const gamesRes = await fetch(gamesUrl);
      if (gamesRes.ok) {
        const gamesData = await gamesRes.json();
        setGames(gamesData.games);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="mx-auto max-w-4xl px-6 py-5 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Chess Analytics</h1>
          <nav className="flex gap-4 text-sm font-medium">
            <Link href="/" className="text-blue-600 dark:text-blue-400">Dashboard</Link>
            <Link href="/puzzles" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Puzzles</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {/* Username + time control + submit */}
        <form onSubmit={fetchStats} className="flex gap-3">
          <input
            type="text"
            placeholder="Enter chess.com username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
          />
          <select
            value={timeCategory}
            onChange={(e) => setTimeCategory(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TIME_CATEGORIES.map((tc) => (
              <option key={tc.value} value={tc.value}>
                {tc.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Loading..." : "Get Report"}
          </button>
        </form>

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-blue-600" />
            {statusMsg && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{statusMsg}</p>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Stats cards */}
        {stats && !loading && (
          <div className="space-y-6">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Report for <span className="font-semibold text-zinc-900 dark:text-zinc-100">{queriedUser}</span> — last {stats.totalGames} {timeCategory} games
              </p>
              {rating != null && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Rating: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{rating}</span>
                </p>
              )}
            </div>

            {/* Total games */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Games</p>
              <p className="mt-1 text-4xl font-bold">{stats.totalGames}</p>
            </div>

            {/* Win / Loss / Draw */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Wins</p>
                <p className="mt-1 text-3xl font-bold text-green-600 dark:text-green-400">
                  {stats.results.wins}
                </p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {stats.results.winRate}%
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Losses</p>
                <p className="mt-1 text-3xl font-bold text-red-600 dark:text-red-400">
                  {stats.results.losses}
                </p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {stats.results.lossRate}%
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Draws</p>
                <p className="mt-1 text-3xl font-bold text-yellow-600 dark:text-yellow-400">
                  {stats.results.draws}
                </p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {stats.results.drawRate}%
                </p>
              </div>
            </div>

            {/* Accuracy */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Accuracy (White)</p>
                <p className="mt-1 text-3xl font-bold">
                  {stats.accuracy.white != null ? `${stats.accuracy.white}%` : "N/A"}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Accuracy (Black)</p>
                <p className="mt-1 text-3xl font-bold">
                  {stats.accuracy.black != null ? `${stats.accuracy.black}%` : "N/A"}
                </p>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Accuracy (Overall)</p>
                <p className="mt-1 text-3xl font-bold">
                  {stats.accuracy.overall != null ? `${stats.accuracy.overall}%` : "N/A"}
                </p>
              </div>
            </div>

            {/* Game list */}
            {games.length > 0 && (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Result</th>
                      <th className="px-4 py-3">Time Control</th>
                      <th className="px-4 py-3 text-right">Acc (W)</th>
                      <th className="px-4 py-3 text-right">Acc (B)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((game, i) => (
                      <tr
                        key={game.id}
                        className={`border-b border-zinc-100 dark:border-zinc-800 last:border-0 ${
                          game.result === "WIN"
                            ? "bg-green-50/50 dark:bg-green-950/20"
                            : game.result === "LOSS"
                              ? "bg-red-50/50 dark:bg-red-950/20"
                              : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 text-zinc-400 dark:text-zinc-500">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          {new Date(game.endTime).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                              game.result === "WIN"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                : game.result === "LOSS"
                                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
                            }`}
                          >
                            {game.result}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{game.timeControl}</td>
                        <td className="px-4 py-2.5 text-right">
                          {game.accuracyWhite != null ? `${game.accuracyWhite}%` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {game.accuracyBlack != null ? `${game.accuracyBlack}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Empty state — no stats fetched yet */}
        {!stats && !loading && !error && (
          <div className="text-center py-16 text-zinc-400 dark:text-zinc-500">
            Enter a chess.com username to generate a report on their last 40 games.
          </div>
        )}
      </main>
    </div>
  );
}
