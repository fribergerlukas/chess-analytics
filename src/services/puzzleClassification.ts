/**
 * Puzzle Classification System — Three-Axis Taxonomy
 *
 * 1. CATEGORY (WHY)   — the training intent / game situation
 * 2. SEVERITY (HOW BAD) — the cost of the player's mistake
 * 3. LABELS  (WHAT)   — tactical motifs present in the solution
 *
 * These axes are independent and must not be conflated.
 *
 * Eval convention:
 *   evalBeforeCp / evalAfterCp are stored from WHITE's perspective.
 *   "userEval" converts to the player-to-move's perspective (positive = good for user).
 *   cpLoss is always positive (how much the mistake cost the user).
 */

import { Chess, Square } from "chess.js";
import { Side } from "@prisma/client";

// ============================================================
// CLASSIFICATION CONTEXT
// ============================================================

/**
 * Enriched context for puzzle classification.
 * Includes game history (previous position evals) and position data
 * so category detection can use eval trajectory, not just a snapshot.
 */
export interface ClassificationContext {
  evalBeforeCp: number | null;       // Position eval (white's perspective)
  evalAfterCp: number | null;        // Eval after the mistake (white's perspective)
  sideToMove: Side;                  // Who's moving in this position
  fen: string;                       // Position FEN
  bestMoveUci: string;               // The correct move (UCI)
  pvMoves: string[];                 // Principal variation moves
  // Game context — eval of surrounding positions (white's perspective)
  prevEvalCp?: number | null;        // Eval 1 ply before this position
  prevPrevEvalCp?: number | null;    // Eval 2 plies before this position
}

/** Convert eval from white's perspective to the user's perspective. */
function toUserEval(evalCp: number | null | undefined, side: Side): number | null {
  if (evalCp == null) return null;
  return side === "WHITE" ? evalCp : -evalCp;
}

// ============================================================
// AXIS 1 — CATEGORY (WHY)
// ============================================================
//
// Determines what the position demanded from the player.
// Each puzzle gets exactly ONE category.
//
// Categories are mutually exclusive. If a puzzle seems to fit
// multiple, the thresholds or logic should be adjusted — not
// the exclusivity rule.

export type PuzzleCategory =
  | "opening"
  | "defending"
  | "attacking"
  | "tactics"
  | "endgame"
  | "strategic";

// ── Defending detection ──
// A position is "defending" when TWO criteria are met:
//   1. Concrete threat — the opponent can win material or deliver checkmate
//      if the player does nothing (null move test + SEE).
//   2. Survival — the best move doesn't swing the position in the player's
//      favor. After best play the eval is still ≤ SURVIVAL_THRESHOLD.
//      This confirms the best move was responsive (dealing with the threat),
//      not an offensive counter-attack.
const SURVIVAL_THRESHOLD = 50;    // userEval ≤ this → best move is survival
const MATERIAL_THREAT_MIN = 1;    // opponent must win ≥ this many points (1 = pawn)

// ── Static Exchange Evaluation (SEE) ──────────────────────────────────

/**
 * Evaluate the net material outcome of a capture sequence on a single square.
 *
 * Starting from `fen`, the initial capture `from→to` is played, then both
 * sides recapture with the least valuable piece until one side stops
 * (because continuing would lose material).
 *
 * Returns the net material gain for the initial attacker (≥ 0).
 */
function seeCapture(fen: string, from: string, to: string): number {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return 0;
  }

  const targetSquare = to as Square;

  // Value of the piece being captured
  const victim = chess.get(targetSquare);
  if (!victim) return 0;

  const gains: number[] = [];
  gains.push(PIECE_VAL[victim.type] || 0);

  // Make the initial capture
  try {
    chess.move({ from: from as Square, to: targetSquare });
  } catch {
    return 0;
  }

  // Simulate recaptures: each side uses the least valuable attacker
  for (let depth = 0; depth < 32; depth++) {
    const recaptures = chess
      .moves({ verbose: true })
      .filter((m) => m.to === targetSquare && m.captured);

    if (recaptures.length === 0) break;

    // Least valuable attacker first (standard SEE)
    recaptures.sort(
      (a, b) => (PIECE_VAL[a.piece] || 0) - (PIECE_VAL[b.piece] || 0)
    );

    const pieceOnTarget = chess.get(targetSquare);
    if (!pieceOnTarget) break;
    gains.push(PIECE_VAL[pieceOnTarget.type] || 0);

    try {
      chess.move(recaptures[0]);
    } catch {
      break;
    }
  }

  // Negamax: each side captures only if it's profitable
  let value = 0;
  for (let i = gains.length - 1; i >= 0; i--) {
    value = Math.max(0, gains[i] - value);
  }

  return value;
}

// ── Null-move threat detection ────────────────────────────────────────

interface ThreatInfo {
  /** Best net material the opponent can win with a free move */
  maxMaterialWin: number;
  /** Opponent can deliver checkmate with a free move */
  canCheckmate: boolean;
}

/**
 * Give the opponent a free move (null move) and check what damage they
 * can inflict. Uses SEE to determine actual material *wins* (not just
 * captures — recaptures are accounted for).
 *
 * Skips the test if the player is already in check (the caller handles
 * that case separately since check is an obvious threat).
 */
export function detectNullMoveThreats(fen: string, sideToMove: Side): ThreatInfo {
  const result: ThreatInfo = { maxMaterialWin: 0, canCheckmate: false };

  // If already in check, skip null-move (handled by caller)
  try {
    const currentPos = new Chess(fen);
    if (currentPos.isCheck()) return result;
  } catch {
    return result;
  }

  // Swap turn: give the opponent a free move
  const fenParts = fen.split(" ");
  fenParts[1] = sideToMove === "WHITE" ? "b" : "w";
  fenParts[3] = "-"; // en passant is invalid after a null move
  const nullFen = fenParts.join(" ");

  let nullPos: Chess;
  try {
    nullPos = new Chess(nullFen);
  } catch {
    return result;
  }

  const opponentMoves = nullPos.moves({ verbose: true });

  for (const move of opponentMoves) {
    // Check for checkmate
    try {
      const test = new Chess(nullFen);
      test.move(move);
      if (test.isCheckmate()) {
        result.canCheckmate = true;
      }
    } catch {
      continue;
    }

    // Check for material win via SEE
    if (move.captured) {
      const netGain = seeCapture(nullFen, move.from, move.to);
      if (netGain > result.maxMaterialWin) {
        result.maxMaterialWin = netGain;
      }
    }
  }

  return result;
}

// ── Defending position detection ──────────────────────────────────────

/**
 * Detect whether a position is a defending situation.
 *
 * Two criteria must BOTH be met:
 *
 * 1. CONCRETE THREAT — the opponent threatens the player's material or king.
 *    Detected by: player is in check, OR a null-move test shows the opponent
 *    can win material (SEE ≥ 1 pawn) or deliver checkmate with a free move.
 *
 * 2. SURVIVAL — the best move is responsive, not an offensive improvement.
 *    After best play, userEval ≤ 50. The move dealt with the threat but
 *    didn't swing the game in the player's favor. A capture that addresses
 *    the threat still qualifies — what matters is the outcome, not the
 *    move type.
 *
 * This means "defending" is about what the POSITION demands (handle the
 * threat) and the OUTCOME (you survive, you don't gain).
 */
export function isDefendingPosition(ctx: ClassificationContext): boolean {
  const userEval = toUserEval(ctx.evalBeforeCp, ctx.sideToMove);
  if (userEval == null) return false;

  // Criterion 2 (fast pre-check): best move must be survival
  // If the position is already strongly in our favor, this isn't defending.
  if (userEval > SURVIVAL_THRESHOLD) return false;

  // Criterion 1: concrete threat exists

  // 1a — In check: the most direct threat
  try {
    const chess = new Chess(ctx.fen);
    if (chess.isCheck()) return true;
  } catch { /* skip */ }

  // 1b — Null move: opponent can win material or deliver checkmate
  const threats = detectNullMoveThreats(ctx.fen, ctx.sideToMove);
  if (threats.canCheckmate) return true;
  if (threats.maxMaterialWin >= MATERIAL_THREAT_MIN) return true;

  return false;
}

// ── Attacking detection ──
// A position is "attacking" when the best move executes or creates a
// concrete threat against the opponent. No eval threshold — the global
// holdable filter already ensures the position isn't completely lost.
//
// Mirror of defending:
//   Defending:  threat AGAINST player (before move) + survival (eval ≤ 50)
//   Attacking:  threat FROM player (best move)      — any holdable eval

/**
 * Detect whether a position is an attacking situation.
 *
 * The best move must execute or create a concrete threat against the
 * opponent:
 *   a) EXECUTES: best move captures and wins material (SEE ≥ 1), or
 *      delivers check or checkmate.
 *   b) CREATES: after the best move, the opponent faces material loss
 *      or checkmate if they do nothing (null-move from their side).
 *
 * No eval threshold is applied — attacking puzzles can arise from any
 * holdable position (equal, ahead, or slightly behind). The global
 * holdable filter already prevents completely lost positions from
 * becoming puzzles.
 */
export function isAttackingPosition(ctx: ClassificationContext): boolean {
  if (ctx.evalBeforeCp == null) return false;

  // Best move must exist to analyze threats
  if (!ctx.bestMoveUci) return false;

  let chess: Chess;
  try {
    chess = new Chess(ctx.fen);
  } catch {
    return false;
  }

  const from = ctx.bestMoveUci.slice(0, 2) as Square;
  const to = ctx.bestMoveUci.slice(2, 4) as Square;
  const promo = ctx.bestMoveUci.length > 4
    ? (ctx.bestMoveUci[4] as "q" | "r" | "b" | "n")
    : undefined;

  // ── 1a: Best move EXECUTES a threat ──

  // Does the best move win material?
  const targetPiece = chess.get(to);
  if (targetPiece) {
    const netGain = seeCapture(ctx.fen, from, to);
    if (netGain >= MATERIAL_THREAT_MIN) return true;
  }

  // Does the best move deliver check or checkmate?
  let afterBest: Chess;
  try {
    afterBest = new Chess(ctx.fen);
    afterBest.move({ from, to, ...(promo ? { promotion: promo } : {}) });
  } catch {
    return false;
  }

  if (afterBest.isCheckmate()) return true;
  if (afterBest.isCheck()) return true;

  // ── 1b: Best move CREATES a threat ──
  // After the best move, does the opponent face material loss or mate
  // if they do nothing? (null-move from opponent's perspective)
  const opponentSide = ctx.sideToMove === "WHITE" ? "BLACK" as Side : "WHITE" as Side;
  const threats = detectNullMoveThreats(afterBest.fen(), opponentSide);
  if (threats.canCheckmate) return true;
  if (threats.maxMaterialWin >= MATERIAL_THREAT_MIN) return true;

  return false;
}

// ── Holdable position filter ──────────────────────────────────────────
// No puzzle should come from a position where even the best move is lost.
// Every puzzle must be from a holdable position.
const HOLDABLE_THRESHOLD = -300;         // userEval ≥ this for all puzzles
const ENDGAME_HOLDABLE_THRESHOLD = -100; // tighter for endgame (must be drawable)

/**
 * Check if a position is holdable (not lost even with best play).
 * Returns false if the position is too far gone to be a useful puzzle.
 */
function isHoldablePosition(userEval: number, isEndgame: boolean): boolean {
  if (isEndgame) return userEval >= ENDGAME_HOLDABLE_THRESHOLD;
  return userEval >= HOLDABLE_THRESHOLD;
}

// ── Endgame detection ─────────────────────────────────────────────────
// Reuses the same logic as arenaStats.ts: fewer than 7 non-pawn, non-king pieces.

export function isEndgamePosition(fen: string): boolean {
  const boardPart = fen.split(" ")[0];
  let pieceCount = 0;
  for (const ch of boardPart) {
    if ("qrbnQRBN".includes(ch)) pieceCount++;
  }
  return pieceCount < 7;
}

// ── Tactics detection ─────────────────────────────────────────────────
// A position is "tactics" if the solution contains a recognizable tactical motif.

/** Tactical labels that qualify a puzzle as "tactics" category. */
const TACTICAL_LABELS: Set<string> = new Set([
  "fork", "pin", "skewer", "double_attack", "discovered_attack",
  "removal_of_defender", "overload", "deflection", "intermezzo",
  "sacrifice", "clearance", "back_rank", "mate_threat", "checkmate",
  "smothered_mate", "trapped_piece", "x_ray", "interference",
  "desperado", "attraction",
]);

/** Check if any detected labels are tactical motifs. */
export function hasTacticalMotif(labels: PuzzleLabel[]): boolean {
  return labels.some((l) => TACTICAL_LABELS.has(l));
}

/** Compute ply number from a FEN string (0-indexed). */
function getPlyFromFen(fen: string): number {
  const parts = fen.split(" ");
  const fullmove = parseInt(parts[5]) || 1;
  const isBlack = parts[1] === "b";
  return (fullmove - 1) * 2 + (isBlack ? 1 : 0);
}

/**
 * Classify a puzzle into exactly one category.
 *
 * Decision tree (evaluated top-to-bottom, first match wins):
 *
 * 0. Position must be holdable (not lost). If not → null (skip puzzle).
 *
 * 1. Opening (ply ≤ 24) → OPENING
 *    Early game — any mistake in the first 12 full moves.
 *
 * 2. hasTacticalMotif()     → TACTICS
 *    Solution contains a recognizable pattern (fork, pin, skewer, etc.).
 *    Checked first so tactical puzzles aren't diluted into other categories.
 *
 * 3. isEndgamePosition()    → ENDGAME
 *    Endgame phase (< 7 major/minor pieces). Checked before defending/
 *    attacking so endgame technique (captures, threats in simplified
 *    positions) stays in the endgame bucket.
 *
 * 4. isDefendingPosition()  → DEFENDING
 *    Concrete threat against player (null-move + SEE) + survival (eval ≤ 50).
 *
 * 5. isAttackingPosition()  → ATTACKING
 *    Best move executes or creates a concrete threat against the opponent.
 *
 * 6. Otherwise              → STRATEGIC
 *    Quiet positional improvement — no concrete threats in either direction.
 */
export function classifyCategory(ctx: ClassificationContext): PuzzleCategory | null {
  if (ctx.evalBeforeCp == null) return null;

  const userEval = ctx.sideToMove === "WHITE" ? ctx.evalBeforeCp : -ctx.evalBeforeCp;
  const endgame = isEndgamePosition(ctx.fen);

  // Global filter: position must be holdable
  if (!isHoldablePosition(userEval, endgame)) return null;

  // 1. Opening — early game (ply ≤ 24)
  if (getPlyFromFen(ctx.fen) <= 24) return "opening";

  // 2. Tactics — any recognizable tactical motif takes priority
  const labels = detectLabels(ctx.fen, ctx.bestMoveUci, ctx.pvMoves, null);
  if (hasTacticalMotif(labels)) return "tactics";

  // 3. Endgame — simplified positions stay in endgame bucket
  //    (prevents endgame captures/threats from being absorbed by attacking)
  if (endgame) return "endgame";

  // 4. Defending — opponent has a concrete threat + player is surviving
  if (isDefendingPosition(ctx)) return "defending";

  // 5. Attacking — best move creates/executes a concrete threat
  if (isAttackingPosition(ctx)) return "attacking";

  // 6. Strategic — catch-all: quiet positional improvement
  return "strategic";
}

// ============================================================
// AXIS 2 — SEVERITY (HOW BAD)
// ============================================================
//
// Describes the outcome quality of the player's decision.
// Independent of category — a resilience puzzle can be a blunder,
// an advantage_capitalisation puzzle can be a missed_win.
//
// "Blunder" and "mistake" are NOT categories. They live here,
// describing severity, not training intent.

export type PuzzleSeverity =
  | "mistake"
  | "blunder"
  | "missed_win"
  | "missed_save";

// Tunable thresholds.
const SEV_BLUNDER_CP = 300;           // cpLoss ≥ this → blunder
const SEV_MISSED_WIN_EVAL = 200;      // userEval ≥ this to qualify
const SEV_MISSED_SAVE_EVAL = -200;    // userEval ≤ this to qualify
const SEV_MISSED_THRESHOLD = 200;     // cpLoss ≥ this for missed_win / missed_save

/**
 * Classify the severity of the player's mistake.
 *
 * Priority (first match wins):
 *
 * 1. MISSED_WIN:  userEval ≥ +200 AND cpLoss ≥ 200
 *    "You had a winning advantage and threw it away."
 *
 * 2. MISSED_SAVE: userEval ≤ -200 AND cpLoss ≥ 200
 *    "A defensive resource existed but you missed it."
 *
 * 3. BLUNDER:     cpLoss ≥ 300
 *    "Severe eval collapse or decisive material loss."
 *
 * 4. MISTAKE:     cpLoss ≥ 150 (our puzzle generation minimum)
 *    "Moderate eval loss."
 *
 * Note: All puzzles have cpLoss ≥ 150 (MISTAKE_THRESHOLD in puzzles.ts),
 * so CLEAN and INACCURACY never appear in our puzzle data.
 */
export function classifySeverity(
  evalBeforeCp: number | null,
  sideToMove: Side,
  cpLoss: number
): PuzzleSeverity {
  if (evalBeforeCp == null) return "mistake";

  const userEval = sideToMove === "WHITE" ? evalBeforeCp : -evalBeforeCp;

  // MISSED_WIN: Had a big advantage, lost it
  if (userEval >= SEV_MISSED_WIN_EVAL && cpLoss >= SEV_MISSED_THRESHOLD) {
    return "missed_win";
  }

  // MISSED_SAVE: Was losing but a resource existed, didn't find it
  if (userEval <= SEV_MISSED_SAVE_EVAL && cpLoss >= SEV_MISSED_THRESHOLD) {
    return "missed_save";
  }

  // BLUNDER: Catastrophic eval drop
  if (cpLoss >= SEV_BLUNDER_CP) {
    return "blunder";
  }

  // MISTAKE: Default for all puzzles (cpLoss ≥ 150)
  return "mistake";
}

// ============================================================
// AXIS 3 — LABELS (WHAT)
// ============================================================
//
// Tactical motifs present in the solution.
// A puzzle may have MULTIPLE labels.
// Labels describe WHAT happens tactically, not WHY or HOW BAD.
//
// Labels are additive and non-exclusive: a sacrifice that leads
// to checkmate gets both "sacrifice" and "checkmate".

export type PuzzleLabel =
  // Core tactical labels
  | "fork"
  | "pin"
  | "skewer"
  | "double_attack"
  | "discovered_attack"
  | "removal_of_defender"
  | "overload"
  | "deflection"
  | "intermezzo"
  | "sacrifice"
  | "clearance"
  | "back_rank"
  | "mate_threat"
  | "checkmate"
  | "smothered_mate"
  | "trapped_piece"
  | "x_ray"
  | "interference"
  | "desperado"
  | "attraction"
  // Defensive / resilience labels
  | "perpetual_check"
  | "defensive_sacrifice"
  | "counter_attack"
  | "fortress"
  | "stalemate"
  | "blockade";

// Piece values for sacrifice detection (standard material values)
const PIECE_VAL: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
};

/** Count total material for each side from a FEN string. */
function countMaterial(fen: string): { w: number; b: number } {
  const boardPart = fen.split(" ")[0];
  let w = 0, b = 0;
  for (const ch of boardPart) {
    const lower = ch.toLowerCase();
    const val = PIECE_VAL[lower];
    if (val) {
      if (ch === ch.toUpperCase()) w += val;
      else b += val;
    }
  }
  return { w, b };
}

/** Apply a UCI move to a chess.js instance. Returns the move result or null. */
function applyUci(chess: Chess, uci: string) {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promo = uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined;
  try {
    return chess.move({ from, to, ...(promo ? { promotion: promo } : {}) });
  } catch {
    return null;
  }
}

/**
 * Check if a piece on `square` is attacked by the opponent.
 *
 * Determines the piece color on that square and checks if the OTHER
 * color can capture it. Uses geometric ray-based checks via
 * doesPieceDefend() to avoid chess.js turn-swap issues.
 */
function isSquareAttacked(chess: Chess, square: string): boolean {
  const piece = chess.get(square as Square);
  if (!piece) return false;

  const attackerColor = piece.color === "w" ? "b" : "w";
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== attackerColor) continue;
      const sq = toSquareName(c, 7 - r);
      if (doesPieceDefend(chess, sq, square)) return true;
    }
  }
  return false;
}

/**
 * Count how many opponent pieces a piece on `square` attacks.
 * Returns an array of attacked piece types.
 */
function getAttackedPieces(chess: Chess, square: string): string[] {
  // Swap turn so we can generate moves from the piece
  const fenParts = chess.fen().split(" ");
  fenParts[1] = fenParts[1] === "w" ? "b" : "w";
  fenParts[3] = "-";
  try {
    const swapped = new Chess(fenParts.join(" "));
    const moves = swapped.moves({ square: square as Square, verbose: true });
    const attacked: string[] = [];
    for (const m of moves) {
      if (m.captured) attacked.push(m.captured);
    }
    return attacked;
  } catch {
    return [];
  }
}

// ── Winning-threat enumeration (for double_attack detection) ─────────

interface Threat {
  source: Square;      // piece making the threat
  target: Square;      // piece being threatened
  targetType: string;  // piece type of target
  gain: number;        // SEE value (material won if captured)
}

/**
 * Enumerate all squares where `color` has a profitable capture (SEE > 0).
 * Returns one threat per target square (highest-gain attacker wins ties).
 */
function getWinningThreats(chess: Chess, color: "w" | "b"): Threat[] {
  // Swap turn to `color` so chess.js generates their moves
  const fenParts = chess.fen().split(" ");
  fenParts[1] = color;
  fenParts[3] = "-"; // clear en passant (not meaningful after turn swap)
  let swapped: Chess;
  try {
    swapped = new Chess(fenParts.join(" "));
  } catch {
    return [];
  }

  const captures = swapped.moves({ verbose: true }).filter(m => m.captured);
  const bestByTarget = new Map<string, Threat>();

  for (const m of captures) {
    let gain: number;
    try {
      gain = seeCapture(swapped.fen(), m.from, m.to);
    } catch {
      continue; // chess.js can crash on certain positions during SEE
    }
    if (gain <= 0) continue;

    const existing = bestByTarget.get(m.to);
    if (!existing || gain > existing.gain) {
      bestByTarget.set(m.to, {
        source: m.from as Square,
        target: m.to as Square,
        targetType: m.captured!,
        gain,
      });
    }
  }

  return Array.from(bestByTarget.values());
}

// ── Shared ray/direction helpers ──────────────────────────────────────

/** Get sliding ray directions for a piece type. */
function getDirectionsForPiece(type: string): [number, number][] {
  switch (type) {
    case "r": return [[0,1],[0,-1],[1,0],[-1,0]];
    case "b": return [[1,1],[1,-1],[-1,1],[-1,-1]];
    case "q": return [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
    default: return [];
  }
}

/** Check if a piece type can slide on a given direction. */
function canSlideOnDirection(type: string, df: number, dr: number): boolean {
  const isDiag = df !== 0 && dr !== 0;
  const isStraight = df === 0 || dr === 0;
  return type === "q" || (type === "b" && isDiag) || (type === "r" && isStraight);
}

/** Convert file/rank indices (0-based) to square name. */
function toSquareName(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + (rank + 1);
}

/**
 * Get all squares a given side attacks on the board.
 * Uses geometric ray-based checks to correctly handle all cases.
 * Returns a Set of square names (e.g. "e4").
 */
function getAttackedSquares(chess: Chess, attackerColor: string): Set<string> {
  const board = chess.board();
  const squares = new Set<string>();

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== attackerColor) continue;
      const sq = toSquareName(c, 7 - r);

      // Check every square on the board for attack from this piece
      for (let tr = 0; tr < 8; tr++) {
        for (let tc = 0; tc < 8; tc++) {
          const targetSq = toSquareName(tc, 7 - tr);
          if (targetSq === sq) continue;
          if (doesPieceDefend(chess, sq, targetSq)) {
            squares.add(targetSq);
          }
        }
      }
    }
  }

  return squares;
}

/**
 * Find all pieces of a given color that defend/control a target square.
 * Uses geometric ray-based checks to correctly detect same-color defense
 * (chess.js move generation can't detect this since it won't "capture" own pieces).
 * Returns an array of square names where defenders sit.
 */
function findDefenders(chess: Chess, targetSq: string, defenderColor: string): string[] {
  const board = chess.board();
  const defenders: string[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== defenderColor) continue;
      const sq = toSquareName(c, 7 - r);
      if (sq === targetSq) continue;
      if (doesPieceDefend(chess, sq, targetSq)) {
        defenders.push(sq);
      }
    }
  }

  return defenders;
}

// ── Ray-based defense helpers ─────────────────────────────────────────
// These bypass chess.js move generation to check if a piece geometrically
// controls a square, regardless of what occupies the target.

/** Check if the straight-line path from (ff,fr) to (tf,tr) is blocked. */
function isPathBlocked(chess: Chess, ff: number, fr: number, tf: number, tr: number): boolean {
  const df = Math.sign(tf - ff);
  const dr = Math.sign(tr - fr);
  let f = ff + df;
  let r = fr + dr;
  while (f !== tf || r !== tr) {
    if (chess.get(toSquareName(f, r) as Square)) return true;
    f += df;
    r += dr;
  }
  return false;
}

/** Check if a piece at pieceSq geometrically defends/controls targetSq. */
function doesPieceDefend(chess: Chess, pieceSq: string, targetSq: string): boolean {
  const piece = chess.get(pieceSq as Square);
  if (!piece) return false;
  const pf = pieceSq.charCodeAt(0) - 97;
  const pr = parseInt(pieceSq[1]) - 1;
  const tf = targetSq.charCodeAt(0) - 97;
  const tr = parseInt(targetSq[1]) - 1;
  const df = tf - pf;
  const dr = tr - pr;
  if (df === 0 && dr === 0) return false;

  switch (piece.type) {
    case "p": {
      const fwd = piece.color === "w" ? 1 : -1;
      return dr === fwd && Math.abs(df) === 1;
    }
    case "n":
      return (Math.abs(df) === 2 && Math.abs(dr) === 1) ||
             (Math.abs(df) === 1 && Math.abs(dr) === 2);
    case "k":
      return Math.abs(df) <= 1 && Math.abs(dr) <= 1;
    case "b":
      return Math.abs(df) === Math.abs(dr) && !isPathBlocked(chess, pf, pr, tf, tr);
    case "r":
      return (df === 0 || dr === 0) && !isPathBlocked(chess, pf, pr, tf, tr);
    case "q":
      return (Math.abs(df) === Math.abs(dr) || df === 0 || dr === 0) &&
             !isPathBlocked(chess, pf, pr, tf, tr);
    default:
      return false;
  }
}

/**
 * Detect tactical labels present in the puzzle solution.
 *
 * Uses the starting FEN, best move, PV, and category to identify motifs.
 * Currently detects a core set; more motifs are marked TODO.
 *
 * TODO: Motif detection refinement
 *   - Pin detection (piece alignment along rank/file/diagonal with more valuable piece behind)
 *   - Skewer detection (reverse pin — attack valuable piece, capture behind)
 *   - Double attack (two pieces creating simultaneous threats)
 *   - Removal of defender (best move captures the piece that guards a key square)
 *   - Overload (forcing a piece to defend too many things)
 *   - Deflection (forcing a defender away from its duty)
 *   - Clearance (moving a piece to open a line for another)
 *   - Perpetual check (defensive repeated check sequence)
 *   - Fortress (creating an impregnable structure)
 *   - Stalemate (forcing/allowing stalemate as defense)
 *   - Blockade (blocking a pawn or piece advance)
 *   - Counter-attack (defensive move that creates own threat)
 *
 * TODO: Multi-label confidence scoring
 * TODO: Category-specific training modes
 * TODO: Severity-weighted training plans
 * TODO: Category-specific performance stats
 * TODO: Arena Card integration
 */
export function detectLabels(
  fen: string,
  bestMoveUci: string,
  pvMoves: string[],
  category: PuzzleCategory | null
): PuzzleLabel[] {
  const labels: PuzzleLabel[] = [];

  if (!bestMoveUci) return labels;

  const chess = new Chess(fen);
  const from = bestMoveUci.slice(0, 2) as Square;
  const to = bestMoveUci.slice(2, 4) as Square;
  const movingPiece = chess.get(from);
  const targetPiece = chess.get(to);
  const moverColor = chess.turn(); // "w" or "b"

  if (!movingPiece) return labels;

  const isCapture =
    !!targetPiece ||
    (movingPiece.type === "p" && from[0] !== to[0]); // en passant

  // --- Apply the best move ---
  const afterBest = new Chess(fen);
  const moveResult = applyUci(afterBest, bestMoveUci);
  if (!moveResult) return labels;

  // --- CHECKMATE: Walk PV up to 8 ply looking for forced mate ---
  // Only label "checkmate" when mate is within 4 full moves — not when the
  // engine line eventually ends in mate 20 moves later.
  const pvWalk = new Chess(fen);
  const movesToCheck = pvMoves.length > 0 ? pvMoves : [bestMoveUci];
  const MAX_MATE_PLY = 6;
  let pvEndedInMate = false;
  let mateSquare: string | null = null;

  for (let mi = 0; mi < movesToCheck.length && mi < MAX_MATE_PLY; mi++) {
    const uci = movesToCheck[mi];
    const r = applyUci(pvWalk, uci);
    if (!r) break;
    if (pvWalk.isCheckmate()) {
      pvEndedInMate = true;
      // The piece that delivered checkmate is on `uci.slice(2,4)`
      mateSquare = uci.slice(2, 4);
      break;
    }
  }

  if (pvEndedInMate) {
    labels.push("checkmate");

    // BACK_RANK: Mate delivered on rank 1 or 8
    if (mateSquare && (mateSquare[1] === "1" || mateSquare[1] === "8")) {
      // Check if the mated king is on the back rank
      const mateFen = pvWalk.fen();
      const kingChar = pvWalk.turn() === "w" ? "K" : "k"; // turn = side that's mated
      // Find king position in FEN
      const mateBoardChess = new Chess(mateFen);
      const board = mateBoardChess.board();
      for (const row of board) {
        for (const sq of row) {
          if (sq && sq.type === "k" && sq.color === pvWalk.turn()) {
            // King's rank: extracted from square notation
            // board() returns 8 rows, row 0 = rank 8, row 7 = rank 1
            // But we can just check via the FEN
          }
        }
      }
      // Simpler: check if the checkmated king is on rank 1 or 8
      const kingSide = pvWalk.turn(); // side that's in checkmate
      const kingSquare = findKing(pvWalk, kingSide);
      if (kingSquare && (kingSquare[1] === "1" || kingSquare[1] === "8")) {
        labels.push("back_rank");
      }
    }
  }

  // --- MATE_THREAT: Best move creates an immediate mate threat ---
  // After the best move, if the opponent has very few ways to avoid mate,
  // it's a mate threat. We check if, among opponent responses, the majority
  // lead to mate-in-1.
  if (!pvEndedInMate && afterBest.isCheck()) {
    // Check already — might lead to mate, but not itself a "mate threat"
  }
  if (!pvEndedInMate) {
    // Check if opponent faces mate-in-1 after the best move
    // (i.e., many of their replies allow mate next move)
    const opponentMoves = afterBest.moves({ verbose: true });
    if (opponentMoves.length > 0 && opponentMoves.length <= 5) {
      let matePossible = 0;
      for (const om of opponentMoves) {
        const test = new Chess(afterBest.fen());
        try {
          test.move(om);
          const responses = test.moves({ verbose: true });
          const hasMate = responses.some((r) => {
            const t2 = new Chess(test.fen());
            try { t2.move(r); return t2.isCheckmate(); } catch { return false; }
          });
          if (hasMate) matePossible++;
        } catch { /* skip */ }
      }
      if (matePossible >= opponentMoves.length - 1 && opponentMoves.length > 0) {
        labels.push("mate_threat");
      }
    }
  }

  // --- SACRIFICE: Best move gives up net material ---
  // A sacrifice requires: (1) the moved piece is worth ≥ 3, (2) the opponent
  // actually recaptures it in the PV (if PV available) or can legally recapture,
  // (3) net material loss ≥ 2 points.
  // If the PV shows the opponent does NOT recapture (e.g. Bxf7+ Kd8 — bishop
  // survives because opponent deals with check differently), it's not a sacrifice.
  if (movingPiece.type !== "k") {
    const movedPieceValue = PIECE_VAL[movingPiece.type] || 0;
    if (movedPieceValue >= 3) { // only track minor pieces and above as sacrifices
      const capturedValue = isCapture
        ? PIECE_VAL[targetPiece?.type || "p"] || 1
        : 0;

      // Only consider sacrifice if net material loss is significant
      if (movedPieceValue > capturedValue + 1) {
        // Check PV: does the opponent actually recapture on the target square?
        let opponentRecaptures = false;
        if (pvMoves.length >= 2) {
          const opponentReply = pvMoves[1];
          const replyTo = opponentReply.slice(2, 4);
          opponentRecaptures = replyTo === to;
        } else {
          // No PV — fall back to checking if legal recaptures exist
          const legalRecaptures = afterBest
            .moves({ verbose: true })
            .filter((m) => m.to === to && m.captured);
          opponentRecaptures = legalRecaptures.length > 0;
        }

        if (opponentRecaptures) {
          if (category === "defending") {
            labels.push("defensive_sacrifice");
          } else {
            labels.push("sacrifice");
          }
        }
      }
    }
  }

  // --- FORK: Moved piece attacks 2+ opponent pieces AND wins material ---
  {
    const attacked = getAttackedPieces(afterBest, to);
    const givesCheck = afterBest.isCheck();

    // Count significant attacks: exclude pawns AND king (king is counted via givesCheck)
    const significantAttacks = attacked.filter((t) => t !== "p" && t !== "k").length;
    const totalThreats = significantAttacks + (givesCheck ? 1 : 0);

    if (totalThreats >= 2) {
      // Verify fork wins material by walking PV 2 plies forward
      let forkWinsMaterial = false;
      if (pvMoves.length >= 3) {
        const opponentColor = moverColor === "w" ? "b" : "w";
        const matAtFork = countMaterial(afterBest.fen());
        const balanceAtFork = matAtFork[moverColor] - matAtFork[opponentColor];

        const pvWalkFork = new Chess(afterBest.fen());
        const r1 = applyUci(pvWalkFork, pvMoves[1]); // opponent response
        if (r1) {
          const r2 = applyUci(pvWalkFork, pvMoves[2]); // our follow-up capture
          if (r2) {
            const matAfter = countMaterial(pvWalkFork.fen());
            const balanceAfter = matAfter[moverColor] - matAfter[opponentColor];
            if (balanceAfter - balanceAtFork >= 1) forkWinsMaterial = true;
          }
        }
      }
      if (forkWinsMaterial) labels.push("fork");
    }
  }

  // --- DISCOVERED ATTACK: Moving piece reveals an attack from a piece behind ---
  // Heuristic: if the best move is NOT a check or capture, but after the move
  // there IS a check (from a different piece) or a new attack appears, it's discovered.
  {
    const givesCheck = afterBest.isCheck();
    const bestMoveIsCheck = moveResult.san.includes("+") || moveResult.san.includes("#");

    if (givesCheck) {
      // Check if the checking piece is NOT the moved piece
      // If so, it's a discovered check
      const checkingPiece = findCheckingPiece(afterBest, to);
      if (checkingPiece && checkingPiece !== to) {
        labels.push("discovered_attack");
      }
    }
  }

  // --- INTERMEZZO: In-between move during an expected sequence ---
  // Pattern: instead of recapturing or continuing an exchange, we insert a
  // forcing check first, opponent responds, then we complete the sequence
  // (capture). Requires PV evidence of the check → response → capture pattern.
  if (afterBest.isCheck() && !isCapture && pvMoves.length >= 3) {
    const interWalk = new Chess(fen);
    let interValid = true;
    for (let i = 0; i < 3 && interValid; i++) {
      if (!applyUci(interWalk, pvMoves[i])) interValid = false;
    }
    if (interValid) {
      // Position after our check + opponent response, before our 3rd move
      const preFollow = new Chess(fen);
      applyUci(preFollow, pvMoves[0]);
      applyUci(preFollow, pvMoves[1]);
      const followTo = pvMoves[2].slice(2, 4) as Square;
      const targetOnFollow = preFollow.get(followTo);
      // Our 3rd move must capture an opponent piece (completing the sequence)
      if (targetOnFollow && targetOnFollow.color !== moverColor) {
        labels.push("intermezzo");
      }
    }
  }

  // --- PIN: Detect any pin that the best move creates or exploits ---
  // A pin puzzle isn't always about creating the pin — it can be about:
  //   (a) Creating a new pin with the moved piece
  //   (b) Adding an attacker to an already-pinned piece (exploiting the pin)
  //   (c) Capturing a piece that a pinned piece "defends" (pinned piece can't recapture)
  // Scans ALL our sliding pieces for absolute pins after the move.
  {
    const pinnedColor = moverColor === "w" ? "b" : "w";
    const kingSquare = findKing(afterBest, pinnedColor);

    if (kingSquare) {
      const kFile = kingSquare.charCodeAt(0) - 97;
      const kRank = parseInt(kingSquare[1]) - 1;
      const boardAfter = afterBest.board();

      // Find all absolute pins by our sliding pieces
      const pinnedSquares: string[] = [];

      for (let pr = 0; pr < 8; pr++) {
        for (let pc = 0; pc < 8; pc++) {
          const piece = boardAfter[pr][pc];
          if (!piece || piece.color !== moverColor) continue;
          if (piece.type !== "q" && piece.type !== "r" && piece.type !== "b") continue;

          const pFile = pc;
          const pRank = 7 - pr;
          const dFile = Math.sign(kFile - pFile);
          const dRank = Math.sign(kRank - pRank);

          // Must be on the same line as the king
          const onSameLine =
            (dFile === 0 || dRank === 0 || Math.abs(kFile - pFile) === Math.abs(kRank - pRank)) &&
            !(dFile === 0 && dRank === 0);
          if (!onSameLine) continue;

          // Check if this piece type can attack along this direction
          const isDiagonal = dFile !== 0 && dRank !== 0;
          const isStraight = dFile === 0 || dRank === 0;
          const canPin =
            piece.type === "q" ||
            (piece.type === "b" && isDiagonal) ||
            (piece.type === "r" && isStraight);
          if (!canPin) continue;

          // Walk from our piece toward the king — look for exactly one opponent piece between
          let f = pFile + dFile;
          let r = pRank + dRank;
          let betweenPiece: { type: string; square: string } | null = null;
          let foundPin = false;

          while (f >= 0 && f < 8 && r >= 0 && r < 8) {
            const sq = String.fromCharCode(97 + f) + (r + 1);
            if (sq === kingSquare) {
              if (betweenPiece) foundPin = true;
              break;
            }
            const p = afterBest.get(sq as Square);
            if (p) {
              if (p.color === pinnedColor && !betweenPiece) {
                betweenPiece = { type: p.type, square: sq };
              } else {
                break; // blocked
              }
            }
            f += dFile;
            r += dRank;
          }

          if (foundPin && betweenPiece && (PIECE_VAL[betweenPiece.type] || 0) >= 3) {
            pinnedSquares.push(betweenPiece.square);
          }
        }
      }

      // Label "pin" if the best move interacts with any pin:
      if (pinnedSquares.length > 0) {
        const pinRelevant =
          // (a) Moved piece is the pinner (it created or maintains the pin)
          pinnedSquares.some(() => {
            // Check if the moved piece is doing the pinning (it's a slider on the line)
            const mp = afterBest.get(to as Square);
            return mp && (mp.type === "q" || mp.type === "r" || mp.type === "b");
          }) ||
          // (b) Best move attacks a pinned piece (adding pressure)
          pinnedSquares.some((sq) => doesPieceDefend(afterBest, to, sq)) ||
          // (c) Best move captures on a square that a pinned piece was "defending"
          //     (pinned piece can't recapture because it's absolutely pinned)
          (isCapture && pinnedSquares.some((sq) => {
            // Was the pinned piece geometrically defending the capture target before?
            return doesPieceDefend(chess, sq, to);
          }));

        if (pinRelevant && !labels.includes("pin")) {
          labels.push("pin");
        }
      }
    }
  }

  // --- SKEWER: Best move attacks a valuable piece that must move, exposing
  // a less valuable piece behind it on the same line ---
  {
    // A skewer is like a reverse pin: attack a high-value piece, capture what's behind
    // Check: does our piece on 'to' attack a valuable opponent piece, and is there
    // another opponent piece behind it on the same line?
    const board = afterBest.board();
    const attackerColor = moverColor;
    const victimColor = attackerColor === "w" ? "b" : "w";
    const toFile = to.charCodeAt(0) - 97;
    const toRank = parseInt(to[1]) - 1;

    if (movingPiece && (movingPiece.type === "q" || movingPiece.type === "r" || movingPiece.type === "b")) {
      const directions: [number, number][] =
        movingPiece.type === "r" ? [[0,1],[0,-1],[1,0],[-1,0]] :
        movingPiece.type === "b" ? [[1,1],[1,-1],[-1,1],[-1,-1]] :
        [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]; // queen

      for (const [df, dr] of directions) {
        let f = toFile + df;
        let r = toRank + dr;
        let firstPiece: { type: string; value: number } | null = null;
        let secondPiece: { type: string; value: number } | null = null;

        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const sq = String.fromCharCode(97 + f) + (r + 1);
          const piece = afterBest.get(sq as Square);
          if (piece) {
            if (piece.color === victimColor) {
              const val = PIECE_VAL[piece.type] || 0;
              if (!firstPiece) {
                firstPiece = { type: piece.type, value: val };
              } else if (!secondPiece) {
                secondPiece = { type: piece.type, value: val };
                break;
              }
            } else {
              break; // own piece blocks the line
            }
          }
          f += df;
          r += dr;
        }

        // Skewer: front piece must be king or high-value (rook/queen),
        // and must be more valuable than the piece behind it
        if (firstPiece && secondPiece) {
          const frontIsHighValue = firstPiece.type === "k" || firstPiece.value >= 5;
          if (frontIsHighValue && (firstPiece.type === "k" || firstPiece.value > secondPiece.value)) {
            if (!labels.includes("skewer")) labels.push("skewer");
          }
        }
      }
    }
  }

  // --- REMOVAL OF DEFENDER: Capture a piece that was specifically defending
  // another piece (≥ minor), leaving that piece hanging ---
  // Uses ray-based doesPieceDefend to correctly detect defense of friendly pieces.
  if (isCapture && targetPiece) {
    const opponentColor = moverColor === "w" ? "b" : "w";
    const capturedSquare = to as string;
    const boardAfter = afterBest.board();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = boardAfter[r][c];
        if (!piece || piece.color !== opponentColor || piece.type === "k") continue;
        const sq = toSquareName(c, 7 - r);
        const pieceValue = PIECE_VAL[piece.type] || 0;
        if (pieceValue < 3) continue;

        // Was the captured piece geometrically defending this square?
        if (!doesPieceDefend(chess, capturedSquare, sq)) continue;

        // Is this piece attacked by us after the capture?
        if (!isSquareAttacked(afterBest, sq)) continue;

        // Is this piece now undefended by any remaining opponent piece?
        let defended = false;
        for (let rr = 0; rr < 8 && !defended; rr++) {
          for (let cc = 0; cc < 8 && !defended; cc++) {
            const p = boardAfter[rr][cc];
            if (!p || p.color !== opponentColor) continue;
            const pSq = toSquareName(cc, 7 - rr);
            if (pSq === sq) continue;
            if (doesPieceDefend(afterBest, pSq, sq)) defended = true;
          }
        }
        if (!defended) {
          if (!labels.includes("removal_of_defender")) labels.push("removal_of_defender");
          break;
        }
      }
      if (labels.includes("removal_of_defender")) break;
    }
  }

  // --- SMOTHERED MATE: Checkmate by a knight where the king is
  // surrounded by its own pieces ---
  if (pvEndedInMate) {
    const mateFen = pvWalk.fen();
    const matedColor = pvWalk.turn();
    const matedKingSquare = findKing(pvWalk, matedColor);
    if (matedKingSquare) {
      // Find the piece delivering mate — should be a knight
      const lastMoveUci = movesToCheck[movesToCheck.length - 1];
      if (lastMoveUci) {
        const mateDeliveredTo = lastMoveUci.slice(2, 4) as Square;
        const matingPiece = pvWalk.get(mateDeliveredTo);
        if (matingPiece && matingPiece.type === "n") {
          // Check if king is surrounded by own pieces (all adjacent squares blocked)
          const kf = matedKingSquare.charCodeAt(0) - 97;
          const kr = parseInt(matedKingSquare[1]) - 1;
          let allBlocked = true;
          for (const [df, dr] of [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
            const nf = kf + df;
            const nr = kr + dr;
            if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) continue;
            const sq = String.fromCharCode(97 + nf) + (nr + 1);
            const p = pvWalk.get(sq as Square);
            // Square must be blocked by own piece (not empty, not opponent piece)
            if (!p || p.color !== matedColor) {
              allBlocked = false;
              break;
            }
          }
          if (allBlocked) {
            labels.push("smothered_mate");
          }
        }
      }
    }
  }

  // --- TRAPPED PIECE: Best move attacks a piece that has no safe squares ---
  if (!isCapture && !afterBest.isCheck()) {
    // After best move, check if any opponent piece is trapped (all moves lose material)
    const opponentColor = moverColor === "w" ? "b" : "w";
    const boardAfter = afterBest.board();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = boardAfter[r][c];
        if (piece && piece.color === opponentColor && piece.type !== "k" && piece.type !== "p") {
          const sq = String.fromCharCode(97 + c) + (8 - r);
          const pieceValue = PIECE_VAL[piece.type] || 0;
          if (pieceValue < 3) continue; // only track minor pieces and above

          // Check if this piece is attacked
          if (!isSquareAttacked(afterBest, sq)) continue;

          // Check if it has any safe moves (moves where it doesn't lose material)
          const fenParts = afterBest.fen().split(" ");
          fenParts[1] = opponentColor;
          fenParts[3] = "-";
          try {
            const escaped = new Chess(fenParts.join(" "));
            const pieceMoves = escaped.moves({ square: sq as Square, verbose: true });
            const hasSafeMove = pieceMoves.some((m) => {
              // A "safe" move is one where the piece isn't still en prise
              const testPos = new Chess(escaped.fen());
              try {
                testPos.move(m);
                return !isSquareAttacked(testPos, m.to);
              } catch {
                return false;
              }
            });
            if (!hasSafeMove) {
              if (!labels.includes("trapped_piece")) labels.push("trapped_piece");
            }
          } catch { /* skip */ }
        }
      }
      if (labels.includes("trapped_piece")) break;
    }
  }

  // --- DESPERADO: Doomed piece captures before being taken ---
  // The moved piece was attacked before the move, captures material, and is
  // still en prise after — it's sacrificing itself but taking something down.
  // Only meaningful for minor pieces and above (≥ 3 points).
  if (isCapture && movingPiece.type !== "k" && movingPiece.type !== "p") {
    const movedValue = PIECE_VAL[movingPiece.type] || 0;
    const capturedValue = PIECE_VAL[targetPiece?.type || "p"] || 1;

    if (movedValue >= 3) {
      // Was the piece attacked on its original square BEFORE the move?
      const wasAttacked = isSquareAttacked(chess, from);
      // Is the piece still en prise AFTER the move?
      const stillEnPrise = isSquareAttacked(afterBest, to);

      if (wasAttacked && stillEnPrise && capturedValue > 0) {
        // Piece was doomed (attacked), grabbed material on the way out
        if (!labels.includes("desperado")) labels.push("desperado");
      }
    }
  }

  // --- DOUBLE ATTACK: Move creates winning threats from 2+ different pieces ---
  // A double attack requires 2+ *different source pieces* each creating a new
  // winning threat (SEE > 0). Distinguished from fork (one piece, multiple targets).
  // PV must confirm material gain (opponent can't parry both threats at once).
  {
    const opponentColor = moverColor === "w" ? "b" : "w";

    // 1. Winning threats BEFORE the move (by target square)
    const threatsBefore = getWinningThreats(chess, moverColor);
    const beforeTargets = new Set(threatsBefore.map(t => t.target));

    // 2. Winning threats AFTER the move
    const threatsAfter = getWinningThreats(afterBest, moverColor);

    // 3. If the move gives check, add check as a threat
    if (afterBest.isCheck()) {
      const checkSource = findCheckingPiece(afterBest, to);
      const kingSquare = findKing(afterBest, afterBest.turn());
      if (checkSource && kingSquare) {
        threatsAfter.push({
          source: checkSource as Square,
          target: kingSquare as Square,
          targetType: "k",
          gain: 0, // check is forcing, not a material threat itself
        });
      }
    }

    // 4. Filter to NEW threats only (target square wasn't threatened before)
    const newThreats = threatsAfter.filter(t => !beforeTargets.has(t.target));

    // 5. Must have 2+ new threats from 2+ different source pieces
    const sourceSquares = new Set(newThreats.map(t => t.source));
    if (sourceSquares.size >= 2 && newThreats.length >= 2) {
      // 6. Verify material gain via PV (opponent can't parry both)
      if (pvMoves.length >= 3) {
        const pvCheck = new Chess(afterBest.fen());
        const r1 = applyUci(pvCheck, pvMoves[1]); // opponent reply
        const r2 = r1 ? applyUci(pvCheck, pvMoves[2]) : null; // our capture
        if (r2) {
          const matBefore = countMaterial(afterBest.fen());
          const matAfter = countMaterial(pvCheck.fen());
          const balBefore = matBefore[moverColor] - matBefore[opponentColor];
          const balAfter = matAfter[moverColor] - matAfter[opponentColor];
          if (balAfter - balBefore >= 1) {
            if (!labels.includes("double_attack")) labels.push("double_attack");
          }
        }
      }
    }
  }

  // --- X-RAY: Battery — two friendly sliders aligned on same ray through move ---
  // After the best move, a friendly sliding piece sits behind the moved piece
  // on the same ray, and an opponent target is ahead.
  if (movingPiece.type === "q" || movingPiece.type === "r" || movingPiece.type === "b") {
    const toFile = to.charCodeAt(0) - 97;
    const toRank = parseInt(to[1]) - 1;
    const directions = getDirectionsForPiece(movingPiece.type);

    for (const [df, dr] of directions) {
      // Look behind the moved piece for a friendly slider
      let bf = toFile - df;
      let br = toRank - dr;
      let behindPiece: { type: string; square: string } | null = null;

      while (bf >= 0 && bf < 8 && br >= 0 && br < 8) {
        const sq = toSquareName(bf, br);
        const p = afterBest.get(sq as Square);
        if (p) {
          if (p.color === moverColor && canSlideOnDirection(p.type, df, dr)) {
            behindPiece = { type: p.type, square: sq };
          }
          break; // first piece found (whether friend or foe)
        }
        bf -= df;
        br -= dr;
      }

      if (!behindPiece) continue;

      // Look ahead for an opponent target
      let af = toFile + df;
      let ar = toRank + dr;
      while (af >= 0 && af < 8 && ar >= 0 && ar < 8) {
        const sq = toSquareName(af, ar);
        const p = afterBest.get(sq as Square);
        if (p) {
          if (p.color !== moverColor && ((PIECE_VAL[p.type] || 0) >= 5 || p.type === "k")) {
            // Battery: friendly slider behind, high-value opponent target ahead
            if (!labels.includes("x_ray")) labels.push("x_ray");
          }
          break;
        }
        af += df;
        ar += dr;
      }

      if (labels.includes("x_ray")) break;
    }
  }

  // --- CLEARANCE: Move clears a line for another friendly piece ---
  // The moved piece was blocking a friendly slider's ray to an opponent target.
  // After the move, that slider now has a clear line to the target.
  {
    const fromFile = from.charCodeAt(0) - 97;
    const fromRank = parseInt(from[1]) - 1;
    const allDirs: [number, number][] = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

    for (const [df, dr] of allDirs) {
      // Look behind the from-square for a friendly slider
      let bf = fromFile - df;
      let br = fromRank - dr;
      let slider: { type: string; square: string } | null = null;

      while (bf >= 0 && bf < 8 && br >= 0 && br < 8) {
        const sq = toSquareName(bf, br);
        const p = chess.get(sq as Square); // position BEFORE the move
        if (p) {
          if (p.color === moverColor && canSlideOnDirection(p.type, df, dr)) {
            slider = { type: p.type, square: sq };
          }
          break;
        }
        bf -= df;
        br -= dr;
      }

      if (!slider) continue;

      // Look ahead (in original position) — the from square was blocking.
      // After the move, check if there's now a clear path to an opponent target.
      let af = fromFile + df;
      let ar = fromRank + dr;
      let foundTarget = false;
      while (af >= 0 && af < 8 && ar >= 0 && ar < 8) {
        const sq = toSquareName(af, ar);
        const p = afterBest.get(sq as Square); // position AFTER the move
        if (p) {
          if (p.color !== moverColor && ((PIECE_VAL[p.type] || 0) >= 5 || p.type === "k")) {
            foundTarget = true;
          }
          break;
        }
        af += df;
        ar += dr;
      }

      if (foundTarget) {
        // Verify the slider couldn't reach this target before (from-square was blocking)
        if (!labels.includes("clearance")) labels.push("clearance");
        break;
      }
    }
  }

  // --- OVERLOAD: Opponent piece is sole defender of 2+ attacked targets ---
  // After the best move, find opponent pieces attacked by us. If two or more
  // share the same sole defender, that defender is overloaded.
  {
    const opponentColor = moverColor === "w" ? "b" : "w";
    const boardAfter = afterBest.board();
    const ourAttacks = getAttackedSquares(afterBest, moverColor);

    // Collect attacked opponent pieces and their defenders
    const attackedWithDefenders: { sq: string; defenders: string[] }[] = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = boardAfter[r][c];
        if (!piece || piece.color !== opponentColor || piece.type === "k") continue;
        const sq = toSquareName(c, 7 - r);
        if (!ourAttacks.has(sq)) continue; // not attacked by us

        const defenders = findDefenders(afterBest, sq, opponentColor);
        attackedWithDefenders.push({ sq, defenders });
      }
    }

    // Check if any single defender is sole protector of 2+ attacked pieces
    const defenderLoad: Record<string, number> = {};
    for (const item of attackedWithDefenders) {
      if (item.defenders.length === 1) {
        const d = item.defenders[0];
        defenderLoad[d] = (defenderLoad[d] || 0) + 1;
      }
    }

    for (const count of Object.values(defenderLoad)) {
      if (count >= 2) {
        if (!labels.includes("overload")) labels.push("overload");
        break;
      }
    }
  }

  // --- INTERFERENCE: Place piece between two connected opponent pieces ---
  // After the move, the moved piece sits on a ray between two opponent pieces,
  // severing a defensive connection.
  {
    const opponentColor = moverColor === "w" ? "b" : "w";
    const toFile = to.charCodeAt(0) - 97;
    const toRank = parseInt(to[1]) - 1;
    const allDirs: [number, number][] = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

    for (const [df, dr] of allDirs) {
      // Look in one direction for an opponent piece
      let f1 = toFile + df;
      let r1 = toRank + dr;
      let piece1: { type: string; square: string } | null = null;

      while (f1 >= 0 && f1 < 8 && r1 >= 0 && r1 < 8) {
        const sq = toSquareName(f1, r1);
        const p = afterBest.get(sq as Square);
        if (p) {
          if (p.color === opponentColor) {
            piece1 = { type: p.type, square: sq };
          }
          break;
        }
        f1 += df;
        r1 += dr;
      }

      if (!piece1) continue;

      // Look in the opposite direction for another opponent piece
      let f2 = toFile - df;
      let r2 = toRank - dr;
      let piece2: { type: string; square: string } | null = null;

      while (f2 >= 0 && f2 < 8 && r2 >= 0 && r2 < 8) {
        const sq = toSquareName(f2, r2);
        const p = afterBest.get(sq as Square);
        if (p) {
          if (p.color === opponentColor) {
            piece2 = { type: p.type, square: sq };
          }
          break;
        }
        f2 -= df;
        r2 -= dr;
      }

      if (!piece2) continue;

      // Check if one was defending the other BEFORE the move
      // (i.e., they were connected on this ray before we placed our piece)
      const defendersBefore1 = findDefenders(chess, piece1.square, opponentColor);
      const defendersBefore2 = findDefenders(chess, piece2.square, opponentColor);

      const wasConnected =
        defendersBefore1.includes(piece2.square) ||
        defendersBefore2.includes(piece1.square);

      if (wasConnected) {
        // Verify the connection is now severed
        const defendersAfter1 = findDefenders(afterBest, piece1.square, opponentColor);
        const defendersAfter2 = findDefenders(afterBest, piece2.square, opponentColor);

        const nowSevered =
          (!defendersAfter1.includes(piece2.square) && defendersBefore1.includes(piece2.square)) ||
          (!defendersAfter2.includes(piece1.square) && defendersBefore2.includes(piece1.square));

        if (nowSevered) {
          if (!labels.includes("interference")) labels.push("interference");
          break;
        }
      }
    }
  }

  // --- DEFLECTION: Force defender away from its duty (requires PV) ---
  // Our FORCING move (check/capture) compels a defender to abandon its post,
  // and our follow-up captures the now-undefended target.
  if (pvMoves.length >= 3 && (afterBest.isCheck() || isCapture)) {
    const pvMove1 = pvMoves[0];
    const pvMove2 = pvMoves[1]; // opponent's forced response
    const pvMove3 = pvMoves[2]; // our follow-up capture

    if (pvMove2 && pvMove3) {
      const defenderFrom = pvMove2.slice(0, 2);
      const captureTarget = pvMove3.slice(2, 4);
      const opponentColor = moverColor === "w" ? "b" : "w";

      const afterOurMove = new Chess(fen);
      const r1 = applyUci(afterOurMove, pvMove1);
      if (r1) {
        // Was the piece that moves in pvMove2 defending the capture target?
        if (doesPieceDefend(afterOurMove, defenderFrom, captureTarget)) {
          const afterDeflect = new Chess(afterOurMove.fen());
          const r2 = applyUci(afterDeflect, pvMove2);
          if (r2) {
            const targetPieceNow = afterDeflect.get(captureTarget as Square);
            if (targetPieceNow && targetPieceNow.color === opponentColor &&
                (PIECE_VAL[targetPieceNow.type] || 0) >= 3) {
              // Check if any remaining opponent piece still defends the target
              let stillDefended = false;
              const boardD = afterDeflect.board();
              for (let rr = 0; rr < 8 && !stillDefended; rr++) {
                for (let cc = 0; cc < 8 && !stillDefended; cc++) {
                  const p = boardD[rr][cc];
                  if (!p || p.color !== opponentColor) continue;
                  const pSq = toSquareName(cc, 7 - rr);
                  if (pSq === captureTarget) continue;
                  if (doesPieceDefend(afterDeflect, pSq, captureTarget)) {
                    stillDefended = true;
                  }
                }
              }
              if (!stillDefended) {
                if (!labels.includes("deflection")) labels.push("deflection");
              }
            }
          }
        }
      }
    }
  }

  // --- ATTRACTION: Force piece (esp. king) to a vulnerable square (requires PV) ---
  // Best move is forcing (check/capture), opponent is drawn to a bad square,
  // and the next move exploits the new position.
  if (pvMoves.length >= 3) {
    const pvMove1 = pvMoves[0]; // our forcing move
    const pvMove2 = pvMoves[1]; // opponent's forced reply (attracted to square)
    const pvMove3 = pvMoves[2]; // our exploitation

    if (pvMove2 && pvMove3) {
      // Our move must be forcing: check or capture
      const isForcingCheck = afterBest.isCheck();
      const isForcingCapture = isCapture;

      if (isForcingCheck || isForcingCapture) {
        const attractedTo = pvMove2.slice(2, 4); // square the opponent piece moves to
        const attractedFrom = pvMove2.slice(0, 2);
        const exploitTarget = pvMove3.slice(2, 4); // what we exploit

        // Apply PV to position after opponent responds
        const afterResponse = new Chess(afterBest.fen());
        const r2 = applyUci(afterResponse, pvMove2);
        if (r2) {
          // The attracted piece is now on a worse square — verify by checking
          // if our follow-up attacks it or exploits its new position
          const opponentColor = moverColor === "w" ? "b" : "w";

          // Check if the attracted piece is the king (classic attraction)
          const attractedPiece = afterResponse.get(attractedTo as Square);
          const isKingAttraction = attractedPiece?.type === "k";

          // Apply our exploitation move
          const afterExploit = new Chess(afterResponse.fen());
          const r3 = applyUci(afterExploit, pvMove3);
          if (r3) {
            // Exploitation: check, checkmate, or capture near the attracted piece
            const exploitIsCheck = afterExploit.isCheck();
            const exploitIsMate = afterExploit.isCheckmate();
            const exploitIsCapture = !!afterResponse.get(exploitTarget as Square);

            if (exploitIsMate || exploitIsCheck || exploitIsCapture) {
              if (isKingAttraction) {
                // King attraction: any forcing follow-up (check, mate, capture) qualifies
                if (!labels.includes("attraction")) labels.push("attraction");
              } else if (exploitIsMate) {
                if (!labels.includes("attraction")) labels.push("attraction");
              } else if (exploitIsCapture) {
                const capturedTarget = afterResponse.get(exploitTarget as Square);
                if (capturedTarget && (PIECE_VAL[capturedTarget.type] || 0) >= 3) {
                  if (!labels.includes("attraction")) labels.push("attraction");
                }
              }
            }
          }
        }
      }
    }
  }

  return labels;
}

/** Find the king's square for a given color. */
function findKing(chess: Chess, color: string): string | null {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (sq && sq.type === "k" && sq.color === color) {
        const file = String.fromCharCode(97 + c);
        const rank = String(8 - r);
        return file + rank;
      }
    }
  }
  return null;
}

/**
 * Find which piece is giving check (if not the moved piece).
 * Returns the square of the checking piece, or null.
 */
function findCheckingPiece(chess: Chess, movedToSquare: string): string | null {
  // The side in check is the current turn (opponent after our move)
  const checkedColor = chess.turn();
  const kingSquare = findKing(chess, checkedColor);
  if (!kingSquare) return null;

  // Look for pieces of the OTHER color that attack the king
  const attackerColor = checkedColor === "w" ? "b" : "w";

  // Swap turn to generate "moves" for the attacking side
  const fenParts = chess.fen().split(" ");
  fenParts[1] = attackerColor;
  fenParts[3] = "-";
  try {
    const swapped = new Chess(fenParts.join(" "));
    const moves = swapped.moves({ verbose: true });
    for (const m of moves) {
      if (m.to === kingSquare) {
        return m.from; // This piece attacks the king
      }
    }
  } catch {
    // Fall through
  }
  return null;
}

// ============================================================
// COMBINED CLASSIFICATION
// ============================================================

export interface PuzzleClassification {
  category: PuzzleCategory | null;
  severity: PuzzleSeverity;
  labels: PuzzleLabel[];
}

/**
 * Classify a puzzle across all three axes.
 *
 * Accepts a ClassificationContext with full game context (previous evals)
 * for enriched category detection.
 *
 * Note on evalAfterBest:
 *   evalBeforeCp serves as evalAfterBest because the engine's position eval
 *   already assumes optimal play. Storing it separately would be redundant.
 */
export function classifyPuzzle(ctx: ClassificationContext): PuzzleClassification {
  const cpLoss =
    ctx.evalBeforeCp != null && ctx.evalAfterCp != null
      ? Math.abs(ctx.evalAfterCp - ctx.evalBeforeCp)
      : 0;

  const category = classifyCategory(ctx);
  const severity = classifySeverity(ctx.evalBeforeCp, ctx.sideToMove, cpLoss);
  const labels = detectLabels(ctx.fen, ctx.bestMoveUci, ctx.pvMoves, category);

  return { category, severity, labels };
}
