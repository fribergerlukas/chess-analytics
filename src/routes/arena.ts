import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { matchesCategory } from "../lib/timeControl";
import { computeArenaStats, computeTargetStats } from "../services/arenaStats";

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
      const { timeCategory, chessRating, title, rated, limit, playerSide } = req.query;

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

      // Parse rated filter
      const ratedFilter = rated === "true" ? true : rated === "false" ? false : undefined;

      // Get all distinct time controls for this user, then filter by category
      const gameWhere: any = { userId: user.id };
      if (ratedFilter !== undefined) gameWhere.rated = ratedFilter;

      const allTCs = await prisma.game.findMany({
        where: gameWhere,
        select: { timeControl: true },
        distinct: ["timeControl"],
      });
      const matchingTCs = allTCs
        .map((g) => g.timeControl)
        .filter((tc) => matchesCategory(tc, timeCategory.toLowerCase()));

      // Fetch games for this time category (always 100)
      const gameLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
      const games = await prisma.game.findMany({
        where: {
          ...gameWhere,
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
        take: gameLimit,
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

      // Filter games by player side if requested
      let filteredGames = games;
      if (playerSide === "white" || playerSide === "black") {
        const sideUpper = playerSide.toUpperCase() as "WHITE" | "BLACK";
        filteredGames = games.filter((g) => gamePlayerSide[g.id] === sideUpper);
      }

      if (filteredGames.length === 0) {
        res.status(404).json({ error: "No games found for this side/time category" });
        return;
      }

      // Batch fetch all positions for these games
      const gameIds = filteredGames.map((g) => g.id);
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
          category: true,
        },
        orderBy: { ply: "asc" },
      });

      const titleStr = typeof title === "string" && title.length > 0 ? title : undefined;

      const result = computeArenaStats(
        positions as any,
        filteredGames,
        rating,
        titleStr,
        gamePlayerSide,
        timeCategory.toLowerCase()
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /target-stats
 *
 * Query params:
 *   targetRating  — target chess rating (number, required)
 *   timeCategory  — "bullet" | "blitz" | "rapid" (required)
 */
router.get(
  "/target-stats",
  (req: Request, res: Response) => {
    const { targetRating, timeCategory } = req.query;

    if (!timeCategory || typeof timeCategory !== "string") {
      res.status(400).json({ error: "timeCategory query param is required" });
      return;
    }

    const rating = Number(targetRating);
    if (!targetRating || isNaN(rating)) {
      res.status(400).json({ error: "targetRating query param is required (number)" });
      return;
    }

    const result = computeTargetStats(rating, timeCategory.toLowerCase());
    res.json(result);
  }
);

export default router;
