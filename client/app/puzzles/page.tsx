"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import type { Arrow } from "react-chessboard";
import { Chess, Square } from "chess.js";
import { useUserContext } from "../UserContext";
import { useAuth } from "../AuthContext";
import PlayerCard, { ArenaStatsData, CARD_STAT_TO_PUZZLE, PUZZLE_TO_CARD_STAT } from "../PlayerCard";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false }
);

interface PuzzleData {
  id: number;
  fen: string;
  sideToMove: "WHITE" | "BLACK";
  playedMoveUci: string;
  bestMoveUci: string;
  evalBeforeCp: number | null;
  evalAfterCp: number | null;
  deltaCp: number | null;
  requiredMoves?: number;
  category?: string | null;
  severity?: string | null;
  labels?: string[];
  createdAt: string;
  game: {
    id: number;
    endDate: string;
    timeControl: string;
  };
}

// Category display config: label, background color, text color
const CATEGORY_DISPLAY: Record<string, { label: string; bg: string; fg: string }> = {
  opening:     { label: "Opening",     bg: "#2d1a3b", fg: "#a37acc" },
  defending:   { label: "Defending",   bg: "#1a2d3b", fg: "#5ba3d9" },
  attacking:   { label: "Attacking",   bg: "#3b3520", fg: "#c27a30" },
  tactics:     { label: "Tactics",     bg: "#1a3b2d", fg: "#5bd98a" },
  endgame:     { label: "Endgame",     bg: "#2d2d1a", fg: "#d9c75b" },
  strategic:   { label: "Strategic",   bg: "#3b1a3b", fg: "#d95bd9" },
  // Legacy names (existing DB records)
  positional:                { label: "Strategic",   bg: "#3b1a3b", fg: "#d95bd9" },
  resilience:                { label: "Defending",   bg: "#1a2d3b", fg: "#5ba3d9" },
  advantage_capitalisation:  { label: "Attacking",   bg: "#3b3520", fg: "#c27a30" },
  opportunity_creation:      { label: "Tactics",     bg: "#1a3b2d", fg: "#5bd98a" },
  precision_only_move:       { label: "Strategic",   bg: "#3b1a3b", fg: "#d95bd9" },
};

const SEVERITY_DISPLAY: Record<string, { label: string; bg: string; fg: string }> = {
  mistake:     { label: "Mistake",     bg: "#3b3520", fg: "#c27a30" },
  blunder:     { label: "Blunder",     bg: "#3b1a1a", fg: "#e05252" },
  missed_win:  { label: "Missed Win",  bg: "#3b1a1a", fg: "#e05252" },
  missed_save: { label: "Missed Save", bg: "#1a2d3b", fg: "#5ba3d9" },
};

const TACTICAL_MOTIFS: { key: string; label: string }[] = [
  { key: "fork", label: "Fork" },
  { key: "pin", label: "Pin" },
  { key: "skewer", label: "Skewer" },
  { key: "double_attack", label: "Double Attack" },
  { key: "discovered_attack", label: "Discovered Attack" },
  { key: "sacrifice", label: "Sacrifice" },
  { key: "removal_of_defender", label: "Remove Defender" },
  { key: "deflection", label: "Deflection" },
  { key: "attraction", label: "Attraction" },
  { key: "clearance", label: "Clearance" },
  { key: "intermezzo", label: "Intermezzo" },
  { key: "trapped_piece", label: "Trapped Piece" },
  { key: "x_ray", label: "X-Ray" },
  { key: "back_rank", label: "Back Rank" },
  { key: "checkmate", label: "Checkmate" },
  { key: "mate_threat", label: "Mate Threat" },
];

const API_BASE = "http://localhost:3000";

// Country code → flag emoji (regional indicator symbols)
function countryCodeToFlag(code: string): string {
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

// Simple cache for chess.com player country lookups
const countryCache = new Map<string, string | null>();

async function fetchPlayerCountry(username: string): Promise<string | null> {
  const key = username.toLowerCase();
  if (countryCache.has(key)) return countryCache.get(key)!;
  try {
    const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(key)}`);
    if (!res.ok) { countryCache.set(key, null); return null; }
    const data = await res.json();
    // country is a URL like "https://api.chess.com/pub/country/US"
    const code = typeof data.country === "string" ? data.country.split("/").pop() || null : null;
    countryCache.set(key, code);
    return code;
  } catch {
    countryCache.set(key, null);
    return null;
  }
}

// Format time control for display (e.g. "600" → "10 min", "180+2" → "3+2")
function formatTimeControl(tc: string): string {
  const parts = tc.split("+");
  const base = parseInt(parts[0]);
  const inc = parts.length > 1 ? parseInt(parts[1]) : 0;
  if (isNaN(base)) return tc;
  const mins = Math.floor(base / 60);
  const secs = base % 60;
  const baseStr = secs > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${mins}`;
  if (inc > 0) return `${baseStr}+${inc}`;
  return `${baseStr} min`;
}

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const STARTING_PIECES: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

// Unicode piece symbols for display (shown in opponent's color since these are captured)
const WHITE_PIECE_SYMBOLS: Record<string, string> = { p: "\u2659", n: "\u2658", b: "\u2657", r: "\u2656", q: "\u2655" };
const BLACK_PIECE_SYMBOLS: Record<string, string> = { p: "\u265F", n: "\u265E", b: "\u265D", r: "\u265C", q: "\u265B" };

interface CapturedInfo {
  /** Pieces white has captured (black pieces taken) */
  whiteCaptured: { piece: string; symbol: string }[];
  /** Pieces black has captured (white pieces taken) */
  blackCaptured: { piece: string; symbol: string }[];
  /** Material advantage: positive = white ahead */
  materialDiff: number;
}

function getCapturedPieces(fen: string): CapturedInfo {
  const board = fen.split(" ")[0];
  const white: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  const black: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };

  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (lower in white) {
      if (ch === lower) black[lower]++;
      else white[lower]++;
    }
  }

  const whiteCaptured: { piece: string; symbol: string }[] = [];
  const blackCaptured: { piece: string; symbol: string }[] = [];
  let whiteMaterial = 0;
  let blackMaterial = 0;

  // Order: queen, rook, bishop, knight, pawn
  for (const piece of ["q", "r", "b", "n", "p"]) {
    const missingBlack = STARTING_PIECES[piece] - black[piece];
    const missingWhite = STARTING_PIECES[piece] - white[piece];
    // White captured these black pieces
    for (let i = 0; i < missingBlack; i++) {
      whiteCaptured.push({ piece, symbol: BLACK_PIECE_SYMBOLS[piece] });
    }
    // Black captured these white pieces
    for (let i = 0; i < missingWhite; i++) {
      blackCaptured.push({ piece, symbol: WHITE_PIECE_SYMBOLS[piece] });
    }
    whiteMaterial += white[piece] * PIECE_VALUES[piece];
    blackMaterial += black[piece] * PIECE_VALUES[piece];
  }

  return { whiteCaptured, blackCaptured, materialDiff: whiteMaterial - blackMaterial };
}

/** Convert centipawns to win% (0–100) from white's perspective */
function cpToWhiteWinPct(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function formatEval(cp: number | null): string {
  if (cp == null) return "?";
  const pawns = cp / 100;
  return (pawns >= 0 ? "+" : "") + pawns.toFixed(1);
}

function uciToSquares(uci: string): { from: Square; to: Square } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
  };
}

function applyUciToChess(chess: Chess, uci: string): boolean {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length > 4 ? uci[4] as "q" | "r" | "b" | "n" : undefined;
  const result = chess.move({ from, to, ...(promotion ? { promotion } : {}) });
  return result !== null;
}

function formatMoveList(fen: string, uciMoves: string[]): string {
  const chess = new Chess(fen);
  const fenParts = fen.split(" ");
  const startIsWhite = fenParts[1] === "w";
  let moveNum = parseInt(fenParts[5]) || 1;
  const parts: string[] = [];

  for (let i = 0; i < uciMoves.length; i++) {
    const from = uciMoves[i].slice(0, 2) as Square;
    const to = uciMoves[i].slice(2, 4) as Square;
    const promo = uciMoves[i].length > 4 ? (uciMoves[i][4] as "q" | "r" | "b" | "n") : undefined;

    let san: string;
    try {
      const move = chess.move({ from, to, ...(promo ? { promotion: promo } : {}) });
      san = move ? move.san : uciMoves[i];
    } catch {
      break;
    }

    const currentIsWhite = startIsWhite ? i % 2 === 0 : i % 2 === 1;

    if (currentIsWhite) {
      parts.push(`${moveNum}.\u2009${san}`);
    } else {
      if (i === 0) {
        parts.push(`${moveNum}...\u2009${san}`);
      } else {
        parts.push(san);
      }
      moveNum++;
    }
  }

  return parts.join(" ");
}

export default function PuzzlesPage() {
  const searchParams = useSearchParams();
  const { queriedUser, setQueriedUser, searchTrigger } = useUserContext();
  const { authUser, authLoading } = useAuth();

  // Auto-set queriedUser from logged-in user if not already set
  const autoLoadFired = useRef(false);
  useEffect(() => {
    if (authLoading || !authUser || autoLoadFired.current) return;
    if (queriedUser) return;
    autoLoadFired.current = true;
    setQueriedUser(authUser);
  }, [authUser, authLoading, queriedUser, setQueriedUser]);

  // List state
  const [puzzles, setPuzzles] = useState<PuzzleData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  // Track which queriedUser we last fetched for
  const [fetchedUser, setFetchedUser] = useState("");

  // Completed puzzles: maps puzzle id → result
  const [completedPuzzles, setCompletedPuzzles] = useState<Record<number, "solved" | "failed">>({});


  // Solver state
  const [activePuzzle, setActivePuzzle] = useState<PuzzleData | null>(null);
  const [activePuzzleIndex, setActivePuzzleIndex] = useState(-1);
  const [game, setGame] = useState<Chess | null>(null);
  const [mounted, setMounted] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [showPlayedMove, setShowPlayedMove] = useState(false);
  const [showEvalBar, setShowEvalBar] = useState(false);
  const [currentEvalCp, setCurrentEvalCp] = useState<number | null>(null);
  const [highlightedSquares, setHighlightedSquares] = useState<Set<string>>(new Set());

  // Multi-move state
  const [currentPly, setCurrentPly] = useState(0);
  const [solvedMoves, setSolvedMoves] = useState(0);
  const [animatingOpponent, setAnimatingOpponent] = useState(false);
  const [puzzleCompleted, setPuzzleCompleted] = useState(false);
  const [puzzleFailed, setPuzzleFailed] = useState(false);
  const [failedBestMove, setFailedBestMove] = useState<string | null>(null);
  const [puzzleRequiredMoves, setPuzzleRequiredMoves] = useState(1);
  const [pvMoves, setPvMoves] = useState<string[]>([]);

  // Analysis mode state
  const [analysisMode, setAnalysisMode] = useState(false);
  const [analysisMoveHistory, setAnalysisMoveHistory] = useState<string[]>([]);
  const [analysisHistoryIndex, setAnalysisHistoryIndex] = useState(-1);
  const [puzzleStartFen, setPuzzleStartFen] = useState<string | null>(null);

  // Setup move state (opponent's move that leads to the puzzle position)
  const [animatingSetup, setAnimatingSetup] = useState(false);
  const [setupFen, setSetupFen] = useState<string | null>(null);
  const [setupMoveUci, setSetupMoveUci] = useState<string | null>(null);

  // Game/player info
  const [gameUrl, setGameUrl] = useState<string | null>(null);
  const [players, setPlayers] = useState<{
    white: string | null; black: string | null;
    whiteElo: string | null; blackElo: string | null;
  } | null>(null);
  const [playerCountries, setPlayerCountries] = useState<{
    white: string | null; black: string | null;
  }>({ white: null, black: null });

  // Report overview state
  const reportPuzzleCount = 500;
  const [reportTimeCategory, setReportTimeCategory] = useState<string>("");
  const [reportSummary, setReportSummary] = useState<{
    total: number;
    gamesAnalyzed: number;
    byCategory: Record<string, number>;
  } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Arena card state for report
  const [reportCard, setReportCard] = useState<{
    timeControl: "bullet" | "blitz" | "rapid";
    chessRating: number;
    peakRating?: number;
    arenaStats: ArenaStatsData;
  } | null>(null);
  const [reportProfile, setReportProfile] = useState<{
    title?: string;
    countryCode?: string;
    avatarUrl?: string;
  } | null>(null);
  const [highlightedCategory, setHighlightedCategory] = useState<string | null>(null);
  const [tacticalExpanded, setTacticalExpanded] = useState(false);
  const [bestMoveExpanded, setBestMoveExpanded] = useState(false);

  // Training Ground state
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [trainingPuzzles, setTrainingPuzzles] = useState<(PuzzleData | null)[]>(Array(10).fill(null));
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingOffset, setTrainingOffset] = useState(0);
  const profileCacheRef = useRef<{ username: string; profile: { title?: string; countryCode?: string; avatarUrl?: string }; ratings: Record<string, number>; peakRatings: Record<string, number> } | null>(null);

  // Target card state (read-only — set from main page via localStorage)
  const [targetStats, setTargetStats] = useState<{
    targetArenaRating: number;
    targetTier: string;
    targetShiny: boolean;
    expectedPhaseAccuracy: { opening: number; middlegame: number; endgame: number };
    expectedBestMoveRate: { opening: number; middlegame: number; endgame: number };
    expectedCategoryStats: Record<string, number>;
  } | null>(null);
  const [savedTargetRating, setSavedTargetRating] = useState<number | null>(null);

  // Background analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzedGames, setAnalyzedGames] = useState(0);
  const [totalAnalysisGames, setTotalAnalysisGames] = useState(0);

  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTriggerRef = useRef(0);
  const evalAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (evalAbortRef.current) evalAbortRef.current.abort();
    };
  }, []);

  // Fetch Stockfish eval for a position (used in analysis mode)
  const evalSeqRef = useRef(0);
  function fetchPositionEval(fen: string) {
    if (!showEvalBar) return;
    if (evalAbortRef.current) evalAbortRef.current.abort();
    const controller = new AbortController();
    evalAbortRef.current = controller;
    const seq = ++evalSeqRef.current;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/eval?fen=${encodeURIComponent(fen)}`,
          { signal: controller.signal }
        );
        if (res.ok && evalSeqRef.current === seq) {
          const data = await res.json();
          setCurrentEvalCp(data.eval);
        }
      } catch {
        // Aborted or network error — ignore
      }
    })();
  }

  // When eval bar is toggled on during analysis mode, fetch eval for current position
  useEffect(() => {
    if (analysisMode && showEvalBar && game) {
      fetchPositionEval(game.fen());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEvalBar]);

  // Keyboard shortcuts for analysis mode
  useEffect(() => {
    if (!analysisMode) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        undoAnalysisMove();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        redoAnalysisMove();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisMode, analysisHistoryIndex, analysisMoveHistory]);

  // Listen for sidebar search triggers
  useEffect(() => {
    if (!queriedUser || searchTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = searchTrigger;
    fetchPuzzles(queriedUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // Auto-fetch on mount if queriedUser is set but we haven't fetched yet (tab switch)
  // If coming from player card with a label filter, use fast path (just load existing puzzles)
  const hasLabelParam = searchParams.get("label") != null;
  useEffect(() => {
    if (queriedUser && !fetchedUser && !loading) {
      fetchPuzzles(queriedUser, hasLabelParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch chess.com profile + ratings when queriedUser changes
  useEffect(() => {
    if (!queriedUser) return;
    const user = queriedUser;
    if (profileCacheRef.current?.username === user.toLowerCase()) {
      setReportProfile(profileCacheRef.current.profile);
      return;
    }
    (async () => {
      let profileData: { title?: string; countryCode?: string; avatarUrl?: string } = {};
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
          if (p.avatar) profileData.avatarUrl = p.avatar;
          if (p.country) {
            const parts = p.country.split("/");
            profileData.countryCode = parts[parts.length - 1];
          }
        }
        if (ratingsRes.ok) {
          const d = await ratingsRes.json();
          for (const tc of ["bullet", "blitz", "rapid"] as const) {
            const key = `chess_${tc}`;
            if (d[key]?.last?.rating) ratings[tc] = d[key].last.rating;
            if (d[key]?.best?.rating) peakRatings[tc] = d[key].best.rating;
          }
        }
        profileCacheRef.current = { username: user.toLowerCase(), profile: profileData, ratings, peakRatings };
        setReportProfile(profileData);
        // Auto-select first available TC so the card shows immediately
        if (!reportTimeCategory) {
          for (const tc of ["rapid", "blitz", "bullet"] as const) {
            if (ratings[tc]) { setReportTimeCategory(tc); break; }
          }
        }
      } catch {
        // Non-critical
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queriedUser]);

  // Fetch arena stats (extracted so generateReport can re-call it)
  async function fetchArenaStats(user?: string, tc?: string) {
    const u = user || queriedUser;
    const t = tc || reportTimeCategory;
    if (!u || !t || t === "all") {
      setReportCard(null);
      return;
    }
    const cache = profileCacheRef.current;
    if (!cache || cache.username !== u.toLowerCase() || !cache.ratings[t]) {
      setReportCard(null);
      return;
    }
    const timeControl = t as "bullet" | "blitz" | "rapid";
    const rating = cache.ratings[timeControl];
    const peak = cache.peakRatings[timeControl];
    const profileData = cache.profile;
    try {
      const arenaParams = new URLSearchParams();
      arenaParams.set("timeCategory", timeControl);
      arenaParams.set("chessRating", String(rating));
      if (profileData.title) arenaParams.set("title", profileData.title);
      arenaParams.set("rated", "true");
      const arenaRes = await fetch(
        `${API_BASE}/users/${encodeURIComponent(u)}/arena-stats?${arenaParams}`
      );
      if (arenaRes.ok) {
        const arenaStats: ArenaStatsData = await arenaRes.json();
        setReportCard({ timeControl, chessRating: rating, peakRating: peak, arenaStats });
      } else {
        setReportCard(null);
      }
    } catch {
      setReportCard(null);
    }
  }

  // Fetch arena stats when time control selection changes
  useEffect(() => {
    fetchArenaStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queriedUser, reportTimeCategory]);

  // Load saved target from localStorage and fetch target stats
  useEffect(() => {
    if (!queriedUser || !reportTimeCategory || reportTimeCategory === "all") {
      setSavedTargetRating(null);
      setTargetStats(null);
      return;
    }
    // Read saved target from localStorage (same key format as main page)
    let saved: number | null = null;
    try {
      const v = localStorage.getItem(`arena_target_${queriedUser.toLowerCase()}_${reportTimeCategory}`);
      saved = v ? Number(v) : null;
    } catch { /* */ }
    setSavedTargetRating(saved);

    if (saved == null) {
      setTargetStats(null);
      return;
    }
    (async () => {
      try {
        const params = new URLSearchParams({
          targetRating: String(saved),
          timeCategory: reportTimeCategory,
        });
        const res = await fetch(`${API_BASE}/target-stats?${params}`);
        if (res.ok) setTargetStats(await res.json());
        else setTargetStats(null);
      } catch { setTargetStats(null); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queriedUser, reportTimeCategory]);

  const boardDisabled = (!analysisMode && (puzzleCompleted || puzzleFailed)) || animatingOpponent || animatingSetup;

  const categoryKeys = ["opening", "defending", "attacking", "tactics", "endgame", "strategic"] as const;

  async function loadPuzzleList(
    user: string,
    puzzleCount?: number,
    category?: string,
    timeCategory?: string,
    label?: string
  ) {
    const puzzleParams = new URLSearchParams({
      limit: String(puzzleCount || 500),
      rated: "true",
      ...(category ? { category } : {}),
      ...(timeCategory ? { timeCategory } : {}),
      ...(label ? { label } : {}),
    });
    const res = await fetch(
      `${API_BASE}/users/${encodeURIComponent(user)}/puzzles?${puzzleParams}`
    );
    if (res.ok) {
      const data = await res.json();
      setPuzzles(data.puzzles);
      setTotal(data.total);
    }
  }

  function startPolling(user: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/users/${encodeURIComponent(user)}/puzzles/status`
        );
        if (!res.ok) return;
        const status = await res.json();
        setAnalyzedGames(status.analyzedGames);
        setTotalAnalysisGames(status.totalGames);

        if (status.status !== "running") {
          // Done — stop polling, do final puzzle load
          setAnalyzing(false);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          await loadPuzzleList(user);
        } else if (status.puzzlesCreated > 0) {
          // New puzzles available — refresh the list
          await loadPuzzleList(user);
        }
      } catch {
        // Polling failure is non-critical
      }
    }, 5000);
  }

  async function fetchPuzzles(user: string, skipGenerate?: boolean) {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setLoading(true);
    setError("");
    setPuzzles([]);
    setTotal(0);
    setActivePuzzle(null);
    setAnalyzing(false);
    setCompletedPuzzles({});

    try {
      // Fast path: try loading existing puzzles first
      if (skipGenerate) {
        await loadPuzzleList(user);
        setFetchedUser(user);
        setLoading(false);
        setStatusMsg("");
        return;
      }

      setStatusMsg("Importing games from chess.com...");
      const importRes = await fetch(`${API_BASE}/import/chesscom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, rated: true }),
      });
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importRes.status})`);
      }

      setStatusMsg("Generating puzzles...");
      const genRes = await fetch(
        `${API_BASE}/users/${encodeURIComponent(user)}/puzzles/generate`,
        { method: "POST" }
      );
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => null);
        throw new Error(body?.error || `Puzzle generation failed (${genRes.status})`);
      }
      const genData = await genRes.json();

      // Load whatever puzzles are available now
      await loadPuzzleList(user);
      setFetchedUser(user);

      // If background analysis is running, start polling
      if (genData.analyzing) {
        setAnalyzing(true);
        setAnalyzedGames(genData.analyzedGames);
        setTotalAnalysisGames(genData.totalGames);
        startPolling(user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  }

  async function generateReport(user: string, puzzleCount: number, timeCategory: string) {
    setReportLoading(true);
    setError("");
    try {
      // 1. Import games with more history (200 games — after TC filter yields ~100)
      const importRes = await fetch(`${API_BASE}/import/chesscom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, rated: true, maxGames: 200 }),
      });
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importRes.status})`);
      }

      // 2. Generate puzzles from ALL evaluated games (no gameLimit)
      const isSpecificTC = timeCategory && timeCategory !== "all";
      const tcParam = isSpecificTC ? `?timeCategory=${timeCategory}` : "";
      const genRes = await fetch(
        `${API_BASE}/users/${encodeURIComponent(user)}/puzzles/generate${tcParam}`,
        { method: "POST" }
      );
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => null);
        throw new Error(body?.error || `Puzzle generation failed (${genRes.status})`);
      }
      const genData = await genRes.json();

      // 3. Fetch summary (no gameLimit — count ALL puzzles)
      const summaryParam = isSpecificTC ? `?timeCategory=${timeCategory}` : "";
      const summaryRes = await fetch(
        `${API_BASE}/users/${encodeURIComponent(user)}/puzzles/summary${summaryParam}`
      );
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setReportSummary(data);
      }

      // 4. Re-fetch arena stats (categories now have fresh position data)
      await fetchArenaStats(user, timeCategory);

      // 5. Load puzzle list
      const tcFilter = isSpecificTC ? timeCategory : undefined;
      await loadPuzzleList(user, puzzleCount, undefined, tcFilter);
      setFetchedUser(user);

      // If background analysis is running, start polling
      if (genData.analyzing) {
        setAnalyzing(true);
        setAnalyzedGames(genData.analyzedGames);
        setTotalAnalysisGames(genData.totalGames);
        startPolling(user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setReportLoading(false);
    }
  }

  function resetMultiMoveState() {
    setSelectedSquare(null);
    setShowPlayedMove(false);
    setHighlightedSquares(new Set());
    setCurrentPly(0);
    setSolvedMoves(0);
    setAnimatingOpponent(false);
    setPuzzleCompleted(false);
    setPuzzleFailed(false);
    setFailedBestMove(null);
    setCurrentEvalCp(null);
    setAnalysisMode(false);
    setAnalysisMoveHistory([]);
    setAnalysisHistoryIndex(-1);
  }

  function enterAnalysisMode() {
    if (!game) return;
    const currentFen = game.fen();
    setAnalysisMode(true);
    setAnalysisMoveHistory([currentFen]);
    setAnalysisHistoryIndex(0);
    setSelectedSquare(null);
    setHighlightedSquares(new Set());
    fetchPositionEval(currentFen);
  }

  function exitAnalysisMode() {
    setAnalysisMode(false);
    setSelectedSquare(null);
    setHighlightedSquares(new Set());
  }

  function tryAnalysisMove(from: string, to: string): boolean {
    if (!game) return false;
    const piece = game.get(from as Square);
    const isPromotion =
      piece?.type === "p" &&
      ((piece.color === "w" && to[1] === "8") ||
       (piece.color === "b" && to[1] === "1"));

    const moveOpts: { from: Square; to: Square; promotion?: "q" } = {
      from: from as Square,
      to: to as Square,
    };
    if (isPromotion) moveOpts.promotion = "q";

    const moveCopy = new Chess(game.fen());
    let move;
    try {
      move = moveCopy.move(moveOpts);
    } catch {
      return false;
    }
    if (!move) return false;

    const newFen = moveCopy.fen();
    // Truncate any redo history and push new position
    const newHistory = analysisMoveHistory.slice(0, analysisHistoryIndex + 1);
    newHistory.push(newFen);
    setAnalysisMoveHistory(newHistory);
    setAnalysisHistoryIndex(newHistory.length - 1);
    setGame(new Chess(newFen));
    setSelectedSquare(null);
    setHighlightedSquares(new Set());
    fetchPositionEval(newFen);
    return true;
  }

  function undoAnalysisMove() {
    if (analysisHistoryIndex <= 0) return;
    const newIndex = analysisHistoryIndex - 1;
    const fen = analysisMoveHistory[newIndex];
    setAnalysisHistoryIndex(newIndex);
    setGame(new Chess(fen));
    setSelectedSquare(null);
    setHighlightedSquares(new Set());
    fetchPositionEval(fen);
  }

  function redoAnalysisMove() {
    if (analysisHistoryIndex >= analysisMoveHistory.length - 1) return;
    const newIndex = analysisHistoryIndex + 1;
    const fen = analysisMoveHistory[newIndex];
    setAnalysisHistoryIndex(newIndex);
    setGame(new Chess(fen));
    setSelectedSquare(null);
    setHighlightedSquares(new Set());
    fetchPositionEval(fen);
  }

  function resetToPuzzleStart() {
    if (!puzzleStartFen) return;
    const fen = puzzleStartFen;
    setAnalysisMoveHistory([fen]);
    setAnalysisHistoryIndex(0);
    setGame(new Chess(fen));
    setSelectedSquare(null);
    setHighlightedSquares(new Set());
    fetchPositionEval(fen);
  }

  function playSetupAnimation(sFen: string, puzzleFen: string) {
    setGame(new Chess(sFen));
    setAnimatingSetup(true);
    animationTimeoutRef.current = setTimeout(() => {
      setGame(new Chess(puzzleFen));
      setAnimatingSetup(false);
    }, 600);
  }

  async function openPuzzle(puzzle: PuzzleData, index: number) {
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);

    // Set puzzle context immediately, clear board while loading
    setActivePuzzle(puzzle);
    setActivePuzzleIndex(index);
    setGame(null);
    resetMultiMoveState();
    setPuzzleRequiredMoves(puzzle.requiredMoves ?? 1);
    setPvMoves([]);
    setAnimatingSetup(true);
    setGameUrl(null);
    setPlayers(null);
    setPlayerCountries({ white: null, black: null });

    // Fetch full puzzle to get pvMoves + setup move + player info
    let sFen: string | null = null;
    let sMoveUci: string | null = null;
    let fetchedPlayers: { white: string | null; black: string | null } | null = null;
    try {
      const res = await fetch(`${API_BASE}/puzzles/${puzzle.id}`);
      if (res.ok) {
        const data = await res.json();
        sFen = data.setupFen ?? null;
        sMoveUci = data.setupMoveUci ?? null;
        if (data.pvMoves && Array.isArray(data.pvMoves) && data.pvMoves.length > 0) {
          setPvMoves(data.pvMoves);
          setPuzzleRequiredMoves(data.requiredMoves ?? Math.ceil(data.pvMoves.length / 2));
        }
        if (data.game?.externalId) {
          setGameUrl(data.game.externalId);
        }
        if (data.players) {
          setPlayers(data.players);
          fetchedPlayers = { white: data.players.white, black: data.players.black };
        }
      }
    } catch {
      // Fall through — will use bestMoveUci as single-move fallback
    }

    // Fetch country flags asynchronously (non-blocking)
    if (fetchedPlayers) {
      const wp = fetchedPlayers.white;
      const bp = fetchedPlayers.black;
      Promise.all([
        wp ? fetchPlayerCountry(wp) : Promise.resolve(null),
        bp ? fetchPlayerCountry(bp) : Promise.resolve(null),
      ]).then(([wc, bc]) => {
        setPlayerCountries({ white: wc, black: bc });
      });
    }

    setSetupFen(sFen);
    setSetupMoveUci(sMoveUci);
    setCurrentEvalCp(puzzle.evalBeforeCp);
    setPuzzleStartFen(puzzle.fen);

    if (sFen && sMoveUci) {
      // Show the pre-puzzle position, then animate the opponent's move
      playSetupAnimation(sFen, puzzle.fen);
    } else {
      // No setup data — just show the puzzle position
      setGame(new Chess(puzzle.fen));
      setAnimatingSetup(false);
    }
  }

  function resetPuzzle() {
    if (!activePuzzle) return;
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
    resetMultiMoveState();

    // Replay setup animation if available
    if (setupFen && setupMoveUci) {
      playSetupAnimation(setupFen, activePuzzle.fen);
    } else {
      setGame(new Chess(activePuzzle.fen));
    }
  }

  function goToNextPuzzle() {
    // Find the next unsolved puzzle in training list
    for (let i = activePuzzleIndex + 1; i < trainingPuzzles.length; i++) {
      const p = trainingPuzzles[i];
      if (p && !completedPuzzles[p.id]) {
        openPuzzle(p, i);
        return;
      }
    }
  }

  function backToList() {
    setActivePuzzle(null);
    setActivePuzzleIndex(-1);
    resetMultiMoveState();
  }

  async function selectCategory(category: string) {
    setSelectedCategory(category);
    setSelectedLabel(null);
    setTrainingPuzzles(Array(10).fill(null));
    setTrainingOffset(0);
    setCompletedPuzzles({});
    setActivePuzzle(null);
    setActivePuzzleIndex(-1);

    // For tactics, show the motif submenu instead of fetching immediately
    if (category === "tactics") return;

    setTrainingLoading(true);
    try {
      // Import + generate if needed
      if (queriedUser) {
        const isSpecificTC = reportTimeCategory && reportTimeCategory !== "all";
        const tcParam = isSpecificTC ? `?timeCategory=${reportTimeCategory}` : "";
        await fetch(
          `${API_BASE}/users/${encodeURIComponent(queriedUser)}/puzzles/generate${tcParam}`,
          { method: "POST" }
        );

        // Fetch 10 puzzles for this category
        const puzzleParams = new URLSearchParams({
          limit: "10",
          rated: "true",
          category,
          ...(isSpecificTC ? { timeCategory: reportTimeCategory } : {}),
        });
        const res = await fetch(
          `${API_BASE}/users/${encodeURIComponent(queriedUser)}/puzzles?${puzzleParams}`
        );
        if (res.ok) {
          const data = await res.json();
          setTrainingPuzzles(data.puzzles.slice(0, 10));
          setPuzzles(data.puzzles);
          setTotal(data.total);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setTrainingLoading(false);
    }
  }

  async function selectTacticsLabel(label: string | null) {
    setSelectedLabel(label);
    setTrainingPuzzles(Array(10).fill(null));
    setTrainingLoading(true);
    setTrainingOffset(0);
    setCompletedPuzzles({});
    setActivePuzzle(null);
    setActivePuzzleIndex(-1);

    try {
      if (queriedUser) {
        const isSpecificTC = reportTimeCategory && reportTimeCategory !== "all";
        const tcParam = isSpecificTC ? `?timeCategory=${reportTimeCategory}` : "";
        await fetch(
          `${API_BASE}/users/${encodeURIComponent(queriedUser)}/puzzles/generate${tcParam}`,
          { method: "POST" }
        );

        const puzzleParams = new URLSearchParams({
          limit: "10",
          rated: "true",
          category: "tactics",
          ...(label ? { label } : {}),
          ...(isSpecificTC ? { timeCategory: reportTimeCategory } : {}),
        });
        const res = await fetch(
          `${API_BASE}/users/${encodeURIComponent(queriedUser)}/puzzles?${puzzleParams}`
        );
        if (res.ok) {
          const data = await res.json();
          setTrainingPuzzles(data.puzzles.slice(0, 10));
          setPuzzles(data.puzzles);
          setTotal(data.total);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setTrainingLoading(false);
    }
  }

  async function loadMoreTraining() {
    if (!queriedUser || !selectedCategory) return;
    const newOffset = trainingOffset + 10;
    setTrainingOffset(newOffset);
    setTrainingLoading(true);

    // Add 10 more placeholder slots
    setTrainingPuzzles((prev) => [...prev, ...Array(10).fill(null)]);

    try {
      const isSpecificTC = reportTimeCategory && reportTimeCategory !== "all";
      const puzzleParams = new URLSearchParams({
        limit: "10",
        offset: String(newOffset),
        rated: "true",
        category: selectedCategory,
        ...(selectedLabel ? { label: selectedLabel } : {}),
        ...(isSpecificTC ? { timeCategory: reportTimeCategory } : {}),
      });
      const res = await fetch(
        `${API_BASE}/users/${encodeURIComponent(queriedUser)}/puzzles?${puzzleParams}`
      );
      if (res.ok) {
        const data = await res.json();
        setTrainingPuzzles((prev) => {
          const updated = [...prev];
          for (let i = 0; i < 10; i++) {
            updated[newOffset + i] = data.puzzles[i] || null;
          }
          return updated;
        });
        setPuzzles((prev) => [...prev, ...data.puzzles]);
      }
    } catch {
      // Non-critical
    } finally {
      setTrainingLoading(false);
    }
  }

  function tryMove(from: string, to: string): boolean {
    if (!activePuzzle || !game || boardDisabled || from === to) return false;

    // In analysis mode, allow any legal move (chess.js handles turn alternation)
    if (analysisMode) return tryAnalysisMove(from, to);

    // Only allow the user to move pieces of their own side
    const userIsWhite = activePuzzle.sideToMove === "WHITE";
    if ((game.turn() === "w") !== userIsWhite) return false;

    const piece = game.get(from as Square);
    const isPromotion =
      piece?.type === "p" &&
      ((piece.color === "w" && to[1] === "8") ||
       (piece.color === "b" && to[1] === "1"));

    const moveOpts: { from: Square; to: Square; promotion?: "q" } = {
      from: from as Square,
      to: to as Square,
    };
    if (isPromotion) moveOpts.promotion = "q";

    const moveCopy = new Chess(game.fen());
    let move;
    try {
      move = moveCopy.move(moveOpts);
    } catch {
      return false;
    }
    if (!move) return false;

    const uciMove = from + to + (move.promotion ? move.promotion : "");

    // Determine the expected move for this ply
    let expectedMove: string;
    if (pvMoves.length > 0 && currentPly < pvMoves.length) {
      expectedMove = pvMoves[currentPly];
    } else {
      expectedMove = activePuzzle.bestMoveUci;
    }

    const correct = uciMove.toLowerCase() === expectedMove.toLowerCase();

    if (!correct) {
      // Apply the wrong move so the user sees it on the board, then show failure
      game.move(moveOpts);
      setGame(new Chess(game.fen()));
      setSelectedSquare(null);
      setHighlightedSquares(new Set());
      setPuzzleFailed(true);
      setFailedBestMove(expectedMove);
      setCurrentEvalCp(activePuzzle.evalAfterCp);
      setCompletedPuzzles((prev) => ({ ...prev, [activePuzzle.id]: "failed" }));
      return true;
    }

    // Correct move — apply it
    game.move(moveOpts);
    setGame(new Chess(game.fen()));
    setSelectedSquare(null);
    setHighlightedSquares(new Set());

    const newSolved = solvedMoves + 1;
    setSolvedMoves(newSolved);

    // Check if puzzle is complete (this was the last user move)
    const isLastUserMove = currentPly + 1 >= pvMoves.length;
    if (isLastUserMove || pvMoves.length === 0) {
      setPuzzleCompleted(true);
      setCurrentEvalCp(activePuzzle.evalBeforeCp);
      setCompletedPuzzles((prev) => ({ ...prev, [activePuzzle.id]: "solved" }));
      return true;
    }

    // Not complete — auto-play the opponent's response move
    const opponentUci = pvMoves[currentPly + 1];
    setAnimatingOpponent(true);

    animationTimeoutRef.current = setTimeout(() => {
      setGame((prev) => {
        if (!prev) return prev;
        const next = new Chess(prev.fen());
        applyUciToChess(next, opponentUci);
        return next;
      });
      setCurrentPly(currentPly + 2);
      setAnimatingOpponent(false);
    }, 600);

    return true;
  }

  function handlePieceDrop({
    sourceSquare,
    targetSquare,
  }: {
    piece: { pieceType: string };
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean {
    if (!targetSquare) return false;
    return tryMove(sourceSquare, targetSquare);
  }

  function handlePieceClick({
    square,
  }: {
    isSparePiece: boolean;
    piece: { pieceType: string };
    square: string | null;
  }) {
    if (!game || boardDisabled || !square) return;

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    if (selectedSquare && selectedSquare !== square) {
      if (tryMove(selectedSquare, square)) return;
    }

    const piece = game.get(square as Square);
    if (piece) {
      const isWhitePiece = piece.color === "w";
      const isWhiteTurn = game.turn() === "w";
      // In analysis mode, allow selecting whichever side's turn it is
      if (analysisMode ? isWhitePiece === isWhiteTurn : isWhitePiece === isWhiteTurn) {
        setSelectedSquare(square as Square);
        return;
      }
    }
    setSelectedSquare(null);
  }

  function handleSquareClick({
    square,
  }: {
    piece: { pieceType: string } | null;
    square: string;
  }) {
    if (!game || boardDisabled || !selectedSquare) return;
    if (tryMove(selectedSquare, square)) return;

    // Move failed — if the clicked square has a friendly piece, select it
    const clickedPiece = game.get(square as Square);
    if (clickedPiece && (clickedPiece.color === "w") === (game.turn() === "w")) {
      setSelectedSquare(square as Square);
      return;
    }

    setSelectedSquare(null);
  }

  function handleSquareRightClick({ square }: { piece: { pieceType: string } | null; square: string }) {
    setHighlightedSquares((prev) => {
      const next = new Set(prev);
      if (next.has(square)) {
        next.delete(square);
      } else {
        next.add(square);
      }
      return next;
    });
  }

  function getSquareStyles(): Record<string, React.CSSProperties> {
    const styles: Record<string, React.CSSProperties> = {};

    // Right-click highlights
    for (const sq of highlightedSquares) {
      styles[sq] = { backgroundColor: "rgba(235, 97, 80, 0.8)" };
    }

    // Selected piece + legal move dots (override highlights)
    if (selectedSquare && game && (!boardDisabled || analysisMode)) {
      styles[selectedSquare] = { backgroundColor: "rgba(255, 255, 0, 0.4)" };

      const moves = game.moves({ square: selectedSquare, verbose: true });
      for (const move of moves) {
        const hasPiece = game.get(move.to as Square);
        styles[move.to] = hasPiece
          ? { background: "radial-gradient(circle, transparent 55%, rgba(0, 0, 0, 0.15) 55%)" }
          : { background: "radial-gradient(circle, rgba(0, 0, 0, 0.15) 25%, transparent 25%)" };
      }
    }

    return styles;
  }

  function getArrows(): Arrow[] {
    const arrows: Arrow[] = [];
    // Only show puzzle arrows when not deep in analysis (at initial position or not in analysis)
    const showPuzzleArrows = !analysisMode || analysisHistoryIndex <= 0;
    // Only show best move arrow on failure
    if (puzzleFailed && failedBestMove && showPuzzleArrows) {
      const best = uciToSquares(failedBestMove);
      arrows.push({ startSquare: best.from, endSquare: best.to, color: "rgba(105, 146, 62, 0.85)" });
    }
    // Show played move arrow — available anytime (before solving, after completion/failure)
    if (showPlayedMove && activePuzzle && !animatingSetup && showPuzzleArrows) {
      const played = uciToSquares(activePuzzle.playedMoveUci);
      arrows.push({ startSquare: played.from, endSquare: played.to, color: "rgba(194, 64, 52, 0.85)" });
    }
    return arrows;
  }

  // ── Puzzle Solver View ──
  if (activePuzzle) {
    const orientation = activePuzzle.sideToMove === "WHITE" ? "white" : "black";
    const isMultiMove = puzzleRequiredMoves > 1;
    const currentUserMove = solvedMoves + 1;

    const captured = game ? getCapturedPieces(game.fen()) : { whiteCaptured: [], blackCaptured: [], materialDiff: 0 };
    // Top player is the opponent (opposite of orientation)
    const topIsWhite = orientation === "black";
    const topName = topIsWhite ? (players?.white ?? "White") : (players?.black ?? "Black");
    const topElo = topIsWhite ? players?.whiteElo : players?.blackElo;
    const topCountry = topIsWhite ? playerCountries.white : playerCountries.black;
    const bottomName = topIsWhite ? (players?.black ?? "Black") : (players?.white ?? "White");
    const bottomElo = topIsWhite ? players?.blackElo : players?.whiteElo;
    const bottomCountry = topIsWhite ? playerCountries.black : playerCountries.white;
    const topCaptured = topIsWhite ? captured.whiteCaptured : captured.blackCaptured;
    const bottomCaptured = topIsWhite ? captured.blackCaptured : captured.whiteCaptured;
    // Material diff from top player's perspective
    const topMaterialDiff = topIsWhite ? captured.materialDiff : -captured.materialDiff;
    const timeControlDisplay = activePuzzle.game.timeControl ? formatTimeControl(activePuzzle.game.timeControl) : null;

    const PlayerBar = ({ name, elo, country, capturedPieces, materialAdv, isTop }: {
      name: string; elo: string | null | undefined; country: string | null;
      capturedPieces: { piece: string; symbol: string }[];
      materialAdv: number; isTop: boolean;
    }) => (
      <div
        className="flex items-center gap-2 px-2 py-1.5"
        style={{ backgroundColor: "#272522", minHeight: 32 }}
      >
        {country && (
          <span className="flex-shrink-0" style={{ fontSize: 14 }} title={country}>
            {countryCodeToFlag(country)}
          </span>
        )}
        <span className="text-sm font-semibold" style={{ color: "#fff" }}>{name}</span>
        {elo && <span className="text-xs" style={{ color: "#a09d9a" }}>({elo})</span>}
        <div className="flex items-center gap-0 ml-1" style={{ fontSize: 14, lineHeight: 1, color: "#d1cfcc" }}>
          {capturedPieces.map((cp, i) => (
            <span key={i} style={{ marginLeft: i > 0 && capturedPieces[i - 1]?.piece !== cp.piece ? 3 : 0 }}>
              {cp.symbol}
            </span>
          ))}
          {materialAdv > 0 && (
            <span className="text-xs font-bold ml-1" style={{ color: "#fff" }}>+{materialAdv}</span>
          )}
        </div>
      </div>
    );

    return (
      <div className="min-h-screen" style={{ backgroundColor: "#312e2b", backgroundImage: "repeating-conic-gradient(#2b2926 0% 25%, transparent 0% 50%)", backgroundSize: "60px 60px", color: "#fff" }}>
        <main className="mx-auto max-w-6xl px-4 py-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
            {/* Board with eval bar and player bars */}
            <div className="flex-shrink-0 flex" style={{ gap: 0 }}>
              {/* Eval bar (toggleable) */}
              {showEvalBar && (() => {
                const evalText = currentEvalCp != null
                  ? Math.abs(currentEvalCp) >= 9000
                    ? (currentEvalCp > 0 ? "+" : "-") + "M"
                    : (currentEvalCp >= 0 ? "+" : "") + (currentEvalCp / 100).toFixed(1)
                  : null;
                const whitePct = currentEvalCp != null ? cpToWhiteWinPct(currentEvalCp) : 50;
                const favorWhite = currentEvalCp != null ? currentEvalCp >= 0 : true;
                return (
                <div
                  className="flex-shrink-0 relative overflow-hidden group"
                  style={{
                    width: 28,
                    marginTop: 32,
                    marginRight: 6,
                    height: 520,
                    backgroundColor: "#1a1816",
                    borderRadius: 4,
                    cursor: "default",
                  }}
                >
                  {/* White portion (from bottom) */}
                  <div
                    style={{
                      position: "absolute",
                      bottom: orientation === "white" ? 0 : undefined,
                      top: orientation === "black" ? 0 : undefined,
                      left: 0,
                      right: 0,
                      height: `${whitePct}%`,
                      backgroundColor: "#f0f0f0",
                      transition: "height 0.4s ease",
                    }}
                  />
                  {/* Black portion */}
                  <div
                    style={{
                      position: "absolute",
                      top: orientation === "white" ? 0 : undefined,
                      bottom: orientation === "black" ? 0 : undefined,
                      left: 0,
                      right: 0,
                      height: `${100 - whitePct}%`,
                      backgroundColor: "#1a1816",
                      transition: "height 0.4s ease",
                    }}
                  />
                  {/* Eval label on hover */}
                  {evalText && (
                    <div
                      className="opacity-0 group-hover:opacity-100"
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: "50%",
                        transform: "translate(-50%, -50%)",
                        fontSize: 10,
                        fontWeight: 700,
                        color: favorWhite ? "#1a1816" : "#f0f0f0",
                        backgroundColor: favorWhite ? "rgba(240,240,240,0.9)" : "rgba(26,24,22,0.9)",
                        padding: "2px 4px",
                        borderRadius: 3,
                        whiteSpace: "nowrap",
                        transition: "opacity 0.15s ease",
                        pointerEvents: "none",
                        zIndex: 2,
                      }}
                    >
                      {evalText}
                    </div>
                  )}
                </div>
                );
              })()}

              <div style={{ width: 520 }}>
                {/* Analysis mode banner — above player bar, outside board sizing */}
                {analysisMode && (
                  <div
                    className="flex items-center justify-center py-1"
                    style={{ backgroundColor: "#1a2d3b", color: "#5ba3d9", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}
                  >
                    ANALYSIS MODE
                  </div>
                )}
                {/* Top player bar (opponent) */}
                <PlayerBar
                  name={topName}
                  elo={topElo}
                  country={topCountry}
                  capturedPieces={topCaptured}
                  materialAdv={topMaterialDiff}
                  isTop={true}
                />
                {/* Board */}
                <div className="overflow-hidden" style={{ width: 520, height: 520 }}>
                  {mounted && game ? (
                    <Chessboard
                      options={{
                        position: game.fen(),
                        onPieceDrop: handlePieceDrop,
                        onPieceClick: handlePieceClick,
                        onSquareClick: handleSquareClick,
                        onSquareRightClick: handleSquareRightClick,
                        boardOrientation: orientation,
                        allowDragging: !boardDisabled,
                        darkSquareStyle: { backgroundColor: "#6596EB" },
                        lightSquareStyle: { backgroundColor: "#EAF1F8" },
                        arrows: getArrows(),
                        squareStyles: getSquareStyles(),
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-center w-full h-full" style={{ backgroundColor: "#272522" }}>
                      <div
                        className="h-8 w-8 animate-spin rounded-full border-4"
                        style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
                      />
                    </div>
                  )}
                </div>
                {/* Bottom player bar (user) */}
                <PlayerBar
                  name={bottomName}
                  elo={bottomElo}
                  country={bottomCountry}
                  capturedPieces={bottomCaptured}
                  materialAdv={-topMaterialDiff}
                  isTop={false}
                />
                {/* Time control */}
                {timeControlDisplay && (
                  <div className="flex items-center justify-center py-1" style={{ color: "#a09d9a" }}>
                    <span className="text-xs font-semibold">{timeControlDisplay}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Side Panel — matches board height */}
            {(() => {
              const catDisplay = activePuzzle.category ? CATEGORY_DISPLAY[activePuzzle.category] : null;
              const catAccentColor = catDisplay?.fg || "#5ba3d9";
              return (
              <div
                className="flex-shrink-0 flex flex-col rounded-md overflow-hidden"
                style={{
                  width: 280,
                  marginTop: 32,
                  minHeight: 520,
                  backgroundColor: "#272522",
                  borderTop: `3px solid ${catAccentColor}`,
                }}
              >
                {/* Header — category badge + puzzle number + back */}
                <div
                  className="px-4 py-3"
                  style={{ borderBottom: "1px solid #3d3a37" }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {catDisplay && (
                        <span
                          className="rounded px-2 py-0.5 text-xs font-extrabold"
                          style={{ backgroundColor: catDisplay.bg, color: catDisplay.fg }}
                        >
                          {catDisplay.label}
                        </span>
                      )}
                      <h2 className="text-sm font-bold" style={{ color: "#fff" }}>
                        Puzzle #{activePuzzleIndex + 1}
                      </h2>
                    </div>
                    <button
                      onClick={() => setActivePuzzle(null)}
                      className="text-xs font-semibold px-2.5 py-1 rounded transition-colors"
                      style={{ backgroundColor: "#3d3a37", color: "#d1cfcc" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4b4847")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#3d3a37")}
                    >
                      Back
                    </button>
                  </div>
                  {/* Label pills */}
                  {activePuzzle.labels && activePuzzle.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {activePuzzle.labels.map((label) => (
                        <span
                          key={label}
                          className="rounded px-2 py-0.5 text-xs font-semibold"
                          style={{ backgroundColor: "#3d3a37", color: "#d1cfcc" }}
                        >
                          {label.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Prompt / Status area */}
                <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d3a37" }}>
                  {/* Animating */}
                  {(animatingSetup || animatingOpponent) && !analysisMode && (
                    <div className="flex items-center gap-2 text-xs" style={{ color: "#d1cfcc" }}>
                      <div
                        className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                        style={{ borderColor: "#4b4847", borderTopColor: "#81b64c" }}
                      />
                      Opponent is playing...
                    </div>
                  )}

                  {/* Active prompt (during puzzle) */}
                  {!analysisMode && !puzzleCompleted && !puzzleFailed && !animatingSetup && !animatingOpponent && (
                    <div
                      className="rounded px-3 py-2 text-xs font-semibold"
                      style={{
                        backgroundColor: activePuzzle.sideToMove === "WHITE" ? "#f0d9b5" : "#b58863",
                        color: activePuzzle.sideToMove === "WHITE" ? "#312e2b" : "#fff",
                      }}
                    >
                      {isMultiMove
                        ? `Move ${currentUserMove} of ${puzzleRequiredMoves} \u2014 find the best move`
                        : `Your turn \u2014 find the best move`
                      }
                    </div>
                  )}

                  {/* Success (not in analysis) */}
                  {!analysisMode && puzzleCompleted && (
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: "#81b64c" }}>
                        <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>&#10003;</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: "#81b64c" }}>
                          {isMultiMove ? "Puzzle Solved!" : "Correct!"}
                        </p>
                        {isMultiMove && (
                          <p className="text-xs" style={{ color: "#d1cfcc" }}>
                            All {puzzleRequiredMoves} moves correct
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Failure (not in analysis) */}
                  {!analysisMode && puzzleFailed && (
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: "#e05252" }}>
                        <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>&#10005;</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: "#e05252" }}>Incorrect</p>
                        {isMultiMove && solvedMoves > 0 && (
                          <p className="text-xs" style={{ color: "#d1cfcc" }}>
                            {solvedMoves} of {puzzleRequiredMoves} moves
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Analysis mode indicator */}
                  {analysisMode && (
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: "#5ba3d9" }}
                      >
                        <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>&#9654;</span>
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: "#5ba3d9" }}>Analysis Mode</p>
                        <p className="text-xs" style={{ color: "#a09d9a" }}>
                          Depth: {analysisHistoryIndex} move{analysisHistoryIndex !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Multi-move progress dots */}
                  {isMultiMove && !analysisMode && (
                    <div className="flex items-center gap-1.5 mt-2">
                      {Array.from({ length: puzzleRequiredMoves }).map((_, i) => (
                        <div
                          key={i}
                          className="rounded-full"
                          style={{
                            width: 10,
                            height: 10,
                            backgroundColor:
                              i < solvedMoves
                                ? "#81b64c"
                                : puzzleFailed && i === solvedMoves
                                ? "#e05252"
                                : "#4b4847",
                          }}
                        />
                      ))}
                      <span className="text-xs ml-1" style={{ color: "#a09d9a" }}>
                        {solvedMoves}/{puzzleRequiredMoves}
                      </span>
                    </div>
                  )}
                </div>

                {/* Analysis controls (analysis mode only) */}
                {analysisMode && (
                  <div className="px-4 py-3 flex gap-2" style={{ borderBottom: "1px solid #3d3a37" }}>
                    <button
                      onClick={undoAnalysisMove}
                      disabled={analysisHistoryIndex <= 0}
                      className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                      style={{
                        backgroundColor: analysisHistoryIndex <= 0 ? "#3d3a37" : "#4b4847",
                        color: analysisHistoryIndex <= 0 ? "#6b6865" : "#fff",
                        cursor: analysisHistoryIndex <= 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      &#9664; Undo
                    </button>
                    <button
                      onClick={redoAnalysisMove}
                      disabled={analysisHistoryIndex >= analysisMoveHistory.length - 1}
                      className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                      style={{
                        backgroundColor: analysisHistoryIndex >= analysisMoveHistory.length - 1 ? "#3d3a37" : "#4b4847",
                        color: analysisHistoryIndex >= analysisMoveHistory.length - 1 ? "#6b6865" : "#fff",
                        cursor: analysisHistoryIndex >= analysisMoveHistory.length - 1 ? "not-allowed" : "pointer",
                      }}
                    >
                      Redo &#9654;
                    </button>
                    <button
                      onClick={resetToPuzzleStart}
                      className="rounded px-3 py-2 text-xs font-bold transition-colors"
                      style={{ backgroundColor: "#3d3a37", color: "#d1cfcc" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4b4847")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#3d3a37")}
                      title="Reset to puzzle start position"
                    >
                      &#8634;
                    </button>
                  </div>
                )}

                {/* Toggle buttons — chess.com review style */}
                <div style={{ borderBottom: "1px solid #3d3a37" }}>
                  {/* Show My Move toggle */}
                  <button
                    onClick={() => setShowPlayedMove((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
                    style={{ backgroundColor: showPlayedMove ? "#3d3a37" : "transparent" }}
                    onMouseEnter={(e) => { if (!showPlayedMove) e.currentTarget.style.backgroundColor = "#332f2c"; }}
                    onMouseLeave={(e) => { if (!showPlayedMove) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex items-center justify-center rounded"
                        style={{ width: 26, height: 26, backgroundColor: "#e0524220", color: "#e05252", fontSize: 13 }}
                      >
                        &#8618;
                      </div>
                      <span className="text-xs font-semibold" style={{ color: "#fff" }}>Show My Move</span>
                    </div>
                    {/* Toggle switch */}
                    <div
                      className="relative rounded-full transition-colors"
                      style={{
                        width: 32,
                        height: 18,
                        backgroundColor: showPlayedMove ? "#e05252" : "#4b4847",
                      }}
                    >
                      <div
                        className="absolute top-0.5 rounded-full transition-transform"
                        style={{
                          width: 14,
                          height: 14,
                          backgroundColor: "#fff",
                          transform: showPlayedMove ? "translateX(16px)" : "translateX(2px)",
                        }}
                      />
                    </div>
                  </button>

                  {/* Show Evaluation toggle */}
                  <button
                    onClick={() => setShowEvalBar((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
                    style={{ backgroundColor: showEvalBar ? "#3d3a37" : "transparent" }}
                    onMouseEnter={(e) => { if (!showEvalBar) e.currentTarget.style.backgroundColor = "#332f2c"; }}
                    onMouseLeave={(e) => { if (!showEvalBar) e.currentTarget.style.backgroundColor = "transparent"; }}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex items-center justify-center rounded"
                        style={{ width: 26, height: 26, backgroundColor: "#81b64c20", color: "#81b64c", fontSize: 13 }}
                      >
                        &#9881;
                      </div>
                      <span className="text-xs font-semibold" style={{ color: "#fff" }}>Evaluation Bar</span>
                    </div>
                    <div
                      className="relative rounded-full transition-colors"
                      style={{
                        width: 32,
                        height: 18,
                        backgroundColor: showEvalBar ? "#81b64c" : "#4b4847",
                      }}
                    >
                      <div
                        className="absolute top-0.5 rounded-full transition-transform"
                        style={{
                          width: 14,
                          height: 14,
                          backgroundColor: "#fff",
                          transform: showEvalBar ? "translateX(16px)" : "translateX(2px)",
                        }}
                      />
                    </div>
                  </button>
                </div>

                {/* Line comparison (after completion/failure) */}
                {(puzzleCompleted || puzzleFailed) && (
                  <div className="px-4 py-3 space-y-2.5" style={{ borderBottom: "1px solid #3d3a37" }}>
                    {/* Best line */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#81b64c" }}>
                          Best line
                        </span>
                        <span className="font-mono text-xs font-bold" style={{ color: "#81b64c" }}>
                          {formatEval(activePuzzle.evalBeforeCp)}
                        </span>
                      </div>
                      <p className="text-xs font-mono leading-relaxed" style={{ color: "#fff" }}>
                        {formatMoveList(activePuzzle.fen, pvMoves.length > 0 ? pvMoves : [activePuzzle.bestMoveUci])}
                      </p>
                    </div>

                    <div style={{ borderTop: "1px solid #3d3a37" }} />

                    {/* Your game */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "#e05252" }}>
                          Your game
                        </span>
                        <span className="font-mono text-xs font-bold" style={{ color: "#e05252" }}>
                          {formatEval(activePuzzle.evalBeforeCp)} &rarr; {formatEval(activePuzzle.evalAfterCp)}
                        </span>
                      </div>
                      <p className="text-xs font-mono leading-relaxed" style={{ color: "#d1cfcc" }}>
                        {formatMoveList(activePuzzle.fen, [activePuzzle.playedMoveUci])}
                      </p>
                    </div>
                  </div>
                )}

                {/* Action buttons (after completion/failure) */}
                {(puzzleCompleted || puzzleFailed) && (
                  <div className="flex gap-2 px-4 py-3" style={{ borderBottom: "1px solid #3d3a37" }}>
                    {!analysisMode && (
                      <button
                        onClick={enterAnalysisMode}
                        className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                        style={{ backgroundColor: "#5ba3d9", color: "#fff" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#6db3e9")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#5ba3d9")}
                      >
                        Analyze
                      </button>
                    )}
                    {analysisMode && (
                      <button
                        onClick={exitAnalysisMode}
                        className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                        style={{ backgroundColor: "#4b4847", color: "#d1cfcc" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#5b5857")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#4b4847")}
                      >
                        Exit Analysis
                      </button>
                    )}
                    <button
                      onClick={resetPuzzle}
                      className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                      style={{ backgroundColor: "#c27a30", color: "#fff" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#d48a3a")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#c27a30")}
                    >
                      Retry
                    </button>
                    {!analysisMode && trainingPuzzles.some((p, i) => i > activePuzzleIndex && p && !completedPuzzles[p.id]) && (
                      <button
                        onClick={goToNextPuzzle}
                        className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                        style={{ backgroundColor: "#81b64c", color: "#fff" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#95c95f")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#81b64c")}
                      >
                        Next
                      </button>
                    )}
                    {!analysisMode && selectedCategory && (
                      <button
                        onClick={backToList}
                        className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                        style={{ backgroundColor: "#3d3a37", color: "#d1cfcc" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4b4847")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#3d3a37")}
                      >
                        Back to list
                      </button>
                    )}
                  </div>
                )}

                {/* Spacer pushes game info to bottom */}
                <div className="flex-1" />

                {/* Game info — pinned to bottom */}
                <div className="px-4 py-3 space-y-1.5" style={{ borderTop: "1px solid #3d3a37" }}>
                  <div className="flex items-center gap-2 text-xs" style={{ color: "#d1cfcc" }}>
                    <span>{new Date(activePuzzle.game.endDate).toLocaleDateString()}</span>
                    <span style={{ color: "#4b4847" }}>&middot;</span>
                    <span>{formatTimeControl(activePuzzle.game.timeControl)}</span>
                  </div>
                  {gameUrl && (
                    <a
                      href={gameUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold transition-colors block"
                      style={{ color: "#81b64c" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#95c95f")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#81b64c")}
                    >
                      View game on chess.com &#8599;
                    </a>
                  )}
                </div>
              </div>
              );
            })()}
          </div>
        </main>
      </div>
    );
  }

  // ── SVG Donut Chart ──
  function DonutChart({ data, size = 200, thickness = 36, highlightedIndex, onSegmentHover }: {
    data: { label: string; value: number; color: string; categoryKey?: string }[];
    size?: number;
    thickness?: number;
    highlightedIndex?: number | null;
    onSegmentHover?: (categoryKey: string | null) => void;
  }) {
    const [hovered, setHovered] = useState<number | null>(null);
    const total = data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) return null;

    const center = size / 2;
    const radius = (size - thickness) / 2;

    // Build arc segments
    let cumAngle = -90; // Start from top
    const segments = data.map((d, i) => {
      const pct = d.value / total;
      const angle = pct * 360;
      const startAngle = cumAngle;
      const endAngle = cumAngle + angle;
      cumAngle = endAngle;

      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;
      const largeArc = angle > 180 ? 1 : 0;

      const x1 = center + radius * Math.cos(startRad);
      const y1 = center + radius * Math.sin(startRad);
      const x2 = center + radius * Math.cos(endRad);
      const y2 = center + radius * Math.sin(endRad);

      const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;

      return { ...d, path, pct, index: i };
    });

    return (
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size}>
          {segments.map((seg) => (
            <path
              key={seg.index}
              d={seg.path}
              fill="none"
              stroke={seg.color}
              strokeWidth={hovered === seg.index || highlightedIndex === seg.index ? thickness + 6 : thickness}
              strokeLinecap="butt"
              style={{ transition: "stroke-width 0.15s ease", cursor: "pointer" }}
              onMouseEnter={() => { setHovered(seg.index); onSegmentHover?.(seg.categoryKey || null); }}
              onMouseLeave={() => { setHovered(null); onSegmentHover?.(null); }}
            />
          ))}
          {/* Center text */}
          <text
            x={center}
            y={center - 8}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#fff"
            fontSize={28}
            fontWeight={800}
          >
            {total}
          </text>
          <text
            x={center}
            y={center + 16}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#9b9895"
            fontSize={11}
            fontWeight={600}
          >
            puzzles
          </text>
        </svg>
        {/* Tooltip */}
        {hovered !== null && segments[hovered] && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -120%)",
              backgroundColor: "#1a1816",
              border: `2px solid ${segments[hovered].color}`,
              borderRadius: 8,
              padding: "6px 12px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            <span className="text-xs font-extrabold" style={{ color: segments[hovered].color }}>
              {segments[hovered].label}
            </span>
            <span className="text-xs font-bold ml-2" style={{ color: "#fff" }}>
              {segments[hovered].value}
            </span>
            <span className="text-xs ml-1" style={{ color: "#9b9895" }}>
              ({Math.round(segments[hovered].pct * 100)}%)
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── Puzzle List View ──
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#312e2b", backgroundImage: "repeating-conic-gradient(#2b2926 0% 25%, transparent 0% 50%)", backgroundSize: "60px 60px", color: "#fff" }}>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-50%) translateX(-8px); } to { opacity: 1; transform: translateY(-50%) translateX(0); } } @keyframes fadeInRight { from { opacity: 0; transform: translateY(-50%) translateX(8px); } to { opacity: 1; transform: translateY(-50%) translateX(0); } }`}</style>
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {/* Training Ground */}
        {queriedUser && !loading && !activePuzzle && !selectedCategory && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 32, paddingTop: 16 }}>
            {/* Header */}
            <h1 className="font-extrabold" style={{ color: "#fff", fontSize: 28, marginBottom: 0, textAlign: "center" }}>
              Training Ground
            </h1>

            {/* Player Card (centered) with speech bubble on the side */}
            <div style={{ position: "relative", display: "inline-flex", justifyContent: "center" }}>
              {reportCard && (() => {
                // Compute stat diffs vs target (green = reached, red = needs work)
                const diffs = (() => {
                  if (!targetStats) return undefined;
                  const tRating = targetStats.targetArenaRating;
                  const expectedCats = targetStats.expectedCategoryStats;
                  const currentArena = reportCard.arenaStats.arenaRating;
                  const currentCategories = reportCard.arenaStats.categories;
                  const form = reportCard.arenaStats.form ?? 0;
                  const catDiff = (key: string) =>
                    (expectedCats?.[key] ?? tRating) - ((currentCategories[key as keyof typeof currentCategories]?.stat ?? currentArena) + form);
                  return {
                    overall: tRating - (currentArena + form),
                    attacking: catDiff("attacking"),
                    defending: catDiff("defending"),
                    tactics: catDiff("tactics"),
                    strategic: catDiff("strategic"),
                    opening: catDiff("opening"),
                    endgame: catDiff("endgame"),
                  };
                })();

                return (
                  <PlayerCard
                    username={queriedUser}
                    timeControl={reportCard.timeControl}
                    chessRating={reportCard.chessRating}
                    peakRating={reportCard.peakRating}
                    title={reportProfile?.title}
                    countryCode={reportProfile?.countryCode}
                    avatarUrl={reportProfile?.avatarUrl}
                    arenaStats={reportCard.arenaStats}
                    statDiffs={diffs}
                    highlightedStat={highlightedCategory ? (PUZZLE_TO_CARD_STAT[highlightedCategory] || null) : null}
                  />
                );
              })()}

              {/* Speech bubble positioned to the left of the card — appears after card loads */}
              {reportCard && (
                <div style={{
                  position: "absolute",
                  right: "calc(100% + 20px)",
                  top: "30%",
                  transform: "translateY(-50%)",
                  width: 240,
                  animation: "fadeIn 0.4s ease-out",
                }}>
                  {/* Tail pointing right toward the card */}
                  <div style={{
                    position: "absolute",
                    top: "50%",
                    right: -10,
                    transform: "translateY(-50%)",
                    width: 0,
                    height: 0,
                    borderTop: "10px solid transparent",
                    borderBottom: "10px solid transparent",
                    borderLeft: "12px solid #3a3733",
                  }} />
                  <div style={{
                    backgroundColor: "#3a3733",
                    borderRadius: 16,
                    padding: "14px 20px",
                  }}>
                    <p style={{ color: "#fff", fontSize: 20, fontWeight: 950, margin: 0, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
                      Welcome to the training ground!
                    </p>
                    <p className="font-bold" style={{ color: "#e8e6e3", fontSize: 14, margin: "8px 0 0", lineHeight: 1.5 }}>
                      We have personalized puzzles collected from your games ready for you. What do you prefer working on today?
                    </p>
                  </div>
                </div>
              )}

              {/* Recommendation bubble on the right — appears after card loads */}
              {reportCard && savedTargetRating && (
                <div style={{
                  position: "absolute",
                  left: "calc(100% + 20px)",
                  top: "70%",
                  transform: "translateY(-50%)",
                  width: 240,
                  animation: "fadeInRight 0.4s ease-out 0.15s both",
                }}>
                  {/* Tail pointing left toward the card */}
                  <div style={{
                    position: "absolute",
                    top: "50%",
                    left: -10,
                    transform: "translateY(-50%)",
                    width: 0,
                    height: 0,
                    borderTop: "10px solid transparent",
                    borderBottom: "10px solid transparent",
                    borderRight: "12px solid #3a3733",
                  }} />
                  <div style={{
                    backgroundColor: "#3a3733",
                    borderRadius: 16,
                    padding: "14px 20px",
                  }}>
                    <p style={{ color: "#fff", fontSize: 20, fontWeight: 950, margin: 0, lineHeight: 1.3, letterSpacing: "-0.01em" }}>
                      Our recommendation
                    </p>
                    <p className="font-bold" style={{ color: "#e8e6e3", fontSize: 14, margin: "8px 0 0", lineHeight: 1.5 }}>
                      Compared to your target rating at {savedTargetRating}, you need to improve the categories marked in red.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Time control selector */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <span className="text-xs font-bold" style={{ color: "#9b9895", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Time control
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {(["rapid", "blitz", "bullet"] as const).map((tc) => (
                  <button
                    key={tc}
                    onClick={() => setReportTimeCategory(tc)}
                    className="text-sm font-extrabold transition-colors"
                    style={{
                      padding: "8px 24px",
                      borderRadius: 20,
                      border: "none",
                      backgroundColor: reportTimeCategory === tc ? "#81b64c" : "#3a3733",
                      color: reportTimeCategory === tc ? "#fff" : "#9b9895",
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                    onMouseEnter={(e) => { if (reportTimeCategory !== tc) e.currentTarget.style.backgroundColor = "#4b4847"; }}
                    onMouseLeave={(e) => { if (reportTimeCategory !== tc) e.currentTarget.style.backgroundColor = "#3a3733"; }}
                  >
                    {tc}
                  </button>
                ))}
              </div>
            </div>

            {/* Category buttons — 3×2 grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              width: "100%",
              maxWidth: 520,
            }}>
              {(["tactics", "opening", "endgame", "strategic", "attacking", "defending"] as const).map((cat) => {
                const display = CATEGORY_DISPLAY[cat];
                const disabled = !reportTimeCategory;
                return (
                  <button
                    key={cat}
                    onClick={() => !disabled && selectCategory(cat)}
                    disabled={disabled}
                    className="font-extrabold transition-colors"
                    style={{
                      height: 56,
                      borderRadius: 10,
                      border: "none",
                      backgroundColor: disabled ? "#2a2825" : "#3a3733",
                      color: disabled ? "#4b4847" : "#fff",
                      fontSize: 15,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.filter = "brightness(1.2)"; setHighlightedCategory(cat); } }}
                    onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.filter = "none"; setHighlightedCategory(null); } }}
                  >
                    {display.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tactics Motif Submenu */}
        {queriedUser && !loading && !activePuzzle && selectedCategory === "tactics" && selectedLabel === null && (
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            {/* Header with back button */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
              <button
                onClick={() => { setSelectedCategory(null); }}
                className="text-sm font-bold transition-colors"
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "none",
                  backgroundColor: "#3a3733",
                  color: "#d1cfcc",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#4b4847"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#3a3733"; }}
              >
                &larr; Back
              </button>
              <h2 className="font-extrabold" style={{
                color: CATEGORY_DISPLAY.tactics.fg,
                fontSize: 22,
              }}>
                Tactics Training
              </h2>
            </div>

            {/* All Tactics button */}
            <button
              onClick={() => selectTacticsLabel("")}
              className="font-extrabold transition-colors"
              style={{
                width: "100%",
                height: 56,
                borderRadius: 10,
                border: "none",
                backgroundColor: CATEGORY_DISPLAY.tactics.bg,
                color: CATEGORY_DISPLAY.tactics.fg,
                fontSize: 16,
                cursor: "pointer",
                marginBottom: 12,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
            >
              All Tactics
            </button>

            {/* Motif grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}>
              {TACTICAL_MOTIFS.map((motif) => (
                <button
                  key={motif.key}
                  onClick={() => selectTacticsLabel(motif.key)}
                  className="font-extrabold transition-colors"
                  style={{
                    height: 52,
                    borderRadius: 10,
                    border: "none",
                    backgroundColor: "#3a3733",
                    color: "#fff",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = CATEGORY_DISPLAY.tactics.bg; e.currentTarget.style.color = CATEGORY_DISPLAY.tactics.fg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#3a3733"; e.currentTarget.style.color = "#fff"; }}
                >
                  {motif.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Puzzle List (category selected, no active puzzle) */}
        {queriedUser && !loading && !activePuzzle && selectedCategory && !(selectedCategory === "tactics" && selectedLabel === null) && (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            {/* Header with back button */}
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <button
                onClick={() => {
                  if (selectedCategory === "tactics") {
                    // Go back to motif submenu
                    setSelectedLabel(null);
                    setTrainingPuzzles(Array(10).fill(null));
                    setPuzzles([]);
                  } else {
                    setSelectedCategory(null);
                    setTrainingPuzzles(Array(10).fill(null));
                  }
                }}
                className="text-sm font-bold transition-colors"
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "none",
                  backgroundColor: "#3a3733",
                  color: "#d1cfcc",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#4b4847"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#3a3733"; }}
              >
                &larr; Back
              </button>
              <h2 className="font-extrabold" style={{
                color: CATEGORY_DISPLAY[selectedCategory]?.fg || "#fff",
                fontSize: 22,
              }}>
                {selectedCategory === "tactics" && selectedLabel
                  ? `${TACTICAL_MOTIFS.find((m) => m.key === selectedLabel)?.label || "All"} Training`
                  : selectedCategory === "tactics"
                  ? "All Tactics Training"
                  : `${CATEGORY_DISPLAY[selectedCategory]?.label || selectedCategory} Training`}
              </h2>
              {trainingLoading && (
                <div
                  className="h-4 w-4 animate-spin rounded-full border-2 flex-shrink-0"
                  style={{ borderColor: "#4b4847", borderTopColor: "#81b64c" }}
                />
              )}
            </div>

            {/* Puzzle rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {trainingPuzzles.map((puzzle, idx) => {
                const isLoaded = puzzle !== null;
                const result = puzzle ? completedPuzzles[puzzle.id] : undefined;
                const isSolved = result === "solved";
                const isFailed = result === "failed";

                return (
                  <div
                    key={idx}
                    onClick={() => isLoaded && openPuzzle(puzzle, idx)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      borderRadius: 10,
                      backgroundColor: isLoaded ? "#262421" : "#1e1c1a",
                      cursor: isLoaded ? "pointer" : "default",
                      opacity: isLoaded ? 1 : 0.4,
                      pointerEvents: isLoaded ? "auto" : "none",
                      transition: "background-color 0.15s ease",
                    }}
                    onMouseEnter={(e) => { if (isLoaded) e.currentTarget.style.backgroundColor = "#3a3733"; }}
                    onMouseLeave={(e) => { if (isLoaded) e.currentTarget.style.backgroundColor = "#262421"; }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      border: isSolved ? "2px solid #81b64c" : isFailed ? "2px solid #e05252" : "2px solid #4b4847",
                      backgroundColor: isSolved ? "#81b64c" : isFailed ? "#e05252" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isSolved && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                      {isFailed && (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M4 4l6 6M10 4l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      )}
                    </div>

                    {/* Puzzle number */}
                    <span className="font-extrabold" style={{ color: "#fff", fontSize: 14, minWidth: 70 }}>
                      {isLoaded ? `Puzzle ${idx + 1}` : "Loading..."}
                    </span>

                    {/* Labels */}
                    {isLoaded && puzzle.labels && puzzle.labels.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {puzzle.labels.map((label) => (
                          <span
                            key={label}
                            className="text-xs font-bold"
                            style={{
                              padding: "2px 8px",
                              borderRadius: 4,
                              backgroundColor: CATEGORY_DISPLAY[selectedCategory]?.bg || "#3a3733",
                              color: CATEGORY_DISPLAY[selectedCategory]?.fg || "#d1cfcc",
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Severity badge */}
                    {isLoaded && puzzle.severity && SEVERITY_DISPLAY[puzzle.severity] && (
                      <span
                        className="text-xs font-bold"
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          backgroundColor: SEVERITY_DISPLAY[puzzle.severity].bg,
                          color: SEVERITY_DISPLAY[puzzle.severity].fg,
                          marginLeft: "auto",
                        }}
                      >
                        {SEVERITY_DISPLAY[puzzle.severity].label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Completion state */}
            {(() => {
              const loadedPuzzles = trainingPuzzles.filter((p): p is PuzzleData => p !== null);
              const allLoaded = loadedPuzzles.length > 0 && !trainingLoading;
              const allCompleted = allLoaded && loadedPuzzles.every((p) => completedPuzzles[p.id]);

              if (!allCompleted) return null;

              return (
                <div style={{ marginTop: 20, textAlign: "center" }}>
                  <div
                    className="font-extrabold"
                    style={{
                      color: "#81b64c",
                      fontSize: 18,
                      marginBottom: 12,
                    }}
                  >
                    All complete!
                  </div>
                  <button
                    onClick={loadMoreTraining}
                    className="font-extrabold transition-colors"
                    style={{
                      padding: "12px 32px",
                      borderRadius: 10,
                      border: "none",
                      backgroundColor: "#81b64c",
                      color: "#fff",
                      fontSize: 15,
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#95c95f")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#81b64c")}
                  >
                    Load 10 more
                  </button>
                </div>
              );
            })()}
          </div>
        )}


        {/* Loading */}
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

        {/* Error */}
        {error && (
          <div
            className="px-5 py-4 text-sm font-bold"
            style={{ backgroundColor: "#3b1a1a", borderRadius: 10, color: "#e05252" }}
          >
            {error}
          </div>
        )}

        {/* Empty states (only in puzzle list view, not motif submenu) */}
        {selectedCategory && !(selectedCategory === "tactics" && selectedLabel === null) && !trainingPuzzles.some((p) => p !== null) && !trainingLoading && !error && queriedUser && !analyzing && (
          <div className="text-center py-20 font-bold" style={{ color: "#9b9895", fontSize: 15 }}>
            No puzzles found for this category. Try a different one.
          </div>
        )}

        {selectedCategory && !(selectedCategory === "tactics" && selectedLabel === null) && analyzing && !loading && (
          <div
            className="px-5 py-4 flex items-center gap-3"
            style={{ backgroundColor: "#262421", borderRadius: 10, maxWidth: 640, margin: "0 auto" }}
          >
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 flex-shrink-0"
              style={{ borderColor: "#4b4847", borderTopColor: "#81b64c" }}
            />
            <p className="text-sm font-bold" style={{ color: "#d1cfcc" }}>
              Analyzing games with Stockfish ({analyzedGames}/{totalAnalysisGames})
              {" \u2014 "} new puzzles will appear automatically
            </p>
          </div>
        )}

        {!loading && !error && !queriedUser && (
          <div className="text-center py-24">
            <div style={{ fontSize: 48 }} className="mb-5">&#9819;</div>
            <p className="font-extrabold mb-3" style={{ color: "#fff", fontSize: 22 }}>
              Training Ground
            </p>
            <p className="font-bold" style={{ color: "#9b9895", fontSize: 15 }}>
              Log in to start training on puzzles from your real games.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
