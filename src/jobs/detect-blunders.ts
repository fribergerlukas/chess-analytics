import { detectAllUnclassified } from "../services/blunders";
import prisma from "../lib/prisma";

async function main() {
  const processed = await detectAllUnclassified();
  console.log(`Done. Classified moves in ${processed} game(s)`);
  await prisma.$disconnect();
}

main();
