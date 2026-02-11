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
  const { queriedUser, searchTrigger } = useUserContext();

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

  // Compare card state
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareUsername, setCompareUsername] = useState("");
  const [compareCards, setCompareCards] = useState<CardData[]>([]);
  const [compareProfile, setCompareProfile] = useState<ProfileData | null>(null);
  const [compareActiveIndex, setCompareActiveIndex] = useState(0);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareUser, setCompareUser] = useState("");

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
      // Step 1: Import rated games for all time controls in parallel
      const importPromises = TIME_CONTROLS.map((tc) =>
        fetch(`${API_BASE}/import/chesscom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user, timeCategory: tc, rated: true }),
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

  async function fetchCompare(user: string) {
    setCompareLoading(true);
    setCompareCards([]);
    setCompareProfile(null);
    setCompareUser(user);

    try {
      // Import rated games for all time controls
      await Promise.all(
        TIME_CONTROLS.map((tc) =>
          fetch(`${API_BASE}/import/chesscom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: user, timeCategory: tc, rated: true }),
          })
        )
      );

      // Fetch profile + ratings
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
          if (p.avatar) profileData.avatarUrl = p.avatar;
          if (p.country) {
            const parts = p.country.split("/");
            profileData.countryCode = parts[parts.length - 1];
          }
        }

        if (ratingsRes.ok) {
          const d = await ratingsRes.json();
          for (const tc of TIME_CONTROLS) {
            const key = `chess_${tc}`;
            if (d[key]?.last?.rating) ratings[tc] = d[key].last.rating;
            if (d[key]?.best?.rating) peakRatings[tc] = d[key].best.rating;
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
        // Non-critical
      }

      setCompareProfile(profileData);

      const cardTimeControls = TIME_CONTROLS.filter((tc) => ratings[tc]);
      if (cardTimeControls.length > 0) {
        const arenaPromises = cardTimeControls.map(async (tc) => {
          const params = new URLSearchParams();
          params.set("timeCategory", tc);
          params.set("chessRating", String(ratings[tc]));
          if (profileData.title) params.set("title", profileData.title);
          params.set("rated", "true");
          try {
            const res = await fetch(
              `${API_BASE}/users/${encodeURIComponent(user)}/arena-stats?${params}`
            );
            if (!res.ok) return null;
            const arenaStats: ArenaStatsData = await res.json();
            if (records[tc]) arenaStats.record = records[tc];
            return { timeControl: tc, chessRating: ratings[tc], peakRating: peakRatings[tc], arenaStats } as CardData;
          } catch {
            return null;
          }
        });

        const cardResults = await Promise.all(arenaPromises);
        const filtered = cardResults.filter((c): c is CardData => c !== null);
        // Order compare cards to match main player's card order
        const mainOrder = cards.map((c) => c.timeControl);
        const sorted = filtered.sort((a, b) => {
          const ai = mainOrder.indexOf(a.timeControl);
          const bi = mainOrder.indexOf(b.timeControl);
          // Cards not in main order go to the end
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });
        setCompareCards(sorted);
        setCompareActiveIndex(0);
      }
    } catch {
      // Non-critical
    } finally {
      setCompareLoading(false);
      setCompareOpen(false);
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
                      />
                    </div>
                  );
                })}
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

            {/* ── Compare card area ── */}
            {compareCards.length === 0 && !compareLoading ? (
              <div style={{ position: "relative", width: 240, height: 360, flexShrink: 0 }}>
                {/* Empty card outline */}
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 16,
                    border: "2px dashed #4a4745",
                    backgroundColor: "#2a2825",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onClick={() => setCompareOpen(!compareOpen)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#6b6966";
                    e.currentTarget.style.backgroundColor = "#302e2b";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#4a4745";
                    e.currentTarget.style.backgroundColor = "#2a2825";
                  }}
                >
                  {!compareOpen ? (
                    <>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          backgroundColor: "#3d3a37",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 28,
                          color: "#9b9895",
                          fontWeight: 300,
                        }}
                      >
                        +
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#9b9895" }}>
                        Compare Card
                      </span>
                    </>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = compareUsername.trim();
                        if (trimmed) fetchCompare(trimmed);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "0 20px", width: "100%" }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", letterSpacing: 1 }}>
                        Compare with
                      </span>
                      <input
                        type="text"
                        placeholder="username..."
                        value={compareUsername}
                        onChange={(e) => setCompareUsername(e.target.value)}
                        autoFocus
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          fontSize: 13,
                          fontWeight: 600,
                          borderRadius: 8,
                          border: "none",
                          backgroundColor: "#1c1b19",
                          color: "#fff",
                          outline: "none",
                          textAlign: "center",
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!compareUsername.trim()}
                        style={{
                          width: "100%",
                          padding: "9px",
                          fontSize: 13,
                          fontWeight: 800,
                          borderRadius: 8,
                          border: "none",
                          backgroundColor: "#81b64c",
                          color: "#fff",
                          cursor: compareUsername.trim() ? "pointer" : "not-allowed",
                          opacity: compareUsername.trim() ? 1 : 0.5,
                        }}
                      >
                        Load
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ) : compareLoading ? (
              <div style={{ width: 240, height: 360, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
                <div
                  className="h-8 w-8 animate-spin rounded-full border-4"
                  style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
                />
                <span style={{ fontSize: 12, fontWeight: 700, color: "#9b9895" }}>Loading {compareUsername}...</span>
              </div>
            ) : (
              /* ── Compare player carousel ── */
              <div className="flex items-center gap-4">
                {/* Left arrow */}
                {compareCards.length > 1 && (
                  <button
                    onClick={() => setCompareActiveIndex((i) => Math.max(0, i - 1))}
                    disabled={compareActiveIndex === 0}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: compareActiveIndex === 0 ? "#3d3a37" : "#4a4745",
                      color: compareActiveIndex === 0 ? "#6b6966" : "#d1cfcc",
                      border: "none",
                      cursor: compareActiveIndex === 0 ? "default" : "pointer",
                      fontSize: 20,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (compareActiveIndex !== 0) e.currentTarget.style.backgroundColor = "#5a5755";
                    }}
                    onMouseLeave={(e) => {
                      if (compareActiveIndex !== 0) e.currentTarget.style.backgroundColor = "#4a4745";
                    }}
                  >
                    &#8249;
                  </button>
                )}

                <div style={{ position: "relative" }}>
                  {/* Close button */}
                  <button
                    onClick={() => { setCompareCards([]); setCompareProfile(null); setCompareUser(""); setCompareUsername(""); }}
                    style={{
                      position: "absolute",
                      top: -10,
                      right: -10,
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      backgroundColor: "#4a4745",
                      color: "#d1cfcc",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 20,
                      lineHeight: 1,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#e05252"; e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#4a4745"; e.currentTarget.style.color = "#d1cfcc"; }}
                  >
                    &#215;
                  </button>

                  {/* Card stack */}
                  <div style={{ position: "relative", width: 240, height: 360 }}>
                    {compareCards.map((card, i) => {
                      const offset = i - compareActiveIndex;
                      if (offset < 0) return null;
                      const zIndex = compareCards.length - offset;
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
                            username={compareUser}
                            timeControl={card.timeControl}
                            chessRating={card.chessRating}
                            peakRating={card.peakRating}
                            title={compareProfile?.title}
                            countryCode={compareProfile?.countryCode}
                            avatarUrl={compareProfile?.avatarUrl}
                            arenaStats={card.arenaStats}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right arrow */}
                {compareCards.length > 1 && (
                  <button
                    onClick={() => setCompareActiveIndex((i) => Math.min(compareCards.length - 1, i + 1))}
                    disabled={compareActiveIndex === compareCards.length - 1}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: compareActiveIndex === compareCards.length - 1 ? "#3d3a37" : "#4a4745",
                      color: compareActiveIndex === compareCards.length - 1 ? "#6b6966" : "#d1cfcc",
                      border: "none",
                      cursor: compareActiveIndex === compareCards.length - 1 ? "default" : "pointer",
                      fontSize: 20,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s ease",
                      flexShrink: 0,
                      marginLeft: (compareCards.length - 1 - compareActiveIndex) * 30,
                    }}
                    onMouseEnter={(e) => {
                      if (compareActiveIndex !== compareCards.length - 1) e.currentTarget.style.backgroundColor = "#5a5755";
                    }}
                    onMouseLeave={(e) => {
                      if (compareActiveIndex !== compareCards.length - 1) e.currentTarget.style.backgroundColor = "#4a4745";
                    }}
                  >
                    &#8250;
                  </button>
                )}
              </div>
            )}
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

                <button
                  onClick={() => {
                    if (!queriedUser) return;
                    setGamesLoading(true);
                    (async () => {
                      try {
                        const statsParams = new URLSearchParams();
                        statsParams.set("timeCategory", gameTimeCategory);
                        if (gameRatedFilter !== "all") statsParams.set("rated", gameRatedFilter);
                        const [statsRes, gamesRes] = await Promise.all([
                          fetch(`${API_BASE}/users/${encodeURIComponent(queriedUser)}/stats?${statsParams}`),
                          fetch(`${API_BASE}/users/${encodeURIComponent(queriedUser)}/games?${new URLSearchParams({
                            limit: String(gameLimit),
                            timeCategory: gameTimeCategory,
                            ...(gameRatedFilter !== "all" ? { rated: gameRatedFilter } : {}),
                          })}`),
                        ]);
                        if (statsRes.ok) setStats(await statsRes.json());
                        if (gamesRes.ok) { const d = await gamesRes.json(); setGames(d.games); }
                      } catch { /* non-critical */ } finally { setGamesLoading(false); }
                    })();
                  }}
                  disabled={gamesLoading}
                  style={{
                    padding: "7px 14px",
                    fontSize: 12,
                    fontWeight: 800,
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#81b64c",
                    color: "#fff",
                    cursor: gamesLoading ? "not-allowed" : "pointer",
                    opacity: gamesLoading ? 0.6 : 1,
                    transition: "all 0.15s ease",
                    letterSpacing: 0.3,
                  }}
                  onMouseEnter={(e) => { if (!gamesLoading) e.currentTarget.style.backgroundColor = "#6a9a3e"; }}
                  onMouseLeave={(e) => { if (!gamesLoading) e.currentTarget.style.backgroundColor = "#81b64c"; }}
                >
                  {gamesLoading ? "Loading..." : "Generate"}
                </button>
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
                <FormGraph games={games} />
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

          </div>
        )}

        {/* Empty state */}
        {!stats && !loading && !error && (
          <div className="text-center py-24">
            <div style={{ fontSize: 48 }} className="mb-5">&#9813;</div>
            <p className="font-extrabold mb-3" style={{ color: "#fff", fontSize: 22 }}>
              Arena Player Card
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

// ── Form Graph (SVG) ──────────────────────────────────────────────────

function FormGraph({ games }: { games: GameData[] }) {
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

  const n = points.length;
  if (n === 0) return null;

  const minVal = Math.min(...points, 0);
  const maxVal = Math.max(...points, 0);
  const range = Math.max(maxVal - minVal, 1);

  // SVG dimensions
  const W = 700;
  const H = 200;
  const padX = 40;
  const padY = 20;
  const graphW = W - padX * 2;
  const graphH = H - padY * 2;

  const toX = (i: number) => padX + (i / Math.max(n - 1, 1)) * graphW;
  const toY = (v: number) => padY + graphH - ((v - minVal) / range) * graphH;

  // Zero line Y
  const zeroY = toY(0);

  // Build line path
  const linePath = points
    .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(" ");

  // Build filled area path (from line down to zero)
  const areaPath =
    `M ${toX(0).toFixed(1)} ${zeroY.toFixed(1)} ` +
    points.map((v, i) => `L ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(" ") +
    ` L ${toX(n - 1).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  // Final form value for color
  const finalScore = points[n - 1];
  const lineColor = finalScore > 0 ? "#81b64c" : finalScore < 0 ? "#e05252" : "#9b9895";

  // Y-axis labels
  const yLabels: number[] = [];
  const step = Math.max(1, Math.ceil(range / 5));
  for (let v = Math.floor(minVal / step) * step; v <= maxVal; v += step) {
    yLabels.push(v);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto" }}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines + Y labels */}
      {yLabels.map((v) => (
        <g key={v}>
          <line
            x1={padX}
            y1={toY(v)}
            x2={W - padX}
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

      {/* Filled area (subtle) */}
      <path d={areaPath} fill={lineColor} opacity={0.08} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots for each game */}
      {points.map((v, i) => {
        const result = chronological[i].result;
        const dotColor = result === "WIN" ? "#81b64c" : result === "LOSS" ? "#e05252" : "#c27a30";
        return (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(v)}
            r={3.5}
            fill={dotColor}
            stroke="#262421"
            strokeWidth={1.5}
          />
        );
      })}

      {/* Final score label */}
      <text
        x={toX(n - 1) + 10}
        y={toY(finalScore) + 4}
        fill={lineColor}
        fontSize={13}
        fontWeight={800}
      >
        {finalScore > 0 ? `+${finalScore}` : finalScore}
      </text>

      {/* X-axis label */}
      <text
        x={W / 2}
        y={H - 2}
        textAnchor="middle"
        fill="#6b6966"
        fontSize={10}
        fontWeight={600}
      >
        Last {n} games
      </text>
    </svg>
  );
}
