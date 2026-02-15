"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { Arrow } from "react-chessboard";
import { Chess, Square } from "chess.js";
import { useUserContext } from "../UserContext";
import { useAuth } from "../AuthContext";

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
  resilience:                { label: "Resilience",   bg: "#1a2d3b", fg: "#5ba3d9" },
  advantage_capitalisation:  { label: "Capitalize",   bg: "#3b3520", fg: "#c27a30" },
  opportunity_creation:      { label: "Opportunity",  bg: "#1a3b2d", fg: "#5bd98a" },
  precision_only_move:       { label: "Precision",    bg: "#3b1a3b", fg: "#d95bd9" },
};

const SEVERITY_DISPLAY: Record<string, { label: string; bg: string; fg: string }> = {
  mistake:     { label: "Mistake",     bg: "#3b3520", fg: "#c27a30" },
  blunder:     { label: "Blunder",     bg: "#3b1a1a", fg: "#e05252" },
  missed_win:  { label: "Missed Win",  bg: "#3b1a1a", fg: "#e05252" },
  missed_save: { label: "Missed Save", bg: "#1a2d3b", fg: "#5ba3d9" },
};

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
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [puzzles, setPuzzles] = useState<PuzzleData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  // Track which queriedUser we last fetched for
  const [fetchedUser, setFetchedUser] = useState("");

  // Completed puzzles: maps puzzle id → result
  const [completedPuzzles, setCompletedPuzzles] = useState<Record<number, "solved" | "failed">>({});

  // Table-level filters (applied client-side on the loaded puzzles)
  const [tableCategoryFilter, setTableCategoryFilter] = useState("all");
  const [tableSeverityFilter, setTableSeverityFilter] = useState("all");

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

  // Background analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzedGames, setAnalyzedGames] = useState(0);
  const [totalAnalysisGames, setTotalAnalysisGames] = useState(0);

  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTriggerRef = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Listen for sidebar search triggers
  useEffect(() => {
    if (!queriedUser || searchTrigger === lastTriggerRef.current) return;
    lastTriggerRef.current = searchTrigger;
    fetchPuzzles(queriedUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // Auto-fetch on mount if queriedUser is set but we haven't fetched yet (tab switch)
  useEffect(() => {
    if (queriedUser && !fetchedUser && !loading) {
      fetchPuzzles(queriedUser);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boardDisabled = puzzleCompleted || puzzleFailed || animatingOpponent || animatingSetup;

  async function loadPuzzleList(user: string) {
    const puzzleParams = new URLSearchParams({ limit: "50", rated: "true" });
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

  async function fetchPuzzles(user: string) {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setLoading(true);
    setError("");
    setPuzzles([]);
    setTotal(0);
    setActivePuzzle(null);
    setAnalyzing(false);
    setCompletedPuzzles({});
    setTableCategoryFilter("all");
    setTableSeverityFilter("all");

    try {
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
    // Find the next unsolved puzzle
    for (let i = activePuzzleIndex + 1; i < puzzles.length; i++) {
      if (!completedPuzzles[puzzles[i].id]) {
        openPuzzle(puzzles[i], i);
        return;
      }
    }
  }

  function tryMove(from: string, to: string): boolean {
    if (!activePuzzle || !game || boardDisabled || from === to) return false;

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
      if (isWhitePiece === isWhiteTurn) {
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
    if (selectedSquare && game && !boardDisabled) {
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
    // Only show best move arrow on failure
    if (puzzleFailed && failedBestMove) {
      const best = uciToSquares(failedBestMove);
      arrows.push({ startSquare: best.from, endSquare: best.to, color: "rgba(105, 146, 62, 0.85)" });
    }
    // Show played move arrow — available anytime (before solving, after completion/failure)
    if (showPlayedMove && activePuzzle && !animatingSetup) {
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
      <div className="min-h-screen" style={{ backgroundColor: "#312e2b", color: "#fff" }}>
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
            <div
              className="flex-shrink-0 flex flex-col rounded-md overflow-hidden"
              style={{
                width: 280,
                marginTop: 32, /* align with board (skip top player bar) */
                minHeight: 520,
                backgroundColor: "#272522",
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: "1px solid #3d3a37" }}
              >
                <h2 className="text-sm font-bold" style={{ color: "#fff" }}>
                  Puzzle #{activePuzzleIndex + 1}
                </h2>
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

              {/* Prompt / Status area */}
              <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d3a37" }}>
                {/* Animating */}
                {(animatingSetup || animatingOpponent) && (
                  <div className="flex items-center gap-2 text-xs" style={{ color: "#d1cfcc" }}>
                    <div
                      className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                      style={{ borderColor: "#4b4847", borderTopColor: "#81b64c" }}
                    />
                    Opponent is playing...
                  </div>
                )}

                {/* Active prompt */}
                {!puzzleCompleted && !puzzleFailed && !animatingSetup && !animatingOpponent && (
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

                {/* Success */}
                {puzzleCompleted && (
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

                {/* Failure */}
                {puzzleFailed && (
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

                {/* Multi-move progress dots */}
                {isMultiMove && (
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
                        {formatEval(activePuzzle.evalBeforeCp)} → {formatEval(activePuzzle.evalAfterCp)}
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
                  <button
                    onClick={resetPuzzle}
                    className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                    style={{ backgroundColor: "#c27a30", color: "#fff" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#d48a3a")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#c27a30")}
                  >
                    Retry
                  </button>
                  {puzzles.some((p, i) => i > activePuzzleIndex && !completedPuzzles[p.id]) && (
                    <button
                      onClick={goToNextPuzzle}
                      className="flex-1 rounded px-3 py-2 text-xs font-bold transition-colors"
                      style={{ backgroundColor: "#81b64c", color: "#fff" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#95c95f")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#81b64c")}
                    >
                      Next Puzzle
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
                  {activePuzzle.category && CATEGORY_DISPLAY[activePuzzle.category] && (
                    <>
                      <span style={{ color: "#4b4847" }}>&middot;</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-xs font-bold"
                        style={{
                          backgroundColor: CATEGORY_DISPLAY[activePuzzle.category].bg,
                          color: CATEGORY_DISPLAY[activePuzzle.category].fg,
                        }}
                      >
                        {CATEGORY_DISPLAY[activePuzzle.category].label}
                      </span>
                    </>
                  )}
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
          </div>
        </main>
      </div>
    );
  }

  // ── Puzzle List View ──
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#312e2b", color: "#fff" }}>
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
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

        {/* Analyzing banner */}
        {analyzing && !loading && (
          <div
            className="px-5 py-4 flex items-center gap-3"
            style={{ backgroundColor: "#262421", borderRadius: 10 }}
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

        {/* Puzzle tables */}
        {puzzles.length > 0 && !loading && (() => {
          // Split puzzles into unsolved and completed, applying table filters
          const applyFilters = (list: PuzzleData[]) =>
            list.filter((p) => {
              if (tableCategoryFilter !== "all" && p.category !== tableCategoryFilter) return false;
              if (tableSeverityFilter !== "all" && p.severity !== tableSeverityFilter) return false;
              return true;
            });

          const unsolved = applyFilters(puzzles.filter((p) => !completedPuzzles[p.id]));
          const completed = applyFilters(puzzles.filter((p) => !!completedPuzzles[p.id]));

          const FilterChip = ({ label, value, active, onClick }: {
            label: string; value: string; active: boolean; onClick: () => void;
          }) => (
            <button
              onClick={onClick}
              className="px-3 py-1.5 text-xs font-bold transition-colors"
              style={{
                borderRadius: 20,
                backgroundColor: active ? "#3a3733" : "transparent",
                color: active ? "#fff" : "#9b9895",
                border: "none",
              }}
              onMouseEnter={(e) => { if (!active) { e.currentTarget.style.backgroundColor = "#3a3733"; e.currentTarget.style.color = "#fff"; } }}
              onMouseLeave={(e) => { if (!active) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#9b9895"; } }}
            >
              {label}
            </button>
          );

          const PuzzleRow = ({ puzzle, idx, dimmed }: { puzzle: PuzzleData; idx: number; dimmed?: boolean }) => {
            const result = completedPuzzles[puzzle.id];
            return (
              <tr
                key={puzzle.id}
                className="transition-colors cursor-pointer"
                style={{ borderBottom: "1px solid #3a3733", opacity: dimmed ? 0.6 : 1 }}
                onClick={() => openPuzzle(puzzle, puzzles.indexOf(puzzle))}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#3a3733")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <td className="px-4 py-3" style={{ color: "#9b9895" }}>{idx + 1}</td>
                <td className="px-4 py-3 font-bold" style={{ color: "#fff" }}>
                  {new Date(puzzle.game.endDate).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 font-bold" style={{ color: "#d1cfcc" }}>
                  {formatTimeControl(puzzle.game.timeControl)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className="inline-block w-4 h-4 align-middle"
                    style={{
                      backgroundColor: puzzle.sideToMove === "WHITE" ? "#f0d9b5" : "#b58863",
                      borderRadius: 4,
                    }}
                  />
                </td>
                <td className="px-4 py-3">
                  {puzzle.category && CATEGORY_DISPLAY[puzzle.category] ? (
                    <span
                      className="inline-block px-2.5 py-1 text-xs font-extrabold"
                      style={{
                        borderRadius: 6,
                        backgroundColor: CATEGORY_DISPLAY[puzzle.category].bg,
                        color: CATEGORY_DISPLAY[puzzle.category].fg,
                      }}
                    >
                      {CATEGORY_DISPLAY[puzzle.category].label}
                    </span>
                  ) : (
                    <span style={{ color: "#9b9895" }}>{"\u2014"}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {puzzle.severity && SEVERITY_DISPLAY[puzzle.severity] ? (
                    <span
                      className="inline-block px-2.5 py-1 text-xs font-extrabold"
                      style={{
                        borderRadius: 6,
                        backgroundColor: SEVERITY_DISPLAY[puzzle.severity].bg,
                        color: SEVERITY_DISPLAY[puzzle.severity].fg,
                      }}
                    >
                      {SEVERITY_DISPLAY[puzzle.severity].label}
                    </span>
                  ) : (
                    <span style={{ color: "#9b9895" }}>{"\u2014"}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold" style={{ color: "#e05252" }}>
                  {puzzle.deltaCp != null ? formatEval(puzzle.deltaCp) : "?"}
                </td>
                <td className="px-4 py-3 text-right">
                  {result ? (
                    <span
                      className="px-3 py-1.5 text-xs font-extrabold"
                      style={{
                        borderRadius: 6,
                        backgroundColor: result === "solved" ? "#21371a" : "#3b1a1a",
                        color: result === "solved" ? "#81b64c" : "#e05252",
                      }}
                    >
                      {result === "solved" ? "Solved" : "Failed"}
                    </span>
                  ) : (
                    <span
                      className="px-3 py-1.5 text-xs font-extrabold"
                      style={{ borderRadius: 6, backgroundColor: "#81b64c", color: "#fff" }}
                    >
                      Solve
                    </span>
                  )}
                </td>
              </tr>
            );
          };

          return (
            <div className="space-y-8">
              {/* Summary + filter chips */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p style={{ color: "#d1cfcc", fontSize: 15 }}>
                    {unsolved.length} unsolved of {total} puzzles for{" "}
                    <span className="font-extrabold" style={{ color: "#fff" }}>{queriedUser}</span>
                  </p>
                  {Object.keys(completedPuzzles).length > 0 && (
                    <span className="text-sm font-bold" style={{ color: "#fff" }}>
                      {Object.values(completedPuzzles).filter((r) => r === "solved").length} solved
                      {" / "}
                      {Object.values(completedPuzzles).filter((r) => r === "failed").length} failed
                    </span>
                  )}
                </div>

                {/* Filter chips */}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs font-bold mr-1" style={{ color: "#9b9895" }}>Category:</span>
                  <FilterChip label="All" value="all" active={tableCategoryFilter === "all"} onClick={() => setTableCategoryFilter("all")} />
                  {Object.entries(CATEGORY_DISPLAY).map(([key, val]) => (
                    <FilterChip key={key} label={val.label} value={key} active={tableCategoryFilter === key} onClick={() => setTableCategoryFilter(key)} />
                  ))}
                  <span className="text-xs font-bold mr-1 ml-3" style={{ color: "#9b9895" }}>Severity:</span>
                  <FilterChip label="All" value="all" active={tableSeverityFilter === "all"} onClick={() => setTableSeverityFilter("all")} />
                  {Object.entries(SEVERITY_DISPLAY).map(([key, val]) => (
                    <FilterChip key={key} label={val.label} value={key} active={tableSeverityFilter === key} onClick={() => setTableSeverityFilter(key)} />
                  ))}
                </div>
              </div>

              {/* Unsolved puzzles table */}
              {unsolved.length > 0 && (
                <div className="overflow-hidden" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #3a3733" }}>
                        <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>#</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Date</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Time</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Side</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Category</th>
                        <th className="px-4 py-3.5 text-left text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Severity</th>
                        <th className="px-4 py-3.5 text-right text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>Eval</th>
                        <th className="px-4 py-3.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {unsolved.map((puzzle, i) => (
                        <PuzzleRow key={puzzle.id} puzzle={puzzle} idx={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {unsolved.length === 0 && Object.keys(completedPuzzles).length > 0 && (
                <div className="text-center py-10 font-bold" style={{ color: "#fff", fontSize: 15 }}>
                  All puzzles completed!
                </div>
              )}

              {/* Completed puzzles section */}
              {completed.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>
                    Completed ({completed.length})
                  </h3>
                  <div className="overflow-hidden" style={{ backgroundColor: "#262421", borderRadius: 12 }}>
                    <table className="w-full text-sm">
                      <tbody>
                        {completed.map((puzzle, i) => (
                          <PuzzleRow key={puzzle.id} puzzle={puzzle} idx={i} dimmed />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Empty states */}
        {!puzzles.length && !loading && !error && queriedUser && !analyzing && (
          <div className="text-center py-20 font-bold" style={{ color: "#9b9895", fontSize: 15 }}>
            No puzzles found for {queriedUser}. Try again shortly — games may still be analyzing.
          </div>
        )}

        {!puzzles.length && !loading && !error && queriedUser && analyzing && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div
              className="h-10 w-10 animate-spin rounded-full border-4"
              style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
            />
            <p className="font-bold" style={{ color: "#d1cfcc", fontSize: 15 }}>
              Analyzing games with Stockfish ({analyzedGames}/{totalAnalysisGames})...
            </p>
            <p className="font-bold" style={{ color: "#9b9895", fontSize: 13 }}>
              Puzzles will appear here as games are analyzed
            </p>
          </div>
        )}

        {!puzzles.length && !loading && !error && !queriedUser && (
          <div className="text-center py-24">
            <div style={{ fontSize: 48 }} className="mb-5">&#9819;</div>
            <p className="font-extrabold mb-3" style={{ color: "#fff", fontSize: 22 }}>
              Personalized Puzzles
            </p>
            <p className="font-bold" style={{ color: "#9b9895", fontSize: 15 }}>
              Enter a chess.com username in the sidebar to generate puzzles from your mistakes.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
