"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Arrow } from "react-chessboard";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false }
);

const API_BASE = "http://localhost:3000";

interface MotifPuzzle {
  id: string;
  motif: string;
  fen: string;
  bestMoveUci: string;
  pvMoves: string[];
  evalBeforeCp: number;
  evalAfterCp: number;
  sideToMove: "WHITE" | "BLACK";
  description: string;
}

// 20 handcrafted positions — one per tactical motif (Set 2)
const MOTIF_PUZZLES: MotifPuzzle[] = [
  // 1. FORK
  {
    id: "fork",
    motif: "fork",
    fen: "6k1/ppp2ppp/3q1r2/8/8/2NP4/PPP2PPP/6K1 w - - 0 25",
    bestMoveUci: "c3e4",
    pvMoves: ["c3e4", "d6d8", "e4f6"],
    evalBeforeCp: 0,
    evalAfterCp: 500,
    sideToMove: "WHITE",
    description: "Ne4 forks Qd6 and Rf6. Queen retreats, Nxf6+ wins the rook with check.",
  },
  // 2. PIN
  {
    id: "pin",
    motif: "pin",
    fen: "r2qkb1r/ppp2ppp/2n1pn2/3p4/4P3/2NB1N2/PPPP1PPP/R1BQK2R w KQkq - 0 5",
    bestMoveUci: "d3b5",
    pvMoves: ["d3b5", "a7a6", "b5c6"],
    evalBeforeCp: 50,
    evalAfterCp: 350,
    sideToMove: "WHITE",
    description: "Bb5 pins Nc6 to Ke8 along the diagonal. The knight can't move.",
  },
  // 3. SKEWER
  {
    id: "skewer",
    motif: "skewer",
    fen: "8/1b4pp/8/8/1k6/8/6PP/R5K1 w - - 0 40",
    bestMoveUci: "a1b1",
    pvMoves: ["a1b1", "b4c5", "b1b7"],
    evalBeforeCp: -200,
    evalAfterCp: 300,
    sideToMove: "WHITE",
    description: "Rb1 skewers Kb4 (must move) and Bb7 behind. After king moves, Rxb7.",
  },
  // 4. DOUBLE ATTACK
  {
    id: "double_attack",
    motif: "double_attack",
    fen: "5k2/3r4/5r2/8/3N4/8/1B4PP/3R2K1 w - - 0 25",
    bestMoveUci: "d4f5",
    pvMoves: ["d4f5", "d7d8", "b2f6"],
    evalBeforeCp: 0,
    evalAfterCp: 400,
    sideToMove: "WHITE",
    description: "Nf5 uncovers both Rd1→Rd7 and Bb2→Rf6. Two different pieces, two new threats.",
  },
  // 5. DISCOVERED ATTACK
  {
    id: "discovered_attack",
    motif: "discovered_attack",
    fen: "4k3/pp6/8/8/8/4N3/PP6/4R1K1 w - - 0 20",
    bestMoveUci: "e3d5",
    pvMoves: ["e3d5", "e8d8", "d5c7"],
    evalBeforeCp: 50,
    evalAfterCp: 400,
    sideToMove: "WHITE",
    description: "Nd5 moves off e-file, revealing Re1 check on Ke8. Discovered check.",
  },
  // 6. REMOVAL OF DEFENDER
  {
    id: "removal_of_defender",
    motif: "removal_of_defender",
    fen: "r3k3/pp3ppp/2n5/8/3n4/5B2/PPP2PPP/3R2K1 w - - 0 15",
    bestMoveUci: "f3c6",
    pvMoves: ["f3c6", "b7c6", "d1d4"],
    evalBeforeCp: 100,
    evalAfterCp: 500,
    sideToMove: "WHITE",
    description: "Bxc6 removes the knight defending Nd4. After bxc6, Rxd4 wins.",
  },
  // 7. OVERLOAD
  {
    id: "overload",
    motif: "overload",
    fen: "7k/3q1b2/2n5/1B6/8/8/P5PP/5RK1 w - - 0 20",
    bestMoveUci: "a2a3",
    pvMoves: ["a2a3", "d7d5", "b5c6"],
    evalBeforeCp: 50,
    evalAfterCp: 200,
    sideToMove: "WHITE",
    description: "After a3, Qd7 is sole defender of both Nc6 (attacked by Bb5) and Bf7 (attacked by Rf1). Overloaded.",
  },
  // 8. DEFLECTION
  {
    id: "deflection",
    motif: "deflection",
    fen: "R5k1/5r2/8/8/8/3B4/6PP/5RK1 w - - 0 30",
    bestMoveUci: "d3h7",
    pvMoves: ["d3h7", "g8h7", "f1f7"],
    evalBeforeCp: 50,
    evalAfterCp: 300,
    sideToMove: "WHITE",
    description: "Bh7+ forces Kxh7, deflecting king from defending Rf7. Then Rxf7 wins.",
  },
  // 9. INTERMEZZO
  {
    id: "intermezzo",
    motif: "intermezzo",
    fen: "8/k3b3/8/8/3N4/8/PP3PPP/6K1 w - - 0 25",
    bestMoveUci: "d4c6",
    pvMoves: ["d4c6", "a7a8", "c6e7"],
    evalBeforeCp: 0,
    evalAfterCp: 300,
    sideToMove: "WHITE",
    description: "Nc6+ inserts a check. Ka8, then Nxe7 captures the bishop.",
  },
  // 10. SACRIFICE
  {
    id: "sacrifice",
    motif: "sacrifice",
    fen: "r1bq1rk1/pppn1ppp/4pn2/3p4/2PP4/2N2N2/PP3PPP/RBQ2RK1 w - - 0 8",
    bestMoveUci: "b1h7",
    pvMoves: ["b1h7", "g8h7"],
    evalBeforeCp: 100,
    evalAfterCp: 800,
    sideToMove: "WHITE",
    description: "Bxh7+! Bishop sacrifice — Kxh7 recaptures, but White's attack is crushing.",
  },
  // 11. CLEARANCE
  {
    id: "clearance",
    motif: "clearance",
    fen: "2q1k3/pp6/8/8/8/2N5/PP4PP/2R3K1 w - - 0 25",
    bestMoveUci: "c3e4",
    pvMoves: ["c3e4", "c7c5", "c1c5"],
    evalBeforeCp: 50,
    evalAfterCp: 400,
    sideToMove: "WHITE",
    description: "Ne4 clears the c-file. Rc1 now has a clear line to attack Qc8.",
  },
  // 12. BACK RANK
  {
    id: "back_rank",
    motif: "back_rank",
    fen: "6k1/5ppp/8/8/8/8/8/2R3K1 w - - 0 1",
    bestMoveUci: "c1c8",
    pvMoves: ["c1c8"],
    evalBeforeCp: 200,
    evalAfterCp: 9999,
    sideToMove: "WHITE",
    description: "Rc8# — back rank mate. King g8 trapped by f7, g7, h7 pawns.",
  },
  // 13. MATE THREAT
  {
    id: "mate_threat",
    motif: "mate_threat",
    fen: "6k1/5p1p/4N3/8/8/7Q/6PP/6K1 w - - 0 1",
    bestMoveUci: "h3g4",
    pvMoves: ["h3g4", "h7h6", "g4g7"],
    evalBeforeCp: 30,
    evalAfterCp: 200,
    sideToMove: "WHITE",
    description: "Qg4 threatens Qg7#. Ne6 covers f8 escape. Almost all Black moves allow mate.",
  },
  // 14. CHECKMATE
  {
    id: "checkmate",
    motif: "checkmate",
    fen: "3rk3/p2p1p2/8/3N4/7Q/8/5PPP/6K1 w - - 0 20",
    bestMoveUci: "h4e7",
    pvMoves: ["h4e7"],
    evalBeforeCp: 9999,
    evalAfterCp: 9999,
    sideToMove: "WHITE",
    description: "Qe7# — Nd5 guards e7 from recapture. King trapped by Rd8, d7/f7 pawns.",
  },
  // 15. SMOTHERED MATE
  {
    id: "smothered_mate",
    motif: "smothered_mate",
    fen: "6rk/6pp/8/4N3/8/8/8/4K3 w - - 0 1",
    bestMoveUci: "e5f7",
    pvMoves: ["e5f7"],
    evalBeforeCp: 9999,
    evalAfterCp: 9999,
    sideToMove: "WHITE",
    description: "Nf7# — smothered mate. King h8 hemmed in by Rg8, g7, h7.",
  },
  // 16. TRAPPED PIECE
  {
    id: "trapped_piece",
    motif: "trapped_piece",
    fen: "6k1/8/8/8/8/1P6/2P3PP/nRR3K1 w - - 0 1",
    bestMoveUci: "h2h3",
    pvMoves: ["h2h3", "a1b3", "c2b3"],
    evalBeforeCp: 30,
    evalAfterCp: 200,
    sideToMove: "WHITE",
    description: "After h3, Na1 is trapped: attacked by Rb1, Nxb3 met by cxb3, Nxc2 met by Rc1.",
  },
  // 17. X-RAY (Battery)
  {
    id: "x_ray",
    motif: "x_ray",
    fen: "3k4/8/8/8/8/8/4R3/3Q2K1 w - - 0 1",
    bestMoveUci: "e2d2",
    pvMoves: ["e2d2", "d8c8", "d2d7"],
    evalBeforeCp: 30,
    evalAfterCp: 80,
    sideToMove: "WHITE",
    description: "Rd2 creates battery with Qd1 behind. X-ray pressure on d-file toward Kd8.",
  },
  // 18. INTERFERENCE
  {
    id: "interference",
    motif: "interference",
    fen: "r3r1k1/8/2N5/8/8/8/6PP/6K1 w - - 0 25",
    bestMoveUci: "c6d8",
    pvMoves: ["c6d8", "a8d8", "g1f2"],
    evalBeforeCp: 0,
    evalAfterCp: 300,
    sideToMove: "WHITE",
    description: "Nd8 lands between Ra8 and Re8, cutting their defensive connection on rank 8.",
  },
  // 19. DESPERADO
  {
    id: "desperado",
    motif: "desperado",
    fen: "6k1/8/8/8/8/5b2/6PP/3RK3 b - - 0 30",
    bestMoveUci: "f3d1",
    pvMoves: ["f3d1", "e1d1"],
    evalBeforeCp: 0,
    evalAfterCp: -100,
    sideToMove: "BLACK",
    description: "Bf3 is doomed (attacked by g2 pawn). Bxd1 grabs the rook — Kxd1 recaptures.",
  },
  // 20. ATTRACTION
  {
    id: "attraction",
    motif: "attraction",
    fen: "4k3/5b2/8/8/2B5/8/6PP/3Q2K1 w - - 0 20",
    bestMoveUci: "c4f7",
    pvMoves: ["c4f7", "e8f7", "d1d5"],
    evalBeforeCp: 30,
    evalAfterCp: 200,
    sideToMove: "WHITE",
    description: "Bxf7+ attracts king to f7. After Kxf7, Qd5+ exploits the exposed king.",
  },
];

interface ClassifyResult {
  category: string | null;
  severity: string;
  labels: string[];
}

// Color map for motif pills
const MOTIF_COLOR: Record<string, string> = {
  fork: "#5bd98a",
  pin: "#5ba3d9",
  skewer: "#d9c75b",
  double_attack: "#c27a30",
  discovered_attack: "#d95bd9",
  removal_of_defender: "#e05252",
  overload: "#ff7b72",
  deflection: "#a371f7",
  intermezzo: "#79c0ff",
  sacrifice: "#f0883e",
  clearance: "#7ee787",
  back_rank: "#ff4444",
  mate_threat: "#ff6666",
  checkmate: "#ff0000",
  smothered_mate: "#ff3366",
  trapped_piece: "#d2a8ff",
  x_ray: "#56d4dd",
  interference: "#ffa657",
  desperado: "#f78166",
  attraction: "#db61a2",
};

function MotifBadge({ motif, highlight }: { motif: string; highlight?: boolean }) {
  const color = MOTIF_COLOR[motif] || "#9b9895";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        backgroundColor: highlight ? color + "22" : "#3d3a37",
        color: highlight ? color : "#9b9895",
        border: highlight ? `1px solid ${color}55` : "1px solid transparent",
        marginRight: 4,
        marginBottom: 4,
      }}
    >
      {motif.replace(/_/g, " ")}
    </span>
  );
}

function MotifCard({ puzzle }: { puzzle: MotifPuzzle }) {
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
  const arrows: Arrow[] = [
    { startSquare: from, endSquare: to, color: "rgba(105, 146, 62, 0.85)" },
  ];
  const boardOrientation = puzzle.sideToMove === "WHITE" ? "white" : "black";
  const hasExpectedMotif = result?.labels.includes(puzzle.motif) ?? false;

  return (
    <div
      style={{
        backgroundColor: "#272522",
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${hasExpectedMotif ? "#5bd98a33" : result && !loading ? "#e0525233" : "#3d3a37"}`,
      }}
    >
      {/* Header with motif name */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #3d3a37",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: MOTIF_COLOR[puzzle.motif] || "#fff",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {puzzle.motif.replace(/_/g, " ")}
        </span>
        {!loading && result && (
          <span style={{ fontSize: 18 }}>
            {hasExpectedMotif ? (
              <span style={{ color: "#5bd98a" }}>&#10003;</span>
            ) : (
              <span style={{ color: "#e05252" }}>&#10007;</span>
            )}
          </span>
        )}
      </div>

      {/* Board */}
      <div style={{ padding: 10, paddingBottom: 0 }}>
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
      <div style={{ padding: "10px 14px 14px" }}>
        {/* Detected labels */}
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#9b9895",
              textTransform: "uppercase",
              display: "block",
              marginBottom: 4,
            }}
          >
            Detected Labels
          </span>
          {loading ? (
            <span style={{ fontSize: 12, color: "#9b9895" }}>
              Classifying...
            </span>
          ) : error ? (
            <span style={{ fontSize: 12, color: "#e05252" }}>{error}</span>
          ) : result && result.labels.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {result.labels.map((l) => (
                <MotifBadge
                  key={l}
                  motif={l}
                  highlight={l === puzzle.motif}
                />
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "#666" }}>No labels detected</span>
          )}
        </div>

        {/* Category */}
        {result && (
          <div style={{ marginBottom: 6 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#9b9895",
                textTransform: "uppercase",
                marginRight: 6,
              }}
            >
              Category:
            </span>
            <span style={{ fontSize: 12, color: "#ccc" }}>
              {result.category || "none"}
            </span>
          </div>
        )}

        {/* Description */}
        <p
          style={{
            fontSize: 11,
            color: "#7a7774",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {puzzle.description}
        </p>
      </div>
    </div>
  );
}

export default function MotifTestPage() {
  const total = MOTIF_PUZZLES.length;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#312e2b",
        padding: "32px 40px",
      }}
    >
      <h1
        style={{
          fontSize: 26,
          fontWeight: 800,
          color: "#fff",
          marginBottom: 4,
        }}
      >
        Tactical Motif Test
      </h1>
      <p style={{ fontSize: 14, color: "#9b9895", marginBottom: 28 }}>
        {total} handcrafted positions — one per tactical motif. Each is
        classified via POST /classify-test. Green check = expected motif
        detected, red X = missing.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          maxWidth: 1400,
        }}
      >
        {MOTIF_PUZZLES.map((puzzle) => (
          <MotifCard key={puzzle.id} puzzle={puzzle} />
        ))}
      </div>
    </div>
  );
}
