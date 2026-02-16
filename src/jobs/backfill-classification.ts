/**
 * Backfill job: Re-classify all existing puzzles using the three-axis taxonomy.
 * Fetches surrounding position evals per game for enriched defending detection.
 *
 * Updates: category, severity, labels
 * Safe to run multiple times (idempotent).
 */

import prisma from "../lib/prisma";
import { classifyPuzzle, ClassificationContext } from "../services/puzzleClassification";

async function main() {
  const puzzles = await prisma.puzzle.findMany({
    select: {
      id: true,
      gameId: true,
      fen: true,
      sideToMove: true,
      bestMoveUci: true,
      evalBeforeCp: true,
      evalAfterCp: true,
      pvMoves: true,
      category: true,
      severity: true,
      labels: true,
      position: { select: { ply: true } },
    },
  });

  console.log(`Found ${puzzles.length} puzzles to classify.`);

  // Group by game for efficient position fetching
  const byGame = new Map<number, typeof puzzles>();
  for (const p of puzzles) {
    const list = byGame.get(p.gameId) || [];
    list.push(p);
    byGame.set(p.gameId, list);
  }

  console.log(`Spread across ${byGame.size} games.`);

  const categoryDist: Record<string, number> = {};
  const severityDist: Record<string, number> = {};
  const labelDist: Record<string, number> = {};
  let updated = 0;
  let gamesProcessed = 0;

  for (const [gameId, gamePuzzles] of byGame) {
    // Fetch all evaluated positions for context
    const positions = await prisma.position.findMany({
      where: { gameId, eval: { not: null } },
      select: { ply: true, eval: true },
      orderBy: { ply: "asc" },
    });

    const evalByPly = new Map<number, number>();
    for (const pos of positions) {
      if (pos.eval != null) evalByPly.set(pos.ply, pos.eval);
    }

    for (const p of gamePuzzles) {
      const ply = p.position.ply;

      const ctx: ClassificationContext = {
        evalBeforeCp: p.evalBeforeCp,
        evalAfterCp: p.evalAfterCp,
        sideToMove: p.sideToMove,
        fen: p.fen,
        bestMoveUci: p.bestMoveUci,
        pvMoves: p.pvMoves,
        prevEvalCp: evalByPly.get(ply - 1) ?? null,
        prevPrevEvalCp: evalByPly.get(ply - 2) ?? null,
      };

      const result = classifyPuzzle(ctx);

      const cat = result.category ?? "uncategorized";
      categoryDist[cat] = (categoryDist[cat] || 0) + 1;
      severityDist[result.severity] = (severityDist[result.severity] || 0) + 1;
      for (const label of result.labels) {
        labelDist[label] = (labelDist[label] || 0) + 1;
      }

      const catChanged = p.category !== result.category;
      const sevChanged = p.severity !== result.severity;
      const labelsChanged =
        JSON.stringify(p.labels.sort()) !== JSON.stringify(result.labels.sort());

      if (catChanged || sevChanged || labelsChanged) {
        await prisma.puzzle.update({
          where: { id: p.id },
          data: {
            category: result.category,
            severity: result.severity,
            labels: result.labels,
          },
        });
        updated++;
      }
    }

    gamesProcessed++;
    if (gamesProcessed % 100 === 0) {
      console.log(`  Processed ${gamesProcessed}/${byGame.size} games...`);
    }
  }

  console.log(`\nUpdated ${updated} of ${puzzles.length} puzzles.\n`);
  console.log("Category distribution:", categoryDist);
  console.log("Severity distribution:", severityDist);
  console.log("Label distribution:", labelDist);

  await prisma.$disconnect();
}

main();
