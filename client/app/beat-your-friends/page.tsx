"use client";

import { useState, useEffect, useRef } from "react";
import PlayerCard, { Arena GameStatsData } from "../PlayerCard";
import { useAuth } from "../AuthContext";
import SimulationGame from "./SimulationGame";

interface ProfileData {
  title?: string;
  countryCode?: string;
  avatarUrl?: string;
}

interface CardData {
  timeControl: "bullet" | "blitz" | "rapid";
  chessRating: number;
  peakRating?: number;
  arenaStats: Arena GameStatsData;
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
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareUser, setCompareUser] = useState("");

  // Simulation game
  const [simGameOpen, setSimGameOpen] = useState(false);
  const [simSidePicker, setSimSidePicker] = useState(false);
  const [simUserSide, setSimUserSide] = useState<"white" | "black">("white");

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
            const arenaStats: Arena GameStatsData = await res.json();
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
            const arenaStats: Arena GameStatsData = await res.json();
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
          Arena Game
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

        {/* Simulation Game (full-screen takeover) */}
        {simGameOpen && compareCards.length > 0 && (() => {
          const simTc = cards[activeIndex]?.timeControl || "blitz";
          const simCompareCard = compareCards.find((c) => c.timeControl === simTc);
          return (
            <SimulationGame
              opponentUsername={compareUser}
              opponentRating={simCompareCard?.chessRating}
              opponentSide={simUserSide === "white" ? "black" : "white"}
              opponentProfile={compareProfile || undefined}
              timeCategory={simTc}
              onClose={() => setSimGameOpen(false)}
            />
          );
        })()}

        {/* Cards row — Your Card + Compare Card */}
        {cards.length > 0 && !loading && !simGameOpen && (() => {
          // Time control tabs derived from the user's available cards
          const timeControls = cards.map((c) => c.timeControl);
          // Find the compare card matching the current time control
          const currentTc = cards[activeIndex]?.timeControl;
          const matchingCompareCard = compareCards.find((c) => c.timeControl === currentTc);

          return (
          <>
            {/* Time control tabs */}
            {timeControls.length > 1 && (
              <div className="flex justify-center gap-2">
                {timeControls.map((tc, i) => (
                  <button
                    key={tc}
                    onClick={() => setActiveIndex(i)}
                    style={{
                      padding: "8px 24px",
                      fontSize: 13,
                      fontWeight: 800,
                      borderRadius: 8,
                      border: "none",
                      backgroundColor: activeIndex === i ? "#4a4745" : "transparent",
                      color: activeIndex === i ? "#fff" : "#9b9895",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      textTransform: "capitalize",
                    }}
                    onMouseEnter={(e) => { if (activeIndex !== i) { e.currentTarget.style.backgroundColor = "#3d3a37"; e.currentTarget.style.color = "#fff"; } }}
                    onMouseLeave={(e) => { if (activeIndex !== i) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#9b9895"; } }}
                  >
                    {tc}
                  </button>
                ))}
              </div>
            )}

            <div className="flex justify-center items-center gap-10">
              {/* ── Your card ── */}
              <div style={{ width: 240, height: 360, flexShrink: 0 }}>
                <PlayerCard
                  username={authUser || ""}
                  timeControl={cards[activeIndex].timeControl}
                  chessRating={cards[activeIndex].chessRating}
                  peakRating={cards[activeIndex].peakRating}
                  title={profile?.title}
                  countryCode={profile?.countryCode}
                  avatarUrl={profile?.avatarUrl}
                  arenaStats={cards[activeIndex].arenaStats}
                />
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
                <div style={{ position: "relative", flexShrink: 0 }}>
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

                  <div style={{ width: 240, height: 360 }}>
                    {matchingCompareCard ? (
                      <PlayerCard
                        username={compareUser}
                        timeControl={matchingCompareCard.timeControl}
                        chessRating={matchingCompareCard.chessRating}
                        peakRating={matchingCompareCard.peakRating}
                        title={compareProfile?.title}
                        countryCode={compareProfile?.countryCode}
                        avatarUrl={compareProfile?.avatarUrl}
                        arenaStats={matchingCompareCard.arenaStats}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          borderRadius: 16,
                          backgroundColor: "#2a2825",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#6b6966" }}>
                          No {currentTc} data
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Simulation Game + Prediction ── */}
            <div className="flex flex-col items-center gap-6" style={{ marginTop: 32 }}>
              {/* Simulation Game button + side picker */}
              {!simSidePicker ? (
                <button
                  onClick={() => {
                    if (!compareUser || compareCards.length === 0) {
                      setCompareOpen(true);
                    } else {
                      setSimSidePicker(true);
                    }
                  }}
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
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>
                    Play as
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setSimUserSide("white");
                        setSimSidePicker(false);
                        setSimGameOpen(true);
                      }}
                      style={{
                        padding: "12px 28px",
                        fontSize: 15,
                        fontWeight: 800,
                        borderRadius: 10,
                        border: "2px solid #4a4745",
                        backgroundColor: "#f0d9b5",
                        color: "#312e2b",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#81b64c"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#4a4745"; }}
                    >
                      &#9812; White
                    </button>
                    <button
                      onClick={() => {
                        setSimUserSide("black");
                        setSimSidePicker(false);
                        setSimGameOpen(true);
                      }}
                      style={{
                        padding: "12px 28px",
                        fontSize: 15,
                        fontWeight: 800,
                        borderRadius: 10,
                        border: "2px solid #4a4745",
                        backgroundColor: "#b58863",
                        color: "#fff",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#81b64c"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#4a4745"; }}
                    >
                      &#9818; Black
                    </button>
                  </div>
                  <button
                    onClick={() => setSimSidePicker(false)}
                    className="text-xs font-bold mt-1"
                    style={{ color: "#6b6966", background: "none", border: "none", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              )}

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
          );
        })()}

        {/* Empty state — not logged in */}
        {!authUser && !authLoading && !loading && (
          <div className="text-center py-24">
            <p className="font-extrabold mb-3" style={{ color: "#fff", fontSize: 22 }}>
              Arena Game
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
