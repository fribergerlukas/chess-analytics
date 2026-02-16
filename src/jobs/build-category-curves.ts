/**
 * Build per-category expected score curves from collected data.
 *
 * Reads category-score-data.json (output of collect-category-data.ts),
 * groups by rating bracket, averages each category's successRate, and outputs
 * 6 RatePoint[] arrays ready to paste into arenaStats.ts.
 *
 * Usage: npx ts-node src/jobs/build-category-curves.ts
 */

import * as fs from "fs";
import * as path from "path";

interface CategoryDataPoint {
  username: string;
  rating: number;
  bracket: string;
  attacking: number;
  defending: number;
  tactics: number;
  positional: number;
  opening: number;
  endgame: number;
}

const CATEGORIES = ["attacking", "defending", "tactics", "positional", "opening", "endgame"] as const;

function main() {
  const dataPath = path.join(__dirname, "../../category-score-data.json");
  if (!fs.existsSync(dataPath)) {
    console.error("category-score-data.json not found. Run collect-category-data.ts first.");
    process.exit(1);
  }

  const data: CategoryDataPoint[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
  console.log(`Loaded ${data.length} data points\n`);

  // Group by bracket
  const brackets = new Map<string, CategoryDataPoint[]>();
  for (const point of data) {
    if (!brackets.has(point.bracket)) brackets.set(point.bracket, []);
    brackets.get(point.bracket)!.push(point);
  }

  // Compute averages per bracket
  const curvePoints: { rating: number; attacking: number; defending: number; tactics: number; positional: number; opening: number; endgame: number }[] = [];

  for (const [bracket, points] of brackets) {
    const avgRating = Math.round(points.reduce((s, p) => s + p.rating, 0) / points.length);
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const row: any = { rating: avgRating };
    for (const cat of CATEGORIES) {
      const vals = points.map((p) => p[cat]);
      row[cat] = Math.round(avg(vals) * 10) / 10;
    }
    curvePoints.push(row);

    console.log(`${bracket} (avg rating ${avgRating}, n=${points.length}):`);
    for (const cat of CATEGORIES) {
      const vals = points.map((p) => p[cat]);
      console.log(`  ${cat.padEnd(12)} ${avg(vals).toFixed(1)}%`);
    }
  }

  // Sort by rating
  curvePoints.sort((a, b) => a.rating - b.rating);

  // Output as TypeScript constants
  console.log("\n\n// ── Paste these into arenaStats.ts ──\n");

  for (const cat of CATEGORIES) {
    const constName = `EXPECTED_${cat.toUpperCase()}_SCORE_CURVE`;
    console.log(`const ${constName}: RatePoint[] = [`);
    for (const p of curvePoints) {
      console.log(`  { rating: ${p.rating}, rate: ${(p as any)[cat]} },`);
    }
    console.log("];\n");
  }
}

main();
