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

type PhaseTriple = { opening: number; middlegame: number; endgame: number };
type PhaseResultTriple = { opening: { wins: number; draws: number; losses: number }; middlegame: { wins: number; draws: number; losses: number }; endgame: { wins: number; draws: number; losses: number } };

interface TargetStatsData {
  targetArenaRating: number;
  targetTier: string;
  targetShiny: boolean;
  expectedPhaseAccuracy: PhaseTriple;
  expectedBestMoveRate: PhaseTriple;
  expectedBlunderRate?: PhaseTriple;
  expectedMissedWinRate?: PhaseTriple;
  expectedMissedSaveRate?: PhaseTriple;
  expectedAccuracyByResult?: PhaseResultTriple;
  expectedCategoryStats: Record<string, number>;
}

interface SideResults {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  accuracy: number | null;
}

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
  byColor?: {
    white: SideResults;
    black: SideResults;
  };
  accuracy: {
    white: number | null;
    black: number | null;
    overall: number | null;
    overallAvg?: number | null;
    overallMedian?: number | null;
  };
}

interface GameData {
  id: number;
  endTime: string;
  timeControl: string;
  result: "WIN" | "LOSS" | "DRAW";
  accuracyWhite: number | null;
  accuracyBlack: number | null;
  opponent?: string | null;
  playerSide?: "white" | "black" | null;
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
  const [gameSideFilter, setGameSideFilter] = useState("all");
  const [gamePhasesOpen, setGamePhasesOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [skillCategoriesOpen, setSkillCategoriesOpen] = useState(false);
  const [graphsOpen, setGraphsOpen] = useState(false);
  const [tacticsOpen, setTacticsOpen] = useState(false);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [gameLimit] = useState(100);
  const [importedCategories, setImportedCategories] = useState<Set<string>>(new Set());
  const [reportArenaStats, setReportArenaStats] = useState<ArenaStatsData | null>(null);

  const cardFrontRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [freePage, setFreePage] = useState(0);
  const [premiumPage, setPremiumPage] = useState(0);
  const [targetRating, setTargetRating] = useState<number | null>(null);
  const [targetStats, setTargetStats] = useState<TargetStatsData | null>(null);
  const [savedTarget, setSavedTarget] = useState<number | null>(null);
  const targetDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const loadStartRef = useRef<number>(0);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastTriggerRef = useRef(0);

  // ── Target rating persistence ──
  const TARGET_KEY = (user: string, tc: string) => `arena_target_${user.toLowerCase()}_${tc}`;

  function saveTarget(user: string, tc: string, rating: number) {
    try { localStorage.setItem(TARGET_KEY(user, tc), String(rating)); } catch { /* */ }
  }

  function loadTarget(user: string, tc: string): number | null {
    try {
      const v = localStorage.getItem(TARGET_KEY(user, tc));
      return v ? Number(v) : null;
    } catch { return null; }
  }

  function clearSavedTarget(user: string, tc: string) {
    try { localStorage.removeItem(TARGET_KEY(user, tc)); } catch { /* */ }
  }

  // Load saved target when user or active card changes
  useEffect(() => {
    if (!queriedUser || cards.length === 0) return;
    const activeCard = cards[activeIndex];
    if (!activeCard) return;
    const saved = loadTarget(queriedUser, activeCard.timeControl);
    setSavedTarget(saved);
    setTargetRating(saved);
    setReportArenaStats(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queriedUser, activeIndex, cards]);

  // ── Cache helpers ──
  const CACHE_KEY = (user: string) => `arena_cache_v3_${user.toLowerCase()}`;
  const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  function saveToCache(user: string, data: { cards: CardData[]; stats: StatsData; profile: ProfileData; games: GameData[] }) {
    try {
      localStorage.setItem(CACHE_KEY(user), JSON.stringify({ ...data, timestamp: Date.now() }));
    } catch { /* quota exceeded etc */ }
  }

  function loadFromCache(user: string): { cards: CardData[]; stats: StatsData; profile: ProfileData; games: GameData[]; timestamp: number } | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY(user));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.timestamp > CACHE_TTL) {
        localStorage.removeItem(CACHE_KEY(user));
        return null;
      }
      return parsed;
    } catch { return null; }
  }

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!queriedUser || searchTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = searchTrigger;
    const cached = loadFromCache(queriedUser);
    if (cached) {
      setCards(cached.cards);
      setStats(cached.stats);
      setProfile(cached.profile);
      setGames(cached.games);
      setActiveIndex(0);
      setLoading(false);
      setReportArenaStats(null);
      setImportedCategories(new Set(cached.cards.map((c: CardData) => c.timeControl)));
      if (cached.cards[0]) setGameTimeCategory(cached.cards[0].timeControl);
      // Refresh in background
      fetchStats(queriedUser, true);
    } else {
      fetchStats(queriedUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // Auto-fetch on mount if queriedUser is already set (tab switch)
  useEffect(() => {
    if (queriedUser && !stats && !loading) {
      const cached = loadFromCache(queriedUser);
      if (cached) {
        setCards(cached.cards);
        setStats(cached.stats);
        setProfile(cached.profile);
        setGames(cached.games);
        setActiveIndex(0);
        setReportArenaStats(null);
        setImportedCategories(new Set(cached.cards.map((c: CardData) => c.timeControl)));
        if (cached.cards[0]) setGameTimeCategory(cached.cards[0].timeControl);
        // Refresh in background
        fetchStats(queriedUser, true);
      } else {
        fetchStats(queriedUser);
      }
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
    const cached = loadFromCache(authUser);
    if (cached) {
      setCards(cached.cards);
      setStats(cached.stats);
      setProfile(cached.profile);
      setGames(cached.games);
      setActiveIndex(0);
      setReportArenaStats(null);
      setImportedCategories(new Set(cached.cards.map((c: CardData) => c.timeControl)));
      if (cached.cards[0]) setGameTimeCategory(cached.cards[0].timeControl);
      // Refresh in background
      fetchStats(authUser, true);
    } else {
      fetchStats(authUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, authLoading, queriedUser, stats, loading]);

  async function fetchStats(user: string, background = false) {
    if (!background) {
      setLoading(true);
      setError("");
      setStats(null);
      setGames([]);
      setProfile(null);
      setCards([]);
      setReportArenaStats(null);
      setStatusMsg("Importing games from chess.com...");
      setShowProgress(false);
      loadStartRef.current = Date.now();
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      progressTimerRef.current = setTimeout(() => setShowProgress(true), 5000);
    }

    try {
      // Step 1: Fetch chess.com profile + ratings FIRST (fast, public API)
      if (!background) setStatusMsg("Fetching player profile...");
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

      // Step 2: Determine default TC = highest-rated
      const cardTimeControls = TIME_CONTROLS.filter((tc) => ratings[tc]);
      const sortedTCs = [...cardTimeControls].sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));
      const defaultTC = sortedTCs.length > 0 ? sortedTCs[0] : "blitz";

      // Step 3: Import ONLY the default TC (fast path)
      if (!background) setStatusMsg("Importing games from chess.com...");
      const importRes = await fetch(`${API_BASE}/import/chesscom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, timeCategory: defaultTC, rated: true, maxGames: 200 }),
      });
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importRes.status})`);
      }

      // Mark this TC as imported
      setImportedCategories(new Set([defaultTC]));

      // Step 4: Build arena card for the default TC + fetch stats → show results
      if (!background) setStatusMsg("Building arena card...");

      // Helper to build a card for a single TC
      const buildCard = async (tc: string): Promise<CardData | null> => {
        if (!ratings[tc]) return null;
        const params = new URLSearchParams();
        params.set("timeCategory", tc);
        params.set("chessRating", String(ratings[tc]));
        if (profileData.title) params.set("title", profileData.title);
        params.set("rated", "true");
        try {
          const res = await fetch(`${API_BASE}/users/${encodeURIComponent(user)}/arena-stats?${params}`);
          if (!res.ok) return null;
          const arenaStats: ArenaStatsData = await res.json();
          if (records[tc]) arenaStats.record = records[tc];
          return { timeControl: tc as "bullet" | "blitz" | "rapid", chessRating: ratings[tc], peakRating: peakRatings[tc], arenaStats };
        } catch { return null; }
      };

      const defaultCard = await buildCard(defaultTC);
      if (defaultCard) {
        setCards([defaultCard]);
        if (!background) setActiveIndex(0);
      }

      // Sync dropdown to match the default TC
      if (!background) setGameTimeCategory(defaultTC);

      // Step 5: Fetch stats + games for the default TC
      if (!background) setStatusMsg("Fetching stats...");
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
      let gamesData: GameData[] = [];
      if (gamesRes.ok) {
        const gd = await gamesRes.json();
        gamesData = gd.games;
        setGames(gamesData);
      }

      // Save to cache
      setCards((currentCards) => {
        if (currentCards.length > 0) {
          saveToCache(user, { cards: currentCards, stats: data, profile: profileData, games: gamesData });
        }
        return currentCards;
      });

      // Step 6: Fire-and-forget — import remaining TCs in background, build their cards
      const remainingTCs = sortedTCs.filter((tc) => tc !== defaultTC);
      if (remainingTCs.length > 0) {
        // Don't await — let this run in background
        Promise.all(
          remainingTCs.map(async (tc) => {
            try {
              await fetch(`${API_BASE}/import/chesscom`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: user, timeCategory: tc, rated: true, maxGames: 200 }),
              });
              setImportedCategories((prev) => new Set([...prev, tc]));

              const card = await buildCard(tc);
              if (card) {
                setCards((prev) => {
                  const existing = prev.filter((c) => c.timeControl !== tc);
                  const updated = [...existing, card].sort((a, b) => b.chessRating - a.chessRating);
                  return updated;
                });
              }
            } catch { /* background import failure is non-critical */ }
          })
        );
      }
    } catch (err) {
      if (!background) setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (!background) {
        setLoading(false);
        setStatusMsg("");
        setShowProgress(false);
        if (progressTimerRef.current) { clearTimeout(progressTimerRef.current); progressTimerRef.current = null; }
      }
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
      if (gameSideFilter !== "all") arenaParams.set("playerSide", gameSideFilter);

      // Build target-stats fetch if target rating is set
      const targetFetchPromise = targetRating != null
        ? fetch(`${API_BASE}/target-stats?${new URLSearchParams({
            targetRating: String(targetRating),
            timeCategory: gameTimeCategory,
          })}`)
        : null;

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
      if (arenaRes.ok) {
        const arenaStats: ArenaStatsData = await arenaRes.json();
        setReportArenaStats(arenaStats);
      }
      if (targetFetchPromise) {
        const targetRes = await targetFetchPromise;
        if (targetRes.ok) setTargetStats(await targetRes.json());
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

  // Auto-refresh report when any filter changes (with import-on-switch for TC)
  const reportInitialized = useRef(false);
  useEffect(() => {
    if (!reportInitialized.current) {
      reportInitialized.current = true;
      return;
    }

    // If the TC hasn't been imported yet, import it first
    if (!importedCategories.has(gameTimeCategory) && queriedUser) {
      let cancelled = false;
      setGamesLoading(true);
      (async () => {
        try {
          await fetch(`${API_BASE}/import/chesscom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: queriedUser, timeCategory: gameTimeCategory, rated: true, maxGames: 200 }),
          });
          if (cancelled) return;
          setImportedCategories((prev) => new Set([...prev, gameTimeCategory]));
          await refreshReport();
        } catch {
          if (!cancelled) setGamesLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    refreshReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameTimeCategory, gameRatedFilter, gameSideFilter]);

  // Fetch target stats (debounced)
  useEffect(() => {
    if (targetDebounceRef.current) clearTimeout(targetDebounceRef.current);
    if (targetRating == null || cards.length === 0) {
      setTargetStats(null);
      return;
    }
    const activeCard = cards[activeIndex];
    if (!activeCard) return;
    targetDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          targetRating: String(targetRating),
          timeCategory: activeCard.timeControl,
        });
        const res = await fetch(`${API_BASE}/target-stats?${params}`);
        if (res.ok) setTargetStats(await res.json());
      } catch { /* non-critical */ }
    }, 300);
    return () => { if (targetDebounceRef.current) clearTimeout(targetDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRating, activeIndex, cards]);

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
            {showProgress && (() => {
              const STEPS: { msg: string; pct: number }[] = [
                { msg: "Importing games from chess.com...", pct: 15 },
                { msg: "Fetching player profile...", pct: 40 },
                { msg: "Building arena cards...", pct: 65 },
                { msg: "Fetching stats...", pct: 85 },
              ];
              const currentStep = STEPS.findIndex((s) => s.msg === statusMsg);
              const basePct = currentStep >= 0 ? STEPS[currentStep].pct : 10;
              const nextPct = currentStep >= 0 && currentStep < STEPS.length - 1 ? STEPS[currentStep + 1].pct : 95;
              // Slowly animate within the current step
              const elapsed = (Date.now() - loadStartRef.current) / 1000;
              const stepProgress = Math.min(0.8, (elapsed % 15) / 15);
              const pct = Math.min(95, basePct + (nextPct - basePct) * stepProgress);

              return (
                <div style={{ width: 280, marginTop: 8 }}>
                  <div style={{
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: "#1c1b19",
                    overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${pct}%`,
                      borderRadius: 2,
                      backgroundColor: "#81b64c",
                      transition: "width 1s ease",
                    }} />
                  </div>
                  <p style={{
                    textAlign: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#6b6966",
                    marginTop: 6,
                  }}>
                    This may take a moment on first load
                  </p>
                </div>
              );
            })()}
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
        {cards.length > 0 && !loading && (() => {
          const activeCard = cards[activeIndex];
          const currentArena = activeCard?.arenaStats.arenaRating ?? 0;
          const currentTier = activeCard?.arenaStats.tier ?? "bronze";
          const currentCategories = activeCard?.arenaStats.categories;
          const currentRating = activeCard?.chessRating ?? 0;

          // Build fictive target card arenaStats
          const buildTargetArenaStats = (): ArenaStatsData | null => {
            if (!targetStats) return null;
            const tRating = targetStats.targetArenaRating;
            const catKeys = ["attacking", "defending", "tactics", "strategic", "opening", "endgame"] as const;
            const cats = {} as ArenaStatsData["categories"];
            for (const key of catKeys) {
              cats[key] = { stat: targetStats.expectedCategoryStats?.[key] ?? tRating, percentage: 0, successRate: 0 };
            }
            return {
              arenaRating: tRating,
              tier: targetStats.targetTier as ArenaStatsData["tier"],
              shiny: targetStats.targetShiny,
              categories: cats,
              form: 0,
              backStats: { accuracyOverall: null, accuracyWhite: null, accuracyBlack: null, blunderRate: 0, missedWinRate: 0, missedSaveRate: 0 },
              phaseAccuracy: {
                opening: targetStats.expectedPhaseAccuracy.opening,
                middlegame: targetStats.expectedPhaseAccuracy.middlegame,
                endgame: targetStats.expectedPhaseAccuracy.endgame,
              },
              gamesAnalyzed: 0,
            };
          };

          const buildStatDiffs = () => {
            if (!targetStats || !currentCategories) return undefined;
            const tRating = targetStats.targetArenaRating;
            const expectedCats = targetStats.expectedCategoryStats;
            const form = activeCard?.arenaStats.form ?? 0;
            const catDiff = (key: keyof typeof currentCategories) =>
              (expectedCats?.[key] ?? tRating) - ((currentCategories[key]?.stat ?? currentArena) + form);
            return {
              overall: tRating - (currentArena + form),
              attacking: catDiff("attacking"),
              defending: catDiff("defending"),
              tactics: catDiff("tactics"),
              strategic: catDiff("strategic"),
              opening: catDiff("opening"),
              endgame: catDiff("endgame"),
            };
          };

          const fictiveStats = buildTargetArenaStats();
          const statDiffs = buildStatDiffs();

          const handleRatingChange = (r: number) => {
            if (r === 0) {
              setTargetRating(null);
            } else if (targetRating == null && r <= 500) {
              // Spinner arrow from empty — start near current rating instead of min
              setTargetRating(currentRating + 200);
            } else {
              setTargetRating(r);
            }
          };

          return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>

            {/* Cards row */}
            <div style={{ display: "flex", justifyContent: "center", alignItems: "start", gap: 144 }}>

              {/* ── Main player carousel ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* Left arrow */}
                {cards.length > 1 && (
                  <button
                    onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                    disabled={activeIndex === 0}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      backgroundColor: "transparent",
                      color: activeIndex === 0 ? "#4a4745" : "#9b9895",
                      border: activeIndex === 0 ? "1px solid #3d3a3700" : "1px solid #4a474540",
                      cursor: activeIndex === 0 ? "default" : "pointer",
                      fontSize: 16,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (activeIndex !== 0) { e.currentTarget.style.color = "#d1cfcc"; e.currentTarget.style.borderColor = "#6b696640"; }
                    }}
                    onMouseLeave={(e) => {
                      if (activeIndex !== 0) { e.currentTarget.style.color = "#9b9895"; e.currentTarget.style.borderColor = "#4a474540"; }
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
                    const translateX = offset * 44;
                    const scale = 1 - offset * 0.04;
                    const cardOpacity = offset === 0 ? 1 : Math.max(0.3, 1 - offset * 0.35);

                    return (
                      <div
                        key={card.timeControl}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          zIndex,
                          transform: `translateX(${translateX}px) scale(${scale})`,
                          opacity: cardOpacity,
                          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
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

                {/* Right arrow */}
                {cards.length > 1 && (
                  <button
                    onClick={() => setActiveIndex((i) => Math.min(cards.length - 1, i + 1))}
                    disabled={activeIndex === cards.length - 1}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      backgroundColor: "transparent",
                      color: activeIndex === cards.length - 1 ? "#4a4745" : "#9b9895",
                      border: activeIndex === cards.length - 1 ? "1px solid #3d3a3700" : "1px solid #4a474540",
                      cursor: activeIndex === cards.length - 1 ? "default" : "pointer",
                      fontSize: 16,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s ease",
                      flexShrink: 0,
                      marginLeft: (cards.length - 1 - activeIndex) * 24,
                    }}
                    onMouseEnter={(e) => {
                      if (activeIndex !== cards.length - 1) { e.currentTarget.style.color = "#d1cfcc"; e.currentTarget.style.borderColor = "#6b696640"; }
                    }}
                    onMouseLeave={(e) => {
                      if (activeIndex !== cards.length - 1) { e.currentTarget.style.color = "#9b9895"; e.currentTarget.style.borderColor = "#4a474540"; }
                    }}
                  >
                    &#8250;
                  </button>
                )}
              </div>

              {/* ── Target Rating Card ── */}
              <div style={{ flexShrink: 0 }}>
                <div style={{
                  filter: "saturate(0.45) brightness(0.92)",
                  opacity: 0.85,
                  transition: "all 0.4s ease",
                  border: "2px solid #000",
                  borderRadius: 14,
                }}>
                  <PlayerCard
                    username={queriedUser}
                    timeControl={activeCard?.timeControl ?? ""}
                    chessRating={targetRating ?? 0}
                    title={profile?.title}
                    countryCode={profile?.countryCode}
                    avatarUrl={profile?.avatarUrl}
                    arenaStats={fictiveStats ?? activeCard?.arenaStats ?? ({} as ArenaStatsData)}
                    statDiffs={statDiffs}
                    editableRating
                    onRatingChange={handleRatingChange}
                    ratingPlaceholder={String(currentRating + 200)}
                  />
                </div>
                {/* Set / Clear target button */}
                <div style={{ display: "flex", justifyContent: "center", marginTop: 8, gap: 6 }}>
                  {targetRating != null && targetRating > 0 && (
                    <>
                      {savedTarget !== targetRating ? (
                        <button
                          onClick={() => {
                            if (activeCard) {
                              saveTarget(queriedUser, activeCard.timeControl, targetRating);
                              setSavedTarget(targetRating);
                            }
                          }}
                          style={{
                            padding: "5px 14px",
                            fontSize: 11,
                            fontWeight: 800,
                            borderRadius: 6,
                            border: "none",
                            backgroundColor: "#81b64c",
                            color: "#fff",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#6fa33e"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#81b64c"; }}
                        >
                          Set Target
                        </button>
                      ) : (
                        <span style={{
                          padding: "5px 14px",
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#81b64c",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          Target Set
                        </span>
                      )}
                      {savedTarget != null && (
                        <button
                          onClick={() => {
                            if (activeCard) {
                              clearSavedTarget(queriedUser, activeCard.timeControl);
                              setSavedTarget(null);
                              setTargetRating(null);
                              setTargetStats(null);
                            }
                          }}
                          style={{
                            padding: "5px 10px",
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: 6,
                            border: "none",
                            backgroundColor: "#3d3a37",
                            color: "#9b9895",
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#4a4745"; e.currentTarget.style.color = "#fff"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#3d3a37"; e.currentTarget.style.color = "#9b9895"; }}
                        >
                          Clear
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Download button — centered below cards */}
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
              <button
                onClick={(e) => { e.stopPropagation(); downloadCardImage(); }}
                disabled={downloading}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: "transparent",
                  color: downloading ? "#4a4745" : "#6b6966",
                  border: "none",
                  cursor: downloading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s ease",
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  if (!downloading) e.currentTarget.style.color = "#9b9895";
                }}
                onMouseLeave={(e) => {
                  if (!downloading) e.currentTarget.style.color = "#6b6966";
                }}
                title="Download card as image"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v8M8 10L5 7M8 10l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

          </div>
          );
        })()}

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
                <select
                  value={gameSideFilter}
                  onChange={(e) => setGameSideFilter(e.target.value)}
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
                  <option value="all">Both Sides</option>
                  <option value="white">White</option>
                  <option value="black">Black</option>
                </select>
              </div>
            </div>

            {/* Overview — collapsible */}
            <div>
              <button
                onClick={() => setOverviewOpen((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  marginBottom: overviewOpen ? 16 : 0,
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="#9b9895"
                  style={{
                    transition: "transform 0.2s",
                    transform: overviewOpen ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                >
                  <path d="M4 2l4 4-4 4" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Overview</span>
              </button>
              {overviewOpen && (() => {
                const w = stats.byColor?.white;
                const b = stats.byColor?.black;
                const rowStyle = { display: "flex", justifyContent: "space-between", padding: "6px 0" } as const;
                const labelStyle = { color: "#9b9895", fontSize: 13, fontWeight: 700 } as const;
                const valStyle = { fontSize: 13, fontWeight: 700 } as const;
                return (
                  <div className="flex flex-col gap-5">
                    {/* Summary row: Total / Wins / Losses / Draws */}
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

                    {/* By-color breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      {/* As White */}
                      <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895", marginBottom: 12 }}>As White</p>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Games</span>
                          <span style={{ ...valStyle, color: "#fff" }}>{w?.total ?? 0}</span>
                        </div>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Wins</span>
                          <span style={{ ...valStyle, color: "#81b64c" }}>{w?.wins ?? 0} <span style={{ color: "#d1cfcc" }}>({w?.winRate ?? 0}%)</span></span>
                        </div>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Losses</span>
                          <span style={{ ...valStyle, color: "#e05252" }}>{w?.losses ?? 0} <span style={{ color: "#d1cfcc" }}>({w?.lossRate ?? 0}%)</span></span>
                        </div>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Draws</span>
                          <span style={{ ...valStyle, color: "#c27a30" }}>{w?.draws ?? 0} <span style={{ color: "#d1cfcc" }}>({w?.drawRate ?? 0}%)</span></span>
                        </div>
                        <div style={{ ...rowStyle, borderTop: "1px solid #3d3a37", marginTop: 4, paddingTop: 10 }}>
                          <span style={labelStyle}>Accuracy</span>
                          <span style={{ ...valStyle, color: "#fff" }}>{w?.accuracy != null ? `${w.accuracy}%` : "N/A"}</span>
                        </div>
                      </div>

                      {/* As Black */}
                      <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895", marginBottom: 12 }}>As Black</p>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Games</span>
                          <span style={{ ...valStyle, color: "#fff" }}>{b?.total ?? 0}</span>
                        </div>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Wins</span>
                          <span style={{ ...valStyle, color: "#81b64c" }}>{b?.wins ?? 0} <span style={{ color: "#d1cfcc" }}>({b?.winRate ?? 0}%)</span></span>
                        </div>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Losses</span>
                          <span style={{ ...valStyle, color: "#e05252" }}>{b?.losses ?? 0} <span style={{ color: "#d1cfcc" }}>({b?.lossRate ?? 0}%)</span></span>
                        </div>
                        <div style={rowStyle}>
                          <span style={labelStyle}>Draws</span>
                          <span style={{ ...valStyle, color: "#c27a30" }}>{b?.draws ?? 0} <span style={{ color: "#d1cfcc" }}>({b?.drawRate ?? 0}%)</span></span>
                        </div>
                        <div style={{ ...rowStyle, borderTop: "1px solid #3d3a37", marginTop: 4, paddingTop: 10 }}>
                          <span style={labelStyle}>Accuracy</span>
                          <span style={{ ...valStyle, color: "#fff" }}>{b?.accuracy != null ? `${b.accuracy}%` : "N/A"}</span>
                        </div>
                      </div>
                    </div>

                    {/* Overall accuracy — average & median */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Average Accuracy</p>
                        <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 32 }}>
                          {stats.accuracy.overallAvg != null ? `${stats.accuracy.overallAvg}%` : "N/A"}
                        </p>
                      </div>
                      <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Median Accuracy</p>
                        <p className="mt-2 font-extrabold" style={{ color: "#fff", fontSize: 32 }}>
                          {stats.accuracy.overallMedian != null ? `${stats.accuracy.overallMedian}%` : "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Graphs */}
            <div>
              <button
                onClick={() => setGraphsOpen((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  marginBottom: graphsOpen ? 16 : 0,
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="#9b9895"
                  style={{
                    transition: "transform 0.2s",
                    transform: graphsOpen ? "rotate(90deg)" : "rotate(0deg)",
                  }}
                >
                  <path d="M4 2l4 4-4 4" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Graphs</span>
              </button>
              {graphsOpen && games.length > 0 && !gamesLoading && (
                <div className="flex flex-col gap-5">
                  <div className="p-6" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                    <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895", marginBottom: 16 }}>Accuracy by Result</p>
                    <FormGraph games={games} chessRating={cards.find((c) => c.timeControl === gameTimeCategory)?.chessRating} />
                  </div>
                </div>
              )}
            </div>
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
              const effectiveArena = reportArenaStats ?? cards[activeIndex]?.arenaStats;
              const phaseAccuracy = effectiveArena?.phaseAccuracy;
              const phaseAccVsExpected = effectiveArena?.phaseAccuracyVsExpected;
              const phaseBestMove = effectiveArena?.phaseBestMoveRate;
              const phaseBestMoveVsExpected = effectiveArena?.phaseBestMoveRateVsExpected;
              const phaseByResult = effectiveArena?.phaseAccuracyByResult;
              const phaseBlunder = effectiveArena?.phaseBlunderRate;
              const phaseMedianAcc = effectiveArena?.phaseMedianAccuracy;
              const phaseMissedWin = effectiveArena?.phaseMissedWinRate;
              const phaseMissedSave = effectiveArena?.phaseMissedSaveRate;
              const phaseBlunderVsExpected = effectiveArena?.phaseBlunderRateVsExpected;
              const phaseMissedWinVsExpected = effectiveArena?.phaseMissedWinRateVsExpected;
              const phaseMissedSaveVsExpected = effectiveArena?.phaseMissedSaveRateVsExpected;
              const phaseEvalDelta = effectiveArena?.phaseEvalDelta;
              const phaseByResultVsExpected = effectiveArena?.phaseAccuracyByResultVsExpected;
              const hasTarget = targetStats != null;
              const PHASE_CATEGORIES = [
                { abbr: "OPN", label: "Opening", color: "#a37acc", accKey: "opening" as const },
                { abbr: "MID", label: "Middlegame", color: "#c46d8e", accKey: "middlegame" as const },
                { abbr: "END", label: "Endgame", color: "#d4a84b", accKey: "endgame" as const },
              ];
              const PHASE_METRICS = [
                "Accuracy",
                "Median Accuracy",
                "Best Move Rate",
                "Blunder Rate",
                "Missed Wins",
                "Missed Saves",
                "Eval Delta",
                "Accuracy in Wins",
                "Accuracy in Draws",
                "Accuracy in Losses",
              ];
              const SKILL_CATEGORIES = [
                { abbr: "ATK", label: "Attacking", color: "#e05252",
                  metrics: ["Missed Win Rate", "Conversion Rate", "Initiative Pressing", "Sacrifice Accuracy", "Sacrifice Count"] },
                { abbr: "DEF", label: "Defending", color: "#5b9bd5",
                  metrics: ["Missed Save Rate", "Hold Rate", "Critical Accuracy", "Pressure Zone Accuracy", "Comeback Rate", "Post-Blunder Accuracy"] },
                { abbr: "STR", label: "Strategy", color: "#81b64c",
                  metrics: ["Success Rate", "CP Loss Distribution"] },
              ];

              // Get the "Your Score" value for a metric
              const getYourValue = (cat: typeof PHASE_CATEGORIES[number], metric: string): { text: string; color: string } => {
                const accVal = phaseAccuracy?.[cat.accKey];
                const vsExpected = phaseAccVsExpected?.[cat.accKey];
                if (metric === "Accuracy" && accVal != null) {
                  return { text: `${accVal.toFixed(1)}%`, color: "#fff" };
                }
                if (metric === "Best Move Rate") {
                  const bmr = phaseBestMove?.[cat.accKey];
                  if (bmr != null) return { text: `${bmr.toFixed(1)}%`, color: "#fff" };
                }
                if (metric === "Median Accuracy") {
                  const val = phaseMedianAcc?.[cat.accKey];
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#fff" };
                }
                if (metric === "Blunder Rate") {
                  const br = phaseBlunder?.[cat.accKey];
                  if (br != null) return { text: `${br.toFixed(1)}%`, color: br > 3 ? "#e05252" : br > 1.5 ? "#c27a30" : "#81b64c" };
                }
                if (metric === "Missed Wins") {
                  const val = phaseMissedWin?.[cat.accKey];
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: val > 2 ? "#e05252" : val > 1 ? "#c27a30" : "#81b64c" };
                }
                if (metric === "Missed Saves") {
                  const val = phaseMissedSave?.[cat.accKey];
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: val > 2 ? "#e05252" : val > 1 ? "#c27a30" : "#81b64c" };
                }
                if (metric === "Eval Delta") {
                  const val = phaseEvalDelta?.[cat.accKey];
                  if (val != null) {
                    const sign = val > 0 ? "+" : "";
                    return { text: `${sign}${val.toFixed(0)}cp`, color: val > 0 ? "#81b64c" : val < 0 ? "#e05252" : "#fff" };
                  }
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

              // Get the "Rating Range" expected value — derived from actual - vsExpected delta
              const getRangeValue = (cat: typeof PHASE_CATEGORIES[number], metric: string): { text: string; color: string } => {
                if (metric === "Accuracy" || metric === "Median Accuracy") {
                  const accVal = phaseAccuracy?.[cat.accKey];
                  const vsExpected = phaseAccVsExpected?.[cat.accKey];
                  if (accVal != null && vsExpected != null) {
                    const expected = +(accVal - vsExpected).toFixed(1);
                    return { text: `${expected.toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                if (metric === "Best Move Rate") {
                  const bmr = phaseBestMove?.[cat.accKey];
                  const vsExpected = phaseBestMoveVsExpected?.[cat.accKey];
                  if (bmr != null && vsExpected != null) {
                    const expected = +(bmr - vsExpected).toFixed(1);
                    return { text: `${expected.toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                if (metric === "Blunder Rate") {
                  const br = phaseBlunder?.[cat.accKey];
                  const vs = phaseBlunderVsExpected?.[cat.accKey];
                  if (br != null && vs != null) {
                    return { text: `${+(br - vs).toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                if (metric === "Missed Wins") {
                  const val = phaseMissedWin?.[cat.accKey];
                  const vs = phaseMissedWinVsExpected?.[cat.accKey];
                  if (val != null && vs != null) {
                    return { text: `${+(val - vs).toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                if (metric === "Missed Saves") {
                  const val = phaseMissedSave?.[cat.accKey];
                  const vs = phaseMissedSaveVsExpected?.[cat.accKey];
                  if (val != null && vs != null) {
                    return { text: `${+(val - vs).toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                if (metric === "Eval Delta") {
                  return { text: "0cp", color: "#9b9895" };
                }
                if (metric === "Accuracy in Wins") {
                  const val = phaseByResult?.[cat.accKey]?.wins;
                  const vs = phaseByResultVsExpected?.[cat.accKey]?.wins;
                  if (val != null && vs != null) {
                    return { text: `${+(val - vs).toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                if (metric === "Accuracy in Draws") {
                  const val = phaseByResult?.[cat.accKey]?.draws;
                  const vs = phaseByResultVsExpected?.[cat.accKey]?.draws;
                  if (val != null && vs != null) {
                    return { text: `${+(val - vs).toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                if (metric === "Accuracy in Losses") {
                  const val = phaseByResult?.[cat.accKey]?.losses;
                  const vs = phaseByResultVsExpected?.[cat.accKey]?.losses;
                  if (val != null && vs != null) {
                    return { text: `${+(val - vs).toFixed(1)}%`, color: "#9b9895" };
                  }
                }
                return { text: "\u2014", color: "#4a4745" };
              };

              // Get the "Target Rating" expected value
              const getTargetValue = (cat: typeof PHASE_CATEGORIES[number], metric: string): { text: string; color: string } => {
                if (!targetStats) return { text: "\u2014", color: "#4a4745" };
                if (metric === "Accuracy" || metric === "Median Accuracy") {
                  const val = targetStats.expectedPhaseAccuracy[cat.accKey];
                  return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                if (metric === "Best Move Rate") {
                  const val = targetStats.expectedBestMoveRate?.[cat.accKey];
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                if (metric === "Blunder Rate") {
                  const val = targetStats.expectedBlunderRate?.[cat.accKey];
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                if (metric === "Missed Wins") {
                  const val = targetStats.expectedMissedWinRate?.[cat.accKey];
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                if (metric === "Missed Saves") {
                  const val = targetStats.expectedMissedSaveRate?.[cat.accKey];
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                if (metric === "Eval Delta") {
                  return { text: "0cp", color: "#9b9895" };
                }
                if (metric === "Accuracy in Wins") {
                  const val = targetStats.expectedAccuracyByResult?.[cat.accKey]?.wins;
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                if (metric === "Accuracy in Draws") {
                  const val = targetStats.expectedAccuracyByResult?.[cat.accKey]?.draws;
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                if (metric === "Accuracy in Losses") {
                  const val = targetStats.expectedAccuracyByResult?.[cat.accKey]?.losses;
                  if (val != null) return { text: `${val.toFixed(1)}%`, color: "#9b9895" };
                }
                return { text: "\u2014", color: "#4a4745" };
              };

              // Metrics where lower values = better performance
              const LOWER_IS_BETTER = new Set(["Blunder Rate", "Missed Wins", "Missed Saves"]);

              // Compare You vs Peers: green if better, red if worse, yellow if equal
              const getComparisonColor = (metric: string, youText: string, peerText: string): string => {
                const youNum = parseFloat(youText);
                const peerNum = parseFloat(peerText);
                if (isNaN(youNum) || isNaN(peerNum)) return "#9b9895"; // no data — neutral
                const diff = youNum - peerNum;
                if (Math.abs(diff) < 0.15) return "#c9b84a"; // essentially equal — yellow
                const lowerBetter = LOWER_IS_BETTER.has(metric);
                const isBetter = lowerBetter ? diff < 0 : diff > 0;
                return isBetter ? "#81b64c" : "#e05252";
              };

              const renderPhasePanel = (cat: typeof PHASE_CATEGORIES[number], metrics: string[]) => {
                const accVal = phaseAccuracy?.[cat.accKey];
                // Transposed layout: metrics as columns, You/Peers/Target as rows
                const metricColTemplate = `72px repeat(${metrics.length}, 1fr)`;

                // Pre-compute all values for comparison
                const youVals = metrics.map((m) => getYourValue(cat, m));
                const peerVals = metrics.map((m) => getRangeValue(cat, m));
                const targetVals = hasTarget ? metrics.map((m) => getTargetValue(cat, m)) : null;

                return (
                  <div key={cat.abbr} style={{ backgroundColor: "#262421", borderRadius: 12, padding: "16px 20px" }}>
                    {/* Panel header */}
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
                    <div style={{ height: 1, backgroundColor: "#3a3733", marginBottom: 8 }} />

                    {/* Column headers (metric names) */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: metricColTemplate,
                      gap: 2,
                      paddingBottom: 6,
                      marginBottom: 2,
                      borderBottom: "1px solid #3a3733",
                      overflowX: "auto",
                    }}>
                      <span />
                      {metrics.map((m) => (
                        <span key={m} style={{
                          fontSize: 9,
                          fontWeight: 700,
                          color: "#6b6966",
                          textTransform: "uppercase",
                          letterSpacing: "0.02em",
                          textAlign: "center",
                          lineHeight: 1.2,
                        }}>{m}</span>
                      ))}
                    </div>

                    {/* You row — colored by comparison to peers */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: metricColTemplate,
                      gap: 2,
                      alignItems: "center",
                      padding: "7px 0",
                      borderBottom: "1px solid #3a3733",
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>You</span>
                      {metrics.map((metric, i) => (
                        <span key={metric} style={{
                          color: getComparisonColor(metric, youVals[i].text, peerVals[i].text),
                          fontSize: 12,
                          fontWeight: 700,
                          textAlign: "center",
                        }}>{youVals[i].text}</span>
                      ))}
                    </div>

                    {/* Peers row — neutral gray */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: metricColTemplate,
                      gap: 2,
                      alignItems: "center",
                      padding: "7px 0",
                      borderBottom: hasTarget ? "1px solid #3a3733" : "none",
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6b6966", textTransform: "uppercase", letterSpacing: "0.04em" }}>Peers</span>
                      {metrics.map((metric, i) => (
                        <span key={metric} style={{
                          color: peerVals[i].text === "\u2014" ? "#4a4745" : "#9b9895",
                          fontSize: 12,
                          fontWeight: 700,
                          textAlign: "center",
                        }}>{peerVals[i].text}</span>
                      ))}
                    </div>

                    {/* Target row — neutral gray */}
                    {hasTarget && targetVals && (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: metricColTemplate,
                        gap: 2,
                        alignItems: "center",
                        padding: "7px 0",
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#6b6966", textTransform: "uppercase", letterSpacing: "0.04em" }}>Target</span>
                        {metrics.map((metric, i) => (
                          <span key={metric} style={{
                            color: targetVals[i].text === "\u2014" ? "#4a4745" : "#9b9895",
                            fontSize: 12,
                            fontWeight: 700,
                            textAlign: "center",
                          }}>{targetVals[i].text}</span>
                        ))}
                      </div>
                    )}
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
                  <button
                    onClick={() => setGamePhasesOpen((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      marginBottom: gamePhasesOpen ? 16 : 20,
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="#9b9895"
                      style={{
                        transition: "transform 0.2s",
                        transform: gamePhasesOpen ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    >
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Game Phases</span>
                  </button>
                  {gamePhasesOpen && (
                    <div className="flex flex-col gap-5" style={{ marginBottom: 20 }}>
                      {PHASE_CATEGORIES.map((cat) => renderPhasePanel(cat, PHASE_METRICS))}
                    </div>
                  )}
                  <button
                    onClick={() => setSkillCategoriesOpen((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      marginBottom: skillCategoriesOpen ? 16 : 0,
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="#9b9895"
                      style={{
                        transition: "transform 0.2s",
                        transform: skillCategoriesOpen ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    >
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Skill Categories</span>
                  </button>
                  {skillCategoriesOpen && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      {SKILL_CATEGORIES.map((cat) => renderPanel(cat, cat.metrics))}
                    </div>
                  )}
                  <button
                    onClick={() => setTacticsOpen((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      marginTop: 20,
                      marginBottom: tacticsOpen ? 16 : 0,
                    }}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="#9b9895"
                      style={{
                        transition: "transform 0.2s",
                        transform: tacticsOpen ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    >
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "#9b9895" }}>Tactics</span>
                  </button>
                  {tacticsOpen && (() => {
                    const breakdown = (reportArenaStats ?? cards[activeIndex]?.arenaStats)?.tacticsBreakdown;
                    const MOTIF_LABELS: Record<string, { display: string; labels: string[] }> = {
                      fork: { display: "Fork", labels: ["fork"] },
                      pin_double_attack: { display: "Pin / Double Attack", labels: ["pin", "double_attack"] },
                      skewer: { display: "Skewer", labels: ["skewer"] },
                      discovered_attack: { display: "Discovered Attack", labels: ["discovered_attack"] },
                      removal_of_defender: { display: "Removal of Defender", labels: ["removal_of_defender"] },
                      overload: { display: "Overload", labels: ["overload"] },
                      deflection: { display: "Deflection", labels: ["deflection"] },
                      intermezzo: { display: "Intermezzo", labels: ["intermezzo"] },
                      sacrifice: { display: "Sacrifice", labels: ["sacrifice"] },
                      clearance: { display: "Clearance", labels: ["clearance"] },
                      back_rank: { display: "Back Rank", labels: ["back_rank"] },
                      mate_threat: { display: "Mate Threat", labels: ["mate_threat"] },
                      checkmate: { display: "Checkmate", labels: ["checkmate"] },
                      smothered_mate: { display: "Smothered Mate", labels: ["smothered_mate"] },
                      trapped_piece: { display: "Trapped Piece", labels: ["trapped_piece"] },
                      x_ray: { display: "X-Ray", labels: ["x_ray"] },
                      interference: { display: "Interference", labels: ["interference"] },
                      desperado: { display: "Desperado", labels: ["desperado"] },
                      attraction: { display: "Attraction", labels: ["attraction"] },
                    };
                    const ALL_MOTIFS = Object.keys(MOTIF_LABELS);
                    return (
                      <div style={{ backgroundColor: "#262421", borderRadius: 12, padding: "16px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                          <span style={{
                            backgroundColor: "#c27a30",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "3px 8px",
                            borderRadius: 999,
                            marginRight: 10,
                            lineHeight: 1,
                          }}>TAC</span>
                          <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>Tactics Breakdown</span>
                        </div>
                        <div style={{ height: 1, backgroundColor: "#3a3733", marginBottom: 8 }} />
                        <style>{`
                          .motif-row { transition: background-color 0.15s ease; border-radius: 6px; }
                          .motif-row[data-clickable="true"]:hover { background-color: #3a3733; }
                        `}</style>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 0 }}>
                          {ALL_MOTIFS.map((motif) => {
                            const info = MOTIF_LABELS[motif];
                            const data = breakdown?.[motif];
                            const success = data?.success ?? 0;
                            const total = data?.total ?? 0;
                            const hasData = total > 0;
                            const href = hasData
                              ? `/puzzles?label=${info.labels[0]}`
                              : undefined;
                            return (
                              <a
                                key={motif}
                                className="motif-row"
                                data-clickable={hasData ? "true" : "false"}
                                href={href}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  padding: "8px 12px",
                                  borderBottom: "1px solid #3a3733",
                                  textDecoration: "none",
                                  cursor: hasData ? "pointer" : "default",
                                }}
                              >
                                <span style={{ color: hasData ? "#d1cfcc" : "#9b9895", fontSize: 13 }}>{info.display}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: hasData ? "#fff" : "#4a4745" }}>
                                  {hasData ? `${success}/${total}` : "\u2014"}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
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
                  { title: "Advanced Skill Stats", desc: "Deep breakdowns for attacking, defending, calculation, tactics, strategic play, and openings." },
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
                    Every puzzle is generated from your own games. Train different categories and see exactly where you went wrong. Share your puzzle database with a coach to target your weaknesses together.
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
                      <span style={{ fontSize: 11, color: "#a09d9a" }}>(1830)</span>
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

              {/* Feature — Arena Simulation Game */}
              <div style={{ backgroundColor: "#1c1b19", borderRadius: 16, border: "1px solid #3d3a37", padding: "40px 44px", marginBottom: 32 }}>
                <div className="text-center" style={{ width: "100%", marginBottom: 24 }}>
                  <p className="font-extrabold" style={{ fontSize: 12, color: "#81b64c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                    Arena Simulation Game
                  </p>
                  <h2 className="font-extrabold" style={{ fontSize: 28, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>
                    Simulate games against anyone.
                  </h2>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#9b9895", lineHeight: 1.75, marginBottom: 0 }}>
                    Practice playing against your friends, yourself or anyone else with data pulled from real games.
                  </p>
                </div>
                {/* Board + Cards row */}
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 28 }}>
                  {/* Left: Board with player bars */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, flexShrink: 0 }}>
                    {/* Top player bar — MagnusCarlsen (black) */}
                    <div
                      style={{
                        width: 340,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 12px",
                        backgroundColor: "#272522",
                        borderRadius: "8px 8px 0 0",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#f0d9b5" }}>GM</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>MagnusCarlsen</span>
                      <span style={{ fontSize: 11, color: "#a09d9a" }}>(2525)</span>
                      <span style={{ fontSize: 13, color: "#d1cfcc", marginLeft: 2 }}>{"\u265A"}</span>
                    </div>
                    {/* Board */}
                    <div style={{ width: 340, height: 340, overflow: "hidden" }}>
                      {mounted ? (
                        <Chessboard
                          options={{
                            position: "r1bq1rk1/pp2ppbp/2np1np1/8/2BNP3/2N1B3/PPP2PPP/R2QK2R w KQ - 0 9",
                            boardOrientation: "white",
                            allowDragging: false,
                            darkSquareStyle: { backgroundColor: "#6596EB" },
                            lightSquareStyle: { backgroundColor: "#EAF1F8" },
                          }}
                        />
                      ) : (
                        <div style={{ width: 340, height: 340, backgroundColor: "#272522" }} />
                      )}
                    </div>
                    {/* Bottom player bar — grandmother69 (white) */}
                    <div
                      style={{
                        width: 340,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 12px",
                        backgroundColor: "#272522",
                        borderRadius: "0 0 8px 8px",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>grandmother69</span>
                      <span style={{ fontSize: 11, color: "#a09d9a" }}>(1830)</span>
                    </div>
                  </div>

                  {/* Right: Two cards side by side with VS */}
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
                    {/* grandmother69 card — silver */}
                    <div style={{ pointerEvents: "none" }}>
                      <PlayerCard
                        username="grandmother69"
                        avatarUrl="https://images.chesscomfiles.com/uploads/v1/user/175872113.17bac7ee.200x200o.121a672805c7.jpg"
                        countryCode="SE"
                        timeControl="rapid"
                        chessRating={1830}
                        peakRating={1830}
                        arenaStats={{
                          arenaRating: 76,
                          tier: "silver",
                          shiny: true,
                          categories: {
                            attacking: { stat: 78, percentage: 14.2, successRate: 55.1 },
                            defending: { stat: 74, percentage: 18.5, successRate: 58.2 },
                            tactics: { stat: 79, percentage: 28.7, successRate: 84.1 },
                            strategic: { stat: 75, percentage: 36.1, successRate: 80.4 },
                            opening: { stat: 73, percentage: 30.8, successRate: 59.3 },
                            endgame: { stat: 77, percentage: 32.4, successRate: 49.8 },
                          },
                          form: 1,
                          backStats: {
                            accuracyOverall: 76.2, accuracyWhite: 77.1, accuracyBlack: 75.3,
                            blunderRate: 8.4, missedWinRate: 3.8, missedSaveRate: 4.5,
                          },
                          phaseAccuracy: { opening: null, middlegame: null, endgame: null },
                          gamesAnalyzed: 40,
                          record: { wins: 82, draws: 15, losses: 63 },
                        }}
                      />
                    </div>
                    {/* VS */}
                    <span style={{ fontSize: 20, fontWeight: 900, color: "#6b6966", letterSpacing: 2 }}>VS</span>
                    {/* Empty opponent card with username input */}
                    <div style={{
                      width: 240,
                      height: 360,
                      borderRadius: 16,
                      border: "2px dashed #4a4745",
                      backgroundColor: "#2a2825",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 14,
                    }}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        backgroundColor: "#3d3a37",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 24,
                        color: "#9b9895",
                      }}>
                        ?
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", letterSpacing: 1 }}>
                        Choose Opponent
                      </span>
                      <div style={{
                        width: "75%",
                        padding: "9px 14px",
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 8,
                        backgroundColor: "#1c1b19",
                        color: "#6b6966",
                        textAlign: "center",
                      }}>
                        username...
                      </div>
                      <div style={{
                        width: "75%",
                        padding: "8px",
                        fontSize: 13,
                        fontWeight: 800,
                        borderRadius: 8,
                        backgroundColor: "#81b64c",
                        color: "#fff",
                        textAlign: "center",
                      }}>
                        Play
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature — Know Yourself */}
              <div style={{ backgroundColor: "#1c1b19", borderRadius: 16, border: "1px solid #3d3a37", padding: "40px 44px", marginBottom: 32 }}>
                <div className="text-center" style={{ width: "100%", marginBottom: 28 }}>
                  <p className="font-extrabold" style={{ fontSize: 12, color: "#81b64c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>
                    Deep Analysis
                  </p>
                  <h2 className="font-extrabold" style={{ fontSize: 28, color: "#fff", marginBottom: 6, lineHeight: 1.3 }}>
                    Know yourself as a chess player.
                  </h2>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#9b9895", lineHeight: 1.75, marginBottom: 0 }}>
                    Every game you play is analyzed by Stockfish and broken down into six skill categories. See where you excel and where you need work.
                  </p>
                </div>

                <div style={{ display: "flex", gap: 36, alignItems: "start", justifyContent: "center" }}>
                  {/* Left: Player Card */}
                  <div style={{ pointerEvents: "none", flexShrink: 0 }}>
                    <PlayerCard
                      username="grandmother69"
                      avatarUrl="https://images.chesscomfiles.com/uploads/v1/user/175872113.17bac7ee.200x200o.121a672805c7.jpg"
                      countryCode="SE"
                      timeControl="rapid"
                      chessRating={1830}
                      peakRating={1830}
                      arenaStats={{
                        arenaRating: 76,
                        tier: "silver",
                        shiny: true,
                        categories: {
                          attacking: { stat: 78, percentage: 14.2, successRate: 55.1 },
                          defending: { stat: 74, percentage: 18.5, successRate: 58.2 },
                          tactics: { stat: 79, percentage: 28.7, successRate: 84.1 },
                          strategic: { stat: 75, percentage: 36.1, successRate: 80.4 },
                          opening: { stat: 73, percentage: 30.8, successRate: 59.3 },
                          endgame: { stat: 77, percentage: 32.4, successRate: 49.8 },
                        },
                        form: 1,
                        backStats: {
                          accuracyOverall: 76.2,
                          accuracyWhite: 77.1,
                          accuracyBlack: 75.3,
                          blunderRate: 8.4,
                          missedWinRate: 3.8,
                          missedSaveRate: 4.5,
                        },
                        phaseAccuracy: { opening: null, middlegame: null, endgame: null },
                        gamesAnalyzed: 40,
                        record: { wins: 82, draws: 15, losses: 63 },
                      }}
                    />
                  </div>

                  {/* Right: Metrics + Graph + Description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Accuracy metrics row */}
                    <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                      {[
                        { label: "Accuracy", value: "76.2%", color: "#81b64c" },
                        { label: "Blunder Rate", value: "8.4%", color: "#e05252" },
                        { label: "Missed Wins", value: "3.8%", color: "#c27a30" },
                      ].map((m) => (
                        <div key={m.label} style={{
                          flex: 1,
                          backgroundColor: "#272522",
                          borderRadius: 10,
                          padding: "12px 14px",
                          textAlign: "center",
                        }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: "#6b6966", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{m.label}</p>
                          <p style={{ fontSize: 20, fontWeight: 900, color: m.color, margin: 0 }}>{m.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Accuracy graph mockup */}
                    <div style={{
                      backgroundColor: "#272522",
                      borderRadius: 10,
                      padding: "14px 16px 10px",
                      marginBottom: 16,
                    }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "#6b6966", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Accuracy by Game</p>
                      <svg width="100%" height="80" viewBox="0 0 320 80" preserveAspectRatio="none">
                        {/* Grid lines */}
                        {[0, 20, 40, 60].map((y) => (
                          <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#3a3733" strokeWidth="0.5" />
                        ))}
                        {/* Win dots (green) */}
                        {[
                          [10,18],[30,22],[60,15],[90,25],[110,12],[150,20],[180,28],[220,16],[260,10],[290,24],
                          [40,30],[130,14],[200,22],[240,18],[310,20],
                        ].map(([x,y], i) => (
                          <circle key={`w${i}`} cx={x} cy={y} r="3" fill="#81b64c" opacity="0.8" />
                        ))}
                        {/* Loss dots (red) */}
                        {[
                          [20,52],[50,48],[80,55],[120,45],[170,58],[210,50],[250,42],[280,60],
                        ].map(([x,y], i) => (
                          <circle key={`l${i}`} cx={x} cy={y} r="3" fill="#e05252" opacity="0.8" />
                        ))}
                        {/* Draw dots (yellow) */}
                        {[
                          [70,35],[160,38],[230,32],[300,36],
                        ].map(([x,y], i) => (
                          <circle key={`d${i}`} cx={x} cy={y} r="3" fill="#c27a30" opacity="0.8" />
                        ))}
                        {/* Trend line */}
                        <polyline
                          points="10,32 50,35 90,30 130,28 170,33 210,29 250,26 290,28"
                          fill="none"
                          stroke="#f0d9b5"
                          strokeWidth="1.5"
                          opacity="0.6"
                        />
                      </svg>
                      <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 6 }}>
                        {[
                          { label: "Win", color: "#81b64c" },
                          { label: "Loss", color: "#e05252" },
                          { label: "Draw", color: "#c27a30" },
                        ].map((l) => (
                          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#6b6966" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: l.color, display: "inline-block" }} />
                            {l.label}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Phase accuracy panels */}
                    <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                      {[
                        { phase: "Opening", acc: "85.7%", color: "#a37acc" },
                        { phase: "Middlegame", acc: "72.3%", color: "#c46d8e" },
                        { phase: "Endgame", acc: "78.6%", color: "#d4a84b" },
                      ].map((p) => (
                        <div key={p.phase} style={{
                          flex: 1,
                          backgroundColor: "#272522",
                          borderRadius: 10,
                          padding: "10px 12px",
                          textAlign: "center",
                        }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: p.color, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{p.phase}</p>
                          <p style={{ fontSize: 16, fontWeight: 900, color: "#fff", margin: 0 }}>{p.acc}</p>
                        </div>
                      ))}
                    </div>

                    {/* Description */}
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#9b9895", lineHeight: 1.75, margin: 0 }}>
                      Dive into deep analysis of your game. Discover your strengths, compare yourself to your peers, and set a target rating to see how players perform at the level you're aiming for.
                    </p>
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
                            strategic: { stat: 80, percentage: 37.93, successRate: 85.39 },
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
                            strategic: { stat: 85, percentage: 37.93, successRate: 85.39 },
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
                          overall: -6,
                          attacking: -8,
                          defending: -2,
                          tactics: -3,
                          strategic: -5,
                          opening: -6,
                          endgame: -6,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Feature — Find a Chess Coach */}
              <div style={{ backgroundColor: "#1c1b19", borderRadius: 16, border: "1px solid #3d3a37", padding: "40px 44px", marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
                  {/* Left: Coach avatar + info */}
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1 }}>
                    <img
                      src="https://images.chesscomfiles.com/uploads/v1/user/89523040.0341f1a9.200x200o.0996111c0eec.jpeg"
                      alt="Chess Coach"
                      style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
                    />
                    <div>
                      <p className="font-extrabold" style={{ fontSize: 12, color: "#81b64c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                        Find a Chess Coach
                      </p>
                      <h2 className="font-extrabold" style={{ fontSize: 22, color: "#fff", marginBottom: 4, lineHeight: 1.3 }}>
                        Take your game to the next level.
                      </h2>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#9b9895", lineHeight: 1.7, marginBottom: 0 }}>
                        Work with a trusted coach who can review your puzzle database and target your weaknesses directly.
                      </p>
                    </div>
                  </div>
                  {/* Right: Stars + CTA */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, flexShrink: 0 }}>
                    <div style={{ display: "flex", gap: 2 }}>
                      {Array.from({ length: 5 }, (_, i) => (
                        <svg key={i} width="18" height="18" viewBox="0 0 24 24" fill="#f0d9b5" stroke="#f0d9b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      ))}
                    </div>
                    <a
                      href="/coach"
                      style={{
                        padding: "10px 28px",
                        fontSize: 14,
                        fontWeight: 800,
                        borderRadius: 8,
                        backgroundColor: "#81b64c",
                        color: "#fff",
                        textDecoration: "none",
                        transition: "background-color 0.2s ease",
                      }}
                    >
                      Browse Coaches
                    </a>
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

// ── Accuracy Scatter Graph (SVG) ─────────────────────────────────────

function FormGraph({ games }: { games: GameData[]; chessRating?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const gameAccuracy = (g: GameData): number | null => {
    // Use only the player's own accuracy, not the opponent's
    if (g.playerSide === "white") return g.accuracyWhite ?? null;
    if (g.playerSide === "black") return g.accuracyBlack ?? null;
    // Fallback if playerSide not available
    return g.accuracyWhite ?? g.accuracyBlack ?? null;
  };

  // Games come newest-first; reverse for chronological left-to-right
  const chronological = [...games].reverse();
  const dataPoints = chronological
    .map((g, i) => ({ index: i, acc: gameAccuracy(g), result: g.result, opponent: g.opponent ?? null, date: g.endTime }))
    .filter((d): d is { index: number; acc: number; result: "WIN" | "LOSS" | "DRAW"; opponent: string | null; date: string } => d.acc != null);

  if (dataPoints.length === 0) return null;

  const n = chronological.length;
  const RESULT_COLORS: Record<string, string> = { WIN: "#81b64c", LOSS: "#e05252", DRAW: "#c27a30" };

  // Y-axis range: fit to data with some padding
  const allAccs = dataPoints.map((d) => d.acc);
  const dataMin = Math.min(...allAccs);
  const dataMax = Math.max(...allAccs);
  const yMin = Math.max(0, Math.floor((dataMin - 5) / 5) * 5);
  const yMax = Math.min(100, Math.ceil((dataMax + 5) / 5) * 5);
  const yRange = Math.max(yMax - yMin, 10);

  // Average accuracy by result
  const avgByResult: Record<string, { sum: number; count: number }> = { WIN: { sum: 0, count: 0 }, LOSS: { sum: 0, count: 0 }, DRAW: { sum: 0, count: 0 } };
  for (const d of dataPoints) {
    avgByResult[d.result].sum += d.acc;
    avgByResult[d.result].count++;
  }
  const avgAcc = (r: string) => avgByResult[r].count > 0 ? avgByResult[r].sum / avgByResult[r].count : null;

  // Rolling 5-game average for trend line
  const WINDOW = 5;
  const rollingAcc: (number | null)[] = [];
  const accBuffer: number[] = [];
  for (const g of chronological) {
    const acc = gameAccuracy(g);
    if (acc != null) accBuffer.push(acc);
    if (accBuffer.length > WINDOW) accBuffer.shift();
    rollingAcc.push(accBuffer.length > 0 ? accBuffer.reduce((s, v) => s + v, 0) / accBuffer.length : null);
  }

  // SVG layout
  const W = 700;
  const H = 280;
  const padX = 40;
  const padTop = 28;
  const padBottom = 28;
  const padRight = 16;
  const graphW = W - padX - padRight;
  const graphH = H - padTop - padBottom;
  const toX = (i: number) => padX + (i / Math.max(n - 1, 1)) * graphW;
  const toY = (v: number) => padTop + graphH - ((v - yMin) / yRange) * graphH;

  // Y-axis labels
  const yStep = yRange <= 20 ? 5 : 10;
  const yLabels: number[] = [];
  for (let v = yMin; v <= yMax; v += yStep) yLabels.push(v);

  // Build trend line path
  let trendPath = "";
  let trendStarted = false;
  for (let i = 0; i < n; i++) {
    const v = rollingAcc[i];
    if (v == null) { trendStarted = false; continue; }
    trendPath += `${!trendStarted ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)} `;
    trendStarted = true;
  }

  // Hovered point data
  const hoveredData = hovered != null ? dataPoints.find((d) => d.index === hovered) : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto" }}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHovered(null)}
      >
        {/* Grid lines + Y-axis labels */}
        {yLabels.map((v) => (
          <g key={v}>
            <line
              x1={padX} y1={toY(v)} x2={W - padRight} y2={toY(v)}
              stroke="#3a3733" strokeWidth={0.5} strokeDasharray="4 4"
            />
            <text x={padX - 8} y={toY(v) + 4} textAnchor="end" fill="#6b6966" fontSize={11} fontWeight={600}>
              {v}%
            </text>
          </g>
        ))}

        {/* Average accuracy lines per result */}
        {(["WIN", "LOSS", "DRAW"] as const).map((r) => {
          const avg = avgAcc(r);
          if (avg == null || avg < yMin || avg > yMax) return null;
          return (
            <line
              key={r}
              x1={padX} y1={toY(avg)} x2={W - padRight} y2={toY(avg)}
              stroke={RESULT_COLORS[r]} strokeWidth={1} strokeDasharray="6 4" opacity={0.35}
            />
          );
        })}

        {/* Trend line (rolling average) */}
        {trendPath && (
          <path d={trendPath} fill="none" stroke="#fff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.3} />
        )}

        {/* Scatter dots */}
        {dataPoints.map((d) => {
          const isHovered = hovered === d.index;
          return (
            <circle
              key={d.index}
              cx={toX(d.index)}
              cy={toY(d.acc)}
              r={isHovered ? 6 : 4}
              fill={RESULT_COLORS[d.result] ?? "#6b6966"}
              stroke={isHovered ? "#fff" : "#262421"}
              strokeWidth={isHovered ? 2 : 1}
              opacity={hovered != null && !isHovered ? 0.35 : 0.85}
              style={{ cursor: "pointer", transition: "all 0.1s ease" }}
              onMouseEnter={() => setHovered(d.index)}
            />
          );
        })}

        {/* Hover tooltip */}
        {hoveredData && (() => {
          const x = toX(hoveredData.index);
          const y = toY(hoveredData.acc);
          const label = `${hoveredData.acc.toFixed(1)}%`;
          const resultLabel = hoveredData.result === "WIN" ? "Win" : hoveredData.result === "LOSS" ? "Loss" : "Draw";
          const opponent = hoveredData.opponent;
          const dateStr = hoveredData.date ? new Date(hoveredData.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
          const tooltipW = opponent ? Math.max(100, opponent.length * 7 + 24) : 72;
          const tooltipH = opponent || dateStr ? 52 : 34;
          const tx = Math.min(Math.max(x - tooltipW / 2, padX), W - padRight - tooltipW);
          const ty = y - tooltipH - 10;
          return (
            <g>
              <rect x={tx} y={ty} width={tooltipW} height={tooltipH} rx={6} fill="#1c1b19" stroke="#3d3a37" strokeWidth={1} />
              <text x={tx + tooltipW / 2} y={ty + 14} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={800}>
                {label}
              </text>
              <text x={tx + tooltipW / 2} y={ty + 26} textAnchor="middle" fill={RESULT_COLORS[hoveredData.result]} fontSize={10} fontWeight={700}>
                {resultLabel}
              </text>
              {(opponent || dateStr) && (
                <text x={tx + tooltipW / 2} y={ty + 40} textAnchor="middle" fill="#6b6966" fontSize={9} fontWeight={600}>
                  {opponent ? `vs ${opponent}` : ""}{opponent && dateStr ? " · " : ""}{dateStr ?? ""}
                </text>
              )}
            </g>
          );
        })()}

        {/* X-axis labels */}
        {[0, Math.floor((n - 1) / 2), n - 1].map((idx) => {
          const anchor = idx === 0 ? "start" : idx === n - 1 ? "end" : "middle";
          return (
            <text key={`x-${idx}`} x={toX(idx)} y={padTop + graphH + 16} textAnchor={anchor} fill="#6b6966" fontSize={9} fontWeight={600}>
              {idx === 0 ? "Game 1" : idx === n - 1 ? `Game ${n}` : `Game ${idx + 1}`}
            </text>
          );
        })}

        {/* Legend */}
        {[
          { label: "Win", color: RESULT_COLORS.WIN, x: padX },
          { label: "Loss", color: RESULT_COLORS.LOSS, x: padX + 50 },
          { label: "Draw", color: RESULT_COLORS.DRAW, x: padX + 104 },
          { label: "Trend", color: "#fff", x: padX + 162 },
        ].map((item) => (
          <g key={item.label}>
            {item.label === "Trend" ? (
              <line x1={item.x} y1={padTop - 12} x2={item.x + 14} y2={padTop - 12} stroke={item.color} strokeWidth={2} opacity={0.3} strokeLinecap="round" />
            ) : (
              <circle cx={item.x + 4} cy={padTop - 12} r={4} fill={item.color} opacity={0.85} />
            )}
            <text x={item.x + 18} y={padTop - 8} fill={item.color} fontSize={10} fontWeight={700} opacity={item.label === "Trend" ? 0.4 : 0.85}>
              {item.label}
            </text>
          </g>
        ))}
      </svg>

      {/* Summary stats below the graph */}
      <div style={{ display: "flex", gap: 24, justifyContent: "center", marginTop: 8 }}>
        {(["WIN", "LOSS", "DRAW"] as const).map((r) => {
          const avg = avgAcc(r);
          const count = avgByResult[r].count;
          if (count === 0) return null;
          const label = r === "WIN" ? "Wins" : r === "LOSS" ? "Losses" : "Draws";
          return (
            <div key={r} style={{ textAlign: "center" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#6b6966", margin: 0 }}>Avg in {label}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: RESULT_COLORS[r], margin: "2px 0 0" }}>
                {avg != null ? `${avg.toFixed(1)}%` : "—"}
              </p>
              <p style={{ fontSize: 10, fontWeight: 600, color: "#4a4745", margin: 0 }}>({count} games)</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

