import { Side } from "@prisma/client";
import { cpToWinPercent, moveAccuracy, harmonicMean } from "./accuracy";
import { classifyPositionCategory, PositionCategory } from "./positionCategory";
import { detectLabels, PuzzleLabel } from "./puzzleClassification";

// ── Types ──────────────────────────────────────────────────────────────

export type Tier = "bronze" | "silver" | "gold" | "platinum";

export type CategoryName =
  | "attacking"
  | "defending"
  | "tactics"
  | "strategic"
  | "opening"
  | "endgame";

interface CategoryResult {
  stat: number;
  percentage: number;
  successRate: number;
  total: number;
  success: number;
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
  phaseAccuracy: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseAccuracyVsExpected: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseBestMoveRate: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseBestMoveRateVsExpected: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseAccuracyByResult: {
    opening: { wins: number | null; draws: number | null; losses: number | null };
    middlegame: { wins: number | null; draws: number | null; losses: number | null };
    endgame: { wins: number | null; draws: number | null; losses: number | null };
  };
  phaseBlunderRate: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseMedianAccuracy: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseMissedWinRate: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseMissedSaveRate: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseEvalDelta: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseBlunderRateVsExpected: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseMissedWinRateVsExpected: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseMissedSaveRateVsExpected: {
    opening: number | null;
    middlegame: number | null;
    endgame: number | null;
  };
  phaseAccuracyByResultVsExpected: {
    opening: { wins: number | null; draws: number | null; losses: number | null };
    middlegame: { wins: number | null; draws: number | null; losses: number | null };
    endgame: { wins: number | null; draws: number | null; losses: number | null };
  };
  tacticsBreakdown: Record<string, { success: number; total: number }>;
  gamesAnalyzed: number;
  record?: { wins: number; draws: number; losses: number };
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
  category: string | null;
}

interface GameRow {
  id: number;
  result: string;
  accuracyWhite: number | null;
  accuracyBlack: number | null;
  endDate: Date;
}

// ── Percentile Curves ─────────────────────────────────────────────────
// Shared base curve up to gold, then per-time-control top end.
// Rapid ratings are lower at the top (best players ~2800-2900)
// vs bullet/blitz where top players reach 3000-3400+.

type CurvePoint = { rating: number; arena: number };

const RATING_CURVE_BASE: CurvePoint[] = [
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
];

// Top-end anchors per time control
const RATING_CURVE_TOP: Record<string, CurvePoint[]> = {
  bullet: [
    { rating: 2300, arena: 84 },
    { rating: 2600, arena: 87 },
    { rating: 3000, arena: 90 },
    { rating: 3200, arena: 95 },
    { rating: 3400, arena: 98 },
    { rating: 3500, arena: 99 },
  ],
  blitz: [
    { rating: 2300, arena: 84 },
    { rating: 2600, arena: 87 },
    { rating: 3000, arena: 90 },
    { rating: 3200, arena: 95 },
    { rating: 3400, arena: 98 },
    { rating: 3500, arena: 99 },
  ],
  rapid: [
    { rating: 2200, arena: 84 },
    { rating: 2400, arena: 87 },
    { rating: 2600, arena: 90 },
    { rating: 2750, arena: 95 },
    { rating: 2900, arena: 98 },
    { rating: 3000, arena: 99 },
  ],
};

function getRatingCurve(timeCategory: string): CurvePoint[] {
  const top = RATING_CURVE_TOP[timeCategory] || RATING_CURVE_TOP["blitz"];
  return [...RATING_CURVE_BASE, ...top];
}

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
  "strategic",
  "opening",
  "endgame",
];

const SCALE_FACTOR = 20;
const CONFIDENCE_THRESHOLD = 0.10; // full confidence at 10%+ of positions

// ── Expected per-phase harmonic mean accuracy by rating ──────────────
type RatePoint = { rating: number; rate: number };

const EXPECTED_OPENING_PHASE_ACCURACY_CURVE: RatePoint[] = [
  { rating: 400,  rate: 66 },
  { rating: 496,  rate: 69.5 },
  { rating: 889,  rate: 76.8 },
  { rating: 1112, rate: 76.8 },
  { rating: 1300, rate: 80.3 },
  { rating: 1501, rate: 82.4 },
  { rating: 1712, rate: 85.3 },
  { rating: 1895, rate: 86.0 },
  { rating: 2095, rate: 88.1 },
  { rating: 2287, rate: 88.9 },
  { rating: 2473, rate: 89.8 },
  { rating: 2676, rate: 90.6 },
  { rating: 2921, rate: 91.9 },
  { rating: 3500, rate: 94 },
];

const EXPECTED_MIDDLEGAME_ACCURACY_CURVE: RatePoint[] = [
  { rating: 400,  rate: 60 },
  { rating: 496,  rate: 63.2 },
  { rating: 889,  rate: 65.0 },
  { rating: 1112, rate: 65.8 },
  { rating: 1300, rate: 67.6 },
  { rating: 1501, rate: 69.9 },
  { rating: 1712, rate: 72.2 },
  { rating: 1895, rate: 72.4 },
  { rating: 2095, rate: 74.9 },
  { rating: 2287, rate: 75.5 },
  { rating: 2473, rate: 77.2 },
  { rating: 2676, rate: 79.3 },
  { rating: 2921, rate: 81.5 },
  { rating: 3500, rate: 84 },
];

const EXPECTED_ENDGAME_PHASE_ACCURACY_CURVE: RatePoint[] = [
  { rating: 400,  rate: 71 },
  { rating: 496,  rate: 73.4 },
  { rating: 889,  rate: 74.6 },
  { rating: 1112, rate: 73.6 },
  { rating: 1300, rate: 73.7 },
  { rating: 1501, rate: 76.1 },
  { rating: 1712, rate: 74.7 },
  { rating: 1895, rate: 76.8 },
  { rating: 2095, rate: 76.0 },
  { rating: 2287, rate: 77.3 },
  { rating: 2473, rate: 77.7 },
  { rating: 2676, rate: 79.8 },
  { rating: 2921, rate: 80.3 },
  { rating: 3500, rate: 83 },
];

// ── Expected per-phase best move rate by rating ──────────────────────

const EXPECTED_OPENING_BEST_MOVE_RATE_CURVE: RatePoint[] = [
  { rating: 400,  rate: 30 },
  { rating: 500,  rate: 32 },
  { rating: 900,  rate: 36 },
  { rating: 1100, rate: 38 },
  { rating: 1300, rate: 40 },
  { rating: 1500, rate: 43 },
  { rating: 1700, rate: 46 },
  { rating: 1900, rate: 49 },
  { rating: 2100, rate: 52 },
  { rating: 2300, rate: 55 },
  { rating: 2500, rate: 58 },
  { rating: 2700, rate: 61 },
  { rating: 2900, rate: 64 },
  { rating: 3500, rate: 70 },
];

const EXPECTED_MIDDLEGAME_BEST_MOVE_RATE_CURVE: RatePoint[] = [
  { rating: 400,  rate: 22 },
  { rating: 500,  rate: 24 },
  { rating: 900,  rate: 28 },
  { rating: 1100, rate: 30 },
  { rating: 1300, rate: 32 },
  { rating: 1500, rate: 35 },
  { rating: 1700, rate: 38 },
  { rating: 1900, rate: 41 },
  { rating: 2100, rate: 44 },
  { rating: 2300, rate: 47 },
  { rating: 2500, rate: 50 },
  { rating: 2700, rate: 53 },
  { rating: 2900, rate: 56 },
  { rating: 3500, rate: 62 },
];

const EXPECTED_ENDGAME_BEST_MOVE_RATE_CURVE: RatePoint[] = [
  { rating: 400,  rate: 26 },
  { rating: 500,  rate: 28 },
  { rating: 900,  rate: 32 },
  { rating: 1100, rate: 34 },
  { rating: 1300, rate: 36 },
  { rating: 1500, rate: 39 },
  { rating: 1700, rate: 42 },
  { rating: 1900, rate: 45 },
  { rating: 2100, rate: 48 },
  { rating: 2300, rate: 51 },
  { rating: 2500, rate: 54 },
  { rating: 2700, rate: 57 },
  { rating: 2900, rate: 60 },
  { rating: 3500, rate: 66 },
];

// ── Expected per-phase blunder rate by rating (%) ─────────────────────

const EXPECTED_OPENING_BLUNDER_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 2.0 }, { rating: 800, rate: 1.2 }, { rating: 1200, rate: 0.6 },
  { rating: 1600, rate: 0.3 }, { rating: 2000, rate: 0.15 }, { rating: 2400, rate: 0.05 },
  { rating: 2800, rate: 0 }, { rating: 3500, rate: 0 },
];

const EXPECTED_MIDDLEGAME_BLUNDER_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 8.0 }, { rating: 800, rate: 6.0 }, { rating: 1200, rate: 4.5 },
  { rating: 1600, rate: 3.2 }, { rating: 2000, rate: 2.2 }, { rating: 2400, rate: 1.4 },
  { rating: 2800, rate: 0.9 }, { rating: 3500, rate: 0.5 },
];

const EXPECTED_ENDGAME_BLUNDER_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 10.0 }, { rating: 800, rate: 8.0 }, { rating: 1200, rate: 6.0 },
  { rating: 1600, rate: 4.5 }, { rating: 2000, rate: 3.5 }, { rating: 2400, rate: 2.5 },
  { rating: 2800, rate: 1.8 }, { rating: 3500, rate: 1.0 },
];

// ── Expected per-phase missed win rate by rating (%) ──────────────────

const EXPECTED_OPENING_MISSED_WIN_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 0.4 }, { rating: 800, rate: 0.3 }, { rating: 1200, rate: 0.15 },
  { rating: 1600, rate: 0.08 }, { rating: 2000, rate: 0.03 }, { rating: 2400, rate: 0 },
  { rating: 3500, rate: 0 },
];

const EXPECTED_MIDDLEGAME_MISSED_WIN_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 3.5 }, { rating: 800, rate: 3.0 }, { rating: 1200, rate: 2.3 },
  { rating: 1600, rate: 1.8 }, { rating: 2000, rate: 1.3 }, { rating: 2400, rate: 0.9 },
  { rating: 2800, rate: 0.6 }, { rating: 3500, rate: 0.3 },
];

const EXPECTED_ENDGAME_MISSED_WIN_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 5.5 }, { rating: 800, rate: 4.5 }, { rating: 1200, rate: 3.8 },
  { rating: 1600, rate: 3.0 }, { rating: 2000, rate: 2.3 }, { rating: 2400, rate: 1.7 },
  { rating: 2800, rate: 1.2 }, { rating: 3500, rate: 0.7 },
];

// ── Expected per-phase missed save rate by rating (%) ─────────────────

const EXPECTED_OPENING_MISSED_SAVE_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 0.3 }, { rating: 800, rate: 0.2 }, { rating: 1200, rate: 0.1 },
  { rating: 1600, rate: 0.05 }, { rating: 2000, rate: 0 }, { rating: 3500, rate: 0 },
];

const EXPECTED_MIDDLEGAME_MISSED_SAVE_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 2.5 }, { rating: 800, rate: 2.0 }, { rating: 1200, rate: 1.4 },
  { rating: 1600, rate: 1.0 }, { rating: 2000, rate: 0.6 }, { rating: 2400, rate: 0.35 },
  { rating: 2800, rate: 0.2 }, { rating: 3500, rate: 0.1 },
];

const EXPECTED_ENDGAME_MISSED_SAVE_RATE_CURVE: RatePoint[] = [
  { rating: 400, rate: 3.5 }, { rating: 800, rate: 3.0 }, { rating: 1200, rate: 2.2 },
  { rating: 1600, rate: 1.6 }, { rating: 2000, rate: 1.0 }, { rating: 2400, rate: 0.6 },
  { rating: 2800, rate: 0.35 }, { rating: 3500, rate: 0.15 },
];

// ── Expected accuracy-by-result offsets from base phase accuracy ──────
// wins/draws tend higher, losses lower. Opening is theory-dominated so offsets are small.
const PHASE_RESULT_ACCURACY_OFFSETS: Record<
  "opening" | "middlegame" | "endgame",
  { wins: number; draws: number; losses: number }
> = {
  opening:     { wins: 1.5, draws: 3.0, losses: -2.0 },
  middlegame:  { wins: 4.0, draws: 6.0, losses: -8.0 },
  endgame:     { wins: 3.0, draws: 5.0, losses: -7.0 },
};

// ── Expected per-category success rate by rating ─────────────────────
// Data-driven: collected from 348 players across 12 rating brackets via
// collect-category-data.ts + build-category-curves.ts.
// These are the average successRate (0–100) from computeArenaStats at each rating level.
// TODO: Re-collect after backfill with new classification to get accurate curves.
// For now, reusing old curves as placeholders — they'll be close enough for
// stat distribution purposes (relative ordering matters more than absolutes).

const EXPECTED_ATTACKING_SCORE_CURVE: RatePoint[] = [
  { rating: 496, rate: 52.6 },
  { rating: 889, rate: 58.1 },
  { rating: 1111, rate: 54.9 },
  { rating: 1300, rate: 58.9 },
  { rating: 1501, rate: 54.5 },
  { rating: 1712, rate: 55.1 },
  { rating: 1895, rate: 52.1 },
  { rating: 2095, rate: 50.9 },
  { rating: 2287, rate: 51.3 },
  { rating: 2473, rate: 52.3 },
  { rating: 2676, rate: 53.5 },
  { rating: 2921, rate: 54.7 },
];

const EXPECTED_DEFENDING_SCORE_CURVE: RatePoint[] = [
  { rating: 496, rate: 63.7 },
  { rating: 889, rate: 66.8 },
  { rating: 1111, rate: 62.8 },
  { rating: 1300, rate: 64.1 },
  { rating: 1501, rate: 61.4 },
  { rating: 1712, rate: 59.3 },
  { rating: 1895, rate: 55.6 },
  { rating: 2095, rate: 58.7 },
  { rating: 2287, rate: 57.1 },
  { rating: 2473, rate: 57.1 },
  { rating: 2676, rate: 58.1 },
  { rating: 2921, rate: 58.4 },
];

const EXPECTED_TACTICS_SCORE_CURVE: RatePoint[] = [
  { rating: 496, rate: 76.7 },
  { rating: 889, rate: 79.5 },
  { rating: 1111, rate: 81.2 },
  { rating: 1300, rate: 82.4 },
  { rating: 1501, rate: 83.8 },
  { rating: 1712, rate: 85.7 },
  { rating: 1895, rate: 85.3 },
  { rating: 2095, rate: 87 },
  { rating: 2287, rate: 88 },
  { rating: 2473, rate: 87.6 },
  { rating: 2676, rate: 88.9 },
  { rating: 2921, rate: 89.2 },
];

// Reusing old "positional" curve as placeholder for "strategic"
const EXPECTED_STRATEGIC_SCORE_CURVE: RatePoint[] = [
  { rating: 496, rate: 67.9 },
  { rating: 889, rate: 74.7 },
  { rating: 1111, rate: 77.9 },
  { rating: 1300, rate: 80.7 },
  { rating: 1501, rate: 81.2 },
  { rating: 1712, rate: 81.3 },
  { rating: 1895, rate: 84.3 },
  { rating: 2095, rate: 85.9 },
  { rating: 2287, rate: 86.4 },
  { rating: 2473, rate: 87.4 },
  { rating: 2676, rate: 88.5 },
  { rating: 2921, rate: 89.7 },
];

const EXPECTED_OPENING_SCORE_CURVE: RatePoint[] = [
  { rating: 496, rate: 60.6 },
  { rating: 889, rate: 67 },
  { rating: 1111, rate: 63.1 },
  { rating: 1300, rate: 64.8 },
  { rating: 1501, rate: 62.5 },
  { rating: 1712, rate: 59.2 },
  { rating: 1895, rate: 55.5 },
  { rating: 2095, rate: 51.7 },
  { rating: 2287, rate: 51.4 },
  { rating: 2473, rate: 49.8 },
  { rating: 2676, rate: 45.4 },
  { rating: 2921, rate: 47.9 },
];

const EXPECTED_ENDGAME_SCORE_CURVE: RatePoint[] = [
  { rating: 496, rate: 48.5 },
  { rating: 889, rate: 53.4 },
  { rating: 1111, rate: 51.4 },
  { rating: 1300, rate: 54 },
  { rating: 1501, rate: 53 },
  { rating: 1712, rate: 47.5 },
  { rating: 1895, rate: 47.3 },
  { rating: 2095, rate: 35.6 },
  { rating: 2287, rate: 37.5 },
  { rating: 2473, rate: 34.7 },
  { rating: 2676, rate: 35 },
  { rating: 2921, rate: 37.5 },
];

const EXPECTED_CATEGORY_CURVES: Record<CategoryName, RatePoint[]> = {
  attacking: EXPECTED_ATTACKING_SCORE_CURVE,
  defending: EXPECTED_DEFENDING_SCORE_CURVE,
  tactics: EXPECTED_TACTICS_SCORE_CURVE,
  strategic: EXPECTED_STRATEGIC_SCORE_CURVE,
  opening: EXPECTED_OPENING_SCORE_CURVE,
  endgame: EXPECTED_ENDGAME_SCORE_CURVE,
};

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

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

function computeArenaRating(chessRating: number, timeCategory: string): number {
  const curve = getRatingCurve(timeCategory);
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

// ── Position Category Resolution ────────────────────────────────────────

/** Valid stored categories that map directly to CategoryName */
const VALID_CATEGORIES = new Set<string>([
  "opening", "defending", "attacking", "tactics", "endgame", "strategic",
]);

/**
 * Get the category for a position.
 * Uses stored category if available, otherwise computes on the fly (legacy fallback).
 */
function resolveCategory(pos: PositionRow): CategoryName {
  // Use stored category if valid
  if (pos.category && VALID_CATEGORIES.has(pos.category)) {
    return pos.category as CategoryName;
  }

  // Legacy fallback: compute category on the fly for unbackfilled positions
  return classifyPositionCategory({
    fen: pos.fen,
    ply: pos.ply,
    eval: pos.eval,
    sideToMove: pos.sideToMove,
    bestMoveUci: pos.bestMoveUci,
    pv: pos.pv,
  }) as CategoryName;
}

/**
 * Detect endgame positions using Lichess definition:
 * Fewer than 7 major/minor pieces on the board (excluding kings and pawns).
 */
function isEndgamePosition(fen: string): boolean {
  const boardPart = fen.split(" ")[0];
  let pieceCount = 0;
  for (const ch of boardPart) {
    if ("qrbnQRBN".includes(ch)) pieceCount++;
  }
  return pieceCount < 7;
}

// ── Target Stats (pure math, no DB) ────────────────────────────────────

export interface TargetStatsResult {
  targetArenaRating: number;
  targetTier: Tier;
  targetShiny: boolean;
  expectedPhaseAccuracy: {
    opening: number;
    middlegame: number;
    endgame: number;
  };
  expectedBestMoveRate: {
    opening: number;
    middlegame: number;
    endgame: number;
  };
  expectedBlunderRate: {
    opening: number;
    middlegame: number;
    endgame: number;
  };
  expectedMissedWinRate: {
    opening: number;
    middlegame: number;
    endgame: number;
  };
  expectedMissedSaveRate: {
    opening: number;
    middlegame: number;
    endgame: number;
  };
  expectedAccuracyByResult: {
    opening: { wins: number; draws: number; losses: number };
    middlegame: { wins: number; draws: number; losses: number };
    endgame: { wins: number; draws: number; losses: number };
  };
  expectedCategoryStats: Record<CategoryName, number>;
}

export function computeTargetStats(
  targetChessRating: number,
  timeCategory: string
): TargetStatsResult {
  const targetArenaRating = computeArenaRating(targetChessRating, timeCategory);
  const targetTier = getTierFromArena(targetArenaRating);
  const targetShiny =
    targetTier === "platinum" || targetArenaRating >= SHINY_THRESHOLDS[targetTier];

  // Compute expected per-category stats using the same logic as computeArenaStats
  // 1. Interpolate expected success rates for each category
  const expectedSuccessRates: Record<CategoryName, number> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    expectedSuccessRates[cat] = interpolateCurve(EXPECTED_CATEGORY_CURVES[cat], targetChessRating) / 100;
  }

  // 2. Compute deviations from the mean (same as computeArenaStats stat distribution)
  const avgSuccessRate =
    CATEGORY_NAMES.reduce((sum, cat) => sum + expectedSuccessRates[cat], 0) / CATEGORY_NAMES.length;

  const rawDeviations: Record<CategoryName, number> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    rawDeviations[cat] = (expectedSuccessRates[cat] - avgSuccessRate) * SCALE_FACTOR;
  }

  // 3. Normalize deviations to sum to 0
  const devSum = CATEGORY_NAMES.reduce((sum, cat) => sum + rawDeviations[cat], 0);
  const devAdj = devSum / CATEGORY_NAMES.length;

  // 4. Apply to arena rating with stat bounds
  const statBounds = getStatBounds(targetTier);
  const expectedCategoryStats: Record<CategoryName, number> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    expectedCategoryStats[cat] = clamp(
      Math.round(targetArenaRating + rawDeviations[cat] - devAdj),
      statBounds.min,
      statBounds.max
    );
  }

  // 5. Adjust so 6 stats average equals targetArenaRating exactly
  let statSum = CATEGORY_NAMES.reduce((sum, cat) => sum + expectedCategoryStats[cat], 0);
  let diff = targetArenaRating * 6 - statSum;
  while (diff !== 0) {
    const step = diff > 0 ? 1 : -1;
    let adjusted = false;
    for (const cat of CATEGORY_NAMES) {
      if (diff === 0) break;
      const newVal = expectedCategoryStats[cat] + step;
      if (newVal >= statBounds.min && newVal <= statBounds.max) {
        expectedCategoryStats[cat] = newVal;
        diff -= step;
        adjusted = true;
      }
    }
    if (!adjusted) break;
  }

  return {
    targetArenaRating,
    targetTier,
    targetShiny,
    expectedPhaseAccuracy: {
      opening: round1(interpolateCurve(EXPECTED_OPENING_PHASE_ACCURACY_CURVE, targetChessRating)),
      middlegame: round1(interpolateCurve(EXPECTED_MIDDLEGAME_ACCURACY_CURVE, targetChessRating)),
      endgame: round1(interpolateCurve(EXPECTED_ENDGAME_PHASE_ACCURACY_CURVE, targetChessRating)),
    },
    expectedBestMoveRate: {
      opening: round1(interpolateCurve(EXPECTED_OPENING_BEST_MOVE_RATE_CURVE, targetChessRating)),
      middlegame: round1(interpolateCurve(EXPECTED_MIDDLEGAME_BEST_MOVE_RATE_CURVE, targetChessRating)),
      endgame: round1(interpolateCurve(EXPECTED_ENDGAME_BEST_MOVE_RATE_CURVE, targetChessRating)),
    },
    expectedBlunderRate: {
      opening: round1(interpolateCurve(EXPECTED_OPENING_BLUNDER_RATE_CURVE, targetChessRating)),
      middlegame: round1(interpolateCurve(EXPECTED_MIDDLEGAME_BLUNDER_RATE_CURVE, targetChessRating)),
      endgame: round1(interpolateCurve(EXPECTED_ENDGAME_BLUNDER_RATE_CURVE, targetChessRating)),
    },
    expectedMissedWinRate: {
      opening: round1(interpolateCurve(EXPECTED_OPENING_MISSED_WIN_RATE_CURVE, targetChessRating)),
      middlegame: round1(interpolateCurve(EXPECTED_MIDDLEGAME_MISSED_WIN_RATE_CURVE, targetChessRating)),
      endgame: round1(interpolateCurve(EXPECTED_ENDGAME_MISSED_WIN_RATE_CURVE, targetChessRating)),
    },
    expectedMissedSaveRate: {
      opening: round1(interpolateCurve(EXPECTED_OPENING_MISSED_SAVE_RATE_CURVE, targetChessRating)),
      middlegame: round1(interpolateCurve(EXPECTED_MIDDLEGAME_MISSED_SAVE_RATE_CURVE, targetChessRating)),
      endgame: round1(interpolateCurve(EXPECTED_ENDGAME_MISSED_SAVE_RATE_CURVE, targetChessRating)),
    },
    expectedAccuracyByResult: (() => {
      const r: any = {};
      for (const phase of ["opening", "middlegame", "endgame"] as const) {
        const curve = phase === "opening" ? EXPECTED_OPENING_PHASE_ACCURACY_CURVE
          : phase === "middlegame" ? EXPECTED_MIDDLEGAME_ACCURACY_CURVE
          : EXPECTED_ENDGAME_PHASE_ACCURACY_CURVE;
        const base = interpolateCurve(curve, targetChessRating);
        const off = PHASE_RESULT_ACCURACY_OFFSETS[phase];
        r[phase] = { wins: round1(base + off.wins), draws: round1(base + off.draws), losses: round1(base + off.losses) };
      }
      return r;
    })(),
    expectedCategoryStats,
  };
}

// ── Main Computation ───────────────────────────────────────────────────

export function computeArenaStats(
  positions: PositionRow[],
  games: GameRow[],
  chessRating: number,
  title?: string,
  gamePlayerSide?: Record<number, "WHITE" | "BLACK">,
  timeCategory: string = "blitz"
): ArenaStatsResponse {
  const arenaRating = computeArenaRating(chessRating, timeCategory);
  const tier = getTierFromArena(arenaRating);
  const bounds = getTierBounds(tier);

  // ── Category counts — unified success rate metric ──
  // Each position gets exactly one category (mutually exclusive).
  // Success = cpLoss < 50.

  const categoryCounts: Record<CategoryName, { total: number; success: number }> = {
    attacking: { total: 0, success: 0 },
    defending: { total: 0, success: 0 },
    tactics: { total: 0, success: 0 },
    strategic: { total: 0, success: 0 },
    opening: { total: 0, success: 0 },
    endgame: { total: 0, success: 0 },
  };

  let totalPositions = 0;
  let blunderCount = 0;
  let missedWinCount = 0;
  let missedSaveCount = 0;

  // Per-tactical-motif hit/total tracking
  const TACTICAL_MOTIFS: PuzzleLabel[] = [
    "fork", "pin", "skewer", "double_attack", "discovered_attack",
    "removal_of_defender", "overload", "deflection", "intermezzo",
    "sacrifice", "clearance", "back_rank", "mate_threat", "checkmate",
    "smothered_mate", "trapped_piece", "x_ray", "interference",
    "desperado", "attraction",
  ];
  // Merge pin + double_attack into one combined key
  const MERGED_MOTIFS: Record<string, string> = {
    pin: "pin_double_attack",
    double_attack: "pin_double_attack",
  };
  const OUTPUT_MOTIFS = [
    "fork", "pin_double_attack", "skewer", "discovered_attack",
    "removal_of_defender", "overload", "deflection", "intermezzo",
    "sacrifice", "clearance", "back_rank", "mate_threat", "checkmate",
    "smothered_mate", "trapped_piece", "x_ray", "interference",
    "desperado", "attraction",
  ];
  const motifCounts: Record<string, { total: number; success: number }> = {};
  for (const m of OUTPUT_MOTIFS) motifCounts[m] = { total: 0, success: 0 };

  // Per-game per-phase accuracy: harmonic mean of move accuracies per phase (lichess method)
  const phaseGameAccuracies: Record<"opening" | "middlegame" | "endgame", number[]> = {
    opening: [],
    middlegame: [],
    endgame: [],
  };
  // Per-game overall accuracy (all phases combined, same method as phase accuracy)
  const overallGameAccuracies: number[] = [];
  const whiteGameAccuracies: number[] = [];
  const blackGameAccuracies: number[] = [];

  // Best move rate per phase (across all games, not per-game)
  const phaseBestMoveHits: Record<"opening" | "middlegame" | "endgame", number> = {
    opening: 0, middlegame: 0, endgame: 0,
  };
  const phaseBestMoveTotal: Record<"opening" | "middlegame" | "endgame", number> = {
    opening: 0, middlegame: 0, endgame: 0,
  };

  // Game result lookup (built early so phase loop can use it)
  const gameResults: Record<number, string> = {};
  for (const g of games) {
    gameResults[g.id] = g.result;
  }

  // Blunder rate per phase
  const phaseBlunders: Record<"opening" | "middlegame" | "endgame", number> = {
    opening: 0, middlegame: 0, endgame: 0,
  };
  const phaseMoveCount: Record<"opening" | "middlegame" | "endgame", number> = {
    opening: 0, middlegame: 0, endgame: 0,
  };
  const phaseMissedWins: Record<"opening" | "middlegame" | "endgame", number> = {
    opening: 0, middlegame: 0, endgame: 0,
  };
  const phaseMissedSaves: Record<"opening" | "middlegame" | "endgame", number> = {
    opening: 0, middlegame: 0, endgame: 0,
  };

  // Per-game eval delta per phase (player's perspective, capped at ±1000cp)
  const phaseEvalDeltas: Record<"opening" | "middlegame" | "endgame", number[]> = {
    opening: [], middlegame: [], endgame: [],
  };

  // Per-phase accuracy bucketed by game result
  type ResultKey = "wins" | "draws" | "losses";
  const phaseAccByResult: Record<"opening" | "middlegame" | "endgame", Record<ResultKey, number[]>> = {
    opening: { wins: [], draws: [], losses: [] },
    middlegame: { wins: [], draws: [], losses: [] },
    endgame: { wins: [], draws: [], losses: [] },
  };

  for (const pos of positions) {
    if (pos.eval == null || pos.cpLoss == null) continue;

    totalPositions++;

    // The mover is the opposite of sideToMove (sideToMove = who moves NEXT)
    const moverIsWhite = pos.sideToMove === "BLACK";
    const playerEvalCp = moverIsWhite ? pos.eval : -pos.eval;

    // Mutually exclusive classification — each position gets exactly one category
    const cat = resolveCategory(pos);
    categoryCounts[cat].total++;
    const isSuccess = pos.cpLoss < 50;
    if (isSuccess) {
      categoryCounts[cat].success++;
    }

    // Tactical motif breakdown for tactics positions
    if (cat === "tactics" && pos.bestMoveUci) {
      const pvMoves = pos.pv ? pos.pv.split(" ") : [];
      const labels = detectLabels(pos.fen, pos.bestMoveUci, pvMoves, "tactics");
      const counted = new Set<string>();
      for (const label of labels) {
        const key = MERGED_MOTIFS[label] || label;
        if (motifCounts[key] && !counted.has(key)) {
          counted.add(key);
          motifCounts[key].total++;
          if (isSuccess) motifCounts[key].success++;
        }
      }
    }

    // Back stats
    if (pos.classification === "BLUNDER") blunderCount++;
    if (playerEvalCp >= 200 && pos.cpLoss >= 200) missedWinCount++;
    if (playerEvalCp <= -200 && pos.cpLoss >= 200) missedSaveCount++;
  }

  // ── Per-phase accuracy (move accuracy via win% change) ──
  const phaseGamePositions: Record<number, PositionRow[]> = {};
  for (const pos of positions) {
    if (pos.eval == null) continue;
    if (!phaseGamePositions[pos.gameId]) phaseGamePositions[pos.gameId] = [];
    phaseGamePositions[pos.gameId].push(pos);
  }

  for (const gameIdStr of Object.keys(phaseGamePositions)) {
    const gameId = Number(gameIdStr);
    const gamePos = phaseGamePositions[gameId];
    const playerIsWhite = gamePlayerSide?.[gameId] === "WHITE";
    const sorted = gamePos.sort((a, b) => a.ply - b.ply);

    // Collect per-move accuracies grouped by phase
    const phaseAccs: Record<"opening" | "middlegame" | "endgame", number[]> = {
      opening: [], middlegame: [], endgame: [],
    };
    const allMoveAccs: number[] = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i];
      const next = sorted[i + 1];
      const moverIsWhite = curr.sideToMove === "WHITE";
      if (moverIsWhite !== playerIsWhite) continue;

      const evalBefore = moverIsWhite ? curr.eval! : -curr.eval!;
      const evalAfter = moverIsWhite ? next.eval! : -next.eval!;
      const winBefore = cpToWinPercent(evalBefore);
      const winAfter = cpToWinPercent(evalAfter);
      const acc = moveAccuracy(winBefore, winAfter);

      const isOpening = curr.ply <= 24;
      const isEndgame = !isOpening && isEndgamePosition(curr.fen);
      const phase: "opening" | "middlegame" | "endgame" = isOpening ? "opening" : isEndgame ? "endgame" : "middlegame";

      phaseAccs[phase].push(acc);
      allMoveAccs.push(acc);

      // Best move tracking
      // In the opening, treat book-quality moves (cpLoss ≤ 5) as "best moves"
      // since standard theory moves may differ from Stockfish's top pick
      if (curr.bestMoveUci) {
        phaseBestMoveTotal[phase]++;
        const isStockfishBest = curr.moveUci === curr.bestMoveUci;
        const isBookQuality = phase === "opening" && curr.cpLoss != null && curr.cpLoss <= 5;
        if (isStockfishBest || isBookQuality) phaseBestMoveHits[phase]++;
      }

      // Blunder tracking
      phaseMoveCount[phase]++;
      if (curr.classification === "BLUNDER") phaseBlunders[phase]++;

      // Per-phase missed win/save tracking
      if (curr.cpLoss != null && curr.cpLoss >= 200) {
        const playerEval = moverIsWhite ? curr.eval! : -curr.eval!;
        if (playerEval >= 200) phaseMissedWins[phase]++;
        if (playerEval <= -200) phaseMissedSaves[phase]++;
      }
    }

    // Track first/last eval per phase for eval delta (uses ALL positions, not filtered by side)
    const phaseFirstEval: Record<string, number | null> = { opening: null, middlegame: null, endgame: null };
    const phaseLastEval: Record<string, number | null> = { opening: null, middlegame: null, endgame: null };
    for (const pos of sorted) {
      if (pos.eval == null) continue;
      const isOpening = pos.ply <= 24;
      const isEnd = !isOpening && isEndgamePosition(pos.fen);
      const phase = isOpening ? "opening" : isEnd ? "endgame" : "middlegame";
      const cappedEval = Math.max(-1000, Math.min(1000, pos.eval));
      const playerEval = playerIsWhite ? cappedEval : -cappedEval;
      if (phaseFirstEval[phase] == null) phaseFirstEval[phase] = playerEval;
      phaseLastEval[phase] = playerEval;
    }
    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      if (phaseFirstEval[phase] != null && phaseLastEval[phase] != null) {
        phaseEvalDeltas[phase].push(phaseLastEval[phase]! - phaseFirstEval[phase]!);
      }
    }

    // Harmonic mean per phase for this game (lichess method)
    const resultKey: ResultKey | null =
      gameResults[gameId] === "WIN" ? "wins" :
      gameResults[gameId] === "LOSS" ? "losses" :
      gameResults[gameId] === "DRAW" ? "draws" : null;

    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      if (phaseAccs[phase].length > 0) {
        const capped = phaseAccs[phase].map((v) => Math.max(v, 24));
        const hm = harmonicMean(capped);
        phaseGameAccuracies[phase].push(hm);
        if (resultKey) phaseAccByResult[phase][resultKey].push(hm);
      }
    }

    // Overall accuracy for this game (winsorized harmonic mean, same as gameAccuracy)
    if (allMoveAccs.length > 0) {
      const capped = allMoveAccs.map((v) => Math.max(v, 24));
      const gameHm = harmonicMean(capped);
      overallGameAccuracies.push(gameHm);
      if (playerIsWhite) {
        whiteGameAccuracies.push(gameHm);
      } else {
        blackGameAccuracies.push(gameHm);
      }
    }
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

  function singleGameAccuracy(g: GameRow): number | null {
    if (g.accuracyWhite != null && g.accuracyBlack != null) {
      return (g.accuracyWhite + g.accuracyBlack) / 2;
    }
    return g.accuracyWhite ?? g.accuracyBlack ?? null;
  }

  const recentAccs = last5.map(singleGameAccuracy).filter((a): a is number => a != null);
  const allAccs = games.map(singleGameAccuracy).filter((a): a is number => a != null);

  let form = 0;
  if (recentAccs.length > 0 && allAccs.length > 0) {
    const recentAvg = recentAccs.reduce((s, v) => s + v, 0) / recentAccs.length;
    const overallAvg = allAccs.reduce((s, v) => s + v, 0) / allAccs.length;
    form = clamp(Math.round((recentAvg - overallAvg) / 2.5), -4, 4);
  }

  // ── Back stats (computed from position-level Stockfish data, same method as phase accuracy) ──
  const accWhite = whiteGameAccuracies.length > 0
    ? round2(whiteGameAccuracies.reduce((s, v) => s + v, 0) / whiteGameAccuracies.length)
    : null;
  const accBlack = blackGameAccuracies.length > 0
    ? round2(blackGameAccuracies.reduce((s, v) => s + v, 0) / blackGameAccuracies.length)
    : null;
  const accOverall = overallGameAccuracies.length > 0
    ? round2(overallGameAccuracies.reduce((s, v) => s + v, 0) / overallGameAccuracies.length)
    : null;

  // ── Build response ──
  const categories: Record<CategoryName, CategoryResult> = {} as any;
  for (const cat of CATEGORY_NAMES) {
    categories[cat] = {
      stat: stats[cat],
      percentage: round2(categoryData[cat].percentage * 100),
      successRate: round2(categoryData[cat].successRate * 100),
      total: categoryCounts[cat].total,
      success: categoryCounts[cat].success,
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
    phaseAccuracy: {
      opening: phaseGameAccuracies.opening.length > 0
        ? round2(phaseGameAccuracies.opening.reduce((a, b) => a + b, 0) / phaseGameAccuracies.opening.length)
        : null,
      middlegame: phaseGameAccuracies.middlegame.length > 0
        ? round2(phaseGameAccuracies.middlegame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.middlegame.length)
        : null,
      endgame: phaseGameAccuracies.endgame.length > 0
        ? round2(phaseGameAccuracies.endgame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.endgame.length)
        : null,
    },
    phaseAccuracyVsExpected: {
      opening: phaseGameAccuracies.opening.length > 0
        ? round1(
            phaseGameAccuracies.opening.reduce((a, b) => a + b, 0) / phaseGameAccuracies.opening.length
            - interpolateCurve(EXPECTED_OPENING_PHASE_ACCURACY_CURVE, chessRating)
          )
        : null,
      middlegame: phaseGameAccuracies.middlegame.length > 0
        ? round1(
            phaseGameAccuracies.middlegame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.middlegame.length
            - interpolateCurve(EXPECTED_MIDDLEGAME_ACCURACY_CURVE, chessRating)
          )
        : null,
      endgame: phaseGameAccuracies.endgame.length > 0
        ? round1(
            phaseGameAccuracies.endgame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.endgame.length
            - interpolateCurve(EXPECTED_ENDGAME_PHASE_ACCURACY_CURVE, chessRating)
          )
        : null,
    },
    phaseBestMoveRate: {
      opening: phaseBestMoveTotal.opening > 0
        ? round1((phaseBestMoveHits.opening / phaseBestMoveTotal.opening) * 100)
        : null,
      middlegame: phaseBestMoveTotal.middlegame > 0
        ? round1((phaseBestMoveHits.middlegame / phaseBestMoveTotal.middlegame) * 100)
        : null,
      endgame: phaseBestMoveTotal.endgame > 0
        ? round1((phaseBestMoveHits.endgame / phaseBestMoveTotal.endgame) * 100)
        : null,
    },
    phaseBestMoveRateVsExpected: {
      opening: phaseBestMoveTotal.opening > 0
        ? round1(
            (phaseBestMoveHits.opening / phaseBestMoveTotal.opening) * 100
            - interpolateCurve(EXPECTED_OPENING_BEST_MOVE_RATE_CURVE, chessRating)
          )
        : null,
      middlegame: phaseBestMoveTotal.middlegame > 0
        ? round1(
            (phaseBestMoveHits.middlegame / phaseBestMoveTotal.middlegame) * 100
            - interpolateCurve(EXPECTED_MIDDLEGAME_BEST_MOVE_RATE_CURVE, chessRating)
          )
        : null,
      endgame: phaseBestMoveTotal.endgame > 0
        ? round1(
            (phaseBestMoveHits.endgame / phaseBestMoveTotal.endgame) * 100
            - interpolateCurve(EXPECTED_ENDGAME_BEST_MOVE_RATE_CURVE, chessRating)
          )
        : null,
    },
    phaseAccuracyByResult: (() => {
      const MIN_GAMES = 3;
      const avg = (arr: number[]) => arr.length >= MIN_GAMES
        ? round1(arr.reduce((a, b) => a + b, 0) / arr.length)
        : null;
      return {
        opening: { wins: avg(phaseAccByResult.opening.wins), draws: avg(phaseAccByResult.opening.draws), losses: avg(phaseAccByResult.opening.losses) },
        middlegame: { wins: avg(phaseAccByResult.middlegame.wins), draws: avg(phaseAccByResult.middlegame.draws), losses: avg(phaseAccByResult.middlegame.losses) },
        endgame: { wins: avg(phaseAccByResult.endgame.wins), draws: avg(phaseAccByResult.endgame.draws), losses: avg(phaseAccByResult.endgame.losses) },
      };
    })(),
    phaseBlunderRate: {
      opening: phaseMoveCount.opening > 0
        ? round1((phaseBlunders.opening / phaseMoveCount.opening) * 100)
        : null,
      middlegame: phaseMoveCount.middlegame > 0
        ? round1((phaseBlunders.middlegame / phaseMoveCount.middlegame) * 100)
        : null,
      endgame: phaseMoveCount.endgame > 0
        ? round1((phaseBlunders.endgame / phaseMoveCount.endgame) * 100)
        : null,
    },
    phaseMedianAccuracy: (() => {
      const m = (arr: number[]) => { const v = median(arr); return v != null ? round2(v) : null; };
      return { opening: m(phaseGameAccuracies.opening), middlegame: m(phaseGameAccuracies.middlegame), endgame: m(phaseGameAccuracies.endgame) };
    })(),
    phaseMissedWinRate: {
      opening: phaseMoveCount.opening > 0
        ? round2((phaseMissedWins.opening / phaseMoveCount.opening) * 100)
        : null,
      middlegame: phaseMoveCount.middlegame > 0
        ? round2((phaseMissedWins.middlegame / phaseMoveCount.middlegame) * 100)
        : null,
      endgame: phaseMoveCount.endgame > 0
        ? round2((phaseMissedWins.endgame / phaseMoveCount.endgame) * 100)
        : null,
    },
    phaseMissedSaveRate: {
      opening: phaseMoveCount.opening > 0
        ? round2((phaseMissedSaves.opening / phaseMoveCount.opening) * 100)
        : null,
      middlegame: phaseMoveCount.middlegame > 0
        ? round2((phaseMissedSaves.middlegame / phaseMoveCount.middlegame) * 100)
        : null,
      endgame: phaseMoveCount.endgame > 0
        ? round2((phaseMissedSaves.endgame / phaseMoveCount.endgame) * 100)
        : null,
    },
    phaseEvalDelta: {
      opening: phaseEvalDeltas.opening.length > 0
        ? round1(phaseEvalDeltas.opening.reduce((a, b) => a + b, 0) / phaseEvalDeltas.opening.length)
        : null,
      middlegame: phaseEvalDeltas.middlegame.length > 0
        ? round1(phaseEvalDeltas.middlegame.reduce((a, b) => a + b, 0) / phaseEvalDeltas.middlegame.length)
        : null,
      endgame: phaseEvalDeltas.endgame.length > 0
        ? round1(phaseEvalDeltas.endgame.reduce((a, b) => a + b, 0) / phaseEvalDeltas.endgame.length)
        : null,
    },
    phaseBlunderRateVsExpected: {
      opening: phaseMoveCount.opening > 0
        ? round1((phaseBlunders.opening / phaseMoveCount.opening) * 100 - interpolateCurve(EXPECTED_OPENING_BLUNDER_RATE_CURVE, chessRating))
        : null,
      middlegame: phaseMoveCount.middlegame > 0
        ? round1((phaseBlunders.middlegame / phaseMoveCount.middlegame) * 100 - interpolateCurve(EXPECTED_MIDDLEGAME_BLUNDER_RATE_CURVE, chessRating))
        : null,
      endgame: phaseMoveCount.endgame > 0
        ? round1((phaseBlunders.endgame / phaseMoveCount.endgame) * 100 - interpolateCurve(EXPECTED_ENDGAME_BLUNDER_RATE_CURVE, chessRating))
        : null,
    },
    phaseMissedWinRateVsExpected: {
      opening: phaseMoveCount.opening > 0
        ? round1((phaseMissedWins.opening / phaseMoveCount.opening) * 100 - interpolateCurve(EXPECTED_OPENING_MISSED_WIN_RATE_CURVE, chessRating))
        : null,
      middlegame: phaseMoveCount.middlegame > 0
        ? round1((phaseMissedWins.middlegame / phaseMoveCount.middlegame) * 100 - interpolateCurve(EXPECTED_MIDDLEGAME_MISSED_WIN_RATE_CURVE, chessRating))
        : null,
      endgame: phaseMoveCount.endgame > 0
        ? round1((phaseMissedWins.endgame / phaseMoveCount.endgame) * 100 - interpolateCurve(EXPECTED_ENDGAME_MISSED_WIN_RATE_CURVE, chessRating))
        : null,
    },
    phaseMissedSaveRateVsExpected: {
      opening: phaseMoveCount.opening > 0
        ? round1((phaseMissedSaves.opening / phaseMoveCount.opening) * 100 - interpolateCurve(EXPECTED_OPENING_MISSED_SAVE_RATE_CURVE, chessRating))
        : null,
      middlegame: phaseMoveCount.middlegame > 0
        ? round1((phaseMissedSaves.middlegame / phaseMoveCount.middlegame) * 100 - interpolateCurve(EXPECTED_MIDDLEGAME_MISSED_SAVE_RATE_CURVE, chessRating))
        : null,
      endgame: phaseMoveCount.endgame > 0
        ? round1((phaseMissedSaves.endgame / phaseMoveCount.endgame) * 100 - interpolateCurve(EXPECTED_ENDGAME_MISSED_SAVE_RATE_CURVE, chessRating))
        : null,
    },
    phaseAccuracyByResultVsExpected: (() => {
      const accByResultActual = {
        opening: { wins: phaseAccByResult.opening.wins, draws: phaseAccByResult.opening.draws, losses: phaseAccByResult.opening.losses },
        middlegame: { wins: phaseAccByResult.middlegame.wins, draws: phaseAccByResult.middlegame.draws, losses: phaseAccByResult.middlegame.losses },
        endgame: { wins: phaseAccByResult.endgame.wins, draws: phaseAccByResult.endgame.draws, losses: phaseAccByResult.endgame.losses },
      };
      const MIN_GAMES = 3;
      const r: any = {};
      for (const phase of ["opening", "middlegame", "endgame"] as const) {
        const curve = phase === "opening" ? EXPECTED_OPENING_PHASE_ACCURACY_CURVE
          : phase === "middlegame" ? EXPECTED_MIDDLEGAME_ACCURACY_CURVE
          : EXPECTED_ENDGAME_PHASE_ACCURACY_CURVE;
        const base = interpolateCurve(curve, chessRating);
        const off = PHASE_RESULT_ACCURACY_OFFSETS[phase];
        const avg = (arr: number[]) => arr.length >= MIN_GAMES
          ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        const wAvg = avg(accByResultActual[phase].wins);
        const dAvg = avg(accByResultActual[phase].draws);
        const lAvg = avg(accByResultActual[phase].losses);
        r[phase] = {
          wins: wAvg != null ? round1(wAvg - (base + off.wins)) : null,
          draws: dAvg != null ? round1(dAvg - (base + off.draws)) : null,
          losses: lAvg != null ? round1(lAvg - (base + off.losses)) : null,
        };
      }
      return r;
    })(),
    tacticsBreakdown: Object.fromEntries(
      OUTPUT_MOTIFS
        .filter((m) => motifCounts[m].total > 0)
        .map((m) => [m, { success: motifCounts[m].success, total: motifCounts[m].total }])
    ),
    gamesAnalyzed: games.length,
  };
}
