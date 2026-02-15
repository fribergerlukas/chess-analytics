import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { Chess } from "chess.js";
import { StockfishEngine } from "../services/stockfish";
import { matchesCategory } from "../lib/timeControl";

const router = Router();
const prisma = new PrismaClient();

let stockfish: StockfishEngine | null = null;

async function getStockfish(): Promise<StockfishEngine> {
  if (!stockfish) {
    stockfish = new StockfishEngine();
    await stockfish.init();
  }
  return stockfish;
}

function extractFenBoard(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

// Stockfish UCI uses king-to-rook for castling (e1h1, e1a1, e8h8, e8a8)
// chess.js expects king-to-destination (e1g1, e1c1, e8g8, e8c8)
const CASTLING_MAP: Record<string, string> = {
  e1h1: "e1g1", // white kingside
  e1a1: "e1c1", // white queenside
  e8h8: "e8g8", // black kingside
  e8a8: "e8c8", // black queenside
};

function normalizeCastlingUci(uci: string): string {
  return CASTLING_MAP[uci] || uci;
}

function mapRatingToBucket(rating: number): number {
  const buckets = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
  let closest = buckets[0];
  let minDist = Math.abs(rating - buckets[0]);
  for (const b of buckets) {
    const dist = Math.abs(rating - b);
    if (dist < minDist) {
      minDist = dist;
      closest = b;
    }
  }
  return closest;
}

function mapTimeCategory(tc: string): string {
  const map: Record<string, string> = {
    bullet: "bullet",
    blitz: "blitz",
    rapid: "rapid",
  };
  return map[tc] || "blitz";
}

function weightedRandomPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

interface MoveStats {
  moves: { uci: string; san: string; count: number; pct: number }[];
  totalGames: number;
}

interface MoveResult {
  move: string;
  san: string;
  source: string;
  stats: MoveStats;
}

// Level 1: Player's game data
async function tryPlayerData(
  opponentUsername: string,
  fen: string,
  opponentSide: string,
  timeCategory?: string
): Promise<MoveResult | null> {
  const fenBoard = extractFenBoard(fen);
  const sideToMove = opponentSide === "white" ? "WHITE" : "BLACK";

  // If timeCategory provided, find matching time controls first
  let timeControlFilter: Record<string, unknown> = {};
  if (timeCategory) {
    const allTcs = await prisma.game.findMany({
      where: { user: { username: opponentUsername }, rated: true },
      select: { timeControl: true },
      distinct: ["timeControl"],
    });
    const matching = allTcs
      .map((g) => g.timeControl)
      .filter((tc) => matchesCategory(tc, timeCategory.toLowerCase()));
    timeControlFilter = { timeControl: { in: matching } };
  }

  // Find games where the user played as the correct side (opponentSide)
  // by parsing the PGN White header
  const userGames = await prisma.game.findMany({
    where: {
      user: { username: opponentUsername },
      rated: true,
      ...timeControlFilter,
    },
    select: { id: true, pgn: true },
  });

  const gameIdsForSide: number[] = [];
  const userLower = opponentUsername.toLowerCase();
  for (const g of userGames) {
    const whiteMatch = g.pgn.match(/\[White\s+"([^"]+)"\]/i);
    const whiteName = whiteMatch?.[1]?.toLowerCase() ?? "";
    const isWhite = whiteName === userLower;
    const gameSide = isWhite ? "white" : "black";
    if (gameSide === opponentSide) {
      gameIdsForSide.push(g.id);
    }
  }

  if (gameIdsForSide.length === 0) return null;

  const positions = await prisma.position.findMany({
    where: {
      fen: { startsWith: fenBoard },
      sideToMove,
      gameId: { in: gameIdsForSide },
    },
    select: { moveUci: true, san: true, game: { select: { endDate: true } } },
  });

  if (positions.length < 3) return null;

  // Recency weighting: last 4 weeks = 3x, 4-12 weeks = 2x, older = 1x
  const now = Date.now();
  const FOUR_WEEKS = 28 * 24 * 60 * 60 * 1000;
  const TWELVE_WEEKS = 84 * 24 * 60 * 60 * 1000;

  function recencyWeight(endDate: Date): number {
    const age = now - endDate.getTime();
    if (age <= FOUR_WEEKS) return 5;
    if (age <= TWELVE_WEEKS) return 3;
    return 1;
  }

  // Group by moveUci with recency-weighted counts
  const moveCounts = new Map<string, { san: string; count: number; weightedCount: number }>();
  for (const pos of positions) {
    const w = recencyWeight(pos.game.endDate);
    const existing = moveCounts.get(pos.moveUci);
    if (existing) {
      existing.count++;
      existing.weightedCount += w;
    } else {
      moveCounts.set(pos.moveUci, { san: pos.san, count: 1, weightedCount: w });
    }
  }

  const totalGames = positions.length;
  const moves = Array.from(moveCounts.entries())
    .map(([uci, { san, count }]) => ({
      uci,
      san,
      count,
      pct: Math.round((count / totalGames) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  // Weighted random pick using recency-weighted counts
  const weightedMoves = Array.from(moveCounts.entries()).map(([uci, { san, count, weightedCount }]) => ({
    uci,
    san,
    count,
    pct: Math.round((count / totalGames) * 100),
    weight: weightedCount,
  }));
  const picked = weightedRandomPick(weightedMoves);

  return {
    move: picked.uci,
    san: picked.san,
    source: "player_data",
    stats: { moves, totalGames },
  };
}

// Level 2: Lichess Opening Explorer
async function tryLichessExplorer(
  fen: string,
  opponentRating: number,
  timeCategory: string
): Promise<MoveResult | null> {
  const ratingBucket = mapRatingToBucket(opponentRating);
  const speed = mapTimeCategory(timeCategory);

  const params = new URLSearchParams({
    fen,
    ratings: String(ratingBucket),
    speeds: speed,
  });

  try {
    const res = await fetch(
      `https://explorer.lichess.ovh/lichess?${params}`
    );
    if (!res.ok) return null;

    const data = await res.json() as {
      moves?: { uci: string; san: string; white: number; draws: number; black: number }[];
    };
    if (!data.moves || data.moves.length === 0) return null;

    const totalGames = data.moves.reduce(
      (sum, m) => sum + m.white + m.draws + m.black,
      0
    );

    const moves = data.moves.map((m) => {
      const count = m.white + m.draws + m.black;
      return {
        uci: m.uci,
        san: m.san,
        count,
        pct: totalGames > 0 ? Math.round((count / totalGames) * 100) : 0,
      };
    });

    const picked = weightedRandomPick(
      moves.map((m) => ({ uci: m.uci, san: m.san, count: m.count, pct: m.pct, weight: m.count }))
    );

    return {
      move: picked.uci,
      san: picked.san,
      source: "lichess_db",
      stats: { moves: moves.slice(0, 10), totalGames },
    };
  } catch {
    return null;
  }
}

// Level 3: Stockfish at reduced depth
async function tryStockfish(fen: string): Promise<MoveResult | null> {
  try {
    const engine = await getStockfish();
    const result = await engine.evaluate(fen, 8);

    if (!result.bestMove) return null;

    // Convert bestMove UCI to SAN
    let san = result.bestMove;
    try {
      const chess = new Chess(fen);
      const from = result.bestMove.slice(0, 2);
      const to = result.bestMove.slice(2, 4);
      const promotion = result.bestMove.length > 4 ? result.bestMove[4] : undefined;
      const move = chess.move({
        from: from as any,
        to: to as any,
        ...(promotion ? { promotion: promotion as any } : {}),
      });
      if (move) san = move.san;
    } catch {
      // Keep UCI as fallback
    }

    return {
      move: result.bestMove,
      san,
      source: "stockfish",
      stats: {
        moves: [{ uci: result.bestMove, san, count: 1, pct: 100 }],
        totalGames: 0,
      },
    };
  } catch {
    return null;
  }
}

// Level 4: Random legal move
function tryRandomMove(fen: string): MoveResult | null {
  try {
    const chess = new Chess(fen);
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;

    const picked = moves[Math.floor(Math.random() * moves.length)];
    const uci = picked.from + picked.to + (picked.promotion || "");

    return {
      move: uci,
      san: picked.san,
      source: "random",
      stats: {
        moves: [{ uci, san: picked.san, count: 1, pct: 100 }],
        totalGames: 0,
      },
    };
  } catch {
    return null;
  }
}

router.post("/simulation/move", async (req: Request, res: Response) => {
  try {
    const { opponentUsername, fen, opponentSide, opponentRating, timeCategory } = req.body;

    if (!fen || !opponentSide) {
      return res.status(400).json({ error: "fen and opponentSide are required" });
    }

    function sendResult(result: MoveResult) {
      result.move = normalizeCastlingUci(result.move);
      for (const m of result.stats.moves) {
        m.uci = normalizeCastlingUci(m.uci);
      }
      return res.json(result);
    }

    // Level 1: Player data
    if (opponentUsername) {
      const result = await tryPlayerData(opponentUsername, fen, opponentSide, timeCategory);
      if (result) return sendResult(result);
    }

    // Level 2: Lichess explorer
    const lichessResult = await tryLichessExplorer(
      fen,
      opponentRating || 1500,
      timeCategory || "blitz"
    );
    if (lichessResult) return sendResult(lichessResult);

    // Level 3: Stockfish
    const sfResult = await tryStockfish(fen);
    if (sfResult) return sendResult(sfResult);

    // Level 4: Random
    const randomResult = tryRandomMove(fen);
    if (randomResult) return sendResult(randomResult);

    return res.status(500).json({ error: "No legal moves available" });
  } catch (err) {
    console.error("Simulation move error:", err);
    return res.status(500).json({ error: "Failed to compute move" });
  }
});

export default router;
