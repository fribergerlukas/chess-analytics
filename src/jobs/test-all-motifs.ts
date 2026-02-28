import { detectLabels } from "../services/puzzleClassification";

/**
 * Test all 20 tactical motifs with handcrafted positions.
 * Each position is designed to trigger exactly one motif (or a small expected set).
 */

interface MotifTest {
  motif: string;
  description: string;
  fen: string;
  bestMoveUci: string;
  pvMoves: string[];
  category: null; // We only care about labels
}

const tests: MotifTest[] = [
  // 1. FORK — Ne4 forks Qd6 and Rf6 (no check, clean fork, protected by d3 pawn)
  {
    motif: "fork",
    description: "Ne4 forks Qd6 and Rf6. Queen retreats, Nxf6+ wins rook with check.",
    fen: "6k1/ppp2ppp/3q1r2/8/8/2NP4/PPP2PPP/6K1 w - - 0 25",
    bestMoveUci: "c3e4",
    pvMoves: ["c3e4", "d6d8", "e4f6"],
    category: null,
  },
  // 2. PIN — Nf3 exploits existing pin (Re1 pins Ne5 to Ke8)
  {
    motif: "pin",
    description: "Re1 pins Ne5 to Ke8. Nf3 adds attacker — pinned knight is lost.",
    fen: "r2qkb1r/ppp3pp/3p4/4n3/8/8/PPPN1PPP/R1BQR1K1 w kq - 0 12",
    bestMoveUci: "d2f3",
    pvMoves: ["d2f3", "f8e7", "f3e5"],
    category: null,
  },
  // 3. SKEWER — Be4 skewers Qd5 (must move) and Ra8 behind it
  {
    motif: "skewer",
    description: "Be4 attacks Qd5 along diagonal. Queen moves, Bxa8 wins rook.",
    fen: "r5k1/p4ppp/8/3q4/8/8/PPP3BP/4K2R w K - 0 30",
    bestMoveUci: "g2e4",
    pvMoves: ["g2e4", "d5d2", "e4a8"],
    category: null,
  },
  // 4. DOUBLE ATTACK — Ne5 uncovers Be2→Ra6 (knight was on d3 blocking diagonal) AND attacks Rd7
  {
    motif: "double_attack",
    description: "Ne5 from d3 uncovers Be2→Ra6 AND attacks Rd7. Two pieces, two new threats.",
    fen: "4k3/3r4/r7/8/8/3N4/PPP1B1PP/4K3 w - - 0 25",
    bestMoveUci: "d3e5",
    pvMoves: ["d3e5", "d7d8", "e2a6"],
    category: null,
  },
  // 5. DISCOVERED ATTACK — Nc6 uncovers Bb2 diagonal check on Kg7
  {
    motif: "discovered_attack",
    description: "Nc6 uncovers Bb2 diagonal to Kg7. Bishop delivers discovered check.",
    fen: "r7/pp4kp/4p3/4N3/8/8/PB3PPP/4R1K1 w - - 0 20",
    bestMoveUci: "e5c6",
    pvMoves: ["e5c6", "g7h8", "c6a7"],
    category: null,
  },
  // 6. REMOVAL OF DEFENDER — Bxf6 removes Nf6 which defended Rd7
  {
    motif: "removal_of_defender",
    description: "Bxf6 removes the knight defending Rd7. After gxf6, Rxd7 wins.",
    fen: "r5k1/pp1r1ppp/5n2/6B1/8/8/PPP2PPP/3R2K1 w - - 0 20",
    bestMoveUci: "g5f6",
    pvMoves: ["g5f6", "g7f6", "d1d7"],
    category: null,
  },
  // 7. OVERLOAD — Qd7 is sole defender of both Nc6 and Be6 after Nd5
  {
    motif: "overload",
    description: "After Nd5, Qd7 is sole defender of both Nc6 (attacked by Bb5) and Be6 (attacked by Re1).",
    fen: "r3k3/3q2p1/2n1b3/1B6/8/2N5/PPP2PPP/R3R1K1 w - - 0 15",
    bestMoveUci: "c3d5",
    pvMoves: ["c3d5", "e8f8", "d5e7"],
    category: null,
  },
  // 8. DEFLECTION — Nxe5 forces dxe5, deflecting d6 pawn from defending Bc5
  {
    motif: "deflection",
    description: "Nxe5 forces dxe5. The d6 pawn was defending Bc5. After dxe5, Bxc5 wins.",
    fen: "r3k2r/ppp2ppp/3p4/2b1n3/1B6/5N2/PPP2PPP/R3K2R w KQkq - 0 15",
    bestMoveUci: "f3e5",
    pvMoves: ["f3e5", "d6e5", "b4c5"],
    category: null,
  },
  // 9. INTERMEZZO — Bb5+ check (non-capture), Qd7 blocks, Bxd7+ captures
  {
    motif: "intermezzo",
    description: "Bb5+ inserts a check. Qd7 blocks. Bxd7+ captures the queen.",
    fen: "r1bqk2r/pp3ppp/4p3/8/2BpP3/5N2/PPP2PPP/R1BQK2R w KQkq - 0 10",
    bestMoveUci: "c4b5",
    pvMoves: ["c4b5", "d8d7", "b5d7"],
    category: null,
  },
  // 10. SACRIFICE — Qxh7+ queen sac (already validated)
  {
    motif: "sacrifice",
    description: "Qxh7+ sacrifices the queen. Kxh7 recaptures but the resulting position wins.",
    fen: "r1bq1rk1/ppppbppp/2n2n2/4p2Q/2B1P3/2N2N2/PPPP1PPP/R1B2RK1 w - - 0 14",
    bestMoveUci: "h5h7",
    pvMoves: ["h5h7", "g8h7"],
    category: null,
  },
  // 11. CLEARANCE — Ne6 clears d4 from d-file, Rd1 sees Qd8
  {
    motif: "clearance",
    description: "Ne6 clears d4 from the d-file. Rd1 now has clear line to Qd8.",
    fen: "3qk3/8/8/8/3N4/8/8/3R2K1 w - - 0 1",
    bestMoveUci: "d4e6",
    pvMoves: ["d4e6", "d8d6", "d1d6"],
    category: null,
  },
  // 12. BACK RANK — Rd8# mate in one
  {
    motif: "back_rank",
    description: "Rd8# — back rank mate. King trapped by f7, g7, h7 pawns.",
    fen: "6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1",
    bestMoveUci: "d1d8",
    pvMoves: ["d1d8"],
    category: null,
  },
  // 13. MATE THREAT — Qg5 threatens Qg7# with Bf8 blocking escape
  {
    motif: "mate_threat",
    description: "Qg5 threatens Qg7#. With Bf8 blocking escape, almost all Black moves allow mate.",
    fen: "5Bk1/5p1p/8/8/7Q/8/8/6K1 w - - 0 1",
    bestMoveUci: "h4g5",
    pvMoves: ["h4g5", "h7h6", "g5g7"],
    category: null,
  },
  // 14. CHECKMATE — Qxf7# Scholar's mate pattern
  {
    motif: "checkmate",
    description: "Qxf7# — Scholar's mate. Checkmate in one.",
    fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K2R w KQkq - 0 4",
    bestMoveUci: "f3f7",
    pvMoves: ["f3f7"],
    category: null,
  },
  // 15. SMOTHERED MATE — Nf7# king h8 hemmed by Rg8, g7, h7
  {
    motif: "smothered_mate",
    description: "Nf7# — smothered mate. King h8 surrounded by Rg8, g7, h7.",
    fen: "6rk/6pp/8/6N1/8/8/8/4K3 w - - 0 1",
    bestMoveUci: "g5f7",
    pvMoves: ["g5f7"],
    category: null,
  },
  // 16. TRAPPED PIECE — a3 quiet move, Nh8 attacked by Qe5, no safe squares
  {
    motif: "trapped_piece",
    description: "After a3, Nh8 attacked by Qe5. f7 attacked by Rf1, Nxg6 met by Bxg6.",
    fen: "6kn/8/6P1/4Q2B/8/8/P7/4KR2 w - - 0 1",
    bestMoveUci: "a2a3",
    pvMoves: ["a2a3", "h8f7", "e5f6"],
    category: null,
  },
  // 17. X-RAY — Qe2 creates battery with Re1 behind on e-file
  {
    motif: "x_ray",
    description: "Qe2 creates battery with Re1 behind. X-ray pressure on e-file toward Ke8.",
    fen: "4k3/8/8/8/8/8/8/4RQK1 w - - 0 1",
    bestMoveUci: "f1e2",
    pvMoves: ["f1e2", "e8d8", "e2e7"],
    category: null,
  },
  // 18. INTERFERENCE — Nb5 blocks b-file between Rb8 and Rb2
  {
    motif: "interference",
    description: "Nb5 blocks b-file between Rb8 and Rb2, severing defensive connection.",
    fen: "1r4k1/8/8/8/8/2N5/1r6/R3K3 w - - 0 1",
    bestMoveUci: "c3b5",
    pvMoves: ["c3b5", "b8b5", "a1a2"],
    category: null,
  },
  // 19. DESPERADO — Doomed knight on d4 captures before being taken
  {
    motif: "desperado",
    description: "Knight on d4 attacked by Be3. Nxc2+ grabs pawn — doomed piece takes material.",
    fen: "r1bqkb1r/pppp1ppp/2n5/4p3/3nP3/4BN2/PPPP1PPP/RN1QKB1R b KQkq - 0 14",
    bestMoveUci: "d4c2",
    pvMoves: ["d4c2", "d1c2"],
    category: null,
  },
  // 20. ATTRACTION — Bxf7+ attracts king to f7, then Ng5+ exploits
  {
    motif: "attraction",
    description: "Bxf7+ attracts king to f7. Then Ng5+ exploits the exposed king.",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5",
    bestMoveUci: "c4f7",
    pvMoves: ["c4f7", "e8f7", "f3g5"],
    category: null,
  },
];

// Run all tests
console.log("=== MOTIF DETECTOR VALIDATION (20 motifs) ===\n");
let pass = 0;
let fail = 0;

for (const t of tests) {
  const labels = detectLabels(t.fen, t.bestMoveUci, t.pvMoves, t.category);
  const hasExpected = labels.includes(t.motif as any);
  const status = hasExpected ? "PASS" : "FAIL";
  if (hasExpected) pass++;
  else fail++;
  console.log(
    `${status} | ${t.motif.padEnd(22)} | labels: [${labels.join(", ")}]`
  );
  if (!hasExpected) {
    console.log(`     ^ Expected "${t.motif}" but not found!`);
  }
}

console.log(`\n${pass}/${tests.length} motifs detected correctly. ${fail} failed.`);
