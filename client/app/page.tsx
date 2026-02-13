"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { toPng } from "html-to-image";
import { useUserContext } from "./UserContext";
import { useAuth } from "./AuthContext";
import PlayerCard, { ArenaStatsData } from "./PlayerCard";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false }
);

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
  avatarUrl?: string;
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
  const { queriedUser, setQueriedUser, searchTrigger } = useUserContext();
  const { authUser, authLoading } = useAuth();

  const [stats, setStats] = useState<StatsData | null>(null);
  const [games, setGames] = useState<GameData[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [cards, setCards] = useState<CardData[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [gameTimeCategory, setGameTimeCategory] = useState("bullet");
  const [gameRatedFilter, setGameRatedFilter] = useState("true");
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gameLimit, setGameLimit] = useState(40);

  const cardFrontRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [freePage, setFreePage] = useState(0);
  const [premiumPage, setPremiumPage] = useState(0);

  const lastTriggerRef = useRef(0);

  useEffect(() => { setMounted(true); }, []);

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

  // Auto-load logged-in user's stats
  const autoLoadFired = useRef(false);
  useEffect(() => {
    if (authLoading || !authUser || autoLoadFired.current) return;
    if (queriedUser || stats || loading) return;
    autoLoadFired.current = true;
    setQueriedUser(authUser);
    fetchStats(authUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, authLoading, queriedUser, stats, loading]);

  async function fetchStats(user: string) {
    setLoading(true);
    setError("");
    setStats(null);
    setGames([]);
    setProfile(null);
    setCards([]);
    setStatusMsg("Importing games from chess.com...");

    try {
      // Step 1: Import rated games for all time controls in parallel (always import up to 100)
      const importPromises = TIME_CONTROLS.map((tc) =>
        fetch(`${API_BASE}/import/chesscom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user, timeCategory: tc, rated: true, maxGames: 100 }),
        })
      );
      const importResults = await Promise.all(importPromises);
      // Check if at least one import succeeded
      const anyOk = importResults.some((r) => r.ok);
      if (!anyOk) {
        const body = await importResults[0].json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importResults[0].status})`);
      }

      // Step 2: Fetch chess.com profile + ratings in parallel
      setStatusMsg("Fetching player profile...");
      let profileData: ProfileData = {};
      let ratings: Record<string, number> = {};
      let peakRatings: Record<string, number> = {};
      let records: Record<string, { wins: number; draws: number; losses: number }> = {};

      try {
        const [profileRes, ratingsRes] = await Promise.all([
          fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}`),
          fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/stats`),
        ]);

        if (profileRes.ok) {
          const p = await profileRes.json();
          profileData.title = p.title || undefined;
          if (p.avatar) {
            profileData.avatarUrl = p.avatar;
          }
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
            if (d[key]?.record) {
              records[tc] = {
                wins: d[key].record.win || 0,
                draws: d[key].record.draw || 0,
                losses: d[key].record.loss || 0,
              };
            }
          }
        }
      } catch {
        // Profile/ratings fetch is non-critical
      }

      setProfile(profileData);

      // Step 3: For each time control with a rating, fetch arena stats (rated only)
      const cardTimeControls = TIME_CONTROLS.filter((tc) => ratings[tc]);
      setStatusMsg("Building arena cards...");

      if (cardTimeControls.length > 0) {
        const arenaPromises = cardTimeControls.map(async (tc) => {
          const params = new URLSearchParams();
          params.set("timeCategory", tc);
          params.set("chessRating", String(ratings[tc]));
          if (profileData.title) params.set("title", profileData.title);
          params.set("rated", "true");
          const url = `${API_BASE}/users/${encodeURIComponent(user)}/arena-stats?${params}`;
          try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const arenaStats: ArenaStatsData = await res.json();
            if (records[tc]) {
              arenaStats.record = records[tc];
            }
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
        const sorted = cardResults
          .filter((c): c is CardData => c !== null)
          .sort((a, b) => b.chessRating - a.chessRating);
        setCards(sorted);
        setActiveIndex(0);
      }

      // Step 4: Fetch stats + games — use highest-rated time control, rated only
      const defaultTC = cardTimeControls.length > 0 ? cardTimeControls[0] : "blitz";
      setStatusMsg("Fetching stats...");
      const statsParams = new URLSearchParams();
      statsParams.set("timeCategory", defaultTC);
      statsParams.set("rated", "true");
      statsParams.set("limit", String(gameLimit));

      const url = `${API_BASE}/users/${encodeURIComponent(user)}/stats?${statsParams}`;

      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data: StatsData = await res.json();
      setStats(data);

      const gamesParams = new URLSearchParams({ limit: String(gameLimit), timeCategory: defaultTC, rated: "true" });
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

  async function refreshReport() {
    if (!queriedUser) return;
    setGamesLoading(true);
    try {
      const statsParams = new URLSearchParams();
      statsParams.set("timeCategory", gameTimeCategory);
      statsParams.set("limit", String(gameLimit));
      if (gameRatedFilter !== "all") statsParams.set("rated", gameRatedFilter);

      // Build arena-stats params (needs chessRating from active card)
      const activeCard = cards[activeIndex];
      const arenaParams = new URLSearchParams();
      arenaParams.set("timeCategory", gameTimeCategory);
      arenaParams.set("chessRating", String(activeCard?.chessRating ?? 1500));
      arenaParams.set("limit", String(gameLimit));
      if (profile?.title) arenaParams.set("title", profile.title);
      if (gameRatedFilter !== "all") arenaParams.set("rated", gameRatedFilter);

      const [statsRes, gamesRes, arenaRes] = await Promise.all([
        fetch(`${API_BASE}/users/${encodeURIComponent(queriedUser)}/stats?${statsParams}`),
        fetch(`${API_BASE}/users/${encodeURIComponent(queriedUser)}/games?${new URLSearchParams({
          limit: String(gameLimit),
          timeCategory: gameTimeCategory,
          ...(gameRatedFilter !== "all" ? { rated: gameRatedFilter } : {}),
        })}`),
        fetch(`${API_BASE}/users/${encodeURIComponent(queriedUser)}/arena-stats?${arenaParams}`),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (gamesRes.ok) { const d = await gamesRes.json(); setGames(d.games); }
      if (arenaRes.ok && activeCard) {
        const arenaStats: ArenaStatsData = await arenaRes.json();
        if (activeCard.arenaStats.record) arenaStats.record = activeCard.arenaStats.record;
        setCards((prev) => prev.map((c, i) => i === activeIndex ? { ...c, arenaStats } : c));
      }
    } catch {
      // Non-critical
    } finally {
      setGamesLoading(false);
    }
  }

  async function downloadCardImage() {
    const node = cardFrontRef.current;
    if (!node || downloading) return;
    setDownloading(true);

    // Pause shimmer animation during capture
    const shimmerEl = node.querySelector("[data-shimmer]") as HTMLElement | null;
    if (shimmerEl) shimmerEl.style.opacity = "0";

    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        style: { position: "relative", backfaceVisibility: "visible" },
      });
      const link = document.createElement("a");
      const activeCard = cards[activeIndex];
      link.download = `${queriedUser}-${activeCard.timeControl}-arena-card.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      if (shimmerEl) shimmerEl.style.opacity = "";
      setDownloading(false);
    }
  }

  // Auto-refresh report when any filter changes
  const reportInitialized = useRef(false);
  useEffect(() => {
    if (!reportInitialized.current) {
      reportInitialized.current = true;
      return;
    }
    refreshReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameTimeCategory, gameRatedFilter, gameLimit]);

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

        {/* Player Cards — Main + Compare */}
        {cards.length > 0 && !loading && (
          <div className="flex justify-center items-center gap-10">
            {/* ── Main player carousel ── */}
            <div className="flex items-center gap-4">
              {/* Left arrow */}
              {cards.length > 1 && (
                <button
                  onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: activeIndex === 0 ? "#3d3a37" : "#4a4745",
                    color: activeIndex === 0 ? "#6b6966" : "#d1cfcc",
                    border: "none",
                    cursor: activeIndex === 0 ? "default" : "pointer",
                    fontSize: 20,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s ease",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (activeIndex !== 0) e.currentTarget.style.backgroundColor = "#5a5755";
                  }}
                  onMouseLeave={(e) => {
                    if (activeIndex !== 0) e.currentTarget.style.backgroundColor = "#4a4745";
                  }}
                >
                  &#8249;
                </button>
              )}

              {/* Card stack */}
              <div style={{ position: "relative", width: 240, height: 360 }}>
                {cards.map((card, i) => {
                  const offset = i - activeIndex;
                  if (offset < 0) return null;
                  const zIndex = cards.length - offset;
                  const translateX = offset * 30;
                  const scale = 1 - offset * 0.05;
                  const opacity = offset === 0 ? 1 : Math.max(0.4, 1 - offset * 0.3);

                  return (
                    <div
                      key={card.timeControl}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        zIndex,
                        transform: `translateX(${translateX}px) scale(${scale})`,
                        opacity,
                        transition: "all 0.4s ease",
                        transformOrigin: "left center",
                        pointerEvents: offset === 0 ? "auto" : "none",
                      }}
                    >
                      <PlayerCard
                        username={queriedUser}
                        timeControl={card.timeControl}
                        chessRating={card.chessRating}
                        peakRating={card.peakRating}
                        title={profile?.title}
                        countryCode={profile?.countryCode}
                        avatarUrl={profile?.avatarUrl}
                        arenaStats={card.arenaStats}
                        frontFaceRef={offset === 0 ? cardFrontRef : undefined}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Download button */}
              <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); downloadCardImage(); }}
                  disabled={downloading}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: downloading ? "#3d3a37" : "#3d3a37",
                    color: downloading ? "#6b6966" : "#9b9895",
                    border: "none",
                    cursor: downloading ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s ease",
                    padding: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (!downloading) {
                      e.currentTarget.style.backgroundColor = "#4a4745";
                      e.currentTarget.style.color = "#d1cfcc";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!downloading) {
                      e.currentTarget.style.backgroundColor = "#3d3a37";
                      e.currentTarget.style.color = "#9b9895";
                    }
                  }}
                  title="Download card as image"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2v8M8 10L5 7M8 10l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Right arrow */}
              {cards.length > 1 && (
                <button
                  onClick={() => setActiveIndex((i) => Math.min(cards.length - 1, i + 1))}
                  disabled={activeIndex === cards.length - 1}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: activeIndex === cards.length - 1 ? "#3d3a37" : "#4a4745",
                    color: activeIndex === cards.length - 1 ? "#6b6966" : "#d1cfcc",
                    border: "none",
                    cursor: activeIndex === cards.length - 1 ? "default" : "pointer",
                    fontSize: 20,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s ease",
                    flexShrink: 0,
                    marginLeft: (cards.length - 1 - activeIndex) * 30,
                  }}
                  onMouseEnter={(e) => {
                    if (activeIndex !== cards.length - 1) e.currentTarget.style.backgroundColor = "#5a5755";
                  }}
                  onMouseLeave={(e) => {
                    if (activeIndex !== cards.length - 1) e.currentTarget.style.backgroundColor = "#4a4745";
                  }}
                >
                  &#8250;
                </button>
              )}
            </div>
          </div>
        )}

        {/* Report Stats */}
        {stats && !loading && (
          <div className="space-y-6">
            {/* Header bar */}
            <div
              style={{
                backgroundColor: "#262421",
                borderRadius: 12,
                padding: "20px 24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: "#3d3a37",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                  }}
                >
                  &#9813;
                </div>
                <div>
                  <p className="font-extrabold" style={{ color: "#fff", fontSize: 16, lineHeight: 1.2 }}>Report Stats</p>
                  <p style={{ color: "#6b6966", fontSize: 12, fontWeight: 600, marginTop: 2 }}>
                    {queriedUser}
                  </p>
                </div>
              </div>

              {/* Filters row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Game count pills */}
                <div style={{ display: "flex", gap: 2, backgroundColor: "#1c1b19", borderRadius: 8, padding: 3 }}>
                  {[40, 60, 80, 100].map((n) => (
                    <button
                      key={n}
                      onClick={() => setGameLimit(n)}
                      style={{
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                        borderRadius: 6,
                        border: "none",
                        backgroundColor: gameLimit === n ? "#4a4745" : "transparent",
                        color: gameLimit === n ? "#fff" : "#6b6966",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                <select
                  value={gameTimeCategory}
                  onChange={(e) => setGameTimeCategory(e.target.value)}
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#1c1b19",
                    color: "#fff",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="bullet">Bullet</option>
                  <option value="blitz">Blitz</option>
                  <option value="rapid">Rapid</option>
                </select>
                <select
                  value={gameRatedFilter}
                  onChange={(e) => setGameRatedFilter(e.target.value)}
                  style={{
                    padding: "7px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#1c1b19",
                    color: "#fff",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="all">All</option>
                  <option value="true">Rated</option>
                  <option value="false">Casual</option>
                </select>
              </div>
            </div>

            {/* Total / Wins / Losses / Draws — single row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Total</p>
                <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 32 }}>{stats.totalGames}</p>
              </div>
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Wins</p>
                <p className="mt-2 font-extrabold" style={{ color: "#81b64c", fontSize: 32 }}>{stats.results.wins}</p>
                <p className="mt-1 font-bold" style={{ color: "#d1cfcc", fontSize: 13 }}>{stats.results.winRate}%</p>
              </div>
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Losses</p>
                <p className="mt-2 font-extrabold" style={{ color: "#e05252", fontSize: 32 }}>{stats.results.losses}</p>
                <p className="mt-1 font-bold" style={{ color: "#d1cfcc", fontSize: 13 }}>{stats.results.lossRate}%</p>
              </div>
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Draws</p>
                <p className="mt-2 font-extrabold" style={{ color: "#c27a30", fontSize: 32 }}>{stats.results.draws}</p>
                <p className="mt-1 font-bold" style={{ color: "#d1cfcc", fontSize: 13 }}>{stats.results.drawRate}%</p>
              </div>
            </div>

            {/* Accuracy */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Accuracy (White)</p>
                <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 32 }}>
                  {stats.accuracy.white != null ? `${stats.accuracy.white}%` : "N/A"}
                </p>
              </div>
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Accuracy (Black)</p>
                <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 32 }}>
                  {stats.accuracy.black != null ? `${stats.accuracy.black}%` : "N/A"}
                </p>
              </div>
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Accuracy (Overall)</p>
                <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 32 }}>
                  {stats.accuracy.overall != null ? `${stats.accuracy.overall}%` : "N/A"}
                </p>
              </div>
            </div>

            {/* Result Form Graph */}
            {games.length > 0 && !gamesLoading && (
              <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895", marginBottom: 16 }}>Result Form</p>
                <FormGraph games={games} chessRating={cards.find((c) => c.timeControl === gameTimeCategory)?.chessRating} />
              </div>
            )}
            {gamesLoading && (
              <div className="flex justify-center py-8">
                <div
                  className="h-8 w-8 animate-spin rounded-full border-4"
                  style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
                />
              </div>
            )}

            {/* Category Breakdown */}
            {(() => {
              const phaseAccuracy = cards[activeIndex]?.arenaStats?.phaseAccuracy;
              const phaseAccVsExpected = cards[activeIndex]?.arenaStats?.phaseAccuracyVsExpected;
              const phaseBestMove = cards[activeIndex]?.arenaStats?.phaseBestMoveRate;
              const phaseByResult = cards[activeIndex]?.arenaStats?.phaseAccuracyByResult;
              const phaseBlunder = cards[activeIndex]?.arenaStats?.phaseBlunderRate;
              const PHASE_CATEGORIES = [
                { abbr: "OPN", label: "Opening", color: "#a37acc", accKey: "opening" as const },
                { abbr: "MID", label: "Middlegame", color: "#c46d8e", accKey: "middlegame" as const },
                { abbr: "END", label: "Endgame", color: "#d4a84b", accKey: "endgame" as const },
              ];
              const PHASE_METRICS = [
                "Accuracy",
                "Accuracy vs Expected",
                "Best Move Rate",
                "Blunder Rate",
                "Accuracy in Wins",
                "Accuracy in Draws",
                "Accuracy in Losses",
                "Avg CP Loss",
                "Mistake Rate",
                "Critical Moment Accuracy",
                "Consistency",
              ];
              const SKILL_CATEGORIES = [
                { abbr: "ATK", label: "Attacking", color: "#e05252",
                  metrics: ["Missed Win Rate", "Conversion Rate", "Initiative Pressing", "Sacrifice Accuracy", "Sacrifice Count"] },
                { abbr: "DEF", label: "Defending", color: "#5b9bd5",
                  metrics: ["Missed Save Rate", "Hold Rate", "Critical Accuracy", "Pressure Zone Accuracy", "Comeback Rate", "Post-Blunder Accuracy"] },
                { abbr: "TAC", label: "Tactics", color: "#c27a30",
                  metrics: ["Success Rate", "Blunder Rate", "Difficulty Breakdown"] },
                { abbr: "STR", label: "Strategy", color: "#81b64c",
                  metrics: ["Success Rate", "CP Loss Distribution"] },
              ];
              const renderPhasePanel = (cat: typeof PHASE_CATEGORIES[number], metrics: string[]) => {
                const accVal = phaseAccuracy?.[cat.accKey];
                const vsExpected = phaseAccVsExpected?.[cat.accKey];
                const getMetricValue = (metric: string): { text: string; color: string } => {
                  if (metric === "Accuracy" && accVal != null) {
                    return { text: `${accVal.toFixed(1)}%`, color: "#fff" };
                  }
                  if (metric === "Accuracy vs Expected" && vsExpected != null) {
                    const sign = vsExpected > 0 ? "+" : "";
                    const color = vsExpected > 0 ? "#81b64c" : vsExpected < 0 ? "#e05252" : "#9b9895";
                    return { text: `${sign}${vsExpected.toFixed(1)}%`, color };
                  }
                  if (metric === "Best Move Rate") {
                    const bmr = phaseBestMove?.[cat.accKey];
                    if (bmr != null) return { text: `${bmr.toFixed(1)}%`, color: "#fff" };
                  }
                  if (metric === "Blunder Rate") {
                    const br = phaseBlunder?.[cat.accKey];
                    if (br != null) return { text: `${br.toFixed(1)}%`, color: br > 3 ? "#e05252" : br > 1.5 ? "#c27a30" : "#81b64c" };
                  }
                  if (metric === "Accuracy in Wins") {
                    const val = phaseByResult?.[cat.accKey]?.wins;
                    if (val != null) return { text: `${val.toFixed(1)}%`, color: "#81b64c" };
                  }
                  if (metric === "Accuracy in Draws") {
                    const val = phaseByResult?.[cat.accKey]?.draws;
                    if (val != null) return { text: `${val.toFixed(1)}%`, color: "#c27a30" };
                  }
                  if (metric === "Accuracy in Losses") {
                    const val = phaseByResult?.[cat.accKey]?.losses;
                    if (val != null) return { text: `${val.toFixed(1)}%`, color: "#e05252" };
                  }
                  return { text: "\u2014", color: "#4a4745" };
                };
                return (
                  <div key={cat.abbr} style={{ backgroundColor: "#262421", borderRadius: 12, padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                      <span style={{
                        backgroundColor: cat.color,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 999,
                        marginRight: 10,
                        lineHeight: 1,
                      }}>{cat.abbr}</span>
                      <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, flex: 1 }}>{cat.label}</span>
                      <span style={{ color: accVal != null ? "#fff" : "#4a4745", fontSize: 24, fontWeight: 700 }}>
                        {accVal != null ? `${accVal.toFixed(1)}%` : "\u2014"}
                      </span>
                    </div>
                    <div style={{ height: 1, backgroundColor: "#3a3733", marginBottom: 10 }} />
                    {metrics.map((metric, i) => {
                      const { text, color } = getMetricValue(metric);
                      return (
                        <div key={metric} style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "7px 0",
                          borderBottom: i < metrics.length - 1 ? "1px solid #3a3733" : "none",
                        }}>
                          <span style={{ color: "#9b9895", fontSize: 13 }}>{metric}</span>
                          <span style={{ color, fontSize: 13, fontWeight: 700 }}>
                            {text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              };
              const renderPanel = (cat: { abbr: string; label: string; color: string }, metrics: string[]) => (
                <div key={cat.abbr} style={{ backgroundColor: "#262421", borderRadius: 12, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                    <span style={{
                      backgroundColor: cat.color,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 999,
                      marginRight: 10,
                      lineHeight: 1,
                    }}>{cat.abbr}</span>
                    <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, flex: 1 }}>{cat.label}</span>
                    <span style={{ color: "#4a4745", fontSize: 24, fontWeight: 700 }}>&mdash;</span>
                  </div>
                  <div style={{ height: 1, backgroundColor: "#3a3733", marginBottom: 10 }} />
                  {metrics.map((metric, i) => (
                    <div key={metric} style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "7px 0",
                      borderBottom: i < metrics.length - 1 ? "1px solid #3a3733" : "none",
                    }}>
                      <span style={{ color: "#9b9895", fontSize: 13 }}>{metric}</span>
                      <span style={{ color: "#4a4745", fontSize: 13, fontWeight: 700 }}>&mdash;</span>
                    </div>
                  ))}
                </div>
              );
              return (
                <>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895", marginBottom: 16 }}>Game Phases</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-5" style={{ marginBottom: 20 }}>
                    {PHASE_CATEGORIES.map((cat) => renderPhasePanel(cat, PHASE_METRICS))}
                  </div>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895", marginBottom: 16 }}>Skill Categories</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {SKILL_CATEGORIES.map((cat) => renderPanel(cat, cat.metrics))}
                  </div>
                </>
              );
            })()}

          </div>
        )}

        {/* Empty state — membership plans when logged out, prompt when logged in */}
        {!stats && !loading && !error && (
          authUser ? (
            <div className="text-center py-24">
              <div className="flex justify-center mb-5">
                <svg width="56" height="56" viewBox="0 0 45 45" fill="none">
                  <rect x="20.5" y="2" width="4" height="8" rx="1" fill="#81b64c" />
                  <rect x="17" y="4" width="11" height="4" rx="1" fill="#81b64c" />
                  <path d="M10 16 C10 16 12 13 14 14 C16 15 16 12 16 12 L17 10 C17 10 19 12.5 22.5 12.5 C26 12.5 28 10 28 10 L29 12 C29 12 29 15 31 14 C33 13 35 16 35 16 L35 20 C35 20 30 18 22.5 18 C15 18 10 20 10 20 Z" fill="#81b64c" />
                  <path d="M10 20 C10 20 8 28 8 32 C8 34 10 36 10 36 L35 36 C35 36 37 34 37 32 C37 28 35 20 35 20 C35 20 30 22 22.5 22 C15 22 10 20 10 20 Z" fill="#81b64c" />
                  <rect x="7" y="36" width="31" height="4" rx="1.5" fill="#81b64c" />
                  <rect x="9" y="40" width="27" height="3" rx="1" fill="#81b64c" />
                </svg>
              </div>
              <p className="font-extrabold mb-3" style={{ color: "#fff", fontSize: 22 }}>
                Arena Player Card
              </p>
              <p className="font-bold" style={{ color: "#9b9895", fontSize: 15 }}>
                Search a chess.com username in the sidebar to generate a report.
              </p>
            </div>
          ) : (
            <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 0 32px" }}>
              {/* Hero — compact */}
              <div className="text-center" style={{ marginBottom: 56 }}>
                <h1 className="font-extrabold" style={{ fontSize: 38, color: "#fff", marginBottom: 10, letterSpacing: "-0.02em" }}>
                  Know Your Game. Train Your Weaknesses.
                </h1>
              </div>

              {/* Pricing panel */}
              <div style={{ backgroundColor: "#1c1b19", borderRadius: 16, border: "1px solid #3d3a37", padding: "40px 44px", marginBottom: 32 }}>
              <div className="text-center" style={{ marginBottom: 28 }}>
                <h2 className="font-extrabold" style={{ fontSize: 28, color: "#fff", marginBottom: 8 }}>
                  Choose your plan
                </h2>
              </div>

              {/* Pricing cards side by side */}
              {(() => {
                const freePages = [
                  { title: "Arena Player Card", desc: "Generate your personal card with six skill categories rated against players in your range." },
                  { title: "Basic Stat Breakdown", desc: "See your accuracy, blunder rate, and win/draw/loss record across all analyzed games." },
                  { title: "Result Form Graph", desc: "Track your recent performance trend with a visual form graph showing your trajectory." },
                  { title: "Compare with Friends", desc: "Look up any chess.com player and compare cards side by side." },
                ];
                const premiumPages = [
                  { title: "Personalized Puzzles", desc: "Solve puzzles generated from your own games — positions where you missed the best move." },
                  { title: "Advanced Skill Stats", desc: "Deep breakdowns for attacking, defending, calculation, tactics, positional play, and openings." },
                  { title: "Game-Phase Analysis", desc: "See how you perform across opening, middlegame, and endgame with detailed insights and data." },
                  { title: "100 Games + Priority", desc: "Analyze up to 100 games with faster priority processing for quicker results." },
                ];
                const ArrowBtn = ({ dir, onClick }: { dir: "left" | "right"; onClick: () => void }) => (
                  <button
                    onClick={onClick}
                    style={{
                      width: 28, height: 28, borderRadius: "50%",
                      border: "1px solid #3d3a37", backgroundColor: "transparent",
                      color: "#6b6966", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#81b64c"; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#3d3a37"; e.currentTarget.style.color = "#6b6966"; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {dir === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
                    </svg>
                  </button>
                );
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6" style={{ maxWidth: 680, margin: "0 auto" }}>
                    {/* Free tier */}
                    <div style={{
                      backgroundColor: "#262421", borderRadius: 16, padding: "28px 24px",
                      border: "1px solid #3d3a37", display: "flex", flexDirection: "column",
                    }}>
                      <p className="font-extrabold" style={{ fontSize: 12, color: "#9b9895", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                        Free
                      </p>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 18 }}>
                        <span className="font-extrabold" style={{ fontSize: 32, color: "#fff" }}>$0</span>
                        <span style={{ fontSize: 13, color: "#6b6966", fontWeight: 700 }}>/month</span>
                      </div>
                      <div style={{ height: 1, backgroundColor: "#3d3a37", marginBottom: 18 }} />
                      {/* Feature carousel */}
                      <div style={{ flex: 1, minHeight: 90, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                        <p className="font-extrabold" style={{ fontSize: 13, color: "#d1cfcc", marginBottom: 6 }}>
                          {freePages[freePage].title}
                        </p>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#6b6966", lineHeight: 1.6, margin: 0 }}>
                          {freePages[freePage].desc}
                        </p>
                      </div>
                      {/* Arrows + dots */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 18 }}>
                        <ArrowBtn dir="left" onClick={() => setFreePage((p) => (p - 1 + freePages.length) % freePages.length)} />
                        <div style={{ display: "flex", gap: 6 }}>
                          {freePages.map((_, i) => (
                            <button key={i} onClick={() => setFreePage(i)} style={{
                              width: 7, height: 7, borderRadius: "50%", border: "none",
                              backgroundColor: freePage === i ? "#d1cfcc" : "#5a5754",
                              cursor: "pointer", transition: "background-color 0.15s ease",
                            }} />
                          ))}
                        </div>
                        <ArrowBtn dir="right" onClick={() => setFreePage((p) => (p + 1) % freePages.length)} />
                      </div>
                      <div style={{
                        marginTop: 18, padding: "11px", textAlign: "center",
                        fontSize: 13, fontWeight: 800, borderRadius: 8,
                        border: "1px solid #3d3a37", color: "#6b6966", cursor: "default",
                      }}>
                        Select
                      </div>
                    </div>

                    {/* Premium tier */}
                    <div style={{
                      backgroundColor: "#262421", borderRadius: 16, padding: "28px 24px",
                      border: "2px solid #81b64c", display: "flex", flexDirection: "column",
                      position: "relative", boxShadow: "0 0 30px rgba(129,182,76,0.08)",
                    }}>
                      <div style={{
                        position: "absolute", top: -11, right: 16,
                        backgroundColor: "#81b64c", color: "#fff",
                        fontSize: 10, fontWeight: 800, padding: "3px 10px",
                        borderRadius: 999, textTransform: "uppercase", letterSpacing: "0.06em",
                      }}>
                        Recommended
                      </div>
                      <p className="font-extrabold" style={{ fontSize: 12, color: "#81b64c", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                        Premium
                      </p>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 18 }}>
                        <span className="font-extrabold" style={{ fontSize: 32, color: "#fff" }}>$5.99</span>
                        <span style={{ fontSize: 13, color: "#6b6966", fontWeight: 700 }}>/month</span>
                      </div>
                      <div style={{ height: 1, backgroundColor: "#3d3a37", marginBottom: 18 }} />
                      {/* Feature carousel */}
                      <div style={{ flex: 1, minHeight: 90, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                        <p className="font-extrabold" style={{ fontSize: 13, color: "#d1cfcc", marginBottom: 6 }}>
                          {premiumPages[premiumPage].title}
                        </p>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#6b6966", lineHeight: 1.6, margin: 0 }}>
                          {premiumPages[premiumPage].desc}
                        </p>
                      </div>
                      {/* Arrows + dots */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 18 }}>
                        <ArrowBtn dir="left" onClick={() => setPremiumPage((p) => (p - 1 + premiumPages.length) % premiumPages.length)} />
                        <div style={{ display: "flex", gap: 6 }}>
                          {premiumPages.map((_, i) => (
                            <button key={i} onClick={() => setPremiumPage(i)} style={{
                              width: 7, height: 7, borderRadius: "50%", border: "none",
                              backgroundColor: premiumPage === i ? "#a3d65c" : "#5a5754",
                              cursor: "pointer", transition: "background-color 0.15s ease",
                            }} />
                          ))}
                        </div>
                        <ArrowBtn dir="right" onClick={() => setPremiumPage((p) => (p + 1) % premiumPages.length)} />
                      </div>
                      <div
                        style={{
                          marginTop: 18, padding: "11px", textAlign: "center",
                          fontSize: 13, fontWeight: 800, borderRadius: 8,
                          backgroundColor: "#81b64c", color: "#fff",
                          cursor: "pointer", transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#6fa33e"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#81b64c"; }}
                      >
                        Select
                      </div>
                    </div>
                  </div>
                );
              })()}
              </div>

              {/* Feature — Puzzle */}
              <div style={{ backgroundColor: "#1c1b19", borderRadius: 16, border: "1px solid #3d3a37", padding: "40px 44px", marginBottom: 32 }}>
                <div className="text-center" style={{ width: "100%", marginBottom: 24 }}>
                  <p className="font-extrabold" style={{ fontSize: 12, color: "#81b64c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                    Personalized Puzzles
                  </p>
                  <h2 className="font-extrabold" style={{ fontSize: 28, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>
                    Puzzles from your games.
                  </h2>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#9b9895", lineHeight: 1.75, marginBottom: 0 }}>
                    Every puzzle is a position where you missed the best move. Tagged by category and motif.
                  </p>
                </div>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, flexShrink: 0 }}>
                    <div
                      style={{
                        width: 300,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 10px",
                        backgroundColor: "#272522",
                        borderRadius: "8px 8px 0 0",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>Opponent</span>
                      <span style={{ fontSize: 11, color: "#a09d9a" }}>(1650)</span>
                      <span style={{ fontSize: 13, color: "#d1cfcc", marginLeft: 2 }}>{"\u2656"}</span>
                    </div>
                    <div style={{ width: 300, height: 300, overflow: "hidden" }}>
                      {mounted ? (
                        <Chessboard
                          options={{
                            position: "6k1/5pp1/2p4p/3p4/1P6/r5Pq/2Q2P1P/4R1K1 w - - 0 38",
                            boardOrientation: "white",
                            allowDragging: false,
                            darkSquareStyle: { backgroundColor: "#6596EB" },
                            lightSquareStyle: { backgroundColor: "#EAF1F8" },
                            arrows: [{ startSquare: "e1", endSquare: "e8", color: "rgba(105, 146, 62, 0.85)" }],
                          }}
                        />
                      ) : (
                        <div style={{ width: 300, height: 300, backgroundColor: "#272522" }} />
                      )}
                    </div>
                    <div
                      style={{
                        width: 300,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "5px 10px",
                        backgroundColor: "#272522",
                        borderRadius: "0 0 8px 8px",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>grandmother69</span>
                      <span style={{ fontSize: 11, color: "#a09d9a" }}>(1580)</span>
                    </div>
                    <div style={{
                      width: 300,
                      marginTop: 6,
                      padding: "7px 12px",
                      backgroundColor: "#f0d9b5",
                      borderRadius: 6,
                    }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#312e2b", margin: 0 }}>
                        Your turn — find the best move
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature — Player Card */}
              <div style={{ backgroundColor: "#1c1b19", borderRadius: 16, border: "1px solid #3d3a37", padding: "40px 44px", marginBottom: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 56, flexWrap: "wrap", justifyContent: "center" }}>
                <div className="text-center" style={{ width: "100%", marginBottom: 8 }}>
                  <p className="font-extrabold" style={{ fontSize: 12, color: "#81b64c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                    Generate Your Player Card
                  </p>
                  <h2 className="font-extrabold" style={{ fontSize: 28, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>
                    Your stats. One card.
                  </h2>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#9b9895", lineHeight: 1.75, marginBottom: 0 }}>
                    Six skill categories built from your real games, rated against players in your range.
                  </p>
                </div>
                <div style={{ pointerEvents: "none", flexShrink: 0 }}>
                  <PlayerCard
                    username="chesswithakeem"
                    avatarUrl="https://images.chesscomfiles.com/uploads/v1/user/89523040.0341f1a9.200x200o.0996111c0eec.jpeg"
                    countryCode="JM"
                    timeControl="blitz"
                    chessRating={2721}
                    peakRating={2721}
                    arenaStats={{
                      arenaRating: 89,
                      tier: "gold",
                      shiny: true,
                      categories: {
                        attacking: { stat: 90, percentage: 15.31, successRate: 56.93 },
                        defending: { stat: 85, percentage: 19.38, successRate: 59.29 },
                        tactics: { stat: 91, percentage: 29.61, successRate: 86.04 },
                        positional: { stat: 85, percentage: 37.93, successRate: 85.39 },
                        opening: { stat: 86, percentage: 29.92, successRate: 43.09 },
                        endgame: { stat: 83, percentage: 34.10, successRate: 26.09 },
                      },
                      form: 0,
                      backStats: {
                        accuracyOverall: 81.48,
                        accuracyWhite: 82.65,
                        accuracyBlack: 80.31,
                        blunderRate: 6.12,
                        missedWinRate: 2.61,
                        missedSaveRate: 3.34,
                      },
                      phaseAccuracy: { opening: null, middlegame: null, endgame: null },
                      gamesAnalyzed: 40,
                      record: { wins: 154, draws: 20, losses: 166 },
                    }}
                  />
                </div>
              </div>
              </div>

              {/* Feature 2 — Card Progression */}
              <div style={{ backgroundColor: "#1c1b19", borderRadius: 16, border: "1px solid #3d3a37", padding: "40px 44px", marginBottom: 32 }}>
                <div className="text-center" style={{ marginBottom: 28 }}>
                  <p className="font-extrabold" style={{ fontSize: 12, color: "#81b64c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                    Progression
                  </p>
                  <h2 className="font-extrabold" style={{ fontSize: 28, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>
                    Level up your card by winning games.
                  </h2>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#9b9895", lineHeight: 1.75 }}>
                    Your card evolves as you improve. Watch your stats climb and your tier change as you play games on chess.com.
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 32, flexWrap: "wrap" }}>
                  {/* Before card */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ pointerEvents: "none" }}>
                      <PlayerCard
                        username="chesswithakeem"
                        avatarUrl="https://images.chesscomfiles.com/uploads/v1/user/89523040.0341f1a9.200x200o.0996111c0eec.jpeg"
                        countryCode="JM"
                        timeControl="blitz"
                        chessRating={2200}
                        peakRating={2200}
                        arenaStats={{
                          arenaRating: 83,
                          tier: "gold",
                          shiny: false,
                          categories: {
                            attacking: { stat: 82, percentage: 15.31, successRate: 56.93 },
                            defending: { stat: 83, percentage: 19.38, successRate: 59.29 },
                            tactics: { stat: 88, percentage: 29.61, successRate: 86.04 },
                            positional: { stat: 80, percentage: 37.93, successRate: 85.39 },
                            opening: { stat: 80, percentage: 29.92, successRate: 44.85 },
                            endgame: { stat: 77, percentage: 34.10, successRate: 26.09 },
                          },
                          form: 0,
                          backStats: {
                            accuracyOverall: 79.2,
                            accuracyWhite: 80.1,
                            accuracyBlack: 78.3,
                            blunderRate: 7.8,
                            missedWinRate: 3.4,
                            missedSaveRate: 4.1,
                          },
                          phaseAccuracy: { opening: null, middlegame: null, endgame: null },
                      gamesAnalyzed: 40,
                          record: { wins: 68, draws: 12, losses: 80 },
                        }}
                      />
                    </div>
                  </div>

                  {/* Arrow between cards */}
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#81b64c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>

                  {/* After card (peak) with diff overlays */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                    <div style={{ pointerEvents: "none" }}>
                      <PlayerCard
                        username="chesswithakeem"
                        avatarUrl="https://images.chesscomfiles.com/uploads/v1/user/89523040.0341f1a9.200x200o.0996111c0eec.jpeg"
                        countryCode="JM"
                        timeControl="blitz"
                        chessRating={2721}
                        peakRating={2721}
                        arenaStats={{
                          arenaRating: 89,
                          tier: "gold",
                          shiny: true,
                          categories: {
                            attacking: { stat: 90, percentage: 15.31, successRate: 56.93 },
                            defending: { stat: 85, percentage: 19.38, successRate: 59.29 },
                            tactics: { stat: 91, percentage: 29.61, successRate: 86.04 },
                            positional: { stat: 85, percentage: 37.93, successRate: 85.39 },
                            opening: { stat: 86, percentage: 29.92, successRate: 43.09 },
                            endgame: { stat: 83, percentage: 34.10, successRate: 26.09 },
                          },
                          form: 0,
                          backStats: {
                            accuracyOverall: 81.48,
                            accuracyWhite: 82.65,
                            accuracyBlack: 80.31,
                            blunderRate: 6.12,
                            missedWinRate: 2.61,
                            missedSaveRate: 3.34,
                          },
                          phaseAccuracy: { opening: null, middlegame: null, endgame: null },
                      gamesAnalyzed: 40,
                          record: { wins: 154, draws: 20, losses: 166 },
                        }}
                        statDiffs={{
                          overall: 6,
                          attacking: 8,
                          defending: 2,
                          tactics: 3,
                          positional: 5,
                          opening: 6,
                          endgame: 6,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )
        )}
      </main>
    </div>
  );
}

// ── Form Graph (SVG) ──────────────────────────────────────────────────

function FormGraph({ games, chessRating }: { games: GameData[]; chessRating?: number }) {
  const [showResult, setShowResult] = useState(true);
  const [showAccuracy, setShowAccuracy] = useState(true);

  // Games come newest-first; reverse so graph reads left-to-right chronologically
  const chronological = [...games].reverse();

  // Build running form score: +1 win, 0 draw, -1 loss
  const points: number[] = [];
  let score = 0;
  for (const g of chronological) {
    if (g.result === "WIN") score += 1;
    else if (g.result === "LOSS") score -= 1;
    points.push(score);
  }

  // Build accuracy form: rolling 5-game average accuracy
  const WINDOW = 5;
  const gameAccuracy = (g: GameData): number | null => {
    if (g.accuracyWhite != null && g.accuracyBlack != null) return (g.accuracyWhite + g.accuracyBlack) / 2;
    return g.accuracyWhite ?? g.accuracyBlack ?? null;
  };
  const rawAccs = chronological.map(gameAccuracy);
  const rollingAcc: (number | null)[] = [];
  const accBuffer: number[] = [];
  for (const acc of rawAccs) {
    if (acc != null) accBuffer.push(acc);
    if (accBuffer.length > WINDOW) accBuffer.shift();
    rollingAcc.push(accBuffer.length > 0 ? accBuffer.reduce((s, v) => s + v, 0) / accBuffer.length : null);
  }

  const n = points.length;
  if (n === 0) return null;

  // Result form Y range (for left axis)
  const minVal = Math.min(...points, 0);
  const maxVal = Math.max(...points, 0);
  const range = Math.max(maxVal - minVal, 1);

  // Accuracy Y range (for right axis, fixed 0–100%)
  const validAccValues = rollingAcc.filter((a): a is number => a != null);
  const accMin = 0;
  const accMax = 100;
  const accRange = 100;

  // SVG dimensions — fixed height to prevent layout jumps on filter change
  const W = 700;
  const H = 280;
  const padX = 40;
  const padTop = 20;
  const padBottom = 36;
  const padRight = 46;
  const graphW = W - padX - padRight;
  const graphH = H - padTop - padBottom;
  const toX = (i: number) => padX + (i / Math.max(n - 1, 1)) * graphW;
  const toY = (v: number) => padTop + graphH - ((v - minVal) / range) * graphH;
  const toAccY = (v: number) => padTop + graphH - ((v - accMin) / accRange) * graphH;

  // Zero line Y
  const zeroY = toY(0);

  // Build result form line path
  const linePath = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(" ");

  // Build accuracy form line path (smooth, on its own scale)
  let accLinePath = "";
  let accStarted = false;
  for (let i = 0; i < n; i++) {
    const v = rollingAcc[i];
    if (v == null) { accStarted = false; continue; }
    accLinePath += `${!accStarted ? "M" : "L"} ${toX(i).toFixed(1)} ${toAccY(v).toFixed(1)} `;
    accStarted = true;
  }

  // Build filled area path (from result line down to zero)
  const areaPath =
    `M ${toX(0).toFixed(1)} ${zeroY.toFixed(1)} ` +
    points.map((v, i) => `L ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(" ") +
    ` L ${toX(n - 1).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  // Final form value for color
  const finalScore = points[n - 1];
  const lineColor = "#81b64c";
  const accColor = "#5b9bd5";
  const lastAcc = rollingAcc[n - 1];

  // Left Y-axis labels (result form)
  const yLabels: number[] = [];
  const step = Math.max(1, Math.ceil(range / 5));
  for (let v = Math.floor(minVal / step) * step; v <= maxVal; v += step) {
    yLabels.push(v);
  }

  // Right Y-axis labels (accuracy %)
  const accYLabels: number[] = [];
  const accStep = Math.max(1, Math.ceil(accRange / 4));
  for (let v = Math.floor(accMin / accStep) * accStep; v <= accMax; v += accStep) {
    accYLabels.push(Math.round(v));
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto" }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines + left Y-axis labels (result form) */}
      {yLabels.map((v) => (
        <g key={v}>
          <line
            x1={padX}
            y1={toY(v)}
            x2={W - padRight}
            y2={toY(v)}
            stroke={v === 0 ? "#4a4745" : "#3a3733"}
            strokeWidth={v === 0 ? 1.5 : 0.5}
            strokeDasharray={v === 0 ? undefined : "4 4"}
          />
          <text
            x={padX - 8}
            y={toY(v) + 4}
            textAnchor="end"
            fill="#6b6966"
            fontSize={11}
            fontWeight={600}
          >
            {v > 0 ? `+${v}` : v}
          </text>
        </g>
      ))}

      {/* Right Y-axis labels (accuracy %) */}
      {showAccuracy && accYLabels.map((v) => (
        <text
          key={`acc-${v}`}
          x={W - padRight + 8}
          y={toAccY(v) + 4}
          textAnchor="start"
          fill={accColor}
          fontSize={11}
          fontWeight={700}
          opacity={0.85}
        >
          {v}%
        </text>
      ))}

      {/* Result form: area + line + dots */}
      {showResult && (
        <>
          <path d={areaPath} fill={lineColor} opacity={0.08} />
          <path d={linePath} fill="none" stroke={lineColor} strokeWidth={n > 60 ? 2 : 2.5} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((v, i) => {
            if (n > 60) {
              const isFirst = i === 0;
              const isLast = i === n - 1;
              const prev = i > 0 ? points[i - 1] : v;
              const next = i < n - 1 ? points[i + 1] : v;
              const isExtreme = (v >= prev && v >= next) || (v <= prev && v <= next);
              const dirChange = i > 0 && i < n - 1 &&
                Math.sign(v - prev) !== 0 && Math.sign(next - v) !== 0 &&
                Math.sign(v - prev) !== Math.sign(next - v);
              if (!isFirst && !isLast && !isExtreme && !dirChange) return null;
            }
            const result = chronological[i].result;
            const dotColor = result === "WIN" ? "#81b64c" : result === "LOSS" ? "#e05252" : "#c27a30";
            const dotR = n > 60 ? 2.5 : 3.5;
            return (
              <circle
                key={i}
                cx={toX(i)}
                cy={toY(v)}
                r={dotR}
                fill={dotColor}
                stroke="#262421"
                strokeWidth={1}
              />
            );
          })}
        </>
      )}

      {/* Accuracy line */}
      {showAccuracy && accLinePath && (
        <path d={accLinePath} fill="none" stroke={accColor} strokeWidth={n > 60 ? 2 : 2.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      )}

      {/* Legend (clickable toggles) */}
      <g style={{ cursor: "pointer" }} onClick={() => setShowResult((v) => !v)} opacity={showResult ? 1 : 0.3}>
        <rect x={padX - 2} y={padTop - 16} width={58} height={14} fill="transparent" />
        <line x1={padX} y1={padTop - 8} x2={padX + 16} y2={padTop - 8} stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" />
        <text x={padX + 20} y={padTop - 4} fill={lineColor} fontSize={10} fontWeight={700}>Result</text>
      </g>
      <g style={{ cursor: "pointer" }} onClick={() => setShowAccuracy((v) => !v)} opacity={showAccuracy ? 1 : 0.3}>
        <rect x={padX + 60} y={padTop - 16} width={68} height={14} fill="transparent" />
        <line x1={padX + 62} y1={padTop - 8} x2={padX + 78} y2={padTop - 8} stroke={accColor} strokeWidth={2.5} strokeLinecap="round" />
        <text x={padX + 82} y={padTop - 4} fill={accColor} fontSize={10} fontWeight={700}>Accuracy</text>
      </g>

      {/* X-axis: rating at start, middle, end */}
      {[0, Math.floor((n - 1) / 2), n - 1].map((idx) => {
        // Estimate rating at each point: current rating minus remaining form delta
        const ratingAtPoint = chessRating
          ? Math.round(chessRating - (finalScore - points[idx]) * 8)
          : undefined;
        const anchor = idx === 0 ? "start" : idx === n - 1 ? "end" : "middle";
        return (
          <g key={`x-${idx}`}>
            {/* Tick mark */}
            <line
              x1={toX(idx)}
              y1={padTop + graphH}
              x2={toX(idx)}
              y2={padTop + graphH + 5}
              stroke="#4a4745"
              strokeWidth={1}
            />
            {/* Rating */}
            {ratingAtPoint != null && (
              <text
                x={toX(idx)}
                y={padTop + graphH + 18}
                textAnchor={anchor}
                fill="#9b9895"
                fontSize={11}
                fontWeight={700}
              >
                {ratingAtPoint}
              </text>
            )}
            {/* Game number */}
            <text
              x={toX(idx)}
              y={padTop + graphH + (ratingAtPoint != null ? 30 : 18)}
              textAnchor={anchor}
              fill="#6b6966"
              fontSize={9}
              fontWeight={600}
            >
              {idx === 0 ? "Game 1" : idx === n - 1 ? `Game ${n}` : `Game ${idx + 1}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

