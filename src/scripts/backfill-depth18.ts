/**
 * Re-evaluate all positions that were evaluated at depth < 18,
 * then recompute accuracy for affected games.
 *
 * Usage: npx ts-node src/scripts/backfill-depth18.ts
 */
import prisma from "../lib/prisma";
import { StockfishEngine } from "../services/stockfish";
import { evaluateGamePositions } from "../services/evaluation";
import { computeGameAccuracy } from "../services/accuracy";

const TARGET_DEPTH = 18;

async function main() {
  // Find all games that have positions evaluated below target depth
  const affectedGames = await prisma.game.findMany({
    where: {
      positionsParsed: true,
      positions: { some: { evalDepth: { lt: TARGET_DEPTH } } },
    },
    select: { id: true },
  });

  console.log(
    `Found ${affectedGames.length} games with positions below depth ${TARGET_DEPTH}`
  );

  if (affectedGames.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const engine = new StockfishEngine();
  await engine.init();

  let processed = 0;
  let errors = 0;

  try {
    for (const { id: gameId } of affectedGames) {
      try {
        // Clear evals for positions below target depth so they get re-evaluated
        const cleared = await prisma.position.updateMany({
          where: { gameId, evalDepth: { lt: TARGET_DEPTH } },
          data: { eval: null, evalDepth: null, bestMoveUci: null, pv: null },
        });

        if (cleared.count === 0) continue;

        // Re-evaluate at target depth
        const count = await evaluateGamePositions(engine, gameId, TARGET_DEPTH);

        // Recompute accuracy with the new evals
        const result = await computeGameAccuracy(gameId);

        processed++;
        console.log(
          `[${processed}/${affectedGames.length}] Game ${gameId}: re-evaluated ${count} positions, accuracy white=${result.white}% black=${result.black}%`
        );
      } catch (err) {
        errors++;
        console.error(`Game ${gameId}: failed —`, err);
      }
    }
  } finally {
    engine.shutdown();
  }

  console.log(
    `\nDone. Processed ${processed} games, ${errors} errors.`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
