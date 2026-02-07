import { Side } from "@prisma/client";
import prisma from "../lib/prisma";

export function cpToWinPercent(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const diff = winBefore - winAfter;
  const raw = 103.1668 * Math.exp(-0.04354 * diff) - 3.1669 + 1;
  return Math.max(0, Math.min(100, raw));
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function harmonicMean(values: number[]): number {
  if (values.length === 0) return 0;
  // Shift values slightly above zero to avoid division by zero
  const safe = values.map((v) => Math.max(v, 0.001));
  const reciprocalSum = safe.reduce((sum, v) => sum + 1 / v, 0);
  return values.length / reciprocalSum;
}

export function gameAccuracy(
  moveAccuracies: number[],
  winPercents: number[]
): number {
  if (moveAccuracies.length === 0) return 0;

  const numMoves = moveAccuracies.length;
  const windowSize = Math.max(2, Math.min(8, Math.floor(numMoves / 10)));

  // Compute volatility-weighted mean
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i <= winPercents.length - windowSize; i++) {
    const window = winPercents.slice(i, i + windowSize);
    const vol = Math.max(0.5, Math.min(12, stddev(window)));

    // Each move in this window gets weighted by volatility
    for (let j = i; j < i + windowSize && j < moveAccuracies.length; j++) {
      weightedSum += moveAccuracies[j] * vol;
      totalWeight += vol;
    }
  }

  // Handle case where window doesn't cover all moves
  if (totalWeight === 0) {
    weightedSum = moveAccuracies.reduce((a, b) => a + b, 0);
    totalWeight = moveAccuracies.length;
  }

  const volatilityWeightedMean = weightedSum / totalWeight;
  const hMean = harmonicMean(moveAccuracies);

  return (volatilityWeightedMean + hMean) / 2;
}

export async function computeGameAccuracy(
  gameId: number
): Promise<{ white: number | null; black: number | null }> {
  const positions = await prisma.position.findMany({
    where: { gameId, eval: { not: null } },
    select: { ply: true, eval: true, sideToMove: true },
    orderBy: { ply: "asc" },
  });

  if (positions.length < 2) return { white: null, black: null };

  const whiteMoveAccuracies: number[] = [];
  const blackMoveAccuracies: number[] = [];
  // Win% sequences for volatility calc, starting with initial 50%
  const whiteWinPercents: number[] = [50];
  const blackWinPercents: number[] = [50];

  for (let i = 0; i < positions.length - 1; i++) {
    const curr = positions[i];
    const next = positions[i + 1];
    const currEval = curr.eval!;
    const nextEval = next.eval!;

    if (curr.sideToMove === Side.WHITE) {
      const winBefore = cpToWinPercent(currEval);
      const winAfter = cpToWinPercent(nextEval);
      whiteMoveAccuracies.push(moveAccuracy(winBefore, winAfter));
      whiteWinPercents.push(winAfter);
    } else {
      const winBefore = cpToWinPercent(-currEval);
      const winAfter = cpToWinPercent(-nextEval);
      blackMoveAccuracies.push(moveAccuracy(winBefore, winAfter));
      blackWinPercents.push(winAfter);
    }
  }

  const white =
    whiteMoveAccuracies.length > 0
      ? Math.round(gameAccuracy(whiteMoveAccuracies, whiteWinPercents) * 100) /
        100
      : null;
  const black =
    blackMoveAccuracies.length > 0
      ? Math.round(gameAccuracy(blackMoveAccuracies, blackWinPercents) * 100) /
        100
      : null;

  await prisma.game.update({
    where: { id: gameId },
    data: { accuracyWhite: white, accuracyBlack: black },
  });

  return { white, black };
}

export async function computeAllAccuracy(): Promise<number> {
  const games = await prisma.game.findMany({
    where: {
      accuracyWhite: null,
      positions: {
        some: { cpLoss: { not: null } },
      },
    },
    select: { id: true },
  });

  let processed = 0;
  for (const { id } of games) {
    try {
      const result = await computeGameAccuracy(id);
      if (result.white !== null || result.black !== null) {
        console.log(
          `Game ${id}: white=${result.white}%, black=${result.black}%`
        );
        processed++;
      }
    } catch (err) {
      console.error(`Game ${id}: failed to compute accuracy —`, err);
    }
  }

  return processed;
}
