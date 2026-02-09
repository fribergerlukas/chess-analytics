/**
 * Backfill job: Re-classify all existing puzzles using the three-axis taxonomy.
 *
 * Updates: category, severity, labels
 * Safe to run multiple times (idempotent).
 */

import prisma from "../lib/prisma";
import { classifyPuzzle } from "../services/puzzleClassification";

async function main() {
  const puzzles = await prisma.puzzle.findMany({
    select: {
      id: true,
      fen: true,
      sideToMove: true,
      bestMoveUci: true,
      evalBeforeCp: true,
      evalAfterCp: true,
      pvMoves: true,
      category: true,
      severity: true,
      labels: true,
    },
  });

  console.log(`Found ${puzzles.length} puzzles to classify.`);

  const categoryDist: Record<string, number> = {};
  const severityDist: Record<string, number> = {};
  const labelDist: Record<string, number> = {};
  let updated = 0;

  for (const p of puzzles) {
    const result = classifyPuzzle(
      p.evalBeforeCp,
      p.evalAfterCp,
      p.sideToMove,
      p.fen,
      p.bestMoveUci,
      p.pvMoves
    );

    const cat = result.category ?? "uncategorized";
    categoryDist[cat] = (categoryDist[cat] || 0) + 1;
    severityDist[result.severity] = (severityDist[result.severity] || 0) + 1;
    for (const label of result.labels) {
      labelDist[label] = (labelDist[label] || 0) + 1;
    }

    // Check if anything changed
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

  console.log(`\nUpdated ${updated} of ${puzzles.length} puzzles.\n`);
  console.log("Category distribution:", categoryDist);
  console.log("Severity distribution:", severityDist);
  console.log("Label distribution:", labelDist);

  await prisma.$disconnect();
}

main();
