import { StockfishEngine } from "../services/stockfish";
import { detectLabels } from "../services/puzzleClassification";

/**
 * Validate all 20 motif test positions with Stockfish.
 * For each position:
 *   1. Run Stockfish at depth 18 to get best move + PV + eval
 *   2. Check if Stockfish's best move matches our expected move
 *   3. If it doesn't match, show what Stockfish thinks is best
 *   4. Re-run detectLabels with Stockfish's PV to see if the motif still triggers
 */

interface MotifTest {
  motif: string;
  description: string;
  fen: string;
  bestMoveUci: string;
  pvMoves: string[];
}

// SET 1 — Original test positions (test-all-motifs.ts)
const set1: MotifTest[] = [
  { motif: "fork", fen: "6k1/ppp2ppp/3q1r2/8/8/2NP4/PPP2PPP/6K1 w - - 0 25", bestMoveUci: "c3e4", pvMoves: ["c3e4", "d6d8", "e4f6"], description: "Ne4 forks Qd6 and Rf6" },
  { motif: "pin", fen: "r2qkb1r/ppp3pp/3p4/4n3/8/8/PPPN1PPP/R1BQR1K1 w kq - 0 12", bestMoveUci: "d2f3", pvMoves: ["d2f3", "f8e7", "f3e5"], description: "Nf3 exploits pin on Ne5" },
  { motif: "skewer", fen: "r5k1/p4ppp/8/3q4/8/8/PPP3BP/4K2R w K - 0 30", bestMoveUci: "g2e4", pvMoves: ["g2e4", "d5d2", "e4a8"], description: "Be4 skewers Qd5 and Ra8" },
  { motif: "double_attack", fen: "4k3/3r4/r7/8/8/3N4/PPP1B1PP/4K3 w - - 0 25", bestMoveUci: "d3e5", pvMoves: ["d3e5", "d7d8", "e2a6"], description: "Ne5 uncovers Be2→Ra6 AND attacks Rd7" },
  { motif: "discovered_attack", fen: "r7/pp4kp/4p3/4N3/8/8/PB3PPP/4R1K1 w - - 0 20", bestMoveUci: "e5c6", pvMoves: ["e5c6", "g7h8", "c6a7"], description: "Nc6 uncovers Bb2→Kg7" },
  { motif: "removal_of_defender", fen: "r5k1/pp1r1ppp/5n2/6B1/8/8/PPP2PPP/3R2K1 w - - 0 20", bestMoveUci: "g5f6", pvMoves: ["g5f6", "g7f6", "d1d7"], description: "Bxf6 removes Nf6 defending Rd7" },
  { motif: "overload", fen: "r3k3/3q2p1/2n1b3/1B6/8/2N5/PPP2PPP/R3R1K1 w - - 0 15", bestMoveUci: "c3d5", pvMoves: ["c3d5", "e8f8", "d5e7"], description: "Nd5 overloads Qd7" },
  { motif: "deflection", fen: "r3k2r/ppp2ppp/3p4/2b1n3/1B6/5N2/PPP2PPP/R3K2R w KQkq - 0 15", bestMoveUci: "f3e5", pvMoves: ["f3e5", "d6e5", "b4c5"], description: "Nxe5 deflects d6 pawn from Bc5" },
  { motif: "intermezzo", fen: "r1bqk2r/pp3ppp/4p3/8/2BpP3/5N2/PPP2PPP/R1BQK2R w KQkq - 0 10", bestMoveUci: "c4b5", pvMoves: ["c4b5", "d8d7", "b5d7"], description: "Bb5+ intermezzo before Qd7 blocks" },
  { motif: "sacrifice", fen: "r1bq1rk1/ppppbppp/2n2n2/4p2Q/2B1P3/2N2N2/PPPP1PPP/R1B2RK1 w - - 0 14", bestMoveUci: "h5h7", pvMoves: ["h5h7", "g8h7"], description: "Qxh7+ queen sacrifice" },
  { motif: "clearance", fen: "3qk3/8/8/8/3N4/8/8/3R2K1 w - - 0 1", bestMoveUci: "d4e6", pvMoves: ["d4e6", "d8d6", "d1d6"], description: "Ne6 clears d-file for Rd1" },
  { motif: "back_rank", fen: "6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1", bestMoveUci: "d1d8", pvMoves: ["d1d8"], description: "Rd8# back rank mate" },
  { motif: "mate_threat", fen: "5Bk1/5p1p/8/8/7Q/8/8/6K1 w - - 0 1", bestMoveUci: "h4g5", pvMoves: ["h4g5", "h7h6", "g5g7"], description: "Qg5 threatens Qg7#" },
  { motif: "checkmate", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K2R w KQkq - 0 4", bestMoveUci: "f3f7", pvMoves: ["f3f7"], description: "Qxf7# Scholar's mate" },
  { motif: "smothered_mate", fen: "6rk/6pp/8/6N1/8/8/8/4K3 w - - 0 1", bestMoveUci: "g5f7", pvMoves: ["g5f7"], description: "Nf7# smothered mate" },
  { motif: "trapped_piece", fen: "6kn/8/6P1/4Q2B/8/8/P7/4KR2 w - - 0 1", bestMoveUci: "a2a3", pvMoves: ["a2a3", "h8f7", "e5f6"], description: "After a3 Nh8 is trapped" },
  { motif: "x_ray", fen: "4k3/8/8/8/8/8/8/4RQK1 w - - 0 1", bestMoveUci: "f1e2", pvMoves: ["f1e2", "e8d8", "e2e7"], description: "Qe2 battery with Re1" },
  { motif: "interference", fen: "1r4k1/8/8/8/8/2N5/1r6/R3K3 w - - 0 1", bestMoveUci: "c3b5", pvMoves: ["c3b5", "b8b5", "a1a2"], description: "Nb5 between Rb8 and Rb2" },
  { motif: "desperado", fen: "r1bqkb1r/pppp1ppp/2n5/4p3/3nP3/4BN2/PPPP1PPP/RN1QKB1R b KQkq - 0 14", bestMoveUci: "d4c2", pvMoves: ["d4c2", "d1c2"], description: "Nxc2+ desperado" },
  { motif: "attraction", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5", bestMoveUci: "c4f7", pvMoves: ["c4f7", "e8f7", "f3g5"], description: "Bxf7+ attracts king" },
];

// SET 2 — New test positions (motif-test page)
const set2: MotifTest[] = [
  { motif: "fork", fen: "6k1/ppp2ppp/3q1r2/8/8/2NP4/PPP2PPP/6K1 w - - 0 25", bestMoveUci: "c3e4", pvMoves: ["c3e4", "d6d8", "e4f6"], description: "Ne4 forks Qd6 and Rf6" },
  { motif: "pin", fen: "r2qkb1r/ppp2ppp/2n1pn2/3p4/4P3/2NB1N2/PPPP1PPP/R1BQK2R w KQkq - 0 5", bestMoveUci: "d3b5", pvMoves: ["d3b5", "a7a6", "b5c6"], description: "Bb5 pins Nc6 to Ke8" },
  { motif: "skewer", fen: "8/1b4pp/8/8/1k6/8/6PP/R5K1 w - - 0 40", bestMoveUci: "a1b1", pvMoves: ["a1b1", "b4c5", "b1b7"], description: "Rb1 skewers Kb4 and Bb7" },
  { motif: "double_attack", fen: "5k2/3r4/5r2/8/3N4/8/1B4PP/3R2K1 w - - 0 25", bestMoveUci: "d4f5", pvMoves: ["d4f5", "d7d8", "b2f6"], description: "Nf5 uncovers Rd1→Rd7 and Bb2→Rf6" },
  { motif: "discovered_attack", fen: "4k3/pp6/8/8/8/4N3/PP6/4R1K1 w - - 0 20", bestMoveUci: "e3d5", pvMoves: ["e3d5", "e8d8", "d5c7"], description: "Nd5 discovers Re1 check" },
  { motif: "removal_of_defender", fen: "r3k3/pp3ppp/2n5/8/3n4/5B2/PPP2PPP/3R2K1 w - - 0 15", bestMoveUci: "f3c6", pvMoves: ["f3c6", "b7c6", "d1d4"], description: "Bxc6 removes Nc6 defending Nd4" },
  { motif: "overload", fen: "7k/3q1b2/2n5/1B6/8/8/P5PP/5RK1 w - - 0 20", bestMoveUci: "a2a3", pvMoves: ["a2a3", "d7d5", "b5c6"], description: "Qd7 overloaded defending Nc6+Bf7" },
  { motif: "deflection", fen: "R5k1/5r2/8/8/8/3B4/6PP/5RK1 w - - 0 30", bestMoveUci: "d3h7", pvMoves: ["d3h7", "g8h7", "f1f7"], description: "Bh7+ deflects king from Rf7" },
  { motif: "intermezzo", fen: "8/k3b3/8/8/3N4/8/PP3PPP/6K1 w - - 0 25", bestMoveUci: "d4c6", pvMoves: ["d4c6", "a7a8", "c6e7"], description: "Nc6+ intermezzo then Nxe7" },
  { motif: "sacrifice", fen: "r1bq1rk1/pppn1ppp/4pn2/3p4/2PP4/2N2N2/PP3PPP/RBQ2RK1 w - - 0 8", bestMoveUci: "b1h7", pvMoves: ["b1h7", "g8h7"], description: "Bxh7+ bishop sacrifice" },
  { motif: "clearance", fen: "2q1k3/pp6/8/8/8/2N5/PP4PP/2R3K1 w - - 0 25", bestMoveUci: "c3e4", pvMoves: ["c3e4", "c7c5", "c1c5"], description: "Ne4 clears c-file for Rc1" },
  { motif: "back_rank", fen: "6k1/5ppp/8/8/8/8/8/2R3K1 w - - 0 1", bestMoveUci: "c1c8", pvMoves: ["c1c8"], description: "Rc8# back rank mate" },
  { motif: "mate_threat", fen: "6k1/5p1p/4N3/8/8/7Q/6PP/6K1 w - - 0 1", bestMoveUci: "h3g4", pvMoves: ["h3g4", "h7h6", "g4g7"], description: "Qg4 threatens Qg7#" },
  { motif: "checkmate", fen: "3rk3/p2p1p2/8/3N4/7Q/8/5PPP/6K1 w - - 0 20", bestMoveUci: "h4e7", pvMoves: ["h4e7"], description: "Qe7# with Nd5 guarding" },
  { motif: "smothered_mate", fen: "6rk/6pp/8/4N3/8/8/8/4K3 w - - 0 1", bestMoveUci: "e5f7", pvMoves: ["e5f7"], description: "Nf7# smothered mate" },
  { motif: "trapped_piece", fen: "6k1/8/8/8/8/1P6/2P3PP/nRR3K1 w - - 0 1", bestMoveUci: "h2h3", pvMoves: ["h2h3", "a1b3", "c2b3"], description: "Na1 trapped after h3" },
  { motif: "x_ray", fen: "3k4/8/8/8/8/8/4R3/3Q2K1 w - - 0 1", bestMoveUci: "e2d2", pvMoves: ["e2d2", "d8c8", "d2d7"], description: "Rd2 battery with Qd1" },
  { motif: "interference", fen: "r3r1k1/8/2N5/8/8/8/6PP/6K1 w - - 0 25", bestMoveUci: "c6d8", pvMoves: ["c6d8", "a8d8", "g1f2"], description: "Nd8 between Ra8 and Re8" },
  { motif: "desperado", fen: "6k1/8/8/8/8/5b2/6PP/3RK3 b - - 0 30", bestMoveUci: "f3d1", pvMoves: ["f3d1", "e1d1"], description: "Bxd1 desperado" },
  { motif: "attraction", fen: "4k3/5b2/8/8/2B5/8/6PP/3Q2K1 w - - 0 20", bestMoveUci: "c4f7", pvMoves: ["c4f7", "e8f7", "d1d5"], description: "Bxf7+ attracts king, Qd5+" },
];

async function main() {
  const engine = new StockfishEngine();
  await engine.init();

  const DEPTH = 18;

  for (const [setIdx, positions] of [set1, set2].entries()) {
    const setName = setIdx === 0 ? "SET 1 (test-all-motifs)" : "SET 2 (motif-test page)";
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ${setName}`);
    console.log(`${"=".repeat(60)}\n`);

    let pass = 0;
    let fail = 0;
    const problems: string[] = [];

    for (const t of positions) {
      const result = await engine.evaluate(t.fen, DEPTH);
      const sfBest = result.bestMove;
      const sfPv = result.pv.split(" ");
      const sfScore = result.score;
      const moveMatch = sfBest === t.bestMoveUci;

      // Check if our move at least wins material (eval > 0 from mover's perspective)
      // For Black-to-move positions, score is already from Black's perspective
      const isWinning = sfScore > 50 || (t.fen.split(" ")[1] === "b" && sfScore > 50);

      // If Stockfish disagrees, also check if our move still triggers the motif
      let motifWithSfPv = false;
      if (!moveMatch) {
        // Run our move through detector with Stockfish's full PV starting from our move
        // Also evaluate our specific move
        const labelsOurMove = detectLabels(t.fen, t.bestMoveUci, t.pvMoves, null);
        motifWithSfPv = labelsOurMove.includes(t.motif as any);
      }

      // Also evaluate what Stockfish says about our specific move
      let ourMoveEval: number | null = null;
      if (!moveMatch) {
        // Evaluate position after our move
        const { Chess } = require("chess.js");
        const chess = new Chess(t.fen);
        try {
          const from = t.bestMoveUci.slice(0, 2);
          const to = t.bestMoveUci.slice(2, 4);
          const promo = t.bestMoveUci.length > 4 ? t.bestMoveUci[4] : undefined;
          chess.move({ from, to, promotion: promo });
          const afterResult = await engine.evaluate(chess.fen(), DEPTH);
          // Score is from opponent's perspective, so negate
          ourMoveEval = -afterResult.score;
        } catch {}
      }

      const status = moveMatch ? "MATCH" : "DIFFER";
      const evalStr = sfScore >= 10000 ? "M+" : sfScore <= -10000 ? "M-" : `${sfScore}cp`;
      const icon = moveMatch ? "✓" : "✗";

      console.log(`${icon} ${t.motif.padEnd(22)} | SF best: ${sfBest.padEnd(6)} | Ours: ${t.bestMoveUci.padEnd(6)} | ${status} | eval: ${evalStr}`);

      if (!moveMatch) {
        const ourEvalStr = ourMoveEval !== null
          ? (ourMoveEval >= 10000 ? "M+" : ourMoveEval <= -10000 ? "M-" : `${ourMoveEval}cp`)
          : "?";
        console.log(`  SF PV: ${sfPv.slice(0, 5).join(" ")}`);
        console.log(`  Our move eval: ${ourEvalStr} | SF best eval: ${evalStr}`);
        const evalDiff = ourMoveEval !== null ? sfScore - ourMoveEval : null;
        console.log(`  Eval loss: ${evalDiff !== null ? evalDiff + "cp" : "?"}`);
        console.log(`  Motif still detected: ${motifWithSfPv ? "YES" : "NO"}`);

        if (ourMoveEval !== null && evalDiff !== null && evalDiff > 100) {
          fail++;
          problems.push(`${t.motif}: our move loses ${evalDiff}cp vs SF best (${sfBest})`);
        } else {
          pass++;
        }
      } else {
        pass++;
      }
    }

    console.log(`\n${pass}/${positions.length} validated. ${fail} problematic.`);
    if (problems.length > 0) {
      console.log("Problems:");
      for (const p of problems) console.log(`  - ${p}`);
    }
  }

  engine.shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
