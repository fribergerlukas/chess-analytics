/**
 * Position Category Classification — Adapter for Arena Card
 *
 * Builds a ClassificationContext from Position data and runs the same
 * decision tree as the puzzle classification system:
 *
 *   0. ply <= 24                       → "opening"
 *   1. hasTacticalMotif(labels)        → "tactics"
 *   2. isEndgamePosition(fen)          → "endgame"
 *   3. isDefendingPosition(ctx)        → "defending"
 *   4. isAttackingPosition(ctx)        → "attacking"
 *   5. otherwise                       → "strategic"
 *
 * Unlike puzzle classification, there is NO holdable position filter here.
 * Arena stats should classify all positions, even lost ones.
 */

import { Side } from "@prisma/client";
import {
  ClassificationContext,
  isDefendingPosition,
  isAttackingPosition,
  isEndgamePosition,
  hasTacticalMotif,
  detectLabels,
} from "./puzzleClassification";

export type PositionCategory =
  | "opening"
  | "defending"
  | "attacking"
  | "tactics"
  | "endgame"
  | "strategic";

export function classifyPositionCategory(ctx: {
  fen: string;
  ply: number;
  eval: number | null;      // from WHITE's perspective (cp)
  sideToMove: Side;
  bestMoveUci: string | null;
  pv: string | null;
}): PositionCategory {
  // 0. Opening — ply-based, threat detection doesn't apply to early theory
  if (ctx.ply <= 24) return "opening";

  // Need eval and bestMove for threat-based classification
  if (ctx.eval == null || !ctx.bestMoveUci) {
    return isEndgamePosition(ctx.fen) ? "endgame" : "strategic";
  }

  // Build ClassificationContext for puzzle functions
  const classCtx: ClassificationContext = {
    evalBeforeCp: ctx.eval,
    evalAfterCp: null,       // not needed for category detection
    sideToMove: ctx.sideToMove,
    fen: ctx.fen,
    bestMoveUci: ctx.bestMoveUci,
    pvMoves: ctx.pv ? ctx.pv.trim().split(/\s+/) : [],
  };

  // 1. Tactics — recognizable tactical motif takes priority
  const labels = detectLabels(ctx.fen, ctx.bestMoveUci, classCtx.pvMoves, null);
  if (hasTacticalMotif(labels)) return "tactics";

  // 2. Endgame — simplified positions stay in endgame bucket
  if (isEndgamePosition(ctx.fen)) return "endgame";

  // 3. Defending — concrete threat against player + survival
  if (isDefendingPosition(classCtx)) return "defending";

  // 4. Attacking — best move creates/executes threat
  if (isAttackingPosition(classCtx)) return "attacking";

  // 5. Strategic — catch-all
  return "strategic";
}
