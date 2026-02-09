import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { matchesCategory } from "../lib/timeControl";
import { generateUserPuzzles } from "../services/puzzles";
import { getJobStatus } from "../services/backgroundEval";

const router = Router();

function str(val: unknown): string {
  return typeof val === "string" ? val : String(val);
}

/**
 * GET /users/:username/puzzles
 *
 * Returns puzzles generated from the user's games.
 *
 * Query params:
 *   limit        — page size (default 20, max 100)
 *   offset       — pagination offset (default 0)
 *   timeCategory — "bullet" | "blitz" | "rapid" (filter by game time control)
 *   rated        — "true" | "false" (filter by rated/unrated; omit for all)
 *   minMoves     — minimum required user moves (default 1; use 2 for multi-move only)
 *   category     — "resilience" | "capitalization" (filter by puzzle category)
 *   maxEvalBefore — max cp deficit before the move (default 300, filters hopeless positions)
 */
router.get(
  "/users/:username/puzzles",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const offset = Number(req.query.offset) || 0;
      const timeCategory = typeof req.query.timeCategory === "string" ? req.query.timeCategory : undefined;
      const ratedParam = typeof req.query.rated === "string" ? req.query.rated : undefined;
      const minMoves = Number(req.query.minMoves) || 1;
      const categoryParam = typeof req.query.category === "string" ? req.query.category : undefined;
      const severityParam = typeof req.query.severity === "string" ? req.query.severity : undefined;
      const maxEvalBefore = Number(req.query.maxEvalBefore) || 300;

      const user = await prisma.user.findFirst({
        where: { username: username.toLowerCase() },
      });

      if (!user) {
        res.status(404).json({ error: `User "${username}" not found` });
        return;
      }

      // Build game-level filter for time category and rated
      const gameFilter: Record<string, unknown> = {};

      if (timeCategory) {
        const allTCs = await prisma.game.findMany({
          where: { userId: user.id },
          select: { timeControl: true },
          distinct: ["timeControl"],
        });
        const matching = allTCs
          .map((g) => g.timeControl)
          .filter((tc) => matchesCategory(tc, timeCategory.toLowerCase()));
        gameFilter.timeControl = { in: matching };
      }

      if (ratedParam === "true") {
        gameFilter.rated = true;
      } else if (ratedParam === "false") {
        gameFilter.rated = false;
      }

      const whereClause: Record<string, unknown> = {
        userId: user.id,
        ...(Object.keys(gameFilter).length > 0 ? { game: gameFilter } : {}),
        ...(minMoves > 1 ? { requiredMoves: { gte: minMoves } } : {}),
        ...(categoryParam ? { category: categoryParam } : {}),
        ...(severityParam ? { severity: severityParam } : {}),
      };

      const allPuzzles = await prisma.puzzle.findMany({
        where: whereClause,
        select: {
          id: true,
          fen: true,
          sideToMove: true,
          playedMoveUci: true,
          bestMoveUci: true,
          evalBeforeCp: true,
          evalAfterCp: true,
          deltaCp: true,
          requiredMoves: true,
          category: true,
          severity: true,
          labels: true,
          createdAt: true,
          game: {
            select: { id: true, endDate: true, timeControl: true, rated: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Filter out hopeless positions (where side to move was already losing badly)
      const filtered = allPuzzles.filter((p) => {
        if (p.evalBeforeCp == null) return true;
        if (p.sideToMove === "WHITE") {
          return p.evalBeforeCp >= -maxEvalBefore;
        } else {
          return p.evalBeforeCp <= maxEvalBefore;
        }
      });

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + limit);

      res.json({ puzzles: paged, total, limit, offset });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /users/:username/puzzles/generate
 *
 * Generates puzzles from already-evaluated games (fast).
 * Stockfish evaluation runs in the background after import.
 */
router.post(
  "/users/:username/puzzles/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const created = await generateUserPuzzles(username);

      // Include background eval status so frontend knows if more are coming
      const job = getJobStatus(username);
      res.json({
        created,
        analyzing: job?.status === "running",
        analyzedGames: job?.completedGames ?? 0,
        totalGames: job?.totalGames ?? 0,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        res.status(404).json({ error: err.message });
        return;
      }
      next(err);
    }
  }
);

/**
 * GET /users/:username/puzzles/status
 *
 * Returns the background evaluation status for this user.
 */
router.get(
  "/users/:username/puzzles/status",
  async (req: Request, res: Response) => {
    const username = str(req.params.username);
    const job = getJobStatus(username);
    if (!job) {
      res.json({ status: "idle", analyzedGames: 0, totalGames: 0, puzzlesCreated: 0 });
      return;
    }
    res.json({
      status: job.status,
      analyzedGames: job.completedGames,
      totalGames: job.totalGames,
      puzzlesCreated: job.puzzlesCreated,
    });
  }
);

/**
 * GET /puzzles/:id
 *
 * Returns a single puzzle with full details (including pv).
 */
router.get(
  "/puzzles/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(str(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: "id must be a number" });
        return;
      }

      const puzzle = await prisma.puzzle.findUnique({
        where: { id },
        include: {
          game: {
            select: { id: true, endDate: true, timeControl: true, externalId: true, pgn: true },
          },
          position: {
            select: { ply: true },
          },
        },
      });

      if (!puzzle) {
        res.status(404).json({ error: `Puzzle ${id} not found` });
        return;
      }

      // Parse player names and Elo from PGN headers
      const pgnHeader = (header: string): string | null => {
        const match = puzzle.game.pgn.match(new RegExp(`\\[${header} "([^"]*)"\\]`));
        return match ? match[1] : null;
      };

      const players = {
        white: pgnHeader("White"),
        black: pgnHeader("Black"),
        whiteElo: pgnHeader("WhiteElo"),
        blackElo: pgnHeader("BlackElo"),
      };

      // Fetch the previous position to get the "setup move"
      // (the opponent's move that led to the puzzle position)
      let setupFen: string | null = null;
      let setupMoveUci: string | null = null;

      if (puzzle.position.ply > 0) {
        const prevPosition = await prisma.position.findFirst({
          where: {
            gameId: puzzle.gameId,
            ply: puzzle.position.ply - 1,
          },
          select: { fen: true, moveUci: true },
        });
        if (prevPosition) {
          setupFen = prevPosition.fen;
          setupMoveUci = prevPosition.moveUci;
        }
      }

      const { position: _pos, game: gameData, ...puzzleData } = puzzle;
      const { pgn: _pgn, ...gameInfo } = gameData;
      res.json({ ...puzzleData, game: gameInfo, players, setupFen, setupMoveUci });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /puzzles/:id/check
 *
 * Body: { move: "e2e4" }
 *
 * Returns whether the submitted move matches the best move.
 */
router.post(
  "/puzzles/:id/check",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(str(req.params.id));
      if (isNaN(id)) {
        res.status(400).json({ error: "id must be a number" });
        return;
      }

      const { move, plyIndex = 0 } = req.body;
      if (typeof move !== "string" || !move.trim()) {
        res.status(400).json({ error: "move is required (UCI format)" });
        return;
      }

      const ply = Number(plyIndex);

      const puzzle = await prisma.puzzle.findUnique({
        where: { id },
        select: {
          bestMoveUci: true,
          pv: true,
          fen: true,
          pvMoves: true,
          requiredMoves: true,
        },
      });

      if (!puzzle) {
        res.status(404).json({ error: `Puzzle ${id} not found` });
        return;
      }

      const userMove = move.trim().toLowerCase();

      // Multi-move: validate against pvMoves at the given ply index
      // User moves are at even indices (0, 2, 4, ...)
      let expectedMove: string;
      if (puzzle.pvMoves.length > 0 && ply < puzzle.pvMoves.length) {
        expectedMove = puzzle.pvMoves[ply].toLowerCase();
      } else {
        // Legacy fallback: single-move puzzle
        expectedMove = puzzle.bestMoveUci.toLowerCase();
      }

      const correct = userMove === expectedMove;

      // Determine if this was the final user move
      const totalPlies = puzzle.pvMoves.length;
      const isLastUserMove = ply + 1 >= totalPlies;
      const completed = correct && isLastUserMove;

      // Opponent's reply is the next ply (ply + 1) if correct and not completed
      let opponentMove: string | undefined;
      if (correct && !completed && ply + 1 < totalPlies) {
        opponentMove = puzzle.pvMoves[ply + 1];
      }

      res.json({
        correct,
        bestMove: expectedMove,
        opponentMove,
        completed,
        pv: puzzle.pv,
        requiredMoves: puzzle.requiredMoves,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
