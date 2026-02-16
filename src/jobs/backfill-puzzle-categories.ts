/**
 * Backfill puzzle categories using the enriched classification system.
 * Fetches surrounding position evals per game for defending detection.
 * Also migrates old category names to new ones.
 *
 * Usage: npx ts-node src/jobs/backfill-puzzle-categories.ts
 */

import prisma from "../lib/prisma";
import { classifyPuzzle, ClassificationContext } from "../services/puzzleClassification";

// Map legacy category names → new names
const LEGACY_MAP: Record<string, string> = {
  resilience: "defending",
  advantage_capitalisation: "attacking",
  opportunity_creation: "tactics",
  precision_only_move: "positional",
  capitalization: "attacking",
};

async function main() {
  // Fetch all puzzles with their position ply and gameId
  const puzzles = await prisma.puzzle.findMany({
    select: {
      id: true,
      gameId: true,
      fen: true,
      sideToMove: true,
      evalBeforeCp: true,
      evalAfterCp: true,
      bestMoveUci: true,
      category: true,
      position: { select: { ply: true } },
    },
  });

  console.log(`Found ${puzzles.length} puzzles to reclassify`);

  // Group puzzles by gameId so we fetch positions once per game
  const byGame = new Map<number, typeof puzzles>();
  for (const p of puzzles) {
    const list = byGame.get(p.gameId) || [];
    list.push(p);
    byGame.set(p.gameId, list);
  }

  console.log(`Spread across ${byGame.size} games`);

  const counts: Record<string, number> = {};
  let updated = 0;
  let migrated = 0;
  let gamesProcessed = 0;

  for (const [gameId, gamePuzzles] of byGame) {
    // Fetch all evaluated positions for this game (for context)
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
      const prevEval = evalByPly.get(ply - 1);
      const prevPrevEval = evalByPly.get(ply - 2);

      const ctx: ClassificationContext = {
        evalBeforeCp: p.evalBeforeCp,
        evalAfterCp: p.evalAfterCp,
        sideToMove: p.sideToMove,
        fen: p.fen,
        bestMoveUci: p.bestMoveUci,
        pvMoves: [],
        prevEvalCp: prevEval ?? null,
        prevPrevEvalCp: prevPrevEval ?? null,
      };

      const result = classifyPuzzle(ctx);
      const newCat = result.category;
      const catKey = newCat ?? "uncategorized";
      counts[catKey] = (counts[catKey] || 0) + 1;

      const isLegacy = p.category != null && LEGACY_MAP[p.category] != null;
      if (isLegacy) migrated++;

      if (p.category !== newCat) {
        await prisma.puzzle.update({
          where: { id: p.id },
          data: { category: newCat },
        });
        updated++;
      }
    }

    gamesProcessed++;
    if (gamesProcessed % 100 === 0) {
      console.log(`  Processed ${gamesProcessed}/${byGame.size} games...`);
    }
  }

  console.log(`\nUpdated ${updated} of ${puzzles.length} puzzles (${migrated} migrated from legacy names)`);
  console.log("Distribution:", counts);
  await prisma.$disconnect();
}

main();
