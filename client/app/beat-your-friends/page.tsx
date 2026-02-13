"use client";

import { useState, useEffect, useRef } from "react";
import PlayerCard, { ArenaStatsData } from "../PlayerCard";
import { useAuth } from "../AuthContext";

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

export default function BeatYourFriends() {
  const { authUser, authLoading } = useAuth();

  // Own cards
  const [cards, setCards] = useState<CardData[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  // Compare cards
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareUsername, setCompareUsername] = useState("");
  const [compareCards, setCompareCards] = useState<CardData[]>([]);
  const [compareProfile, setCompareProfile] = useState<ProfileData | null>(null);
  const [compareActiveIndex, setCompareActiveIndex] = useState(0);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareUser, setCompareUser] = useState("");

  // Auto-load own cards on mount
  const autoLoadFired = useRef(false);
  useEffect(() => {
    if (authLoading || !authUser || autoLoadFired.current) return;
    if (cards.length > 0 || loading) return;
    autoLoadFired.current = true;
    fetchOwnCards(authUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, authLoading]);

  async function fetchOwnCards(user: string) {
    setLoading(true);
    setError("");
    setCards([]);
    setProfile(null);
    setStatusMsg("Importing games from chess.com...");

    try {
      // Import rated games for all time controls
      const importResults = await Promise.all(
        TIME_CONTROLS.map((tc) =>
          fetch(`${API_BASE}/import/chesscom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: user, timeCategory: tc, rated: true, maxGames: 100 }),
          })
        )
      );
      const anyOk = importResults.some((r) => r.ok);
      if (!anyOk) {
        const body = await importResults[0].json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importResults[0].status})`);
      }

      // Fetch profile + ratings
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

      setProfile(profileData);

      // Build arena cards
      const cardTimeControls = TIME_CONTROLS.filter((tc) => ratings[tc]);
      setStatusMsg("Building arena cards...");

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
        const sorted = cardResults
          .filter((c): c is CardData => c !== null)
          .sort((a, b) => b.chessRating - a.chessRating);
        setCards(sorted);
        setActiveIndex(0);
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
      await Promise.all(
        TIME_CONTROLS.map((tc) =>
          fetch(`${API_BASE}/import/chesscom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: user, timeCategory: tc, rated: true, maxGames: 100 }),
          })
        )
      );

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
        const mainOrder = cards.map((c) => c.timeControl);
        const sorted = filtered.sort((a, b) => {
          const ai = mainOrder.indexOf(a.timeControl);
          const bi = mainOrder.indexOf(b.timeControl);
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
        {/* Heading */}
        <h1 className="text-center font-extrabold" style={{ fontSize: 28, color: "#fff" }}>
          Beat your friends
        </h1>

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

        {/* Cards row — Your Card + Compare Card */}
        {cards.length > 0 && !loading && (
          <>
            <div className="flex justify-center items-center gap-10">
              {/* ── Your card carousel ── */}
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
                          username={authUser || ""}
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

            {/* ── Simulation Game + Prediction ── */}
            <div className="flex flex-col items-center gap-6" style={{ marginTop: 32 }}>
              {/* Simulation Game button */}
              <button
                onClick={() => {}}
                style={{
                  padding: "14px 48px",
                  fontSize: 16,
                  fontWeight: 800,
                  borderRadius: 10,
                  border: "none",
                  backgroundColor: "#81b64c",
                  color: "#fff",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  letterSpacing: "0.01em",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#6fa33e"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#81b64c"; }}
              >
                Simulation Game
              </button>

              {/* Win / Draw / Loss prediction row */}
              <div className="grid grid-cols-3 gap-4" style={{ width: "100%", maxWidth: 480 }}>
                <div className="p-5 text-center" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#81b64c", marginBottom: 6 }}>Win</p>
                  <p className="font-extrabold" style={{ color: "#fff", fontSize: 24 }}>&mdash;</p>
                </div>
                <div className="p-5 text-center" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#c27a30", marginBottom: 6 }}>Draw</p>
                  <p className="font-extrabold" style={{ color: "#fff", fontSize: 24 }}>&mdash;</p>
                </div>
                <div className="p-5 text-center" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#e05252", marginBottom: 6 }}>Lose</p>
                  <p className="font-extrabold" style={{ color: "#fff", fontSize: 24 }}>&mdash;</p>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Empty state — not logged in */}
        {!authUser && !authLoading && !loading && (
          <div className="text-center py-24">
            <p className="font-extrabold mb-3" style={{ color: "#fff", fontSize: 22 }}>
              Beat your friends
            </p>
            <p className="font-bold" style={{ color: "#9b9895", fontSize: 15 }}>
              Log in to compare your arena cards with friends.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
