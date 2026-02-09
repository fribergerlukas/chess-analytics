"use client";

import { useState, useEffect, useRef } from "react";
import { useUserContext } from "./UserContext";
import PlayerCard, { ArenaStatsData } from "./PlayerCard";

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

interface ProfileData {
  title?: string;
  countryCode?: string;
}

interface CardData {
  timeControl: "bullet" | "blitz" | "rapid";
  chessRating: number;
  peakRating?: number;
  arenaStats: ArenaStatsData;
}

const API_BASE = "http://localhost:3000";

const TIME_CONTROLS: ("bullet" | "blitz" | "rapid")[] = ["bullet", "blitz", "rapid"];

export default function Home() {
  const { queriedUser, timeCategory, ratedFilter, searchTrigger } = useUserContext();

  const [stats, setStats] = useState<StatsData | null>(null);
  const [games, setGames] = useState<GameData[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);

  const lastTriggerRef = useRef(0);

  useEffect(() => {
    if (!queriedUser || searchTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = searchTrigger;
    fetchStats(queriedUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // Auto-fetch on mount if queriedUser is already set (tab switch)
  useEffect(() => {
    if (queriedUser && !stats && !loading) {
      fetchStats(queriedUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchStats(user: string) {
    setLoading(true);
    setError("");
    setStats(null);
    setGames([]);
    setProfile(null);
    setCards([]);
    setStatusMsg("Importing games from chess.com...");

    try {
      // Step 1: Import games (unchanged)
      const importBody: Record<string, string | boolean> = { username: user, timeCategory };
      if (ratedFilter === "true") importBody.rated = true;
      else if (ratedFilter === "false") importBody.rated = false;
      const importRes = await fetch(`${API_BASE}/import/chesscom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(importBody),
      });
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importRes.status})`);
      }

      // Step 2: Fetch chess.com profile + ratings in parallel
      setStatusMsg("Fetching player profile...");
      let profileData: ProfileData = {};
      let ratings: Record<string, number> = {};
      let peakRatings: Record<string, number> = {};

      try {
        const [profileRes, ratingsRes] = await Promise.all([
          fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}`),
          fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/stats`),
        ]);

        if (profileRes.ok) {
          const p = await profileRes.json();
          profileData.title = p.title || undefined;
          // Country comes as a URL like "https://api.chess.com/pub/country/US"
          if (p.country) {
            const parts = p.country.split("/");
            profileData.countryCode = parts[parts.length - 1];
          }
        }

        if (ratingsRes.ok) {
          const d = await ratingsRes.json();
          for (const tc of TIME_CONTROLS) {
            const key = `chess_${tc}`;
            if (d[key]?.last?.rating) {
              ratings[tc] = d[key].last.rating;
            }
            if (d[key]?.best?.rating) {
              peakRatings[tc] = d[key].best.rating;
            }
          }
        }
      } catch {
        // Profile/ratings fetch is non-critical
      }

      setProfile(profileData);

      // Step 2b: Import games for other time controls that have ratings (so arena cards work)
      const cardTimeControls = TIME_CONTROLS.filter((tc) => ratings[tc]);
      const otherTCs = cardTimeControls.filter((tc) => tc !== timeCategory);
      if (otherTCs.length > 0) {
        setStatusMsg("Importing games for all time controls...");
        await Promise.all(
          otherTCs.map(async (tc) => {
            const body: Record<string, string | boolean> = { username: user, timeCategory: tc };
            if (ratedFilter === "true") body.rated = true;
            else if (ratedFilter === "false") body.rated = false;
            try {
              await fetch(`${API_BASE}/import/chesscom`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
            } catch {
              // Non-critical — card just won't appear for this TC
            }
          })
        );
      }

      // Step 3: For each time control with a rating, fetch arena stats in parallel
      setStatusMsg("Building arena cards...");

      if (cardTimeControls.length > 0) {
        const arenaPromises = cardTimeControls.map(async (tc) => {
          const params = new URLSearchParams();
          params.set("timeCategory", tc);
          params.set("chessRating", String(ratings[tc]));
          if (profileData.title) params.set("title", profileData.title);
          const url = `${API_BASE}/users/${encodeURIComponent(user)}/arena-stats?${params}`;
          try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const arenaStats: ArenaStatsData = await res.json();
            return {
              timeControl: tc,
              chessRating: ratings[tc],
              peakRating: peakRatings[tc],
              arenaStats,
            } as CardData;
          } catch {
            return null;
          }
        });

        const cardResults = await Promise.all(arenaPromises);
        setCards(cardResults.filter((c): c is CardData => c !== null));
      }

      // Step 4: Fetch stats + games for the selected time category (existing behavior)
      setStatusMsg("Fetching stats...");
      const params = new URLSearchParams();
      params.set("timeCategory", timeCategory);
      if (ratedFilter !== "all") params.set("rated", ratedFilter);

      const qs = params.toString();
      const url = `${API_BASE}/users/${encodeURIComponent(user)}/stats${qs ? `?${qs}` : ""}`;

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data: StatsData = await res.json();
      setStats(data);

      const gamesParams = new URLSearchParams({ limit: "40", timeCategory });
      if (ratedFilter !== "all") gamesParams.set("rated", ratedFilter);
      const gamesUrl = `${API_BASE}/users/${encodeURIComponent(user)}/games?${gamesParams}`;
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
    <div className="min-h-screen" style={{ backgroundColor: "#312e2b", color: "#fff" }}>
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div
              className="h-10 w-10 animate-spin rounded-full border-4"
              style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
            />
            {statusMsg && (
              <p className="text-sm font-bold" style={{ color: "#d1cfcc" }}>{statusMsg}</p>
            )}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            className="px-5 py-4 text-sm font-bold"
            style={{ backgroundColor: "#3b1a1a", borderRadius: 10, color: "#e05252" }}
          >
            {error}
          </div>
        )}

        {/* Player Cards */}
        {cards.length > 0 && !loading && (
          <div className="flex justify-center gap-6 flex-wrap">
            {cards.map((card) => (
              <PlayerCard
                key={card.timeControl}
                username={queriedUser}
                timeControl={card.timeControl}
                chessRating={card.chessRating}
                peakRating={card.peakRating}
                title={profile?.title}
                countryCode={profile?.countryCode}
                arenaStats={card.arenaStats}
              />
            ))}
          </div>
        )}

        {/* Stats cards */}
        {stats && !loading && (
          <div className="space-y-8">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <p style={{ color: "#d1cfcc", fontSize: 15 }}>
                Report for <span className="font-extrabold" style={{ color: "#fff" }}>{queriedUser}</span> — last {stats.totalGames} {timeCategory} games
              </p>
            </div>

            {/* Total games */}
            <div
              className="p-7"
              style={{ backgroundColor: "#262421", borderRadius: 12 }}
            >
              <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Total Games</p>
              <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 42 }}>{stats.totalGames}</p>
            </div>

            {/* Win / Loss / Draw */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="p-7" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Wins</p>
                <p className="mt-2 font-extrabold" style={{ color: "#81b64c", fontSize: 36 }}>
                  {stats.results.wins}
                </p>
                <p className="mt-1 font-bold" style={{ color: "#d1cfcc", fontSize: 14 }}>
                  {stats.results.winRate}%
                </p>
              </div>

              <div className="p-7" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Losses</p>
                <p className="mt-2 font-extrabold" style={{ color: "#e05252", fontSize: 36 }}>
                  {stats.results.losses}
                </p>
                <p className="mt-1 font-bold" style={{ color: "#d1cfcc", fontSize: 14 }}>
                  {stats.results.lossRate}%
                </p>
              </div>

              <div className="p-7" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Draws</p>
                <p className="mt-2 font-extrabold" style={{ color: "#c27a30", fontSize: 36 }}>
                  {stats.results.draws}
                </p>
                <p className="mt-1 font-bold" style={{ color: "#d1cfcc", fontSize: 14 }}>
                  {stats.results.drawRate}%
                </p>
              </div>
            </div>

            {/* Accuracy */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="p-7" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Accuracy (White)</p>
                <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 36 }}>
                  {stats.accuracy.white != null ? `${stats.accuracy.white}%` : "N/A"}
                </p>
              </div>

              <div className="p-7" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Accuracy (Black)</p>
                <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 36 }}>
                  {stats.accuracy.black != null ? `${stats.accuracy.black}%` : "N/A"}
                </p>
              </div>

              <div className="p-7" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-sm font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Accuracy (Overall)</p>
                <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 36 }}>
                  {stats.accuracy.overall != null ? `${stats.accuracy.overall}%` : "N/A"}
                </p>
              </div>
            </div>

            {/* Game list */}
            {games.length > 0 && (
              <div
                className="overflow-hidden"
                style={{ backgroundColor: "#262421", borderRadius: 12 }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #3a3733" }}>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>#</th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Date</th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Result</th>
                      <th className="px-5 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Time Control</th>
                      <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Acc (W)</th>
                      <th className="px-5 py-3.5 text-right text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Acc (B)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((game, i) => (
                      <tr
                        key={game.id}
                        className="transition-colors"
                        style={{ borderBottom: "1px solid #3a3733" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#3a3733")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        <td className="px-5 py-3" style={{ color: "#9b9895" }}>{i + 1}</td>
                        <td className="px-5 py-3 font-bold" style={{ color: "#fff" }}>
                          {new Date(game.endTime).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className="inline-block px-2.5 py-1 text-xs font-extrabold"
                            style={{
                              borderRadius: 6,
                              ...(game.result === "WIN"
                                ? { backgroundColor: "#21371a", color: "#81b64c" }
                                : game.result === "LOSS"
                                  ? { backgroundColor: "#3b1a1a", color: "#e05252" }
                                  : { backgroundColor: "#3b3520", color: "#c27a30" }),
                            }}
                          >
                            {game.result}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-bold" style={{ color: "#d1cfcc" }}>{game.timeControl}</td>
                        <td className="px-5 py-3 text-right font-bold" style={{ color: "#fff" }}>
                          {game.accuracyWhite != null ? `${game.accuracyWhite}%` : "\u2014"}
                        </td>
                        <td className="px-5 py-3 text-right font-bold" style={{ color: "#fff" }}>
                          {game.accuracyBlack != null ? `${game.accuracyBlack}%` : "\u2014"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {!stats && !loading && !error && (
          <div className="text-center py-24">
            <div style={{ fontSize: 48 }} className="mb-5">&#9813;</div>
            <p className="font-extrabold mb-3" style={{ color: "#fff", fontSize: 22 }}>
              Player Card
            </p>
            <p className="font-bold" style={{ color: "#9b9895", fontSize: 15 }}>
              Enter a chess.com username in the sidebar to generate a report.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
