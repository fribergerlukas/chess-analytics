/**
 * Backfill job: Classify all existing evaluated positions into categories.
 *
 * Processes positions that have eval data but no category yet.
 * Groups by game for efficient batch processing.
 * Safe to run multiple times (skips positions that already have a category).
 *
 * Usage: npx ts-node src/jobs/backfill-position-categories.ts
 */

import prisma from "../lib/prisma";
import { classifyPositionCategory } from "../services/positionCategory";

async function main() {
  // Count total positions needing classification
  const totalCount = await prisma.position.count({
    where: { eval: { not: null }, category: null },
  });

  console.log(`Found ${totalCount} positions to classify.`);

  if (totalCount === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const BATCH_SIZE = 500;
  let processed = 0;
  const categoryDist: Record<string, number> = {};

  // Process in batches using cursor-based pagination
  let cursor: number | undefined = undefined;

  while (true) {
    const query: Parameters<typeof prisma.position.findMany>[0] = {
      where: { eval: { not: null }, category: null },
      select: {
        id: true,
        fen: true,
        ply: true,
        eval: true,
        sideToMove: true,
        bestMoveUci: true,
        pv: true,
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    };
    if (cursor != null) {
      query.skip = 1;
      query.cursor = { id: cursor };
    }
    const positions = await prisma.position.findMany(query);

    if (positions.length === 0) break;

    const updates = positions.map((pos) => {
      const category = classifyPositionCategory({
        fen: pos.fen,
        ply: pos.ply,
        eval: pos.eval,
        sideToMove: pos.sideToMove,
        bestMoveUci: pos.bestMoveUci,
        pv: pos.pv,
      });

      categoryDist[category] = (categoryDist[category] || 0) + 1;

      return prisma.position.update({
        where: { id: pos.id },
        data: { category },
      });
    });

    await prisma.$transaction(updates);

    cursor = positions[positions.length - 1].id;
    processed += positions.length;

    if (processed % 2000 === 0 || positions.length < BATCH_SIZE) {
      console.log(`  Classified ${processed}/${totalCount} positions...`);
    }
  }

  console.log(`\nDone. Classified ${processed} positions.\n`);
  console.log("Category distribution:");
  const total = Object.values(categoryDist).reduce((a, b) => a + b, 0);
  for (const [cat, count] of Object.entries(categoryDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  await prisma.$disconnect();
}

main();
