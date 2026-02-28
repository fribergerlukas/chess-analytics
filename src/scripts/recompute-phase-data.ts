/**
 * Recompute phase-accuracy-data.json from existing DB data using the current formula.
 * No imports or Stockfish needed — just recalculates from stored evals.
 *
 * Usage: npx ts-node src/scripts/recompute-phase-data.ts
 */
import prisma from "../lib/prisma";
import { cpToWinPercent, moveAccuracy, harmonicMean } from "../services/accuracy";
import * as fs from "fs";
import * as path from "path";

const DATA_FILE = path.join(__dirname, "../../phase-accuracy-data.json");

interface PhaseDataPoint {
  username: string;
  rating: number;
  bracket: string;
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}

function isEndgamePosition(fen: string): boolean {
  const boardPart = fen.split(" ")[0];
  let pieceCount = 0;
  for (const ch of boardPart) {
    if ("qrbnQRBN".includes(ch)) pieceCount++;
  }
  return pieceCount < 7;
}

async function computePhaseAccuracyForUser(username: string): Promise<{
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
  gameCount: number;
}> {
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
  });
  if (!user) return { opening: null, middlegame: null, endgame: null, gameCount: 0 };

  const games = await prisma.game.findMany({
    where: { userId: user.id },
    select: { id: true, pgn: true },
  });

  const phaseGameAccuracies: Record<"opening" | "middlegame" | "endgame", number[]> = {
    opening: [], middlegame: [], endgame: [],
  };

  let gamesWithData = 0;

  for (const game of games) {
    const whiteMatch = game.pgn.match(/\[White "([^"]+)"\]/);
    const playerIsWhite = whiteMatch
      ? whiteMatch[1].toLowerCase() === username.toLowerCase()
      : true;

    const positions = await prisma.position.findMany({
      where: { gameId: game.id, eval: { not: null } },
      select: { ply: true, fen: true, eval: true, sideToMove: true },
      orderBy: { ply: "asc" },
    });

    if (positions.length < 2) continue;
    gamesWithData++;

    const phaseAccs: Record<"opening" | "middlegame" | "endgame", number[]> = {
      opening: [], middlegame: [], endgame: [],
    };

    for (let i = 0; i < positions.length - 1; i++) {
      const curr = positions[i];
      const next = positions[i + 1];
      const moverIsWhite = curr.sideToMove === "WHITE";
      if (moverIsWhite !== playerIsWhite) continue;

      const evalBefore = moverIsWhite ? curr.eval! : -curr.eval!;
      const evalAfter = moverIsWhite ? next.eval! : -next.eval!;
      const winBefore = cpToWinPercent(evalBefore);
      const winAfter = cpToWinPercent(evalAfter);
      const acc = moveAccuracy(winBefore, winAfter);

      const isOpening = curr.ply <= 24;
      const isEndgame = !isOpening && isEndgamePosition(curr.fen);

      if (isOpening) phaseAccs.opening.push(acc);
      else if (isEndgame) phaseAccs.endgame.push(acc);
      else phaseAccs.middlegame.push(acc);
    }

    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      if (phaseAccs[phase].length > 0) {
        const capped = phaseAccs[phase].map((v) => Math.max(v, 24));
        phaseGameAccuracies[phase].push(harmonicMean(capped));
      }
    }
  }

  return {
    opening: phaseGameAccuracies.opening.length > 0
      ? phaseGameAccuracies.opening.reduce((a, b) => a + b, 0) / phaseGameAccuracies.opening.length
      : null,
    middlegame: phaseGameAccuracies.middlegame.length > 0
      ? phaseGameAccuracies.middlegame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.middlegame.length
      : null,
    endgame: phaseGameAccuracies.endgame.length > 0
      ? phaseGameAccuracies.endgame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.endgame.length
      : null,
    gameCount: gamesWithData,
  };
}

async function main() {
  const oldData: PhaseDataPoint[] = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  console.log(`Loaded ${oldData.length} existing data points. Recomputing with new formula...\n`);

  const newData: PhaseDataPoint[] = [];
  let processed = 0;
  let skipped = 0;

  for (const point of oldData) {
    const result = await computePhaseAccuracyForUser(point.username);
    if (result.gameCount === 0) {
      skipped++;
      continue;
    }

    newData.push({
      username: point.username,
      rating: point.rating,
      bracket: point.bracket,
      opening: result.opening,
      middlegame: result.middlegame,
      endgame: result.endgame,
    });

    processed++;
    if (processed % 10 === 0) {
      console.log(`  ${processed}/${oldData.length} players recomputed`);
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2));
  console.log(`\nDone. Wrote ${newData.length} data points (${skipped} skipped, no data in DB).`);
  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
