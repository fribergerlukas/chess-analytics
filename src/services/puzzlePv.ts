import { Chess, Square } from "chess.js";

const MAX_PLIES = 12;
const MATE_EVAL_THRESHOLD = 9000; // cp
const FORCED_LEGAL_MOVE_THRESHOLD = 5;

/**
 * Apply a UCI move string (e.g. "e2e4", "e7e8q") to a chess.js instance.
 * Returns true if the move was legal.
 */
function applyUciMove(chess: Chess, uci: string): boolean {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length > 4 ? uci[4] : undefined;

  try {
    const result = chess.move({
      from,
      to,
      ...(promotion ? { promotion: promotion as "q" | "r" | "b" | "n" } : {}),
    });
    return result !== null;
  } catch {
    return false;
  }
}

/**
 * Check if the side that just moved has a mate-in-1 threat.
 * Works by swapping the turn in the FEN and checking if any move is checkmate.
 */
function hasMateThreat(chess: Chess): boolean {
  const fenParts = chess.fen().split(" ");
  // Swap turn to check what the mover could do if they moved again
  fenParts[1] = fenParts[1] === "w" ? "b" : "w";
  try {
    const threatPos = new Chess(fenParts.join(" "));
    const moves = threatPos.moves({ verbose: true });
    for (const m of moves) {
      try {
        const copy = new Chess(threatPos.fen());
        copy.move(m);
        if (copy.isCheckmate()) return true;
      } catch {
        continue;
      }
    }
  } catch {
    // Invalid FEN after swap — skip
  }
  return false;
}

/**
 * Check if a UCI move is a capture on the given position.
 */
function isCapture(chess: Chess, uci: string): boolean {
  const to = uci.slice(2, 4) as Square;
  const target = chess.get(to);

  // Normal capture
  if (target) return true;

  // En-passant: pawn moves diagonally to empty square
  const from = uci.slice(0, 2) as Square;
  const piece = chess.get(from);
  if (piece?.type === "p" && from[0] !== to[0] && !target) return true;

  return false;
}

export interface PvAnalysis {
  pvMoves: string[];
  requiredMoves: number;
}

/**
 * Analyze a PV string and determine the forced tactical sequence length.
 *
 * Produces Lichess-style puzzles: the sequence continues only while the
 * opponent's replies are "forced" — meaning they must respond to a specific
 * tactical threat with very limited alternatives.
 *
 * Forcing conditions for opponent moves:
 * - In check: must deal with the check
 * - Recapture: user captured a piece, opponent recaptures on the same square
 * - Few legal moves: opponent has ≤ 5 legal moves total
 * - Mate threat: user threatens checkmate if they could move again
 * - Mate sequence: eval indicates forced mate (always extends)
 *
 * Rules:
 * - Sequence ends on a user move (odd number of plies)
 * - Minimum 3 plies (2 user moves + 1 opponent) for multi-move
 * - Otherwise falls back to single-move puzzle
 */
export function analyzePv(
  fen: string,
  pvString: string,
  evalBeforeCp: number | null
): PvAnalysis {
  if (!pvString || !pvString.trim()) {
    return { pvMoves: [], requiredMoves: 1 };
  }

  const allMoves = pvString.trim().split(/\s+/);

  if (allMoves.length < 1) {
    return { pvMoves: [], requiredMoves: 1 };
  }

  const isMateSequence =
    evalBeforeCp != null && Math.abs(evalBeforeCp) >= MATE_EVAL_THRESHOLD;

  const chess = new Chess(fen);

  // endIndex tracks the last user move index to include in the puzzle
  let endIndex = 0;
  let lastMoveWasCapture = false;
  let lastCaptureSquare: string | null = null;

  for (let i = 0; i < allMoves.length && i < MAX_PLIES; i++) {
    const uci = allMoves[i];
    const isOpponentMove = i % 2 === 1;

    if (isOpponentMove) {
      // Before applying opponent's move, check if their response is forced.
      // At this point the user's move has been applied and it's opponent's turn.
      const inCheck = chess.isCheck();
      const legalMoveCount = chess.moves().length;

      // Recapture: user captured on a square, opponent captures back on same square
      const opponentTargetSquare = uci.slice(2, 4);
      const isRecapture =
        lastMoveWasCapture &&
        isCapture(chess, uci) &&
        opponentTargetSquare === lastCaptureSquare;

      // Mate threat: user threatens checkmate if they could move again
      const mateThreat = hasMateThreat(chess);

      const forced =
        isMateSequence ||
        inCheck ||
        legalMoveCount <= FORCED_LEGAL_MOVE_THRESHOLD ||
        isRecapture ||
        mateThreat;

      if (!forced) break; // Opponent has free choice — stop extending
    }

    const captureHere = isCapture(chess, uci);
    const legal = applyUciMove(chess, uci);
    if (!legal) break;

    lastMoveWasCapture = captureHere;
    lastCaptureSquare = captureHere ? uci.slice(2, 4) : null;

    if (chess.isCheckmate()) {
      endIndex = i;
      break;
    }

    // Update endIndex on user moves only
    if (i % 2 === 0) {
      endIndex = i;
    }
  }

  // Build the PV moves array ending on the last user move
  let pvMoves = allMoves.slice(0, endIndex + 1);

  // Ensure we end on a user move (odd number of plies)
  if (pvMoves.length > 1 && pvMoves.length % 2 === 0) {
    pvMoves = pvMoves.slice(0, pvMoves.length - 1);
  }

  // Need at least 3 plies for multi-move (2 user moves + 1 opponent response)
  if (pvMoves.length < 3) {
    return { pvMoves: allMoves.slice(0, 1), requiredMoves: 1 };
  }

  const requiredMoves = Math.ceil(pvMoves.length / 2);

  return { pvMoves, requiredMoves };
}
