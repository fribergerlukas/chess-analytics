import { Result } from "@prisma/client";
import prisma from "../lib/prisma";

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
  pgn: string;
  white: ChesscomPlayer;
  black: ChesscomPlayer;
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

export async function importGames(username: string): Promise<number> {
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

  const lastArchiveUrl = archives[archives.length - 1];
  const { games } = await fetchGames(lastArchiveUrl);

  let imported = 0;

  for (const game of games) {
    const externalId = game.url;

    const existing = await prisma.game.findUnique({
      where: { externalId },
    });
    if (existing) continue;

    await prisma.game.create({
      data: {
        externalId,
        userId: user.id,
        endDate: new Date(game.end_time * 1000),
        timeControl: game.time_control,
        result: computeResult(game, username),
        pgn: game.pgn,
      },
    });

    imported++;
  }

  return imported;
}
