import { Router, Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";

const router = Router();

function str(val: unknown): string {
  return typeof val === "string" ? val : String(val);
}

// TODO: Add stats endpoints (win rate, avg game length, opening frequency)
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

export default router;
