import prisma from "../lib/prisma";
import { StockfishEngine } from "./stockfish";
import { evaluateGamePositions } from "./evaluation";
import { detectGameBlunders } from "./blunders";
import { generateGamePuzzles } from "./puzzles";
import { computeGameAccuracy } from "./accuracy";
import { Side } from "@prisma/client";

interface UserJob {
  status: "running" | "done" | "error";
  totalGames: number;
  completedGames: number;
  puzzlesCreated: number;
  error?: string;
}

const jobs = new Map<string, UserJob>();

function pgnHeader(pgn: string, header: string): string | null {
  const match = pgn.match(new RegExp(`\\[${header} "([^"]*)"\\]`));
  return match ? match[1] : null;
}

function getUserSide(pgn: string, username: string): Side | null {
  const white = pgnHeader(pgn, "White");
  const black = pgnHeader(pgn, "Black");
  if (white && white.toLowerCase() === username.toLowerCase()) return Side.WHITE;
  if (black && black.toLowerCase() === username.toLowerCase()) return Side.BLACK;
  return null;
}

/**
 * Start background evaluation for a user's unevaluated games.
 * Non-blocking — returns immediately. Progress can be checked via getJobStatus.
 * Each game is evaluated → classified → puzzles generated incrementally.
 */
export function startBackgroundEval(userId: number, username: string): void {
  const key = username.toLowerCase();

  // Don't start if already running
  if (jobs.get(key)?.status === "running") return;

  const job: UserJob = { status: "running", totalGames: 0, completedGames: 0, puzzlesCreated: 0 };
  jobs.set(key, job);

  // Fire and forget
  runEvalPipeline(userId, username, job).catch((err) => {
    job.status = "error";
    job.error = err instanceof Error ? err.message : "Unknown error";
    console.error(`Background eval for ${username} failed:`, err);
  });
}

async function runEvalPipeline(userId: number, username: string, job: UserJob) {
  const games = await prisma.game.findMany({
    where: {
      userId,
      positionsParsed: true,
      positions: { some: { eval: null } },
    },
    select: { id: true, pgn: true },
  });

  job.totalGames = games.length;

  if (games.length === 0) {
    job.status = "done";
    return;
  }

  const engine = new StockfishEngine();
  await engine.init();

  try {
    for (const game of games) {
      // Evaluate
      await evaluateGamePositions(engine, game.id, 15);

      // Classify blunders
      await detectGameBlunders(game.id);

      // Compute per-game accuracy from Stockfish data (works for all users, no chess.com membership needed)
      await computeGameAccuracy(game.id);

      // Generate puzzles for this game immediately
      const userSide = getUserSide(game.pgn, username) ?? undefined;
      const created = await generateGamePuzzles(game.id, userId, userSide);
      job.puzzlesCreated += created;

      job.completedGames++;
      console.log(`[bg-eval] ${username} — game ${game.id}: done (${job.completedGames}/${job.totalGames}, +${created} puzzles)`);
    }
  } finally {
    engine.shutdown();
  }

  job.status = "done";
  console.log(`[bg-eval] ${username} — complete. ${job.puzzlesCreated} puzzles created from ${job.totalGames} games.`);
}

export function getJobStatus(username: string): UserJob | null {
  return jobs.get(username.toLowerCase()) ?? null;
}
