import { Side } from "@prisma/client";
import prisma from "../lib/prisma";
import { analyzePv } from "./puzzlePv";
import { classifyPuzzle } from "./puzzleClassification";

const MISTAKE_THRESHOLD = 150;

/**
 * Parse a PGN header value.
 */
function pgnHeader(pgn: string, header: string): string | null {
  const match = pgn.match(new RegExp(`\\[${header} "([^"]*)"\\]`));
  return match ? match[1] : null;
}

/**
 * Determine which side the user played from the PGN.
 */
function getUserSide(pgn: string, username: string): Side | null {
  const white = pgnHeader(pgn, "White");
  const black = pgnHeader(pgn, "Black");
  if (white && white.toLowerCase() === username.toLowerCase()) return Side.WHITE;
  if (black && black.toLowerCase() === username.toLowerCase()) return Side.BLACK;
  return null;
}

/**
 * Generate puzzles for a single game.
 * A puzzle is created for each position where:
 * - The position has been evaluated (eval is not null)
 * - cpLoss >= MISTAKE_THRESHOLD (the player made a significant mistake)
 * - bestMoveUci exists and differs from the played move
 * - The side to move matches the user's side in the game
 * - No puzzle already exists for this user+position
 *
 * Returns the number of puzzles created.
 */
export async function generateGamePuzzles(
  gameId: number,
  userId: number,
  userSide?: Side
): Promise<number> {
  const positions = await prisma.position.findMany({
    where: {
      gameId,
      eval: { not: null },
      cpLoss: { gte: MISTAKE_THRESHOLD },
      bestMoveUci: { not: null },
      ...(userSide ? { sideToMove: userSide } : {}),
    },
    select: {
      id: true,
      fen: true,
      moveUci: true,
      sideToMove: true,
      bestMoveUci: true,
      pv: true,
      eval: true,
      cpLoss: true,
    },
    orderBy: { ply: "asc" },
  });

  let created = 0;

  for (const pos of positions) {
    // Skip if the played move IS the best move
    if (pos.moveUci === pos.bestMoveUci) continue;

    // Skip if puzzle already exists for this user+position
    const existing = await prisma.puzzle.findUnique({
      where: { userId_positionId: { userId, positionId: pos.id } },
    });
    if (existing) continue;

    // evalBefore is the eval at this position (from white's perspective)
    // evalAfter is evalBefore minus the cpLoss (the position after the mistake)
    const evalBeforeCp = pos.eval != null ? Math.round(pos.eval) : null;
    const evalAfterCp =
      evalBeforeCp != null && pos.cpLoss != null
        ? pos.sideToMove === Side.WHITE
          ? Math.round(evalBeforeCp - pos.cpLoss)
          : Math.round(evalBeforeCp + pos.cpLoss)
        : null;
    const deltaCp =
      evalBeforeCp != null && evalAfterCp != null
        ? evalAfterCp - evalBeforeCp
        : null;

    const pvResult = analyzePv(pos.fen, pos.pv || "", evalBeforeCp);

    // Three-axis classification: category (why), severity (how bad), labels (what)
    const classification = classifyPuzzle(
      evalBeforeCp,
      evalAfterCp,
      pos.sideToMove,
      pos.fen,
      pos.bestMoveUci!,
      pvResult.pvMoves
    );

    await prisma.puzzle.create({
      data: {
        userId,
        gameId,
        positionId: pos.id,
        fen: pos.fen,
        sideToMove: pos.sideToMove,
        playedMoveUci: pos.moveUci,
        bestMoveUci: pos.bestMoveUci!,
        pv: pos.pv || "",
        pvMoves: pvResult.pvMoves,
        requiredMoves: pvResult.requiredMoves,
        evalBeforeCp,
        evalAfterCp,
        deltaCp,
        category: classification.category,
        severity: classification.severity,
        labels: classification.labels,
      },
    });

    created++;
  }

  return created;
}

/**
 * Generate puzzles for all games belonging to a user.
 * Only processes games that have been parsed and have evaluated positions.
 */
export async function generateUserPuzzles(username: string): Promise<number> {
  const user = await prisma.user.findFirst({
    where: { username: username.toLowerCase() },
  });

  if (!user) {
    throw new Error(`User "${username}" not found`);
  }

  const games = await prisma.game.findMany({
    where: {
      userId: user.id,
      positionsParsed: true,
      positions: {
        some: { eval: { not: null }, cpLoss: { gte: MISTAKE_THRESHOLD } },
      },
    },
    select: { id: true, pgn: true },
    orderBy: { endDate: "desc" },
  });

  let totalCreated = 0;

  for (const game of games) {
    try {
      const userSide = getUserSide(game.pgn, username) ?? undefined;
      const count = await generateGamePuzzles(game.id, user.id, userSide);
      if (count > 0) {
        console.log(`Game ${game.id}: ${count} puzzle(s) created`);
        totalCreated += count;
      }
    } catch (err) {
      console.error(`Game ${game.id}: failed to generate puzzles —`, err);
    }
  }

  return totalCreated;
}

/**
 * Generate puzzles for ALL users.
 */
export async function generateAllPuzzles(): Promise<number> {
  const users = await prisma.user.findMany({ select: { username: true } });

  let total = 0;
  for (const { username } of users) {
    try {
      const count = await generateUserPuzzles(username);
      if (count > 0) {
        console.log(`User ${username}: ${count} puzzle(s) created`);
        total += count;
      }
    } catch (err) {
      console.error(`User ${username}: failed —`, err);
    }
  }

  return total;
}
