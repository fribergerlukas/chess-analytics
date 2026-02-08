"use client";

import { useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Arrow } from "react-chessboard";
import { Chess, Square } from "chess.js";

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
  createdAt: string;
  game: {
    id: number;
    endDate: string;
    timeControl: string;
  };
}

interface CheckResult {
  correct: boolean;
  bestMove: string;
  pv: string;
}

const API_BASE = "http://localhost:3000";

const TIME_CATEGORIES = [
  { label: "Bullet", value: "bullet" },
  { label: "Blitz", value: "blitz" },
  { label: "Rapid", value: "rapid" },
];

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

export default function PuzzlesPage() {
  // List state
  const [username, setUsername] = useState("");
  const [timeCategory, setTimeCategory] = useState("rapid");
  const [ratedFilter, setRatedFilter] = useState("all");
  const [puzzles, setPuzzles] = useState<PuzzleData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [queriedUser, setQueriedUser] = useState("");

  // Solver state
  const [activePuzzle, setActivePuzzle] = useState<PuzzleData | null>(null);
  const [activePuzzleIndex, setActivePuzzleIndex] = useState(-1);
  const [game, setGame] = useState<Chess | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [showPlayedMove, setShowPlayedMove] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  async function fetchPuzzles(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");
    setPuzzles([]);
    setTotal(0);
    setActivePuzzle(null);

    try {
      // Step 1: Import games from chess.com
      setStatusMsg("Importing games from chess.com...");
      const importRes = await fetch(`${API_BASE}/import/chesscom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed, timeCategory }),
      });
      if (!importRes.ok) {
        const body = await importRes.json().catch(() => null);
        throw new Error(body?.error || `Import failed (${importRes.status})`);
      }

      // Step 2: Generate puzzles from evaluated positions
      setStatusMsg("Generating puzzles from your games...");
      const genRes = await fetch(
        `${API_BASE}/users/${encodeURIComponent(trimmed)}/puzzles/generate`,
        { method: "POST" }
      );
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => null);
        throw new Error(body?.error || `Puzzle generation failed (${genRes.status})`);
      }

      // Step 3: Fetch the puzzle list
      setStatusMsg("Loading puzzles...");
      const puzzleParams = new URLSearchParams({ limit: "20", timeCategory });
      if (ratedFilter !== "all") puzzleParams.set("rated", ratedFilter);
      const res = await fetch(
        `${API_BASE}/users/${encodeURIComponent(trimmed)}/puzzles?${puzzleParams}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setPuzzles(data.puzzles);
      setTotal(data.total);
      setQueriedUser(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
      setStatusMsg("");
    }
  }

  function openPuzzle(puzzle: PuzzleData, index: number) {
    const chess = new Chess(puzzle.fen);
    setActivePuzzle(puzzle);
    setActivePuzzleIndex(index);
    setGame(chess);
    setCheckResult(null);
    setSelectedSquare(null);
    setShowPlayedMove(false);
  }

  function goToNextPuzzle() {
    const nextIdx = activePuzzleIndex + 1;
    if (nextIdx < puzzles.length) {
      openPuzzle(puzzles[nextIdx], nextIdx);
    }
  }

  function tryMove(from: string, to: string): boolean {
    if (!activePuzzle || !game || checkResult || from === to) return false;

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
    const move = moveCopy.move(moveOpts);
    if (!move) return false;

    game.move(moveOpts);
    setGame(new Chess(game.fen()));
    setSelectedSquare(null);

    const uciMove = from + to + (move.promotion ? move.promotion : "");

    setChecking(true);
    const puzzleId = activePuzzle.id;
    fetch(`${API_BASE}/puzzles/${puzzleId}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ move: uciMove }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((result: CheckResult | null) => {
        if (result) setCheckResult(result);
      })
      .catch(() => {})
      .finally(() => setChecking(false));

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
    if (!game || checkResult || !square) return;

    // Clicking the already-selected piece deselects it
    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    // If a piece is selected, try to capture on this square
    if (selectedSquare && selectedSquare !== square) {
      if (tryMove(selectedSquare, square)) return;
    }

    // Select this piece if it belongs to the side to move
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
    if (!game || checkResult || !selectedSquare) return;

    // Try to move selected piece to this empty square
    if (tryMove(selectedSquare, square)) return;

    // Deselect if clicking an invalid square
    setSelectedSquare(null);
  }

  // Build highlight styles for selected piece + legal moves
  function getSquareStyles(): Record<string, React.CSSProperties> {
    const styles: Record<string, React.CSSProperties> = {};
    if (!selectedSquare || !game || checkResult) return styles;

    // Highlight selected square
    styles[selectedSquare] = { backgroundColor: "rgba(255, 255, 0, 0.4)" };

    // Highlight legal move targets
    const moves = game.moves({ square: selectedSquare, verbose: true });
    for (const move of moves) {
      const hasPiece = game.get(move.to as Square);
      styles[move.to] = hasPiece
        ? {
            background: "radial-gradient(circle, transparent 55%, rgba(0, 0, 0, 0.15) 55%)",
          }
        : {
            background: "radial-gradient(circle, rgba(0, 0, 0, 0.15) 25%, transparent 25%)",
          };
    }
    return styles;
  }

  // Build arrows for best move and optionally the played move
  function getArrows(): Arrow[] {
    const arrows: Arrow[] = [];
    if (checkResult) {
      const best = uciToSquares(checkResult.bestMove);
      arrows.push({ startSquare: best.from, endSquare: best.to, color: "rgba(0, 128, 255, 0.7)" });
    }
    if (showPlayedMove && activePuzzle) {
      const played = uciToSquares(activePuzzle.playedMoveUci);
      arrows.push({ startSquare: played.from, endSquare: played.to, color: "rgba(220, 38, 38, 0.7)" });
    }
    return arrows;
  }

  // Puzzle Solver view
  if (activePuzzle && game) {
    const orientation = activePuzzle.sideToMove === "WHITE" ? "white" : "black";

    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight">Chess Analytics</h1>
            <nav className="flex gap-4 text-sm font-medium">
              <Link href="/" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Dashboard</Link>
              <Link href="/puzzles" className="text-blue-600 dark:text-blue-400">Puzzles</Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          <div className="flex flex-col lg:flex-row gap-8">
            {/* Chessboard */}
            <div className="flex-shrink-0" style={{ width: 440, height: 440 }}>
              {mounted && (
                <Chessboard
                  options={{
                    position: game.fen(),
                    onPieceDrop: handlePieceDrop,
                    onPieceClick: handlePieceClick,
                    onSquareClick: handleSquareClick,
                    boardOrientation: orientation,
                    allowDragging: checkResult === null,
                    arrows: getArrows(),
                    squareStyles: getSquareStyles(),
                  }}
                />
              )}
            </div>

            {/* Info panel */}
            <div className="flex-1 space-y-4">
              <button
                onClick={() => setActivePuzzle(null)}
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              >
                &larr; Back to List
              </button>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
                <h2 className="text-lg font-semibold">
                  Puzzle #{activePuzzleIndex + 1}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Find the best move for{" "}
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {activePuzzle.sideToMove === "WHITE" ? "White" : "Black"}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">Game</span>
                    <p className="font-medium">
                      #{activePuzzle.game.id} — {new Date(activePuzzle.game.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">Time Control</span>
                    <p className="font-medium">{activePuzzle.game.timeControl}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">Eval Before</span>
                    <p className="font-medium">{formatEval(activePuzzle.evalBeforeCp)}</p>
                  </div>
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">Eval After</span>
                    <p className="font-medium">{formatEval(activePuzzle.evalAfterCp)}</p>
                  </div>
                </div>
              </div>

              {/* Checking spinner */}
              {checking && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
                  Checking...
                </div>
              )}

              {/* Result card */}
              {checkResult && (
                <div
                  className={`rounded-xl border p-6 space-y-2 ${
                    checkResult.correct
                      ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30"
                      : "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30"
                  }`}
                >
                  <p
                    className={`text-lg font-bold ${
                      checkResult.correct
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-700 dark:text-red-400"
                    }`}
                  >
                    {checkResult.correct ? "Correct!" : "Incorrect"}
                  </p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Best move:{" "}
                    <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                      {checkResult.bestMove}
                    </span>
                  </p>
                  <button
                    onClick={() => setShowPlayedMove((v) => !v)}
                    className="mt-1 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  >
                    {showPlayedMove ? "Hide" : "Show"} played move{" "}
                    <span className="font-mono text-red-600 dark:text-red-400">
                      {activePuzzle.playedMoveUci}
                    </span>
                  </button>
                </div>
              )}

              {/* Navigation buttons */}
              {checkResult && (
                <div className="flex gap-3">
                  {!checkResult.correct && (
                    <button
                      onClick={() => {
                        setGame(new Chess(activePuzzle.fen));
                        setCheckResult(null);
                        setSelectedSquare(null);
                        setShowPlayedMove(false);
                      }}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => setActivePuzzle(null)}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    Back to List
                  </button>
                  {activePuzzleIndex + 1 < puzzles.length && (
                    <button
                      onClick={goToNextPuzzle}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                    >
                      Next Puzzle &rarr;
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Puzzle List view
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="mx-auto max-w-4xl px-6 py-5 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Chess Analytics</h1>
          <nav className="flex gap-4 text-sm font-medium">
            <Link href="/" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">Dashboard</Link>
            <Link href="/puzzles" className="text-blue-600 dark:text-blue-400">Puzzles</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
        {/* Username + time category + submit */}
        <form onSubmit={fetchPuzzles} className="flex gap-3">
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
          <select
            value={ratedFilter}
            onChange={(e) => setRatedFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Games</option>
            <option value="true">Rated</option>
            <option value="false">Unrated</option>
          </select>
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Loading..." : "Load Puzzles"}
          </button>
        </form>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-blue-600" />
            {statusMsg && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {statusMsg}
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Puzzle table */}
        {puzzles.length > 0 && !loading && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Showing {puzzles.length} of {total} puzzles for{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {queriedUser}
              </span>
            </p>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Game</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Time Control</th>
                    <th className="px-4 py-3">Side</th>
                    <th className="px-4 py-3 text-right">Eval Drop</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {puzzles.map((puzzle, i) => (
                    <tr
                      key={puzzle.id}
                      className="border-b border-zinc-100 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-zinc-400 dark:text-zinc-500">
                        {i + 1}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-zinc-500 dark:text-zinc-400">
                        #{puzzle.game.id}
                      </td>
                      <td className="px-4 py-2.5">
                        {new Date(puzzle.game.endDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">
                        {puzzle.game.timeControl}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">
                          {puzzle.sideToMove === "WHITE" ? "White" : "Black"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">
                        {puzzle.deltaCp != null
                          ? formatEval(puzzle.deltaCp)
                          : "?"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => openPuzzle(puzzle, i)}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                        >
                          Solve
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!puzzles.length && !loading && !error && queriedUser && (
          <div className="text-center py-16 text-zinc-400 dark:text-zinc-500">
            No puzzles found for {queriedUser}. Games need to be evaluated first (run the evaluate and detect-blunders jobs).
          </div>
        )}

        {!puzzles.length && !loading && !error && !queriedUser && (
          <div className="text-center py-16 text-zinc-400 dark:text-zinc-500">
            Enter a chess.com username to import games and generate missed-tactics puzzles.
          </div>
        )}
      </main>
    </div>
  );
}
