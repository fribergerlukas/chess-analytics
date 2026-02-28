import { detectLabels, classifyPuzzle } from "../services/puzzleClassification";
import { Side } from "@prisma/client";

// === TEST 1: SACRIFICE — Qxh7+ queen sac ===
console.log("=== SACRIFICE (Qxh7+ queen sac) ===");
const sacLabels = detectLabels(
  "r1bq1rk1/ppppbppp/2n2n2/4p2Q/2B1P3/2N2N2/PPPP1PPP/R1B2RK1 w - - 0 14",
  "h5h7", ["h5h7", "g8h7"], null
);
console.log("Labels:", sacLabels);
console.log("Has sacrifice:", sacLabels.includes("sacrifice"));

// === TEST 2: DESPERADO — doomed knight captures ===
console.log("\n=== DESPERADO (Nd4 attacked, takes on c2) ===");
const despLabels = detectLabels(
  "r1bqkb1r/pppp1ppp/2n5/4p3/3nP3/4BN2/PPPP1PPP/RN1QKB1R b KQkq - 0 14",
  "d4c2", ["d4c2", "d1c2"], null
);
console.log("Labels:", despLabels);
console.log("Has desperado:", despLabels.includes("desperado"));

// === TEST 3: NOT a sacrifice — Bxf7+ wins pawn with check (bishop 3 - pawn 1 = 2, threshold) ===
console.log("\n=== NOT sacrifice (Bxf7+ — bishop for pawn with check) ===");
const notSacLabels = detectLabels(
  "r1b1k2r/ppppqppp/2n2n2/4N3/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 16",
  "c4f7", ["c4f7", "e8d8", "f7g6"], null
);
console.log("Labels:", notSacLabels);
console.log("Has sacrifice:", notSacLabels.includes("sacrifice"), "(should be false)");

// === TEST 4: NOT a sacrifice — pawn push e3e4 ===
console.log("\n=== NOT sacrifice (e3-e4 pawn push) ===");
const notSacLabels2 = detectLabels(
  "r1bq1rk1/pp3ppp/2nbpn2/2pp4/3P4/2NBPN2/PPQ2PPP/R1B2RK1 w - - 0 18",
  "e3e4", ["e3e4"], null
);
console.log("Labels:", notSacLabels2);
console.log("Has sacrifice:", notSacLabels2.includes("sacrifice"), "(should be false)");

// === TEST 5: NOT a sacrifice — g7g6 pawn block ===
console.log("\n=== NOT sacrifice (g7-g6 mate block) ===");
const notSacLabels3 = detectLabels(
  "r1b2rk1/pp1n1ppp/3qp3/7Q/8/2P2N2/PPB2PPP/R3R1K1 b - - 0 14",
  "g7g6", ["g7g6"], null
);
console.log("Labels:", notSacLabels3);
console.log("Has sacrifice:", notSacLabels3.includes("sacrifice"), "(should be false)");

// === RE-VALIDATE: 6 puzzles ===
console.log("\n=== 6 PUZZLE CATEGORIES ===");
const puzzles = [
  { id: "opening", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4", bestMoveUci: "d2d3", pvMoves: ["d2d3"], evalBeforeCp: 30, evalAfterCp: -20, sideToMove: "WHITE" as Side, expected: "opening" },
  { id: "defending", fen: "r1b2rk1/pp1n1ppp/3qp3/7Q/8/2P2N2/PPB2PPP/R3R1K1 b - - 0 14", bestMoveUci: "g7g6", pvMoves: ["g7g6"], evalBeforeCp: 80, evalAfterCp: 80, sideToMove: "BLACK" as Side, expected: "defending" },
  { id: "attacking", fen: "r1b1k2r/ppppqppp/2n2n2/4N3/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 16", bestMoveUci: "c4f7", pvMoves: ["c4f7", "e8d8", "f7g6"], evalBeforeCp: 60, evalAfterCp: -150, sideToMove: "WHITE" as Side, expected: "attacking" },
  { id: "tactics", fen: "r1b2rk1/pp1q1ppp/2p5/4p3/3n4/2P2N2/PP1B1PPP/R1Q2RK1 b - - 0 16", bestMoveUci: "d4e2", pvMoves: ["d4e2", "g1h1", "e2c1"], evalBeforeCp: 0, evalAfterCp: 300, sideToMove: "BLACK" as Side, expected: "tactics" },
  { id: "endgame", fen: "8/8/4kpp1/8/4PP2/6K1/8/8 w - - 0 40", bestMoveUci: "g3g4", pvMoves: ["g3g4"], evalBeforeCp: 30, evalAfterCp: -20, sideToMove: "WHITE" as Side, expected: "endgame" },
  { id: "strategic", fen: "r1bq1rk1/pp3ppp/2nbpn2/2pp4/3P4/2NBPN2/PPQ2PPP/R1B2RK1 w - - 0 18", bestMoveUci: "e3e4", pvMoves: ["e3e4"], evalBeforeCp: 15, evalAfterCp: -35, sideToMove: "WHITE" as Side, expected: "strategic" },
];
let allPass = true;
for (const p of puzzles) {
  const result = classifyPuzzle({ fen: p.fen, bestMoveUci: p.bestMoveUci, pvMoves: p.pvMoves, evalBeforeCp: p.evalBeforeCp, evalAfterCp: p.evalAfterCp, sideToMove: p.sideToMove });
  const match = result.category === p.expected;
  if (!match) allPass = false;
  console.log(`${match ? "PASS" : "FAIL"} | ${p.id.padEnd(10)} | expected: ${p.expected.padEnd(10)} | got: ${(result.category || "null").padEnd(10)} | labels: [${result.labels.join(", ")}]`);
}
console.log(allPass ? "\nAll tests passed!" : "\nSome tests FAILED!");
