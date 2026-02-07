import { StockfishEngine } from "../services/stockfish";
import { evaluateAllUnevaluated } from "../services/evaluation";
import prisma from "../lib/prisma";

async function main() {
  const engine = new StockfishEngine();
  await engine.init();

  const processed = await evaluateAllUnevaluated(engine);
  console.log(`Done. Evaluated positions in ${processed} game(s)`);

  engine.shutdown();
  await prisma.$disconnect();
}

main();
