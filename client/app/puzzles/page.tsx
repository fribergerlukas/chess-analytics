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
  const [highlightedSquares, setHighlightedSquares] = useState<Set<string>>(new Set());

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

      setStatusMsg("Generating puzzles from your games...");
      const genRes = await fetch(
        `${API_BASE}/users/${encodeURIComponent(trimmed)}/puzzles/generate`,
        { method: "POST" }
      );
      if (!genRes.ok) {
        const body = await genRes.json().catch(() => null);
        throw new Error(body?.error || `Puzzle generation failed (${genRes.status})`);
      }

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
    setHighlightedSquares(new Set());
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
    setHighlightedSquares(new Set());

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
    if (!game || checkResult || !selectedSquare) return;
    if (tryMove(selectedSquare, square)) return;
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
    if (selectedSquare && game && !checkResult) {
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
    if (checkResult) {
      const best = uciToSquares(checkResult.bestMove);
      arrows.push({ startSquare: best.from, endSquare: best.to, color: "rgba(105, 146, 62, 0.85)" });
    }
    if (showPlayedMove && activePuzzle) {
      const played = uciToSquares(activePuzzle.playedMoveUci);
      arrows.push({ startSquare: played.from, endSquare: played.to, color: "rgba(194, 64, 52, 0.85)" });
    }
    return arrows;
  }

  // ── Puzzle Solver View ──
  if (activePuzzle && game) {
    const orientation = activePuzzle.sideToMove === "WHITE" ? "white" : "black";

    return (
      <div className="min-h-screen" style={{ backgroundColor: "#312e2b", color: "#fff" }}>
        {/* Nav bar */}
        <header style={{ backgroundColor: "#272522", borderBottom: "1px solid #3d3a37" }}>
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/" className="text-xl font-bold" style={{ color: "#81b64c" }}>
                Chess Analytics
              </Link>
              <nav className="flex gap-4 text-sm font-semibold">
                <Link href="/" style={{ color: "#9e9b98" }} className="hover:text-white transition-colors">
                  Dashboard
                </Link>
                <Link href="/puzzles" style={{ color: "#81b64c" }}>
                  Puzzles
                </Link>
              </nav>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start justify-center">
            {/* Board */}
            <div className="flex-shrink-0 rounded-md overflow-hidden" style={{ width: 520, height: 520 }}>
              {mounted && (
                <Chessboard
                  options={{
                    position: game.fen(),
                    onPieceDrop: handlePieceDrop,
                    onPieceClick: handlePieceClick,
                    onSquareClick: handleSquareClick,
                    onSquareRightClick: handleSquareRightClick,
                    boardOrientation: orientation,
                    allowDragging: checkResult === null,
                    darkSquareStyle: { backgroundColor: "#6596EB" },
                    lightSquareStyle: { backgroundColor: "#EAF1F8" },
                    arrows: getArrows(),
                    squareStyles: getSquareStyles(),
                  }}
                />
              )}
            </div>

            {/* Side Panel */}
            <div className="flex-1 max-w-sm w-full space-y-4">
              {/* Puzzle header card */}
              <div className="rounded-md p-5" style={{ backgroundColor: "#272522" }}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-bold" style={{ color: "#fff" }}>
                    Puzzle #{activePuzzleIndex + 1}
                  </h2>
                  <button
                    onClick={() => setActivePuzzle(null)}
                    className="text-xs font-semibold px-3 py-1.5 rounded transition-colors"
                    style={{ backgroundColor: "#3d3a37", color: "#9e9b98" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4b4847")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#3d3a37")}
                  >
                    Back to List
                  </button>
                </div>

                {/* Prompt */}
                <div
                  className="rounded px-4 py-3 mb-4 text-sm font-semibold"
                  style={{
                    backgroundColor: activePuzzle.sideToMove === "WHITE" ? "#f0d9b5" : "#b58863",
                    color: activePuzzle.sideToMove === "WHITE" ? "#312e2b" : "#fff",
                  }}
                >
                  Your turn — find the best move for {activePuzzle.sideToMove === "WHITE" ? "White" : "Black"}
                </div>

                {/* Game info */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <span style={{ color: "#9e9b98" }}>Game</span>
                    <p className="font-medium" style={{ color: "#c8c5c2" }}>
                      #{activePuzzle.game.id}
                    </p>
                  </div>
                  <div>
                    <span style={{ color: "#9e9b98" }}>Date</span>
                    <p className="font-medium" style={{ color: "#c8c5c2" }}>
                      {new Date(activePuzzle.game.endDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <span style={{ color: "#9e9b98" }}>Eval Before</span>
                    <p className="font-medium" style={{ color: "#c8c5c2" }}>{formatEval(activePuzzle.evalBeforeCp)}</p>
                  </div>
                  <div>
                    <span style={{ color: "#9e9b98" }}>Eval After</span>
                    <p className="font-medium" style={{ color: "#c8c5c2" }}>{formatEval(activePuzzle.evalAfterCp)}</p>
                  </div>
                </div>
              </div>

              {/* Checking spinner */}
              {checking && (
                <div className="flex items-center gap-2 text-sm px-1" style={{ color: "#9e9b98" }}>
                  <div
                    className="h-4 w-4 animate-spin rounded-full border-2"
                    style={{ borderColor: "#4b4847", borderTopColor: "#81b64c" }}
                  />
                  Checking...
                </div>
              )}

              {/* Result */}
              {checkResult && (
                <div
                  className="rounded-md p-5 space-y-3"
                  style={{
                    backgroundColor: checkResult.correct ? "#21371a" : "#3b1a1a",
                    border: checkResult.correct ? "1px solid #3d6b2e" : "1px solid #6b2e2e",
                  }}
                >
                  <p
                    className="text-xl font-bold"
                    style={{ color: checkResult.correct ? "#81b64c" : "#e05252" }}
                  >
                    {checkResult.correct ? "Correct!" : "Incorrect"}
                  </p>
                  <p className="text-sm" style={{ color: "#c8c5c2" }}>
                    Best move:{" "}
                    <span className="font-mono font-bold" style={{ color: "#fff" }}>
                      {checkResult.bestMove}
                    </span>
                  </p>
                  <button
                    onClick={() => setShowPlayedMove((v) => !v)}
                    className="text-sm font-semibold transition-colors"
                    style={{ color: "#9e9b98" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#9e9b98")}
                  >
                    {showPlayedMove ? "Hide" : "Show"} played move{" "}
                    <span className="font-mono" style={{ color: "#e05252" }}>
                      {activePuzzle.playedMoveUci}
                    </span>
                  </button>
                </div>
              )}

              {/* Action buttons */}
              {checkResult && (
                <div className="flex gap-2">
                  {!checkResult.correct && (
                    <button
                      onClick={() => {
                        setGame(new Chess(activePuzzle.fen));
                        setCheckResult(null);
                        setSelectedSquare(null);
                        setShowPlayedMove(false);
                      }}
                      className="flex-1 rounded-md px-4 py-2.5 text-sm font-bold transition-colors"
                      style={{ backgroundColor: "#c27a30", color: "#fff" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#d48a3a")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#c27a30")}
                    >
                      Retry
                    </button>
                  )}
                  {activePuzzleIndex + 1 < puzzles.length && (
                    <button
                      onClick={goToNextPuzzle}
                      className="flex-1 rounded-md px-4 py-2.5 text-sm font-bold transition-colors"
                      style={{ backgroundColor: "#81b64c", color: "#fff" }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#95c95f")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#81b64c")}
                    >
                      Next Puzzle
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

  // ── Puzzle List View ──
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#312e2b", color: "#fff" }}>
      <header style={{ backgroundColor: "#272522", borderBottom: "1px solid #3d3a37" }}>
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-xl font-bold" style={{ color: "#81b64c" }}>
              Chess Analytics
            </Link>
            <nav className="flex gap-4 text-sm font-semibold">
              <Link href="/" style={{ color: "#9e9b98" }} className="hover:text-white transition-colors">
                Dashboard
              </Link>
              <Link href="/puzzles" style={{ color: "#81b64c" }}>
                Puzzles
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {/* Search bar */}
        <form onSubmit={fetchPuzzles} className="flex gap-2">
          <input
            type="text"
            placeholder="chess.com username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="flex-1 rounded-md px-4 py-2.5 text-sm outline-none"
            style={{
              backgroundColor: "#272522",
              border: "1px solid #3d3a37",
              color: "#fff",
            }}
          />
          <select
            value={timeCategory}
            onChange={(e) => setTimeCategory(e.target.value)}
            className="rounded-md px-3 py-2.5 text-sm outline-none"
            style={{
              backgroundColor: "#272522",
              border: "1px solid #3d3a37",
              color: "#c8c5c2",
            }}
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
            className="rounded-md px-3 py-2.5 text-sm outline-none"
            style={{
              backgroundColor: "#272522",
              border: "1px solid #3d3a37",
              color: "#c8c5c2",
            }}
          >
            <option value="all">All Games</option>
            <option value="true">Rated</option>
            <option value="false">Unrated</option>
          </select>
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="rounded-md px-5 py-2.5 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#81b64c", color: "#fff" }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = "#95c95f"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#81b64c"; }}
          >
            {loading ? "Loading..." : "Load Puzzles"}
          </button>
        </form>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-16">
            <div
              className="h-8 w-8 animate-spin rounded-full border-4"
              style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
            />
            {statusMsg && (
              <p className="text-sm" style={{ color: "#9e9b98" }}>{statusMsg}</p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            className="rounded-md px-4 py-3 text-sm"
            style={{ backgroundColor: "#3b1a1a", border: "1px solid #6b2e2e", color: "#e05252" }}
          >
            {error}
          </div>
        )}

        {/* Puzzle table */}
        {puzzles.length > 0 && !loading && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "#9e9b98" }}>
              Showing {puzzles.length} of {total} puzzles for{" "}
              <span className="font-bold" style={{ color: "#fff" }}>{queriedUser}</span>
            </p>

            <div className="rounded-md overflow-hidden" style={{ backgroundColor: "#272522", border: "1px solid #3d3a37" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid #3d3a37" }}>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#7c7a77" }}>#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#7c7a77" }}>Game</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#7c7a77" }}>Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#7c7a77" }}>Time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: "#7c7a77" }}>Side</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider" style={{ color: "#7c7a77" }}>Eval Drop</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {puzzles.map((puzzle, i) => (
                    <tr
                      key={puzzle.id}
                      className="transition-colors cursor-pointer"
                      style={{ borderBottom: "1px solid #3d3a37" }}
                      onClick={() => openPuzzle(puzzle, i)}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#3d3a37")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <td className="px-4 py-3" style={{ color: "#7c7a77" }}>{i + 1}</td>
                      <td className="px-4 py-3 font-mono" style={{ color: "#9e9b98" }}>#{puzzle.game.id}</td>
                      <td className="px-4 py-3" style={{ color: "#c8c5c2" }}>
                        {new Date(puzzle.game.endDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9e9b98" }}>{puzzle.game.timeControl}</td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-block w-4 h-4 rounded-sm mr-1.5 align-middle"
                          style={{
                            backgroundColor: puzzle.sideToMove === "WHITE" ? "#f0d9b5" : "#b58863",
                            border: "1px solid #4b4847",
                          }}
                        />
                        <span className="font-medium align-middle" style={{ color: "#c8c5c2" }}>
                          {puzzle.sideToMove === "WHITE" ? "White" : "Black"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: "#e05252" }}>
                        {puzzle.deltaCp != null ? formatEval(puzzle.deltaCp) : "?"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className="rounded px-3 py-1.5 text-xs font-bold"
                          style={{ backgroundColor: "#81b64c", color: "#fff" }}
                        >
                          Solve
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty states */}
        {!puzzles.length && !loading && !error && queriedUser && (
          <div className="text-center py-16 text-sm" style={{ color: "#7c7a77" }}>
            No puzzles found for {queriedUser}. Games need to be evaluated first.
          </div>
        )}

        {!puzzles.length && !loading && !error && !queriedUser && (
          <div className="text-center py-20">
            <div className="text-4xl mb-4">&#9819;</div>
            <p className="text-lg font-bold mb-2" style={{ color: "#c8c5c2" }}>
              Missed Tactics Trainer
            </p>
            <p className="text-sm" style={{ color: "#7c7a77" }}>
              Enter a chess.com username to import games and generate puzzles from your mistakes.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
