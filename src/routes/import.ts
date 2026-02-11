import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { importGames } from "../services/chesscom";
import { parseAllUnparsed } from "../services/positions";
import prisma from "../lib/prisma";
import { startBackgroundEval } from "../services/backgroundEval";

const router = Router();

const chesscomImportSchema = z.object({
  username: z.string().min(1, "Username is required"),
  timeCategory: z.enum(["bullet", "blitz", "rapid"]).optional(),
  rated: z.boolean().optional(),
  maxGames: z.number().int().min(1).max(200).optional(),
});

// TODO: Add Lichess import route (POST /lichess)
// TODO: Add time-window filtering (optional startDate/endDate in body)
// TODO: Move position parsing to a background queue for large imports

router.post(
  "/chesscom",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, timeCategory, rated, maxGames } = chesscomImportSchema.parse(req.body);
      const imported = await importGames(username, timeCategory, rated, maxGames);

      let parsed = 0;
      if (imported > 0) {
        parsed = await parseAllUnparsed();
      }

      // Kick off background Stockfish evaluation (non-blocking)
      const user = await prisma.user.findFirst({
        where: { username: username.toLowerCase() },
      });
      if (user) {
        startBackgroundEval(user.id, username);
      }

      res.json({ imported, parsed });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors });
        return;
      }
      next(err);
    }
  }
);

export default router;
