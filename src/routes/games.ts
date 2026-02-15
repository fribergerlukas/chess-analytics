import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { matchesCategory } from "../lib/timeControl";

const router = Router();

function str(val: unknown): string {
  return typeof val === "string" ? val : String(val);
}

// TODO: Add opening frequency stats endpoint
// TODO: Add Stockfish evaluation data to position responses

/**
 * GET /users/:username/games
 *
 * Query params:
 *   source       — filter by platform (e.g. "chesscom", "lichess")
 *   from         — ISO date string, games ending on or after this date
 *   to           — ISO date string, games ending on or before this date
 *   timeCategory — filter by category: "bullet", "blitz", or "rapid"
 *   rated        — "true" | "false" (filter by rated/unrated; omit for all)
 *   limit        — page size (default 20, max 100)
 *   offset       — pagination offset (default 0)
 */
router.get(
  "/users/:username/games",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const { source, from, to, rated, timeCategory } = req.query;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const offset = Number(req.query.offset) || 0;

      const platform = typeof source === "string" ? source.toLowerCase() : undefined;

      const user = await prisma.user.findFirst({
        where: {
          username: username.toLowerCase(),
          ...(platform ? { platform } : {}),
        },
      });

      if (!user) {
        res.status(404).json({ error: `User "${username}" not found` });
        return;
      }

      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (from) dateFilter.gte = new Date(String(from));
      if (to) dateFilter.lte = new Date(String(to));

      const ratedFilter: Record<string, unknown> = {};
      if (rated === "true") ratedFilter.rated = true;
      else if (rated === "false") ratedFilter.rated = false;

      let timeControlFilter: Record<string, unknown> = {};
      if (typeof timeCategory === "string") {
        const allTCs = await prisma.game.findMany({
          where: { userId: user.id },
          select: { timeControl: true },
          distinct: ["timeControl"],
        });
        const matching = allTCs
          .map((g) => g.timeControl)
          .filter((tc) => matchesCategory(tc, timeCategory.toLowerCase()));
        timeControlFilter = { timeControl: { in: matching } };
      }

      const games = await prisma.game.findMany({
        where: {
          userId: user.id,
          ...ratedFilter,
          ...timeControlFilter,
          ...(Object.keys(dateFilter).length > 0
            ? { endDate: dateFilter }
            : {}),
        },
        select: {
          id: true,
          endDate: true,
          timeControl: true,
          result: true,
          accuracyWhite: true,
          accuracyBlack: true,
          pgn: true,
          createdAt: true,
        },
        orderBy: { endDate: "desc" },
        take: limit,
        skip: offset,
      });

      const total = await prisma.game.count({
        where: {
          userId: user.id,
          ...ratedFilter,
          ...timeControlFilter,
          ...(Object.keys(dateFilter).length > 0
            ? { endDate: dateFilter }
            : {}),
        },
      });

      // Helper to extract opponent name and player side from PGN headers
      const parsePgn = (pgn: string, myUsername: string) => {
        const whiteMatch = pgn.match(/\[White\s+"([^"]+)"\]/);
        const blackMatch = pgn.match(/\[Black\s+"([^"]+)"\]/);
        const white = whiteMatch?.[1];
        const black = blackMatch?.[1];
        if (!white || !black) return { opponent: null, playerSide: null as "white" | "black" | null };
        const isWhite = white.toLowerCase() === myUsername.toLowerCase();
        return { opponent: isWhite ? black : white, playerSide: (isWhite ? "white" : "black") as "white" | "black" };
      };

      res.json({
        games: games.map((g) => {
          const { opponent, playerSide } = parsePgn(g.pgn, username);
          return {
            id: g.id,
            endTime: g.endDate,
            timeControl: g.timeControl,
            result: g.result,
            accuracyWhite: g.accuracyWhite,
            accuracyBlack: g.accuracyBlack,
            opponent,
            playerSide,
            source: user.platform,
            createdAt: g.createdAt,
          };
        }),
        total,
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /users/:username/stats
 *
 * Returns stats for the 40 most recent games.
 *
 * Query params:
 *   source       — filter by platform (e.g. "chesscom", "lichess")
 *   timeControl  — filter by exact time control string (e.g. "180", "300+3")
 *   timeCategory — filter by category: "bullet", "blitz", or "rapid"
 *   rated        — "true" | "false" (filter by rated/unrated; omit for all)
 */
router.get(
  "/users/:username/stats",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const { source, timeControl, timeCategory, rated } = req.query;

      const platform = typeof source === "string" ? source.toLowerCase() : undefined;

      const user = await prisma.user.findFirst({
        where: {
          username: username.toLowerCase(),
          ...(platform ? { platform } : {}),
        },
      });

      if (!user) {
        res.status(404).json({ error: `User "${username}" not found` });
        return;
      }

      let timeControlFilter: Record<string, unknown> = {};
      if (typeof timeControl === "string") {
        timeControlFilter = { timeControl };
      } else if (typeof timeCategory === "string") {
        const allTCs = await prisma.game.findMany({
          where: { userId: user.id },
          select: { timeControl: true },
          distinct: ["timeControl"],
        });
        const matching = allTCs
          .map((g) => g.timeControl)
          .filter((tc) => matchesCategory(tc, timeCategory.toLowerCase()));
        timeControlFilter = { timeControl: { in: matching } };
      }

      const ratedFilter: Record<string, unknown> = {};
      if (rated === "true") ratedFilter.rated = true;
      else if (rated === "false") ratedFilter.rated = false;

      const baseWhere = {
        userId: user.id,
        ...timeControlFilter,
        ...ratedFilter,
      };

      const statsLimit = Math.min(Number(req.query.limit) || 40, 200);
      const recentGames = await prisma.game.findMany({
        where: baseWhere,
        select: { id: true, result: true, accuracyWhite: true, accuracyBlack: true },
        orderBy: { endDate: "desc" },
        take: statsLimit,
      });

      const counts = { WIN: 0, LOSS: 0, DRAW: 0 };
      let whiteSum = 0, whiteCount = 0, blackSum = 0, blackCount = 0;

      for (const g of recentGames) {
        counts[g.result]++;
        if (g.accuracyWhite != null) { whiteSum += g.accuracyWhite; whiteCount++; }
        if (g.accuracyBlack != null) { blackSum += g.accuracyBlack; blackCount++; }
      }

      const totalGames = recentGames.length;
      const round2 = (n: number) => Math.round(n * 100) / 100;

      const avgWhite = whiteCount > 0 ? whiteSum / whiteCount : null;
      const avgBlack = blackCount > 0 ? blackSum / blackCount : null;

      res.json({
        totalGames,
        results: {
          wins: counts.WIN,
          losses: counts.LOSS,
          draws: counts.DRAW,
          winRate: totalGames ? round2((counts.WIN / totalGames) * 100) : 0,
          lossRate: totalGames ? round2((counts.LOSS / totalGames) * 100) : 0,
          drawRate: totalGames ? round2((counts.DRAW / totalGames) * 100) : 0,
        },
        accuracy: {
          white: avgWhite != null ? round2(avgWhite) : null,
          black: avgBlack != null ? round2(avgBlack) : null,
          overall:
            avgWhite != null && avgBlack != null
              ? round2((avgWhite + avgBlack) / 2)
              : avgWhite != null
                ? round2(avgWhite)
                : avgBlack != null
                  ? round2(avgBlack)
                  : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /games/:gameId
 *
 * Returns game details including raw PGN.
 */
router.get(
  "/games/:gameId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = Number(str(req.params.gameId));
      if (isNaN(gameId)) {
        res.status(400).json({ error: "gameId must be a number" });
        return;
      }

      const game = await prisma.game.findUnique({
        where: { id: gameId },
        include: { user: { select: { username: true, platform: true } } },
      });

      if (!game) {
        res.status(404).json({ error: `Game ${gameId} not found` });
        return;
      }

      res.json({
        id: game.id,
        endTime: game.endDate,
        timeControl: game.timeControl,
        result: game.result,
        accuracyWhite: game.accuracyWhite,
        accuracyBlack: game.accuracyBlack,
        pgn: game.pgn,
        positionsParsed: game.positionsParsed,
        source: game.user.platform,
        username: game.user.username,
        createdAt: game.createdAt,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /games/:gameId/positions
 *
 * Query params:
 *   limit   — page size (default 200, max 500)
 *   offset  — pagination offset (default 0)
 */
router.get(
  "/games/:gameId/positions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = Number(str(req.params.gameId));
      if (isNaN(gameId)) {
        res.status(400).json({ error: "gameId must be a number" });
        return;
      }

      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const offset = Number(req.query.offset) || 0;

      const game = await prisma.game.findUnique({ where: { id: gameId } });
      if (!game) {
        res.status(404).json({ error: `Game ${gameId} not found` });
        return;
      }

      const positions = await prisma.position.findMany({
        where: { gameId },
        select: {
          ply: true,
          fen: true,
          moveUci: true,
          san: true,
          sideToMove: true,
          eval: true,
          evalDepth: true,
          cpLoss: true,
          classification: true,
        },
        orderBy: { ply: "asc" },
        take: limit,
        skip: offset,
      });

      const total = await prisma.position.count({ where: { gameId } });

      res.json({ positions, total, limit, offset });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /games/:gameId/blunders
 *
 * Returns positions classified as INACCURACY, MISTAKE, or BLUNDER.
 */
router.get(
  "/games/:gameId/blunders",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = Number(str(req.params.gameId));
      if (isNaN(gameId)) {
        res.status(400).json({ error: "gameId must be a number" });
        return;
      }

      const game = await prisma.game.findUnique({ where: { id: gameId } });
      if (!game) {
        res.status(404).json({ error: `Game ${gameId} not found` });
        return;
      }

      const positions = await prisma.position.findMany({
        where: {
          gameId,
          classification: { in: ["INACCURACY", "MISTAKE", "BLUNDER"] },
        },
        select: {
          ply: true,
          san: true,
          fen: true,
          eval: true,
          cpLoss: true,
          classification: true,
        },
        orderBy: { ply: "asc" },
      });

      res.json({ blunders: positions });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
