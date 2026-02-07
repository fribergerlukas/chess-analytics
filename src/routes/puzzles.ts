import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";

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
 *   limit  — page size (default 20, max 100)
 *   offset — pagination offset (default 0)
 */
router.get(
  "/users/:username/puzzles",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const offset = Number(req.query.offset) || 0;

      const user = await prisma.user.findFirst({
        where: { username: username.toLowerCase() },
      });

      if (!user) {
        res.status(404).json({ error: `User "${username}" not found` });
        return;
      }

      const puzzles = await prisma.puzzle.findMany({
        where: { userId: user.id },
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
            select: { id: true, endDate: true, timeControl: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      });

      const total = await prisma.puzzle.count({
        where: { userId: user.id },
      });

      res.json({ puzzles, total, limit, offset });
    } catch (err) {
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
