import { MoveClassification, Side } from "@prisma/client";
import prisma from "../lib/prisma";

export function classifyMove(cpLoss: number): MoveClassification {
  if (cpLoss < 10) return MoveClassification.BEST;
  if (cpLoss < 50) return MoveClassification.GOOD;
  if (cpLoss < 100) return MoveClassification.INACCURACY;
  if (cpLoss < 200) return MoveClassification.MISTAKE;
  return MoveClassification.BLUNDER;
}

export async function detectGameBlunders(gameId: number): Promise<number> {
  const positions = await prisma.position.findMany({
    where: { gameId, eval: { not: null } },
    select: { id: true, ply: true, eval: true, sideToMove: true },
    orderBy: { ply: "asc" },
  });

  let classified = 0;

  for (let i = 0; i < positions.length; i++) {
    const curr = positions[i];

    // Last position has no next eval to compare against
    if (i === positions.length - 1) {
      await prisma.position.update({
        where: { id: curr.id },
        data: { cpLoss: 0, classification: null },
      });
      continue;
    }

    const next = positions[i + 1];
    const currEval = curr.eval!;
    const nextEval = next.eval!;

    // cpLoss: how much the position worsened for the side that moved
    const cpLoss =
      curr.sideToMove === Side.WHITE
        ? currEval - nextEval // white wants eval high
        : nextEval - currEval; // black wants eval low (negative)

    // Clamp negative cpLoss to 0 (move improved position)
    const loss = Math.max(0, cpLoss);
    const classification = classifyMove(loss);

    await prisma.position.update({
      where: { id: curr.id },
      data: { cpLoss: loss, classification },
    });

    classified++;
  }

  return classified;
}

export async function detectAllUnclassified(): Promise<number> {
  const games = await prisma.game.findMany({
    where: {
      positionsParsed: true,
      positions: {
        some: { eval: { not: null }, cpLoss: null },
      },
    },
    select: { id: true },
  });

  let processed = 0;
  for (const { id } of games) {
    try {
      const count = await detectGameBlunders(id);
      if (count > 0) {
        console.log(`Game ${id}: ${count} moves classified`);
        processed++;
      }
    } catch (err) {
      console.error(`Game ${id}: failed to classify —`, err);
    }
  }

  return processed;
}
