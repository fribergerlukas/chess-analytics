import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { matchesCategory } from "../lib/timeControl";
import { generateUserPuzzles } from "../services/puzzles";

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
 * Generates puzzles from the user's evaluated games.
 * Returns the number of puzzles created.
 */
router.post(
  "/users/:username/puzzles/generate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const created = await generateUserPuzzles(username);
      res.json({ created });
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
            select: { id: true, endDate: true, timeControl: true },
          },
        },
      });

      if (!puzzle) {
        res.status(404).json({ error: `Puzzle ${id} not found` });
        return;
      }

      res.json(puzzle);
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

      const { move } = req.body;
      if (typeof move !== "string" || !move.trim()) {
        res.status(400).json({ error: "move is required (UCI format)" });
        return;
      }

      const puzzle = await prisma.puzzle.findUnique({
        where: { id },
        select: { bestMoveUci: true, pv: true, fen: true },
      });

      if (!puzzle) {
        res.status(404).json({ error: `Puzzle ${id} not found` });
        return;
      }

      const correct = move.trim().toLowerCase() === puzzle.bestMoveUci.toLowerCase();

      res.json({
        correct,
        bestMove: puzzle.bestMoveUci,
        pv: puzzle.pv,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
