import { parseAllUnparsed } from "../services/positions";
import prisma from "../lib/prisma";

async function main() {
  const processed = await parseAllUnparsed();
  console.log(`Done. Processed ${processed} game(s)`);
  await prisma.$disconnect();
}

main();
