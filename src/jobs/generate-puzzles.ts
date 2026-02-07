import { generateUserPuzzles, generateAllPuzzles } from "../services/puzzles";
import prisma from "../lib/prisma";

async function main() {
  const username = process.argv[2];

  if (username) {
    const count = await generateUserPuzzles(username);
    console.log(`Done. Created ${count} puzzle(s) for ${username}`);
  } else {
    const count = await generateAllPuzzles();
    console.log(`Done. Created ${count} puzzle(s) for all users`);
  }

  await prisma.$disconnect();
}

main();
