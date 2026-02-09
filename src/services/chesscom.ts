import { Result } from "@prisma/client";
import prisma from "../lib/prisma";
import { matchesCategory } from "../lib/timeControl";

export async function validateUser(username: string): Promise<void> {
  const res = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}`
  );
  if (!res.ok) {
    throw new Error(`Chess.com user "${username}" not found`);
  }
}

export async function fetchArchives(
  username: string
): Promise<{ archives: string[] }> {
  const res = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch archives for "${username}"`);
  }
  return res.json() as Promise<{ archives: string[] }>;
}

export async function fetchGames(
  archiveUrl: string
): Promise<{ games: ChesscomGame[] }> {
  const res = await fetch(archiveUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch games from archive`);
  }
  return res.json() as Promise<{ games: ChesscomGame[] }>;
}

interface ChesscomPlayer {
  username: string;
  result: string;
}

interface ChesscomGame {
  url: string;
  end_time: number;
  time_control: string;
  rated?: boolean;
  pgn: string;
  white: ChesscomPlayer;
  black: ChesscomPlayer;
  accuracies?: { white: number; black: number };
}

function computeResult(game: ChesscomGame, username: string): Result {
  const isWhite =
    game.white.username.toLowerCase() === username.toLowerCase();
  const playerResult = isWhite ? game.white.result : game.black.result;

  if (playerResult === "win") return Result.WIN;
  if (
    playerResult === "checkmated" ||
    playerResult === "timeout" ||
    playerResult === "resigned" ||
    playerResult === "lose" ||
    playerResult === "abandoned"
  ) {
    return Result.LOSS;
  }
  return Result.DRAW;
}

// TODO: Add hook point for future Stockfish analysis after import

const MAX_GAMES = 40;

export async function importGames(username: string, timeCategory?: string, rated?: boolean): Promise<number> {
  await validateUser(username);

  const user = await prisma.user.upsert({
    where: { username: username.toLowerCase() },
    update: {},
    create: { username: username.toLowerCase(), platform: "chesscom" },
  });

  const { archives } = await fetchArchives(username);
  if (archives.length === 0) {
    return 0;
  }

  // Collect the most recent games by walking archives from newest to oldest
  const recentGames: ChesscomGame[] = [];
  for (let i = archives.length - 1; i >= 0 && recentGames.length < MAX_GAMES; i--) {
    const { games } = await fetchGames(archives[i]);
    // Games within an archive are chronological; reverse to get newest first
    for (let j = games.length - 1; j >= 0 && recentGames.length < MAX_GAMES; j--) {
      // Skip games that don't match the requested time category
      if (timeCategory && !matchesCategory(games[j].time_control, timeCategory)) {
        continue;
      }
      // Skip games that don't match the rated filter
      if (rated !== undefined && (games[j].rated ?? true) !== rated) {
        continue;
      }
      recentGames.push(games[j]);
    }
  }

  // Clear old games for this user, scoped to the same time category only
  const keepIds = recentGames.map((g) => g.url);

  let deleteFilter: Record<string, unknown> = { userId: user.id, externalId: { notIn: keepIds } };

  if (timeCategory) {
    // Only delete games of the same time category, preserve others
    const allTCs = await prisma.game.findMany({
      where: { userId: user.id },
      select: { timeControl: true },
      distinct: ["timeControl"],
    });
    const matchingTCs = allTCs
      .map((g) => g.timeControl)
      .filter((tc) => matchesCategory(tc, timeCategory));
    deleteFilter = { ...deleteFilter, timeControl: { in: matchingTCs } };
  }

  if (rated !== undefined) {
    deleteFilter = { ...deleteFilter, rated };
  }

  // Delete puzzles, positions, then games (respecting foreign keys)
  await prisma.puzzle.deleteMany({ where: { game: deleteFilter } });
  await prisma.position.deleteMany({ where: { game: deleteFilter } });
  await prisma.game.deleteMany({ where: deleteFilter });

  let imported = 0;

  for (const game of recentGames) {
    const externalId = game.url;

    const existing = await prisma.game.findUnique({
      where: { externalId },
    });
    if (existing) {
      // Update accuracy if chess.com now provides it
      if (existing.accuracyWhite == null && game.accuracies) {
        await prisma.game.update({
          where: { id: existing.id },
          data: {
            accuracyWhite: game.accuracies.white,
            accuracyBlack: game.accuracies.black,
          },
        });
      }
      continue;
    }

    await prisma.game.create({
      data: {
        externalId,
        userId: user.id,
        endDate: new Date(game.end_time * 1000),
        timeControl: game.time_control,
        rated: game.rated ?? true,
        result: computeResult(game, username),
        pgn: game.pgn,
        accuracyWhite: game.accuracies?.white ?? null,
        accuracyBlack: game.accuracies?.black ?? null,
      },
    });

    imported++;
  }

  return imported;
}
