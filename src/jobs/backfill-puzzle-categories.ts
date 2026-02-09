import prisma from "../lib/prisma";

const LOSING_THRESHOLD = -50;
const WINNING_THRESHOLD = 50;

function categorizePuzzle(
  evalBeforeCp: number | null,
  sideToMove: "WHITE" | "BLACK"
): string | null {
  if (evalBeforeCp == null) return null;
  const userEval = sideToMove === "WHITE" ? evalBeforeCp : -evalBeforeCp;
  if (userEval <= LOSING_THRESHOLD) return "resilience";
  if (userEval >= WINNING_THRESHOLD) return "capitalization";
  return null;
}

async function main() {
  const puzzles = await prisma.puzzle.findMany({
    select: { id: true, evalBeforeCp: true, sideToMove: true, category: true },
  });

  const counts: Record<string, number> = {};
  let updated = 0;

  for (const p of puzzles) {
    const cat = categorizePuzzle(p.evalBeforeCp, p.sideToMove);
    const catKey = cat ?? "uncategorized";
    counts[catKey] = (counts[catKey] || 0) + 1;

    if (p.category !== cat) {
      await prisma.puzzle.update({
        where: { id: p.id },
        data: { category: cat },
      });
      updated++;
    }
  }

  console.log(`Updated ${updated} of ${puzzles.length} puzzles`);
  console.log("Distribution:", counts);
  await prisma.$disconnect();
}

main();
