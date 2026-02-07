import { Side } from "@prisma/client";
import { Chess } from "chess.js";
import prisma from "../lib/prisma";

function parsePgn(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn);

  return chess.history({ verbose: true }).map((move, i) => ({
    ply: i + 1,
    fen: move.before,
    moveUci: move.lan,
    san: move.san,
    sideToMove: move.color === "w" ? Side.WHITE : Side.BLACK,
  }));
}

// TODO: Run Stockfish evaluation on each position after parsing
// TODO: Detect large eval swings for puzzle generation

/**
 * Parse a single game's PGN into Position rows.
 * Uses a transaction with a positionsParsed check to prevent
 * concurrent parses from duplicating rows.
 */
export async function parseGamePositions(gameId: number): Promise<number> {
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw new Error(`Game ${gameId} not found`);
  if (game.positionsParsed) return 0;

  const positions = parsePgn(game.pgn);

  // Transaction: re-check the flag inside the transaction to guard
  // against concurrent calls for the same game.
  await prisma.$transaction(async (tx) => {
    const current = await tx.game.findUnique({ where: { id: gameId } });
    if (current?.positionsParsed) return;

    await tx.position.createMany({
      data: positions.map((p) => ({ gameId, ...p })),
    });
    await tx.game.update({
      where: { id: gameId },
      data: { positionsParsed: true },
    });
  });

  return positions.length;
}

/**
 * Parse all games that haven't been parsed yet.
 * Returns the number of games processed.
 */
export async function parseAllUnparsed(): Promise<number> {
  const unparsed = await prisma.game.findMany({
    where: { positionsParsed: false },
    select: { id: true },
  });

  let processed = 0;
  for (const { id } of unparsed) {
    try {
      const count = await parseGamePositions(id);
      if (count > 0) {
        console.log(`Game ${id}: ${count} positions stored`);
        processed++;
      }
    } catch (err) {
      console.error(`Game ${id}: failed to parse —`, err);
    }
  }
  return processed;
}
