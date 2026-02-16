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
  | "defending"
  | "attacking"
  | "tactics"
  | "positional";

const CAT_POSITIONAL_CPLOSS = 300;    // cpLoss ≥ this in equal zone → positional

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
function detectNullMoveThreats(fen: string, sideToMove: Side): ThreatInfo {
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
function isDefendingPosition(ctx: ClassificationContext): boolean {
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
// A position is "attacking" when TWO criteria are met:
//   1. The best move executes or creates a threat against the opponent.
//      EXECUTES: the best move wins material (SEE ≥ 1) or delivers check/mate.
//      CREATES:  after the best move, the opponent faces material loss or mate
//                if they do nothing (null-move test on the resulting position).
//   2. Pressing — the eval is ≥ PRESSING_THRESHOLD. The player has the
//      initiative and is on the winning side, not just finding a tactic
//      from an equal position.
const PRESSING_THRESHOLD = 50;  // userEval ≥ this → pressing advantage

/**
 * Detect whether a position is an attacking situation.
 *
 * Two criteria must BOTH be met:
 *
 * 1. THREAT FROM PLAYER — the best move executes or creates a concrete
 *    threat against the opponent:
 *    a) EXECUTES: best move captures and wins material (SEE ≥ 1), or
 *       delivers check or checkmate.
 *    b) CREATES: after the best move, the opponent faces material loss
 *       or checkmate if they do nothing (null-move from their side).
 *
 * 2. PRESSING — userEval ≥ 50. The player has the initiative. This isn't
 *    a tactic from an equal position — the player is on the winning side
 *    and the best move keeps the pressure on.
 *
 * Mirror of defending:
 *   Defending:  threat AGAINST player (before move) + survival (eval ≤ 50)
 *   Attacking:  threat FROM player (best move)      + pressing (eval ≥ 50)
 */
function isAttackingPosition(ctx: ClassificationContext): boolean {
  const userEval = toUserEval(ctx.evalBeforeCp, ctx.sideToMove);
  if (userEval == null) return false;

  // Criterion 2 (fast pre-check): must be pressing advantage
  if (userEval < PRESSING_THRESHOLD) return false;

  // Criterion 1: best move executes or creates a threat
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

/**
 * Classify a puzzle into exactly one category.
 *
 * Decision tree (evaluated top-to-bottom, first match wins):
 *
 * 1. isDefendingPosition()  → DEFENDING
 *    Concrete threat against player (null-move + SEE) + survival (eval ≤ 50).
 *
 * 2. isAttackingPosition()  → ATTACKING
 *    Best move executes/creates threat + pressing advantage (eval ≥ 50).
 *
 * 3. cpLoss ≥ 300     → POSITIONAL
 *    "The position was balanced but fragile. Only one move held."
 *
 * 4. Otherwise        → TACTICS
 *    "The position was balanced. Could you seize the initiative?"
 */
export function classifyCategory(ctx: ClassificationContext): PuzzleCategory | null {
  if (ctx.evalBeforeCp == null) return null;

  if (isDefendingPosition(ctx)) return "defending";
  if (isAttackingPosition(ctx)) return "attacking";

  const cpLoss =
    ctx.evalBeforeCp != null && ctx.evalAfterCp != null
      ? Math.abs(ctx.evalAfterCp - ctx.evalBeforeCp)
      : 0;

  if (cpLoss >= CAT_POSITIONAL_CPLOSS) return "positional";
  return "tactics";
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
 * Works by swapping the turn and checking if any opponent move captures on that square.
 */
function isSquareAttacked(chess: Chess, square: string): boolean {
  const fenParts = chess.fen().split(" ");
  fenParts[1] = fenParts[1] === "w" ? "b" : "w";
  fenParts[3] = "-"; // clear en passant
  try {
    const swapped = new Chess(fenParts.join(" "));
    const moves = swapped.moves({ verbose: true });
    return moves.some((m) => m.to === square);
  } catch {
    return false;
  }
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

  // --- CHECKMATE: Walk the full PV and check for mate ---
  const pvWalk = new Chess(fen);
  const movesToCheck = pvMoves.length > 0 ? pvMoves : [bestMoveUci];
  let pvEndedInMate = false;
  let mateSquare: string | null = null;

  for (const uci of movesToCheck) {
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

  // --- SACRIFICE: Best move gives up material ---
  // Conditions:
  //   a) The moved piece is now en prise (opponent can capture it), AND
  //   b) Either no piece was captured, or captured piece is worth less
  if (movingPiece.type !== "k") {
    const movedPieceValue = PIECE_VAL[movingPiece.type] || 0;
    const capturedValue = isCapture
      ? PIECE_VAL[targetPiece?.type || "p"] || 1
      : 0;

    // Check if the piece is attacked on its new square
    const enPrise = isSquareAttacked(afterBest, to);

    if (enPrise && movedPieceValue > capturedValue) {
      // Piece can be taken and we didn't win material from the capture
      if (category === "defending") {
        labels.push("defensive_sacrifice");
      } else {
        labels.push("sacrifice");
      }
    }
  }

  // --- FORK: Moved piece attacks 2+ opponent pieces (including king via check) ---
  {
    const attacked = getAttackedPieces(afterBest, to);
    const givesCheck = afterBest.isCheck();

    // Count significant attacks (non-pawn pieces + king if in check)
    const significantAttacks = attacked.filter((t) => t !== "p").length;
    const totalThreats = significantAttacks + (givesCheck ? 1 : 0);

    if (totalThreats >= 2) {
      labels.push("fork");
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
  // Heuristic: If the best move is a check or strong threat while there's
  // an obvious recapture available, it's an intermezzo.
  // Pattern: opponent just captured, best move is NOT recapturing but instead checks.
  if (afterBest.isCheck() && !isCapture) {
    // Not a recapture, gives check — likely an intermezzo
    labels.push("intermezzo");
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
