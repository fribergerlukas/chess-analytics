import { PrismaClient, Side } from "@prisma/client";
import { Chess } from "chess.js";

const prisma = new PrismaClient();

function parsePositions(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const moves = chess.history({ verbose: true });
  return moves.map((move, i) => ({
    ply: i + 1,
    fen: move.before,
    moveUci: move.lan,
    san: move.san,
    sideToMove: move.color === "w" ? Side.WHITE : Side.BLACK,
  }));
}

// TODO: Hook Stockfish evaluation per position after parsing
// TODO: Hook puzzle generation from positions with large eval swings

async function main() {
  const unparsed = await prisma.game.findMany({
    where: { positionsParsed: false },
  });

  console.log(`Found ${unparsed.length} unparsed game(s)`);

  let processed = 0;

  for (const game of unparsed) {
    try {
      const positions = parsePositions(game.pgn);

      await prisma.$transaction([
        prisma.position.createMany({
          data: positions.map((p) => ({ gameId: game.id, ...p })),
        }),
        prisma.game.update({
          where: { id: game.id },
          data: { positionsParsed: true },
        }),
      ]);

      processed++;
      console.log(
        `Game ${game.id}: ${positions.length} positions stored`
      );
    } catch (err) {
      console.error(`Game ${game.id}: failed to parse —`, err);
    }
  }

  console.log(`Done. Processed ${processed}/${unparsed.length} game(s)`);
  await prisma.$disconnect();
}

main();
