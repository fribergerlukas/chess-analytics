import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { matchesCategory } from "../lib/timeControl";
import { computeArenaStats } from "../services/arenaStats";

const router = Router();

/**
 * GET /users/:username/arena-stats
 *
 * Query params:
 *   timeCategory — "bullet" | "blitz" | "rapid"
 *   chessRating  — current chess.com rating (number)
 *   title        — chess title (e.g. "GM", "IM") or omit
 */
router.get(
  "/users/:username/arena-stats",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = typeof req.params.username === "string"
        ? req.params.username
        : String(req.params.username);
      const { timeCategory, chessRating, title } = req.query;

      if (!timeCategory || typeof timeCategory !== "string") {
        res.status(400).json({ error: "timeCategory query param is required" });
        return;
      }

      const rating = Number(chessRating);
      if (!chessRating || isNaN(rating)) {
        res.status(400).json({ error: "chessRating query param is required (number)" });
        return;
      }

      const user = await prisma.user.findFirst({
        where: { username: username.toLowerCase() },
      });

      if (!user) {
        res.status(404).json({ error: `User "${username}" not found` });
        return;
      }

      // Get all distinct time controls for this user, then filter by category
      const allTCs = await prisma.game.findMany({
        where: { userId: user.id },
        select: { timeControl: true },
        distinct: ["timeControl"],
      });
      const matchingTCs = allTCs
        .map((g) => g.timeControl)
        .filter((tc) => matchesCategory(tc, timeCategory.toLowerCase()));

      // Fetch last 40 games for this time category
      const games = await prisma.game.findMany({
        where: {
          userId: user.id,
          timeControl: { in: matchingTCs },
        },
        select: {
          id: true,
          result: true,
          accuracyWhite: true,
          accuracyBlack: true,
          endDate: true,
          pgn: true,
        },
        orderBy: { endDate: "desc" },
        take: 40,
      });

      if (games.length === 0) {
        res.status(404).json({ error: "No games found for this time category" });
        return;
      }

      // Determine which side the user played in each game from PGN headers
      const userLower = username.toLowerCase();
      const gamePlayerSide: Record<number, "WHITE" | "BLACK"> = {};
      for (const g of games) {
        const whiteMatch = g.pgn.match(/\[White\s+"([^"]+)"\]/i);
        const isWhite = whiteMatch && whiteMatch[1].toLowerCase() === userLower;
        gamePlayerSide[g.id] = isWhite ? "WHITE" : "BLACK";
      }

      // Batch fetch all positions for these games
      const gameIds = games.map((g) => g.id);
      const positions = await prisma.position.findMany({
        where: {
          gameId: { in: gameIds },
          eval: { not: null },
        },
        select: {
          gameId: true,
          ply: true,
          fen: true,
          moveUci: true,
          san: true,
          sideToMove: true,
          eval: true,
          cpLoss: true,
          classification: true,
          bestMoveUci: true,
          pv: true,
        },
        orderBy: { ply: "asc" },
      });

      const titleStr = typeof title === "string" && title.length > 0 ? title : undefined;

      const result = computeArenaStats(
        positions as any,
        games,
        rating,
        titleStr,
        gamePlayerSide
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
