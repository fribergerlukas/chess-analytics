import { Side } from "@prisma/client";

// ── Types ──────────────────────────────────────────────────────────────

export type Tier = "bronze" | "silver" | "gold" | "platinum";

export type CategoryName =
  | "attacking"
  | "defending"
  | "tactics"
  | "positional"
  | "opening"
  | "calculation";

interface CategoryResult {
  stat: number;
  percentage: number;
  successRate: number;
}

export interface ArenaStatsResponse {
  arenaRating: number;
  tier: Tier;
  shiny: boolean;
  categories: Record<CategoryName, CategoryResult>;
  form: number;
  backStats: {
    accuracyOverall: number | null;
    accuracyWhite: number | null;
    accuracyBlack: number | null;
    blunderRate: number;
    missedWinRate: number;
    missedSaveRate: number;
  };
  gamesAnalyzed: number;
}

interface PositionRow {
  gameId: number;
  ply: number;
  fen: string;
  moveUci: string;
  san: string;
  sideToMove: Side;
  eval: number | null;
  cpLoss: number | null;
  classification: string | null;
  bestMoveUci: string | null;
  pv: string | null;
}

interface GameRow {
  id: number;
  result: string;
  accuracyWhite: number | null;
  accuracyBlack: number | null;
  endDate: Date;
}

// ── Percentile Curve ──────────────────────────────────────────────────
// Single curve for all time controls, based on chess.com distribution.
// Linear interpolation between anchor points.

type CurvePoint = { rating: number; arena: number };

const RATING_CURVE: CurvePoint[] = [
  { rating: 500,  arena: 38 },
  { rating: 599,  arena: 39 },
  { rating: 600,  arena: 40 },
  { rating: 620,  arena: 42 },
  { rating: 640,  arena: 44 },
  { rating: 660,  arena: 46 },
  { rating: 680,  arena: 48 },
  { rating: 700,  arena: 50 },
  { rating: 725,  arena: 51 },
  { rating: 750,  arena: 52 },
  { rating: 765,  arena: 53 },
  { rating: 780,  arena: 54 },
  { rating: 800,  arena: 55 },
  { rating: 820,  arena: 56 },
  { rating: 845,  arena: 57 },
  { rating: 885,  arena: 58 },
  { rating: 900,  arena: 59 },
  { rating: 1000, arena: 60 },
  { rating: 1300, arena: 64 },
  { rating: 1600, arena: 71 },
  { rating: 2000, arena: 80 },
  { rating: 2300, arena: 84 },
  { rating: 2600, arena: 87 },
  { rating: 3000, arena: 90 },
  { rating: 3200, arena: 95 },
  { rating: 3400, arena: 98 },
  { rating: 3500, arena: 99 },
];

// Tier bounds — derived from arena rating
const TIER_BOUNDS: { tier: Tier; min: number; max: number }[] = [
  { tier: "bronze",   min: 38, max: 64 },
  { tier: "silver",   min: 65, max: 79 },
  { tier: "gold",     min: 80, max: 89 },
  { tier: "platinum", min: 90, max: 99 },
];

// Shiny thresholds — arena rating at which each tier becomes shiny
const SHINY_THRESHOLDS: Record<Tier, number> = {
  bronze: 60,    // ~chess 1000
  silver: 75,    // ~chess 1800
  gold: 85,      // ~chess 2300
  platinum: 90,  // always shiny
};

const CATEGORY_NAMES: CategoryName[] = [
  "attacking",
  "defending",
  "tactics",
  "positional",
  "opening",
  "calculation",
];

const SCALE_FACTOR = 20;
const CONFIDENCE_THRESHOLD = 0.10; // full confidence at 10%+ of positions

// ── Expected missed save rates by rating (broadened definition) ──────
// Missed save = losing (eval <= -150) AND cpLoss >= 100
type RatePoint = { rating: number; rate: number };

const EXPECTED_MISSED_SAVE_CURVE: RatePoint[] = [
  { rating: 0,    rate: 12 },
  { rating: 600,  rate: 10 },
  { rating: 800,  rate: 8 },
  { rating: 1000, rate: 6.5 },
  { rating: 1100, rate: 5.5 },
  { rating: 1200, rate: 5.0 },
  { rating: 1300, rate: 4.5 },
  { rating: 1400, rate: 4.0 },
  { rating: 1500, rate: 3.5 },
  { rating: 1600, rate: 3.0 },
  { rating: 1700, rate: 2.6 },
  { rating: 1800, rate: 2.3 },
  { rating: 1900, rate: 2.0 },
  { rating: 2000, rate: 1.7 },
  { rating: 2100, rate: 1.5 },
  { rating: 2200, rate: 1.3 },
  { rating: 2300, rate: 1.1 },
  { rating: 2400, rate: 0.9 },
  { rating: 2500, rate: 0.8 },
  { rating: 3000, rate: 0.5 },
  { rating: 3500, rate: 0.3 },
];

// Expected calculation failure rates by rating (% of calculation positions with cpLoss >= 150)
const EXPECTED_CALC_FAIL_CURVE: RatePoint[] = [
  { rating: 0,    rate: 45 },
  { rating: 600,  rate: 40 },
  { rating: 800,  rate: 35 },
  { rating: 1000, rate: 30 },
  { rating: 1100, rate: 27 },
  { rating: 1200, rate: 24 },
  { rating: 1300, rate: 21 },
  { rating: 1400, rate: 19 },
  { rating: 1500, rate: 17 },
  { rating: 1600, rate: 15 },
  { rating: 1700, rate: 13 },
  { rating: 1800, rate: 11 },
  { rating: 1900, rate: 9.5 },
  { rating: 2000, rate: 8 },
  { rating: 2100, rate: 7 },
  { rating: 2200, rate: 6 },
  { rating: 2300, rate: 5 },
  { rating: 2400, rate: 4 },
  { rating: 2500, rate: 3.5 },
  { rating: 3000, rate: 2 },
  { rating: 3500, rate: 1 },
];

// Expected average post-opening eval loss by rating (centipawns behind after 15 moves)
// Lower-rated players typically emerge from the opening with worse positions
const EXPECTED_OPENING_EVAL_CURVE: RatePoint[] = [
  { rating: 0,    rate: -120 },
  { rating: 600,  rate: -100 },
  { rating: 800,  rate: -80 },
  { rating: 1000, rate: -60 },
  { rating: 1100, rate: -50 },
  { rating: 1200, rate: -42 },
  { rating: 1300, rate: -35 },
  { rating: 1400, rate: -28 },
  { rating: 1500, rate: -22 },
  { rating: 1600, rate: -18 },
  { rating: 1700, rate: -14 },
  { rating: 1800, rate: -10 },
  { rating: 1900, rate: -7 },
  { rating: 2000, rate: -5 },
  { rating: 2100, rate: -3 },
  { rating: 2200, rate: -2 },
  { rating: 2300, rate: 0 },
  { rating: 2400, rate: 2 },
  { rating: 2500, rate: 5 },
  { rating: 3000, rate: 10 },
  { rating: 3500, rate: 15 },
];

// Expected missed win rates by rating
// Missed win = winning (eval >= 150) AND cpLoss >= 100
const EXPECTED_MISSED_WIN_CURVE: RatePoint[] = [
  { rating: 0,    rate: 11 },
  { rating: 600,  rate: 9 },
  { rating: 800,  rate: 7.5 },
  { rating: 1000, rate: 6.0 },
  { rating: 1100, rate: 5.2 },
  { rating: 1200, rate: 4.5 },
  { rating: 1300, rate: 4.0 },
  { rating: 1400, rate: 3.5 },
  { rating: 1500, rate: 3.0 },
  { rating: 1600, rate: 2.6 },
  { rating: 1700, rate: 2.2 },
  { rating: 1800, rate: 1.9 },
  { rating: 1900, rate: 1.6 },
  { rating: 2000, rate: 1.4 },
  { rating: 2100, rate: 1.2 },
  { rating: 2200, rate: 1.0 },
  { rating: 2300, rate: 0.8 },
  { rating: 2400, rate: 0.7 },
  { rating: 2500, rate: 0.6 },
  { rating: 3000, rate: 0.4 },
  { rating: 3500, rate: 0.2 },
];

// ── Helpers ────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function interpolateCurve(curve: RatePoint[], rating: number): number {
  if (rating <= curve[0].rating) return curve[0].rate;
  if (rating >= curve[curve.length - 1].rating) return curve[curve.length - 1].rate;
  for (let i = 0; i < curve.length - 1; i++) {
    const lo = curve[i];
    const hi = curve[i + 1];
    if (rating >= lo.rating && rating <= hi.rating) {
      const t = (rating - lo.rating) / (hi.rating - lo.rating);
      return lo.rate + t * (hi.rate - lo.rate);
    }
  }
  return curve[curve.length - 1].rate;
}

// ── Arena Rating (percentile curve) ────────────────────────────────────

function computeArenaRating(chessRating: number): number {
  const curve = RATING_CURVE;
  // Below lowest anchor
  if (chessRating <= curve[0].rating) return curve[0].arena;
  // Above highest anchor
  if (chessRating >= curve[curve.length - 1].rating) return curve[curve.length - 1].arena;
  // Find surrounding breakpoints and interpolate
  for (let i = 0; i < curve.length - 1; i++) {
    const lo = curve[i];
    const hi = curve[i + 1];
    if (chessRating >= lo.rating && chessRating <= hi.rating) {
      const t = (chessRating - lo.rating) / (hi.rating - lo.rating);
      return Math.round(lo.arena + t * (hi.arena - lo.arena));
    }
  }
  return curve[curve.length - 1].arena;
}

function getTierFromArena(arenaRating: number): Tier {
  for (let i = TIER_BOUNDS.length - 1; i >= 0; i--) {
    if (arenaRating >= TIER_BOUNDS[i].min) return TIER_BOUNDS[i].tier;
  }
  return "bronze";
}

function getTierBounds(tier: Tier) {
  return TIER_BOUNDS.find((t) => t.tier === tier)!;
}

/**
 * Individual stats can reach one tier above the player's own tier.
 * Bronze stats can reach silver (max 79) but never gold (80+).
 * Silver stats can reach gold (max 89) but never platinum (90+).
 * Gold/Platinum stats can reach 99.
 * The floor is always 38 (lowest possible).
 */
function getStatBounds(tier: Tier): { min: number; max: number } {
  const tierOrder: Tier[] = ["bronze", "silver", "gold", "platinum"];
  const idx = tierOrder.indexOf(tier);
  const nextIdx = Math.min(idx + 1, tierOrder.length - 1);
  const nextTier = TIER_BOUNDS.find((t) => t.tier === tierOrder[nextIdx])!;
  return { min: 38, max: nextTier.max };
}

// ── Category Classification ────────────────────────────────────────────

/**
 * Check if a target square in the FEN is occupied (i.e. the best move is a capture).
 * bestMoveUci is like "e2e4" — target square is chars [2..3].
 */
function isCaptureMove(fen: string, bestMoveUci: string): boolean {
  const targetFile = bestMoveUci.charCodeAt(2) - 97; // 'a' = 0
  const targetRank = parseInt(bestMoveUci[3], 10) - 1; // '1' = 0
  const boardPart = fen.split(" ")[0];
  const rows = boardPart.split("/");
  // FEN rows are from rank 8 (index 0) to rank 1 (index 7)
  const rowIndex = 7 - targetRank;
  const row = rows[rowIndex];
  if (!row) return false;

  let fileIdx = 0;
  for (const ch of row) {
    if (fileIdx > targetFile) break;
    if (/\d/.test(ch)) {
      fileIdx += parseInt(ch, 10);
    } else {
      if (fileIdx === targetFile) return true;
      fileIdx++;
    }
  }
  return false;
}

/**
 * Check if a position qualifies as a CALCULATION position:
 * - Best move is forcing (capture or check)
 * - Engine PV length >= 4 plies (deep forcing line)
 * - Position isn't completely won/lost (|eval| < 500 cp) to avoid trivial sequences
 */
function isCalculationPosition(pos: PositionRow): boolean {
  if (!pos.bestMoveUci || pos.bestMoveUci.length < 4) return false;

  // PV must be >= 4 plies deep
  const pvMoves = pos.pv ? pos.pv.trim().split(/\s+/) : [];
  if (pvMoves.length < 4) return false;

  // Position shouldn't be completely won/lost (trivial calculation)
  if (pos.eval != null && Math.abs(pos.eval * 100) >= 500) return false;

  // Best move must be forcing: capture or check
  const bestIsCapture = isCaptureMove(pos.fen, pos.bestMoveUci);
  // Approximate check detection: if played move matches best move and SAN has '+'
  const san = pos.san || "";
  const playedIsBest = pos.moveUci === pos.bestMoveUci;
  const bestIsCheck = playedIsBest && (san.includes("+") || san.includes("#"));

  return bestIsCapture || bestIsCheck;
}

function classifyPosition(pos: PositionRow, playerSideIsWhite: boolean): CategoryName {
  const evalCp = pos.eval;
  if (evalCp == null) return "positional";

  // eval is always from WHITE perspective, convert to player perspective
  const playerEval = playerSideIsWhite ? evalCp * 100 : -evalCp * 100;

  // Priority 1: Opening (ply <= 30 = first 15 full moves)
  if (pos.ply <= 30) return "opening";

  // Priority 2: Calculation (forcing line with deep PV)
  if (isCalculationPosition(pos)) return "calculation";

  // Priority 3: Attacking (significantly ahead)
  if (playerEval >= 150) return "attacking";

  // Priority 4: Defending (significantly behind)
  if (playerEval <= -150) return "defending";

  // Priority 5: Tactics (capture or check/mate)
  const san = pos.san || "";
  if (san.includes("x") || san.includes("+") || san.includes("#")) return "tactics";
  if (pos.bestMoveUci && pos.bestMoveUci.length >= 4) {
    if (isCaptureMove(pos.fen, pos.bestMoveUci)) return "tactics";
  }

  // Priority 6: Positional (everything else)
  return "positional";
}

// ── Main Computation ───────────────────────────────────────────────────

export function computeArenaStats(
  positions: PositionRow[],
  games: GameRow[],
  chessRating: number,
  title?: string,
  gamePlayerSide?: Record<number, "WHITE" | "BLACK">
): ArenaStatsResponse {
  const arenaRating = computeArenaRating(chessRating);
  const tier = getTierFromArena(arenaRating);
  const bounds = getTierBounds(tier);

  // Classify ALL evaluated positions. Both sides' moves are included — since
  // we compute relative success rates between categories, this still produces
  // meaningful stat distributions.

  const categoryCounts: Record<CategoryName, { total: number; success: number }> = {
    attacking: { total: 0, success: 0 },
    defending: { total: 0, success: 0 },
    tactics: { total: 0, success: 0 },
    positional: { total: 0, success: 0 },
    opening: { total: 0, success: 0 },
    calculation: { total: 0, success: 0 },
  };

  let totalPositions = 0;
  let blunderCount = 0;
  let missedWinCount = 0;
  let missedSaveCount = 0;

  // Defending-specific counters
  let broadMissedSaves = 0;       // losing (eval <= -150) AND cpLoss >= 100
  let losingTotal = 0;            // all positions where eval <= -150
  let losingHeld = 0;             // losing AND cpLoss < 50 (held the position)
  let criticalTotal = 0;          // near-equal positions (|eval| <= 150)
  let criticalFails = 0;          // near-equal AND cpLoss >= 150 (failed under pressure)
  let pressureZoneTotal = 0;      // opponent has initiative (eval -50 to -200)
  let pressureZoneHeld = 0;       // held in pressure zone (cpLoss < 50)

  // Calculation-specific counters
  let calcTotal = 0;              // positions classified as calculation
  let calcBestMove = 0;           // played the engine's best move (moveUci === bestMoveUci)
  let calcSuccess = 0;            // cpLoss < 50 (stayed within 50cp of best line)
  let calcFail = 0;               // cpLoss >= 150 (failed the calculation)

  // Attacking-specific counters
  let broadMissedWins = 0;        // winning (eval >= 150) AND cpLoss >= 100
  let winningTotal = 0;           // all positions where eval >= 150
  let winningConverted = 0;       // winning AND cpLoss < 50 (maintained advantage)
  let attackInitiativeTotal = 0;  // slight edge (eval +50 to +200)
  let attackInitiativeHeld = 0;   // pressed advantage (cpLoss < 50 in edge positions)

  for (const pos of positions) {
    if (pos.eval == null || pos.cpLoss == null) continue;

    totalPositions++;

    // The mover is the opposite of sideToMove (sideToMove = who moves NEXT)
    const moverIsWhite = pos.sideToMove === "BLACK";
    const playerEvalCp = moverIsWhite ? pos.eval * 100 : -pos.eval * 100;

    const category = classifyPosition(pos, moverIsWhite);
    categoryCounts[category].total++;
    if (pos.cpLoss < 50) {
      categoryCounts[category].success++;
    }

    // Calculation-specific tracking
    if (category === "calculation") {
      calcTotal++;
      if (pos.moveUci === pos.bestMoveUci) calcBestMove++;
      if (pos.cpLoss < 50) calcSuccess++;
      if (pos.cpLoss >= 150) calcFail++;
    }

    // Defending-specific tracking
    if (playerEvalCp <= -150) {
      losingTotal++;
      if (pos.cpLoss < 50) losingHeld++;
      if (pos.cpLoss >= 100) broadMissedSaves++;
    }
    if (Math.abs(playerEvalCp) <= 150) {
      criticalTotal++;
      if (pos.cpLoss >= 150) criticalFails++;
    }
    if (playerEvalCp >= -200 && playerEvalCp <= -50) {
      pressureZoneTotal++;
      if (pos.cpLoss < 50) pressureZoneHeld++;
    }

    // Attacking-specific tracking
    if (playerEvalCp >= 150) {
      winningTotal++;
      if (pos.cpLoss < 50) winningConverted++;
      if (pos.cpLoss >= 100) broadMissedWins++;
    }
    if (playerEvalCp >= 50 && playerEvalCp <= 200) {
      attackInitiativeTotal++;
      if (pos.cpLoss < 50) attackInitiativeHeld++;
    }

    // Back stats
    if (pos.classification === "BLUNDER") blunderCount++;
    if (playerEvalCp >= 200 && pos.cpLoss >= 200) missedWinCount++;
    if (playerEvalCp <= -200 && pos.cpLoss >= 200) missedSaveCount++;
  }

  // ── Success rates & percentages ──
  const categoryData: Record<CategoryName, { successRate: number; percentage: number }> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    const c = categoryCounts[cat];
    categoryData[cat] = {
      successRate: c.total > 0 ? c.success / c.total : 0.5,
      percentage: totalPositions > 0 ? c.total / totalPositions : 1 / 6,
    };
  }

  // ── Defending score (composite of 4 metrics) ──
  // 1. Missed save rate vs expected for rating (weight 0.30)
  //    Broadened: eval <= -150 AND cpLoss >= 100
  const actualMissedSaveRate = totalPositions > 0
    ? (broadMissedSaves / totalPositions) * 100
    : 0;
  const expectedMissedSaveRate = interpolateCurve(EXPECTED_MISSED_SAVE_CURVE, chessRating);
  const missedSaveScore = expectedMissedSaveRate > 0
    ? clamp(0.5 + (expectedMissedSaveRate - actualMissedSaveRate) / (2 * expectedMissedSaveRate), 0, 1)
    : 0.5;

  // 2. Hold rate in losing positions (weight 0.25)
  //    cpLoss < 50 when eval <= -150 (held a bad position)
  const holdRate = losingTotal > 0 ? losingHeld / losingTotal : 0.5;

  // 3. Critical position accuracy (weight 0.20)
  //    Near-equal positions (|eval| <= 150) where you failed badly (cpLoss >= 150)
  //    Approximates "only move" and mate threat situations
  const criticalAccuracy = criticalTotal > 0
    ? 1 - (criticalFails / criticalTotal)
    : 0.5;

  // 4. Pressure zone accuracy (weight 0.25)
  //    Opponent has initiative (eval -50 to -200): how often you respond well (cpLoss < 50)
  //    Measures ability to absorb pressure and find precise responses
  const pressureAccuracy = pressureZoneTotal > 0
    ? pressureZoneHeld / pressureZoneTotal
    : 0.5;

  // Composite defending score (0–1 scale, matches other categories' success rates)
  const defendingScore =
    0.30 * missedSaveScore +
    0.25 * holdRate +
    0.20 * criticalAccuracy +
    0.25 * pressureAccuracy;
  categoryData["defending"].successRate = defendingScore;

  // ── Attacking score (composite of 4 metrics) ──
  // 1. Missed win rate vs expected for rating (weight 0.25)
  //    Broadened: eval >= 150 AND cpLoss >= 100
  const actualMissedWinRate = totalPositions > 0
    ? (broadMissedWins / totalPositions) * 100
    : 0;
  const expectedMissedWinRate = interpolateCurve(EXPECTED_MISSED_WIN_CURVE, chessRating);
  const missedWinScore = expectedMissedWinRate > 0
    ? clamp(0.5 + (expectedMissedWinRate - actualMissedWinRate) / (2 * expectedMissedWinRate), 0, 1)
    : 0.5;

  // 2. Conversion rate in winning positions (weight 0.25)
  //    cpLoss < 50 when eval >= 150 (maintained advantage)
  const conversionRate = winningTotal > 0 ? winningConverted / winningTotal : 0.5;

  // 3. Initiative pressing (weight 0.25)
  //    Slight edge (eval +50 to +200): how often you press it (cpLoss < 50)
  const initiativeRate = attackInitiativeTotal > 0
    ? attackInitiativeHeld / attackInitiativeTotal
    : 0.5;

  // 4. Sacrifice accuracy (weight 0.25)
  //    Detect sacrifices: player moves, opponent captures next move, eval holds or improves
  //    Group positions by game to look at consecutive pairs
  const gamePositions: Record<number, (PositionRow & { playerEvalCp: number })[]> = {};
  for (const pos of positions) {
    if (pos.eval == null || pos.cpLoss == null) continue;
    const moverIsWhite = pos.sideToMove === "BLACK";
    const pEval = moverIsWhite ? pos.eval * 100 : -pos.eval * 100;
    if (!gamePositions[pos.gameId]) gamePositions[pos.gameId] = [];
    gamePositions[pos.gameId].push({ ...pos, playerEvalCp: pEval });
  }

  let sacrificeOpportunities = 0;
  let sacrificeSuccesses = 0;

  for (const gameId of Object.keys(gamePositions)) {
    const gPositions = gamePositions[Number(gameId)];
    // Positions are already sorted by ply
    for (let i = 0; i < gPositions.length - 1; i++) {
      const curr = gPositions[i];
      const next = gPositions[i + 1];

      // Player moves at curr, opponent responds at next
      // Sacrifice detected when:
      // - Player's eval is between -50 and +300 (not already crushing)
      // - Player's move is not a capture (they're giving, not taking)
      // - cpLoss < 30 (engine approved the move)
      // - Opponent's response IS a capture (they took the offered piece)
      // - Eval after opponent's capture is still >= player's eval (sacrifice worked)
      const playerSan = curr.san || "";
      const opponentSan = next.san || "";
      const isPlayerCapture = playerSan.includes("x");
      const isOpponentCapture = opponentSan.includes("x");

      if (
        curr.playerEvalCp >= -50 &&
        curr.playerEvalCp <= 300 &&
        !isPlayerCapture &&
        isOpponentCapture
      ) {
        sacrificeOpportunities++;
        // Player found the sacrifice AND eval held
        // next.playerEvalCp is from the OPPONENT's perspective as mover,
        // so we flip: if next.sideToMove is the player's side, eval is from player perspective
        const nextEvalForPlayer = -next.playerEvalCp; // flip since next mover is opponent
        if (curr.cpLoss != null && curr.cpLoss < 30 && nextEvalForPlayer >= curr.playerEvalCp - 50) {
          sacrificeSuccesses++;
        }
      }
    }
  }

  const sacrificeAccuracy = sacrificeOpportunities > 0
    ? sacrificeSuccesses / sacrificeOpportunities
    : 0.5;

  // Composite attacking score (0–1 scale)
  const attackingScore =
    0.25 * missedWinScore +
    0.25 * conversionRate +
    0.25 * initiativeRate +
    0.25 * sacrificeAccuracy;
  categoryData["attacking"].successRate = attackingScore;

  // ── Opening score — how often you come out ahead at move 15 ──
  // Simple: what fraction of games is your eval >= 0 after 15 moves?
  let gamesWithEval = 0;
  let gamesAhead = 0;
  for (const gameId of Object.keys(gamePositions)) {
    const gId = Number(gameId);
    const gPos = gamePositions[gId];
    let closest: (typeof gPos)[0] | null = null;
    let closestDist = Infinity;
    for (const p of gPos) {
      const dist = Math.abs(p.ply - 30);
      if (dist < closestDist) {
        closestDist = dist;
        closest = p;
      }
      if (p.ply > 34) break;
    }
    if (closest && closest.eval != null && closestDist <= 6) {
      const playerIsWhite = gamePlayerSide
        ? gamePlayerSide[gId] === "WHITE"
        : closest.sideToMove === "BLACK";
      const evalForPlayer = playerIsWhite
        ? closest.eval * 100
        : -closest.eval * 100;
      gamesWithEval++;
      if (evalForPlayer >= 0) gamesAhead++;
    }
  }

  // Compare fraction ahead vs expected for rating
  const actualAheadRate = gamesWithEval > 0 ? gamesAhead / gamesWithEval : 0.5;
  const expectedEval = interpolateCurve(EXPECTED_OPENING_EVAL_CURVE, chessRating);
  // Expected fraction ahead: map expected eval to a rough fraction
  // If expected eval is 0 → 50% ahead, +50cp → ~60%, -50cp → ~40%
  const expectedAheadRate = clamp(0.5 + expectedEval / 200, 0.3, 0.7);
  const openingScore = clamp(
    0.5 + (actualAheadRate - expectedAheadRate) / (2 * (1 - expectedAheadRate + 0.01)),
    0, 1
  );
  categoryData["opening"].successRate = openingScore;

  // ── Calculation score (composite) ──
  // 1. Calculation failure rate vs expected for rating (weight 0.40)
  const actualCalcFailRate = calcTotal > 0 ? (calcFail / calcTotal) * 100 : 0;
  const expectedCalcFailRate = interpolateCurve(EXPECTED_CALC_FAIL_CURVE, chessRating);
  const calcFailScore = expectedCalcFailRate > 0
    ? clamp(0.5 + (expectedCalcFailRate - actualCalcFailRate) / (2 * expectedCalcFailRate), 0, 1)
    : 0.5;

  // 2. Best move accuracy in calculation positions (weight 0.35)
  //    How often the player finds the exact engine best move
  const calcBestMoveRate = calcTotal > 0 ? calcBestMove / calcTotal : 0.5;

  // 3. Calculation success rate (weight 0.25)
  //    cpLoss < 50 in calculation positions (stayed within 50cp of best line)
  const calcSuccessRate = calcTotal > 0 ? calcSuccess / calcTotal : 0.5;

  const calculationScore =
    0.40 * calcFailScore +
    0.35 * calcBestMoveRate +
    0.25 * calcSuccessRate;
  categoryData["calculation"].successRate = calculationScore;

  // ── Stat distribution around arena rating ──
  const avgSuccessRate =
    CATEGORY_NAMES.reduce((sum, cat) => sum + categoryData[cat].successRate, 0) / CATEGORY_NAMES.length;

  const rawDeviations: Record<CategoryName, number> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    const d = categoryData[cat];
    // Success rate drives the spread; percentage acts as confidence
    // (categories with <10% of positions get damped toward the mean)
    const confidence = Math.min(d.percentage / CONFIDENCE_THRESHOLD, 1);
    rawDeviations[cat] = (d.successRate - avgSuccessRate) * SCALE_FACTOR * confidence;
  }

  // Normalize deviations to sum to 0
  const devSum = CATEGORY_NAMES.reduce((sum, cat) => sum + rawDeviations[cat], 0);
  const devAdj = devSum / CATEGORY_NAMES.length;

  // Stat bounds: individual stats can reach one tier above the player's tier
  const statBounds = getStatBounds(tier);

  const stats: Record<CategoryName, number> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    stats[cat] = clamp(
      Math.round(arenaRating + rawDeviations[cat] - devAdj),
      statBounds.min,
      statBounds.max
    );
  }

  // Adjust so 6 stats average equals arenaRating exactly
  let statSum = CATEGORY_NAMES.reduce((sum, cat) => sum + stats[cat], 0);
  let diff = arenaRating * 6 - statSum;
  // Distribute the remainder across stats (prioritize stats furthest from bounds)
  while (diff !== 0) {
    const step = diff > 0 ? 1 : -1;
    let adjusted = false;
    for (const cat of CATEGORY_NAMES) {
      if (diff === 0) break;
      const newVal = stats[cat] + step;
      if (newVal >= statBounds.min && newVal <= statBounds.max) {
        stats[cat] = newVal;
        diff -= step;
        adjusted = true;
      }
    }
    if (!adjusted) break; // Can't adjust further (all at bounds)
  }

  // ── Form overlay ──
  const sortedGames = [...games].sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  const last5 = sortedGames.slice(0, 5);

  function gameAccuracy(g: GameRow): number | null {
    if (g.accuracyWhite != null && g.accuracyBlack != null) {
      return (g.accuracyWhite + g.accuracyBlack) / 2;
    }
    return g.accuracyWhite ?? g.accuracyBlack ?? null;
  }

  const recentAccs = last5.map(gameAccuracy).filter((a): a is number => a != null);
  const allAccs = games.map(gameAccuracy).filter((a): a is number => a != null);

  let form = 0;
  if (recentAccs.length > 0 && allAccs.length > 0) {
    const recentAvg = recentAccs.reduce((s, v) => s + v, 0) / recentAccs.length;
    const overallAvg = allAccs.reduce((s, v) => s + v, 0) / allAccs.length;
    form = clamp(Math.round((recentAvg - overallAvg) / 2.5), -4, 4);
  }

  // ── Back stats ──
  const whiteAccs = games.map((g) => g.accuracyWhite).filter((a): a is number => a != null);
  const blackAccs = games.map((g) => g.accuracyBlack).filter((a): a is number => a != null);
  const accWhite = whiteAccs.length > 0 ? round2(whiteAccs.reduce((s, v) => s + v, 0) / whiteAccs.length) : null;
  const accBlack = blackAccs.length > 0 ? round2(blackAccs.reduce((s, v) => s + v, 0) / blackAccs.length) : null;
  const accOverall =
    accWhite != null && accBlack != null
      ? round2((accWhite + accBlack) / 2)
      : accWhite ?? accBlack ?? null;

  // ── Build response ──
  const categories: Record<CategoryName, CategoryResult> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    categories[cat] = {
      stat: stats[cat],
      percentage: round2(categoryData[cat].percentage * 100),
      successRate: round2(categoryData[cat].successRate * 100),
    };
  }

  // Platinum is always shiny; other tiers check threshold
  const shiny = tier === "platinum" || arenaRating >= SHINY_THRESHOLDS[tier];

  return {
    arenaRating,
    tier,
    shiny,
    categories,
    form,
    backStats: {
      accuracyOverall: accOverall,
      accuracyWhite: accWhite,
      accuracyBlack: accBlack,
      blunderRate: totalPositions > 0 ? round2((blunderCount / totalPositions) * 100) : 0,
      missedWinRate: totalPositions > 0 ? round2((missedWinCount / totalPositions) * 100) : 0,
      missedSaveRate: totalPositions > 0 ? round2((missedSaveCount / totalPositions) * 100) : 0,
    },
    gamesAnalyzed: games.length,
  };
}
