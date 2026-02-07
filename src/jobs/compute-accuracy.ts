import { computeAllAccuracy } from "../services/accuracy";
import prisma from "../lib/prisma";

async function main() {
  const processed = await computeAllAccuracy();
  console.log(`Done. Computed accuracy for ${processed} game(s)`);
  await prisma.$disconnect();
}

main();
