/**
 * Build phase accuracy curves from collected data.
 *
 * Reads phase-accuracy-data.json (output of collect-phase-data.ts),
 * groups by rating bracket, averages phase accuracies, and outputs
 * RatePoint[] arrays ready to paste into arenaStats.ts.
 *
 * Usage: npx ts-node src/jobs/build-phase-curves.ts
 */

import * as fs from "fs";
import * as path from "path";

interface PhaseDataPoint {
  username: string;
  rating: number;
  bracket: string;
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}

function main() {
  const dataPath = path.join(__dirname, "../../phase-accuracy-data.json");
  if (!fs.existsSync(dataPath)) {
    console.error("phase-accuracy-data.json not found. Run collect-phase-data.ts first.");
    process.exit(1);
  }

  const data: PhaseDataPoint[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Loaded ${data.length} data points\n`);

  // Group by bracket
  const brackets = new Map<string, PhaseDataPoint[]>();
  for (const point of data) {
    if (!brackets.has(point.bracket)) brackets.set(point.bracket, []);
    brackets.get(point.bracket)!.push(point);
  }

  // Compute averages per bracket
  const curvePoints: { rating: number; opening: number; middlegame: number; endgame: number }[] = [];

  for (const [bracket, points] of brackets) {
    const avgRating = Math.round(points.reduce((s, p) => s + p.rating, 0) / points.length);

    const openingVals = points.filter((p) => p.opening != null).map((p) => p.opening!);
    const middlegameVals = points.filter((p) => p.middlegame != null).map((p) => p.middlegame!);
    const endgameVals = points.filter((p) => p.endgame != null).map((p) => p.endgame!);

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    curvePoints.push({
      rating: avgRating,
      opening: Math.round(avg(openingVals) * 10) / 10,
      middlegame: Math.round(avg(middlegameVals) * 10) / 10,
      endgame: Math.round(avg(endgameVals) * 10) / 10,
    });

    console.log(`${bracket} (avg rating ${avgRating}, n=${points.length}):`);
    console.log(`  Opening:    ${avg(openingVals).toFixed(1)}%  (n=${openingVals.length})`);
    console.log(`  Middlegame: ${avg(middlegameVals).toFixed(1)}%  (n=${middlegameVals.length})`);
    console.log(`  Endgame:    ${avg(endgameVals).toFixed(1)}%  (n=${endgameVals.length})`);
  }

  // Sort by rating
  curvePoints.sort((a, b) => a.rating - b.rating);

  // Output as TypeScript constants
  console.log("\n\n// ── Paste these into arenaStats.ts ──\n");

  console.log("const EXPECTED_OPENING_PHASE_ACCURACY_CURVE: RatePoint[] = [");
  for (const p of curvePoints) {
    console.log(`  { rating: ${p.rating}, rate: ${p.opening} },`);
  }
  console.log("];\n");

  console.log("const EXPECTED_MIDDLEGAME_ACCURACY_CURVE: RatePoint[] = [");
  for (const p of curvePoints) {
    console.log(`  { rating: ${p.rating}, rate: ${p.middlegame} },`);
  }
  console.log("];\n");

  console.log("const EXPECTED_ENDGAME_PHASE_ACCURACY_CURVE: RatePoint[] = [");
  for (const p of curvePoints) {
    console.log(`  { rating: ${p.rating}, rate: ${p.endgame} },`);
  }
  console.log("];");
}

main();
