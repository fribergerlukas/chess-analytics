import { Side } from "@prisma/client";
import prisma from "../lib/prisma";
import { StockfishEngine } from "./stockfish";

/**
 * Evaluate all unevaluated positions for a single game.
 * Updates each position individually so progress is resumable.
 */
export async function evaluateGamePositions(
  engine: StockfishEngine,
  gameId: number,
  depth = 20
): Promise<number> {
  const positions = await prisma.position.findMany({
    where: { gameId, eval: null },
    select: { id: true, fen: true, sideToMove: true },
    orderBy: { ply: "asc" },
  });

  for (const pos of positions) {
    const result = await engine.evaluate(pos.fen, depth);

    // Normalize to white's perspective
    const evalFromWhite =
      pos.sideToMove === Side.WHITE ? result.score : -result.score;

    await prisma.position.update({
      where: { id: pos.id },
      data: {
        eval: evalFromWhite,
        evalDepth: result.depth,
        bestMoveUci: result.bestMove || null,
        pv: result.pv || null,
      },
    });
  }

  return positions.length;
}

/**
 * Find all games with unevaluated positions and evaluate them.
 * Returns the number of games processed.
 */
export async function evaluateAllUnevaluated(
  engine: StockfishEngine,
  depth = 20
): Promise<number> {
  const games = await prisma.game.findMany({
    where: {
      positionsParsed: true,
      positions: { some: { eval: null } },
    },
    select: { id: true },
  });

  let processed = 0;
  for (const { id } of games) {
    try {
      const count = await evaluateGamePositions(engine, id, depth);
      if (count > 0) {
        console.log(`Game ${id}: ${count} positions evaluated`);
        processed++;
      }
    } catch (err) {
      console.error(`Game ${id}: failed to evaluate —`, err);
    }
  }

  return processed;
}
