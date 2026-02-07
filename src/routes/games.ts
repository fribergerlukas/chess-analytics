import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";

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
 *   source  — filter by platform (e.g. "chesscom", "lichess")
 *   from    — ISO date string, games ending on or after this date
 *   to      — ISO date string, games ending on or before this date
 *   limit   — page size (default 20, max 100)
 *   offset  — pagination offset (default 0)
 */
router.get(
  "/users/:username/games",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const { source, from, to } = req.query;
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

      const games = await prisma.game.findMany({
        where: {
          userId: user.id,
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
          createdAt: true,
        },
        orderBy: { endDate: "desc" },
        take: limit,
        skip: offset,
      });

      const total = await prisma.game.count({
        where: {
          userId: user.id,
          ...(Object.keys(dateFilter).length > 0
            ? { endDate: dateFilter }
            : {}),
        },
      });

      res.json({
        games: games.map((g) => ({
          id: g.id,
          endTime: g.endDate,
          timeControl: g.timeControl,
          result: g.result,
          accuracyWhite: g.accuracyWhite,
          accuracyBlack: g.accuracyBlack,
          source: user.platform,
          createdAt: g.createdAt,
        })),
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
 * Query params:
 *   source      — filter by platform (e.g. "chesscom", "lichess")
 *   timeControl — filter by time control string (e.g. "180", "300+3")
 *   from        — ISO date string, games ending on or after this date
 *   to          — ISO date string, games ending on or before this date
 */
router.get(
  "/users/:username/stats",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const username = str(req.params.username);
      const { source, timeControl, from, to } = req.query;

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

      const where = {
        userId: user.id,
        ...(typeof timeControl === "string" ? { timeControl } : {}),
        ...(Object.keys(dateFilter).length > 0 ? { endDate: dateFilter } : {}),
      };

      const [resultGroups, accuracy] = await Promise.all([
        prisma.game.groupBy({
          by: ["result"],
          where,
          _count: { result: true },
        }),
        prisma.game.aggregate({
          where,
          _avg: { accuracyWhite: true, accuracyBlack: true },
        }),
      ]);

      const counts = { WIN: 0, LOSS: 0, DRAW: 0 };
      for (const g of resultGroups) {
        counts[g.result] = g._count.result;
      }
      const totalGames = counts.WIN + counts.LOSS + counts.DRAW;

      const round2 = (n: number) => Math.round(n * 100) / 100;

      const avgWhite = accuracy._avg.accuracyWhite;
      const avgBlack = accuracy._avg.accuracyBlack;

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
