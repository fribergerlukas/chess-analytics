"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Arrow } from "react-chessboard";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false }
);

const API_BASE = "http://localhost:3000";

// Category display config (matches puzzles/page.tsx)
const CATEGORY_DISPLAY: Record<string, { label: string; bg: string; fg: string }> = {
  opening:   { label: "Opening",   bg: "#2d1a3b", fg: "#a37acc" },
  defending: { label: "Defending", bg: "#1a2d3b", fg: "#5ba3d9" },
  attacking: { label: "Attacking", bg: "#3b3520", fg: "#c27a30" },
  tactics:   { label: "Tactics",   bg: "#1a3b2d", fg: "#5bd98a" },
  endgame:   { label: "Endgame",   bg: "#2d2d1a", fg: "#d9c75b" },
  strategic: { label: "Strategic", bg: "#3b1a3b", fg: "#d95bd9" },
};

interface TestPuzzle {
  id: string;
  fen: string;
  bestMoveUci: string;
  pvMoves: string[];
  evalBeforeCp: number;
  evalAfterCp: number;
  sideToMove: "WHITE" | "BLACK";
  expectedCategory: string;
  description: string;
}

// 6 handcrafted test puzzles — one per category
const TEST_PUZZLES: TestPuzzle[] = [
  {
    // 1. OPENING — Italian Game, move 6 (ply=11). White plays Bg5 instead of best move.
    // Ply 11 ≤ 24 → opening regardless of other checks.
    id: "opening",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    bestMoveUci: "d2d3",
    pvMoves: ["d2d3"],
    evalBeforeCp: 30,
    evalAfterCp: -20,
    sideToMove: "WHITE",
    expectedCategory: "opening",
    description: "Italian Game at move 4. Ply 6 — well within the opening threshold (≤ 24). Best is d3 supporting the center.",
  },
  {
    // 2. DEFENDING — Black to move, White threatens Qxh7# (queen + bishop battery).
    // Eval from white's perspective: +80 (black's userEval = -80, ≤ 50).
    // Null-move test finds Qxh7 checkmate. Best defense: g6 blocks the diagonal.
    // Ply = move 14, black = ply 27 > 24.
    id: "defending",
    fen: "r1b2rk1/pp1n1ppp/3qp3/7Q/8/2P2N2/PPB2PPP/R3R1K1 b - - 0 14",
    bestMoveUci: "g7g6",
    pvMoves: ["g7g6"],
    evalBeforeCp: 80,
    evalAfterCp: 80,
    sideToMove: "BLACK",
    expectedCategory: "defending",
    description: "White threatens Qxh7# — queen on h5 supported by bishop on c2 along the b1-h7 diagonal. Black must play ...g6 to block the diagonal and prevent immediate checkmate.",
  },
  {
    // 3. ATTACKING — White to move, best move executes a threat (Bxf7+ wins material with check).
    // No eval threshold needed — attacking just means "your move creates/executes a threat."
    // Ply = move 16, white = ply 30 > 24.
    id: "attacking",
    fen: "r1b1k2r/ppppqppp/2n2n2/4N3/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 16",
    bestMoveUci: "c4f7",
    pvMoves: ["c4f7", "e8d8", "f7g6"],
    evalBeforeCp: 60,
    evalAfterCp: -150,
    sideToMove: "WHITE",
    expectedCategory: "attacking",
    description: "Bxf7+ wins a pawn with check — the best move executes a concrete threat. Only a slight edge needed (eval > 50 separates attacking from defending when both have threats).",
  },
  {
    // 4. TACTICS — Knight fork: Ne2+ gives check, forking Kg1 and Qc1.
    // Nothing can recapture on e2 (only legal reply is Kh1), then Nxc1 wins the queen.
    // Eval is 0 — proving tactics works at any eval. Ply = move 16, black = ply 31 > 24.
    id: "tactics",
    fen: "r1b2rk1/pp1q1ppp/2p5/4p3/3n4/2P2N2/PP1B1PPP/R1Q2RK1 b - - 0 16",
    bestMoveUci: "d4e2",
    pvMoves: ["d4e2", "g1h1", "e2c1"],
    evalBeforeCp: 0,
    evalAfterCp: 300,
    sideToMove: "BLACK",
    expectedCategory: "tactics",
    description: "Ne2+ gives check — nothing can recapture (only reply is Kh1). Then Nxc1 wins the queen. A clean knight fork at equal eval — tactical motifs take priority over all other categories.",
  },
  {
    // 5. ENDGAME — King + pawn endgame. 0 major/minor pieces (< 7 threshold).
    // No tactical motifs, eval near 0 (avoids attacking/defending).
    // Ply = move 40, white = ply 78 > 24.
    id: "endgame",
    fen: "8/8/4kpp1/8/4PP2/6K1/8/8 w - - 0 40",
    bestMoveUci: "g3g4",
    pvMoves: ["g3g4"],
    evalBeforeCp: 30,
    evalAfterCp: -20,
    sideToMove: "WHITE",
    expectedCategory: "endgame",
    description: "King + pawn endgame with no pieces (< 7 major/minor). Kg4 activates the king. Eval near 0 — no attacking/defending triggers.",
  },
  {
    // 6. STRATEGIC — Quiet middlegame position, no threats, no tactics.
    // Many pieces (not endgame), no null-move threats, eval close to 0.
    // Ply = move 18, white = ply 34 > 24.
    id: "strategic",
    fen: "r1bq1rk1/pp3ppp/2nbpn2/2pp4/3P4/2NBPN2/PPQ2PPP/R1B2RK1 w - - 0 18",
    bestMoveUci: "e3e4",
    pvMoves: ["e3e4"],
    evalBeforeCp: 15,
    evalAfterCp: -35,
    sideToMove: "WHITE",
    expectedCategory: "strategic",
    description: "Quiet middlegame — no threats, no tactical motifs, plenty of pieces. The best move is a positional pawn break.",
  },
];

interface ClassifyResult {
  category: string | null;
  severity: string;
  labels: string[];
}

function CategoryBadge({ category }: { category: string | null }) {
  const cat = category || "unknown";
  const display = CATEGORY_DISPLAY[cat] || { label: cat, bg: "#333", fg: "#999" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        backgroundColor: display.bg,
        color: display.fg,
      }}
    >
      {display.label}
    </span>
  );
}

function LabelPill({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        backgroundColor: "#3d3a37",
        color: "#9b9895",
        marginRight: 4,
        marginBottom: 4,
      }}
    >
      {label.replace(/_/g, " ")}
    </span>
  );
}

function PuzzleCard({ puzzle }: { puzzle: TestPuzzle }) {
  const [result, setResult] = useState<ClassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function classify() {
      try {
        const res = await fetch(`${API_BASE}/classify-test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fen: puzzle.fen,
            bestMoveUci: puzzle.bestMoveUci,
            pvMoves: puzzle.pvMoves,
            evalBeforeCp: puzzle.evalBeforeCp,
            evalAfterCp: puzzle.evalAfterCp,
            sideToMove: puzzle.sideToMove,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResult(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    classify();
  }, [puzzle]);

  const from = puzzle.bestMoveUci.slice(0, 2);
  const to = puzzle.bestMoveUci.slice(2, 4);
  const arrows: Arrow[] = [{ startSquare: from, endSquare: to, color: "rgba(105, 146, 62, 0.85)" }];
  const boardOrientation = puzzle.sideToMove === "WHITE" ? "white" : "black";

  const matches = result?.category === puzzle.expectedCategory;

  return (
    <div
      style={{
        backgroundColor: "#272522",
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #3d3a37",
      }}
    >
      {/* Board */}
      <div style={{ padding: 12, paddingBottom: 0 }}>
        <Chessboard
          options={{
            position: puzzle.fen,
            boardOrientation: boardOrientation,
            allowDragging: false,
            arrows: arrows,
            darkSquareStyle: { backgroundColor: "#6596EB" },
            lightSquareStyle: { backgroundColor: "#EAF1F8" },
          }}
        />
      </div>

      {/* Info panel */}
      <div style={{ padding: "12px 16px 16px" }}>
        {/* Category row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", minWidth: 60 }}>
            Expected
          </span>
          <CategoryBadge category={puzzle.expectedCategory} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", minWidth: 60 }}>
            Actual
          </span>
          {loading ? (
            <span style={{ fontSize: 12, color: "#9b9895" }}>Classifying...</span>
          ) : error ? (
            <span style={{ fontSize: 12, color: "#e05252" }}>{error}</span>
          ) : (
            <>
              <CategoryBadge category={result?.category ?? null} />
              <span style={{ fontSize: 16, marginLeft: 4 }}>
                {matches ? (
                  <span style={{ color: "#5bd98a" }}>&#10003;</span>
                ) : (
                  <span style={{ color: "#e05252" }}>&#10007;</span>
                )}
              </span>
            </>
          )}
        </div>

        {/* Labels */}
        {result && result.labels.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", marginRight: 8 }}>
              Labels
            </span>
            <div style={{ display: "inline-flex", flexWrap: "wrap", marginTop: 4 }}>
              {result.labels.map((l) => (
                <LabelPill key={l} label={l} />
              ))}
            </div>
          </div>
        )}

        {/* Severity */}
        {result && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#9b9895", textTransform: "uppercase", marginRight: 8 }}>
              Severity
            </span>
            <span style={{ fontSize: 12, color: "#ccc" }}>{result.severity}</span>
          </div>
        )}

        {/* Description */}
        <p style={{ fontSize: 12, color: "#9b9895", lineHeight: 1.5, margin: 0 }}>
          {puzzle.description}
        </p>
      </div>
    </div>
  );
}

export default function PuzzleTestPage() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#312e2b", padding: "32px 40px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
        Puzzle Classification Test
      </h1>
      <p style={{ fontSize: 14, color: "#9b9895", marginBottom: 28 }}>
        6 handcrafted positions — one per category. Each is classified on mount via POST /classify-test.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 20,
          maxWidth: 1160,
        }}
      >
        {TEST_PUZZLES.map((puzzle) => (
          <PuzzleCard key={puzzle.id} puzzle={puzzle} />
        ))}
      </div>
    </div>
  );
}
