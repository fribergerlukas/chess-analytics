/**
 * Re-evaluate all positions for a specific game at depth 18,
 * recompute accuracy, and compare with chess.com.
 *
 * Usage: npx ts-node src/scripts/reeval-game.ts [gameId] [chesscomAccuracy]
 * Example: npx ts-node src/scripts/reeval-game.ts 10040 78.16
 */
import prisma from "../lib/prisma";
import { StockfishEngine } from "../services/stockfish";
import { evaluateGamePositions } from "../services/evaluation";
import { computeGameAccuracy } from "../services/accuracy";

async function main() {
  const gameId = parseInt(process.argv[2] || "10040", 10);
  const chesscomAccuracy = parseFloat(process.argv[3] || "78.16");

  console.log(`\n=== Re-evaluating game ${gameId} at depth 18 ===\n`);

  // Get current accuracy before re-eval
  const gameBefore = await prisma.game.findUnique({
    where: { id: gameId },
    select: { accuracyWhite: true, accuracyBlack: true, pgn: true },
  });

  if (!gameBefore) {
    console.error(`Game ${gameId} not found`);
    process.exit(1);
  }

  // Check current eval depths
  const depthStats = await prisma.position.aggregate({
    where: { gameId },
    _min: { evalDepth: true },
    _max: { evalDepth: true },
    _avg: { evalDepth: true },
    _count: { id: true },
  });

  console.log(`Positions: ${depthStats._count.id}`);
  console.log(
    `Current eval depth: min=${depthStats._min.evalDepth}, max=${depthStats._max.evalDepth}, avg=${depthStats._avg.evalDepth?.toFixed(1)}`
  );
  console.log(
    `Old accuracy: white=${gameBefore.accuracyWhite}%, black=${gameBefore.accuracyBlack}%`
  );

  // Clear existing evals so evaluateGamePositions will re-evaluate them
  await prisma.position.updateMany({
    where: { gameId },
    data: { eval: null, evalDepth: null, bestMoveUci: null, pv: null },
  });

  // Re-evaluate at depth 18
  const engine = new StockfishEngine();
  await engine.init();

  try {
    const count = await evaluateGamePositions(engine, gameId, 18);
    console.log(`\nRe-evaluated ${count} positions at depth 18`);
  } finally {
    engine.shutdown();
  }

  // Recompute accuracy (uses the new clamped cpToWinPercent automatically)
  const result = await computeGameAccuracy(gameId);

  console.log(`\n=== Results ===`);
  console.log(`Old accuracy:      white=${gameBefore.accuracyWhite}%, black=${gameBefore.accuracyBlack}%`);
  console.log(`New accuracy:      white=${result.white}%, black=${result.black}%`);
  console.log(`Chess.com:         ${chesscomAccuracy}%`);

  // Figure out which side to compare (use the one closer to chess.com's value)
  const whiteDiff = result.white !== null ? Math.abs(result.white - chesscomAccuracy) : Infinity;
  const blackDiff = result.black !== null ? Math.abs(result.black - chesscomAccuracy) : Infinity;
  const side = whiteDiff < blackDiff ? "white" : "black";
  const ours = side === "white" ? result.white : result.black;
  const oldOurs = side === "white" ? gameBefore.accuracyWhite : gameBefore.accuracyBlack;

  console.log(`\nComparing ${side} side:`);
  console.log(`  Old:       ${oldOurs}%`);
  console.log(`  New:       ${ours}%`);
  console.log(`  Chess.com: ${chesscomAccuracy}%`);
  console.log(`  Old diff:  ${oldOurs !== null ? (oldOurs - chesscomAccuracy).toFixed(2) : "N/A"}%`);
  console.log(`  New diff:  ${ours !== null ? (ours - chesscomAccuracy).toFixed(2) : "N/A"}%`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
