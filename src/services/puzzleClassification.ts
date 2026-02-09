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
  | "resilience"
  | "advantage_capitalisation"
  | "opportunity_creation"
  | "precision_only_move";

// Centipawn thresholds from the user's perspective.
// Tunable — change these to shift category boundaries.
const CAT_RESILIENCE_THRESHOLD = -150; // userEval ≤ this → resilience
const CAT_ADVANTAGE_THRESHOLD = 150;   // userEval ≥ this → advantage capitalisation

// When the position is near-equal (-150 < userEval < +150),
// we distinguish precision_only_move from opportunity_creation
// by how catastrophic the miss was.
const CAT_PRECISION_CPLOSS = 300; // cpLoss ≥ this in equal zone → precision_only_move

/**
 * Classify a puzzle into exactly one category.
 *
 * Decision tree (evaluated top-to-bottom, first match wins):
 *
 * 1. userEval ≤ -150  → RESILIENCE
 *    "You were worse. Could you find the defensive resource?"
 *
 * 2. userEval ≥ +150  → ADVANTAGE_CAPITALISATION
 *    "You were better. Could you convert the advantage?"
 *
 * 3. cpLoss ≥ 300     → PRECISION_ONLY_MOVE
 *    "The position was balanced but fragile. Only one move held."
 *
 * 4. Otherwise        → OPPORTUNITY_CREATION
 *    "The position was balanced. Could you seize the initiative?"
 */
export function classifyCategory(
  evalBeforeCp: number | null,
  sideToMove: Side,
  cpLoss: number
): PuzzleCategory | null {
  if (evalBeforeCp == null) return null;

  const userEval = sideToMove === "WHITE" ? evalBeforeCp : -evalBeforeCp;

  if (userEval <= CAT_RESILIENCE_THRESHOLD) return "resilience";
  if (userEval >= CAT_ADVANTAGE_THRESHOLD) return "advantage_capitalisation";
  if (cpLoss >= CAT_PRECISION_CPLOSS) return "precision_only_move";
  return "opportunity_creation";
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
      if (category === "resilience") {
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
 * @param evalBeforeCp - Position eval from white's perspective before the mistake
 * @param evalAfterCp  - Position eval from white's perspective after the mistake (= evalAfterPlayed)
 * @param sideToMove   - Which side the user plays in this puzzle
 * @param fen          - Starting position FEN
 * @param bestMoveUci  - The best move (what the user should have played)
 * @param pvMoves      - Principal variation moves (UCI strings)
 *
 * Note on evalAfterBest:
 *   evalBeforeCp serves as evalAfterBest because the engine's position eval
 *   already assumes optimal play. Storing it separately would be redundant.
 */
export function classifyPuzzle(
  evalBeforeCp: number | null,
  evalAfterCp: number | null,
  sideToMove: Side,
  fen: string,
  bestMoveUci: string,
  pvMoves: string[]
): PuzzleClassification {
  // Compute cpLoss (always positive — how much the mistake cost)
  // deltaCp = evalAfterCp - evalBeforeCp
  // For WHITE mistakes: deltaCp is negative → cpLoss = |deltaCp|
  // For BLACK mistakes: deltaCp is positive → cpLoss = |deltaCp|
  const cpLoss =
    evalBeforeCp != null && evalAfterCp != null
      ? Math.abs(evalAfterCp - evalBeforeCp)
      : 0;

  const category = classifyCategory(evalBeforeCp, sideToMove, cpLoss);
  const severity = classifySeverity(evalBeforeCp, sideToMove, cpLoss);
  const labels = detectLabels(fen, bestMoveUci, pvMoves, category);

  return { category, severity, labels };
}
