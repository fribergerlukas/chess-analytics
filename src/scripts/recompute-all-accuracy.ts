/**
 * Recompute accuracy for ALL games using the current formula.
 * This updates stored accuracyWhite/accuracyBlack in the DB.
 *
 * Usage: npx ts-node src/scripts/recompute-all-accuracy.ts
 */
import prisma from "../lib/prisma";
import { computeGameAccuracy } from "../services/accuracy";

async function main() {
  const games = await prisma.game.findMany({
    where: {
      positions: { some: { eval: { not: null } } },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  console.log(`Recomputing accuracy for ${games.length} games...\n`);

  let processed = 0;
  let errors = 0;

  for (const { id } of games) {
    try {
      const result = await computeGameAccuracy(id);
      processed++;
      if (processed % 50 === 0) {
        console.log(`  ${processed}/${games.length} done`);
      }
    } catch (err) {
      errors++;
      console.error(`Game ${id}: failed —`, err);
    }
  }

  console.log(`\nDone. Recomputed ${processed} games, ${errors} errors.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
