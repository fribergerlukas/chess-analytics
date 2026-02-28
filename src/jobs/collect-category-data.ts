/**
 * Collect per-category arena stats data from existing DB players.
 *
 * Reads phase-accuracy-data.json (349 players already in DB with evals),
 * runs computeArenaStats() for each, and records category successRates.
 * No Stockfish or API calls needed — pure DB reads.
 *
 * Usage: npx ts-node src/jobs/collect-category-data.ts
 */

import prisma from "../lib/prisma";
import { matchesCategory } from "../lib/timeControl";
import { computeArenaStats } from "../services/arenaStats";
import { detectAllUnclassified } from "../services/blunders";
import * as fs from "fs";
import * as path from "path";

const PHASE_DATA_FILE = path.join(__dirname, "../../phase-accuracy-data.json");
const OUTPUT_FILE = path.join(__dirname, "../../category-score-data.json");

interface PhaseDataPoint {
  username: string;
  rating: number;
  bracket: string;
}

interface CategoryDataPoint {
  username: string;
  rating: number;
  bracket: string;
  attacking: number;
  defending: number;
  tactics: number;
  strategic: number;
  opening: number;
  endgame: number;
}

async function main() {
  if (!fs.existsSync(PHASE_DATA_FILE)) {
    console.error("phase-accuracy-data.json not found.");
    process.exit(1);
  }

  const players: PhaseDataPoint[] = JSON.parse(fs.readFileSync(PHASE_DATA_FILE, "utf-8"));
  console.log(`Loaded ${players.length} players from phase-accuracy-data.json\n`);

  // Compute cpLoss for any positions that have evals but no cpLoss yet
  console.log("Computing cpLoss for unclassified positions...");
  const classified = await detectAllUnclassified();
  console.log(`Classified ${classified} games\n`);

  const results: CategoryDataPoint[] = [];
  let skipped = 0;

  for (let i = 0; i < players.length; i++) {
    const { username, rating, bracket } = players[i];

    const user = await prisma.user.findFirst({
      where: { username: username.toLowerCase() },
    });

    if (!user) {
      console.log(`[${i + 1}/${players.length}] ${username}: not in DB, skipping`);
      skipped++;
      continue;
    }

    // Get matching blitz time controls
    const allTCs = await prisma.game.findMany({
      where: { userId: user.id },
      select: { timeControl: true },
      distinct: ["timeControl"],
    });
    const matchingTCs = allTCs
      .map((g) => g.timeControl)
      .filter((tc) => matchesCategory(tc, "blitz"));

    if (matchingTCs.length === 0) {
      console.log(`[${i + 1}/${players.length}] ${username}: no blitz games, skipping`);
      skipped++;
      continue;
    }

    // Fetch games (same pattern as arena route)
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
      console.log(`[${i + 1}/${players.length}] ${username}: no games found, skipping`);
      skipped++;
      continue;
    }

    // Determine player side from PGN headers
    const userLower = username.toLowerCase();
    const gamePlayerSide: Record<number, "WHITE" | "BLACK"> = {};
    for (const g of games) {
      const whiteMatch = g.pgn.match(/\[White\s+"([^"]+)"\]/i);
      const isWhite = whiteMatch && whiteMatch[1].toLowerCase() === userLower;
      gamePlayerSide[g.id] = isWhite ? "WHITE" : "BLACK";
    }

    // Fetch positions
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

    if (positions.length === 0) {
      console.log(`[${i + 1}/${players.length}] ${username}: no evaluated positions, skipping`);
      skipped++;
      continue;
    }

    // Compute arena stats
    const stats = computeArenaStats(
      positions as any,
      games,
      rating,
      undefined,
      gamePlayerSide,
      "blitz"
    );

    const point: CategoryDataPoint = {
      username,
      rating,
      bracket,
      attacking: stats.categories.attacking.successRate,
      defending: stats.categories.defending.successRate,
      tactics: stats.categories.tactics.successRate,
      strategic: stats.categories.strategic.successRate,
      opening: stats.categories.opening.successRate,
      endgame: stats.categories.endgame.successRate,
    };

    results.push(point);
    console.log(
      `[${i + 1}/${players.length}] ${username} (${rating}, ${bracket}): ` +
      `ATK=${point.attacking.toFixed(1)} DEF=${point.defending.toFixed(1)} ` +
      `TAC=${point.tactics.toFixed(1)} POS=${point.strategic.toFixed(1)} ` +
      `OPN=${point.opening.toFixed(1)} END=${point.endgame.toFixed(1)}`
    );
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nDone. ${results.length} players written to category-score-data.json (${skipped} skipped).`);

  await prisma.$disconnect();
}

main();
