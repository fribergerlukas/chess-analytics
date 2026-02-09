import prisma from "../lib/prisma";
import { analyzePv } from "../services/puzzlePv";

async function main() {
  // Reprocess ALL puzzles (not just empty ones) since analysis logic changed
  const puzzles = await prisma.puzzle.findMany({
    select: { id: true, fen: true, pv: true, evalBeforeCp: true },
  });

  console.log(`Found ${puzzles.length} puzzle(s) to reprocess`);

  let updated = 0;
  const distribution: Record<number, number> = {};

  for (const puzzle of puzzles) {
    const { pvMoves, requiredMoves } = analyzePv(
      puzzle.fen,
      puzzle.pv,
      puzzle.evalBeforeCp
    );

    await prisma.puzzle.update({
      where: { id: puzzle.id },
      data: { pvMoves, requiredMoves },
    });

    distribution[requiredMoves] = (distribution[requiredMoves] || 0) + 1;

    updated++;
    if (updated % 100 === 0) {
      console.log(`  ${updated}/${puzzles.length} updated...`);
    }
  }

  console.log(`\nDone. Updated ${updated} puzzle(s).`);
  console.log(`\nDistribution:`);
  for (const [moves, count] of Object.entries(distribution).sort(
    ([a], [b]) => Number(a) - Number(b)
  )) {
    console.log(`  ${moves} move(s): ${count} puzzles`);
  }

  await prisma.$disconnect();
}

main();
