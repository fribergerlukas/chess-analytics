/**
 * Collect per-phase accuracy data across rating brackets.
 *
 * Auto-discovers real chess.com players using:
 *   1. Titled player API (GM, IM, FM, NM, CM, WGM, WIM, WFM, WNM, WCM)
 *   2. Country player lists for lower brackets (sub-1500)
 *
 * For each player: imports blitz games, parses, evaluates with Stockfish,
 * computes accuracy, then calculates per-phase harmonic mean accuracy.
 *
 * Outputs JSON: { username, rating, bracket, opening, middlegame, endgame }[]
 *
 * Usage: npx ts-node src/jobs/collect-phase-data.ts
 */

import { importGames } from "../services/chesscom";
import { parseAllUnparsed } from "../services/positions";
import { evaluateAllUnevaluated } from "../services/evaluation";
import { computeAllAccuracy } from "../services/accuracy";
import { StockfishEngine } from "../services/stockfish";
import { cpToWinPercent, moveAccuracy, harmonicMean } from "../services/accuracy";
import prisma from "../lib/prisma";
import * as fs from "fs";
import * as path from "path";

// ── Configuration ────────────────────────────────────────────────────────

const GAMES_PER_PLAYER = 15;
const EVAL_DEPTH = 12;
const TARGET_PER_BRACKET = 3;
const API_DELAY_MS = 600; // delay between chess.com API calls

const BRACKETS = [
  { min: 0,    max: 800,  label: "0-800" },
  { min: 800,  max: 1000, label: "800-1000" },
  { min: 1000, max: 1200, label: "1000-1200" },
  { min: 1200, max: 1400, label: "1200-1400" },
  { min: 1400, max: 1600, label: "1400-1600" },
  { min: 1600, max: 1800, label: "1600-1800" },
  { min: 1800, max: 2000, label: "1800-2000" },
  { min: 2000, max: 2200, label: "2000-2200" },
  { min: 2200, max: 2400, label: "2200-2400" },
  { min: 2400, max: 2600, label: "2400-2600" },
  { min: 2600, max: 2800, label: "2600-2800" },
  { min: 2800, max: 9999, label: "2800+" },
];

// Titles to query for player discovery (lower titles help fill lower brackets)
const TITLES = ["GM", "IM", "FM", "NM", "CM", "WGM", "WIM", "WFM", "WNM", "WCM"];
const SAMPLES_PER_TITLE = 30;

// Small countries for discovering untitled lower-rated players
const COUNTRY_CODES = ["IS", "LU", "MT", "CY", "LI"];
const SAMPLES_PER_COUNTRY = 40;

// ── Helpers ──────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getBracketLabel(rating: number): string | null {
  for (const b of BRACKETS) {
    if (rating >= b.min && rating < b.max) return b.label;
  }
  return null;
}

interface PhaseDataPoint {
  username: string;
  rating: number;
  bracket: string;
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}

// ── Chess.com API wrappers with rate limiting ────────────────────────────

async function apiFetch(url: string): Promise<any | null> {
  await delay(API_DELAY_MS);
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      console.log("  Rate limited, waiting 10s...");
      await delay(10000);
      const retry = await fetch(url);
      if (!retry.ok) return null;
      return retry.json();
    }
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchBlitzRating(username: string): Promise<number | null> {
  const data = await apiFetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`
  );
  return data?.chess_blitz?.last?.rating ?? null;
}

async function fetchTitledPlayers(title: string): Promise<string[]> {
  const data = await apiFetch(`https://api.chess.com/pub/titled/${title}`);
  return data?.players ?? [];
}

async function fetchCountryPlayers(code: string): Promise<string[]> {
  const data = await apiFetch(
    `https://api.chess.com/pub/country/${code}/players`
  );
  return data?.players ?? [];
}

// ── Phase accuracy computation ──────────────────────────────────────────

function isEndgamePosition(fen: string): boolean {
  const boardPart = fen.split(" ")[0];
  let pieceCount = 0;
  for (const ch of boardPart) {
    if ("qrbnQRBN".includes(ch)) pieceCount++;
  }
  return pieceCount < 7;
}

async function computePhaseAccuracyForUser(username: string): Promise<{
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}> {
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
  });
  if (!user) return { opening: null, middlegame: null, endgame: null };

  const games = await prisma.game.findMany({
    where: { userId: user.id },
    select: { id: true, pgn: true },
  });

  const phaseGameAccuracies: Record<"opening" | "middlegame" | "endgame", number[]> = {
    opening: [],
    middlegame: [],
    endgame: [],
  };

  for (const game of games) {
    const whiteMatch = game.pgn.match(/\[White "([^"]+)"\]/);
    const playerIsWhite = whiteMatch
      ? whiteMatch[1].toLowerCase() === username.toLowerCase()
      : true;

    const positions = await prisma.position.findMany({
      where: { gameId: game.id, eval: { not: null } },
      select: { ply: true, fen: true, eval: true, sideToMove: true },
      orderBy: { ply: "asc" },
    });

    if (positions.length < 2) continue;

    const phaseAccs: Record<"opening" | "middlegame" | "endgame", number[]> = {
      opening: [],
      middlegame: [],
      endgame: [],
    };

    for (let i = 0; i < positions.length - 1; i++) {
      const curr = positions[i];
      const next = positions[i + 1];
      const moverIsWhite = curr.sideToMove === "WHITE";
      if (moverIsWhite !== playerIsWhite) continue;

      const evalBefore = moverIsWhite ? curr.eval! : -curr.eval!;
      const evalAfter = moverIsWhite ? next.eval! : -next.eval!;
      const winBefore = cpToWinPercent(evalBefore);
      const winAfter = cpToWinPercent(evalAfter);
      const acc = moveAccuracy(winBefore, winAfter);

      const isOpening = curr.ply <= 24;
      const isEndgame = !isOpening && isEndgamePosition(curr.fen);

      if (isOpening) phaseAccs.opening.push(acc);
      else if (isEndgame) phaseAccs.endgame.push(acc);
      else phaseAccs.middlegame.push(acc);
    }

    for (const phase of ["opening", "middlegame", "endgame"] as const) {
      if (phaseAccs[phase].length > 0) {
        phaseGameAccuracies[phase].push(harmonicMean(phaseAccs[phase]));
      }
    }
  }

  return {
    opening: phaseGameAccuracies.opening.length > 0
      ? phaseGameAccuracies.opening.reduce((a, b) => a + b, 0) / phaseGameAccuracies.opening.length
      : null,
    middlegame: phaseGameAccuracies.middlegame.length > 0
      ? phaseGameAccuracies.middlegame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.middlegame.length
      : null,
    endgame: phaseGameAccuracies.endgame.length > 0
      ? phaseGameAccuracies.endgame.reduce((a, b) => a + b, 0) / phaseGameAccuracies.endgame.length
      : null,
  };
}

// ── Player Discovery ────────────────────────────────────────────────────

async function discoverPlayers(): Promise<Map<string, string[]>> {
  const bracketPlayers = new Map<string, string[]>();
  for (const b of BRACKETS) bracketPlayers.set(b.label, []);

  const seen = new Set<string>();

  // Helper: check a username, assign to bracket if it fits and has room
  async function tryPlayer(username: string): Promise<boolean> {
    const key = username.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);

    const rating = await fetchBlitzRating(username);
    if (rating == null) return false;

    const label = getBracketLabel(rating);
    if (label == null) return false;

    const bucket = bracketPlayers.get(label)!;
    if (bucket.length >= TARGET_PER_BRACKET) return false;

    bucket.push(username);
    console.log(`  Found: ${username} (${rating}) → ${label} [${bucket.length}/${TARGET_PER_BRACKET}]`);
    return true;
  }

  function allBracketsFull(): boolean {
    for (const b of BRACKETS) {
      if (bracketPlayers.get(b.label)!.length < TARGET_PER_BRACKET) return false;
    }
    return true;
  }

  // Phase 1: Titled players (covers ~1500+)
  console.log("\n═══ Phase 1: Discovering titled players ═══\n");

  for (const title of TITLES) {
    if (allBracketsFull()) break;
    console.log(`Fetching ${title} list...`);
    const players = await fetchTitledPlayers(title);
    if (players.length === 0) {
      console.log(`  No players found for title ${title}`);
      continue;
    }
    console.log(`  Got ${players.length} ${title}s, sampling ${SAMPLES_PER_TITLE}...`);
    const sampled = shuffle(players).slice(0, SAMPLES_PER_TITLE);

    for (const username of sampled) {
      if (allBracketsFull()) break;
      await tryPlayer(username);
    }
  }

  // Phase 2: Country player lists (for lower brackets)
  const lowBracketsNeeded = BRACKETS
    .filter((b) => b.max <= 1600)
    .filter((b) => bracketPlayers.get(b.label)!.length < TARGET_PER_BRACKET);

  if (lowBracketsNeeded.length > 0) {
    console.log(`\n═══ Phase 2: Discovering players from small countries (need ${lowBracketsNeeded.map(b => b.label).join(", ")}) ═══\n`);

    for (const code of COUNTRY_CODES) {
      if (allBracketsFull()) break;
      console.log(`Fetching players from country ${code}...`);
      const players = await fetchCountryPlayers(code);
      if (players.length === 0) {
        console.log(`  No players found for ${code}`);
        continue;
      }
      console.log(`  Got ${players.length} players, sampling ${SAMPLES_PER_COUNTRY}...`);
      const sampled = shuffle(players).slice(0, SAMPLES_PER_COUNTRY);

      for (const username of sampled) {
        if (allBracketsFull()) break;
        await tryPlayer(username);
      }
    }
  }

  // Summary
  console.log("\n═══ Discovery Summary ═══\n");
  let totalPlayers = 0;
  for (const b of BRACKETS) {
    const count = bracketPlayers.get(b.label)!.length;
    totalPlayers += count;
    const status = count >= TARGET_PER_BRACKET ? "FULL" : count > 0 ? `${count}/${TARGET_PER_BRACKET}` : "EMPTY";
    console.log(`  ${b.label.padEnd(10)} ${status.padEnd(6)} ${bracketPlayers.get(b.label)!.join(", ")}`);
  }
  console.log(`\nTotal: ${totalPlayers} players discovered`);

  return bracketPlayers;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Phase Accuracy Data Collection");
  console.log("==============================\n");

  // Step 1: Discover players
  const bracketPlayers = await discoverPlayers();

  // Step 2: Process each player through the pipeline
  console.log("\n═══ Processing Players ═══\n");

  const engine = new StockfishEngine();
  await engine.init();
  console.log("Stockfish initialized\n");

  const results: PhaseDataPoint[] = [];
  let playerNum = 0;
  let totalPlayers = 0;
  for (const b of BRACKETS) totalPlayers += bracketPlayers.get(b.label)!.length;

  for (const bracket of BRACKETS) {
    const players = bracketPlayers.get(bracket.label)!;
    if (players.length === 0) continue;

    console.log(`\n── Bracket: ${bracket.label} (${players.length} players) ──`);

    for (const username of players) {
      playerNum++;
      console.log(`\n[${playerNum}/${totalPlayers}] Processing ${username}...`);

      try {
        // Get rating
        const rating = await fetchBlitzRating(username);
        if (rating == null) {
          console.log(`  Skipping: no blitz rating`);
          continue;
        }
        console.log(`  Rating: ${rating}`);

        // Import games
        const imported = await importGames(username, "blitz", true, GAMES_PER_PLAYER);
        console.log(`  Imported: ${imported} new games`);

        // Parse positions
        const parsed = await parseAllUnparsed();
        console.log(`  Parsed: ${parsed} games`);

        // Evaluate with Stockfish
        const evaluated = await evaluateAllUnevaluated(engine, EVAL_DEPTH);
        console.log(`  Evaluated: ${evaluated} games (depth ${EVAL_DEPTH})`);

        // Compute accuracy (cpLoss)
        const accuracyComputed = await computeAllAccuracy();
        console.log(`  Accuracy: ${accuracyComputed} games`);

        // Compute phase accuracies
        const phaseAcc = await computePhaseAccuracyForUser(username);
        console.log(`  Phase accuracy: OPN=${phaseAcc.opening?.toFixed(1) ?? "—"} MID=${phaseAcc.middlegame?.toFixed(1) ?? "—"} END=${phaseAcc.endgame?.toFixed(1) ?? "—"}`);

        if (phaseAcc.opening != null || phaseAcc.middlegame != null || phaseAcc.endgame != null) {
          results.push({
            username,
            rating,
            bracket: bracket.label,
            ...phaseAcc,
          });

          // Save intermediate results after each player
          const outPath = path.join(__dirname, "../../phase-accuracy-data.json");
          fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
        }
      } catch (err) {
        console.error(`  Error processing ${username}:`, err);
      }
    }
  }

  engine.shutdown();

  // Final save
  const outPath = path.join(__dirname, "../../phase-accuracy-data.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n══════════════════════════════`);
  console.log(`Done! Wrote ${results.length} data points to ${outPath}`);

  await prisma.$disconnect();
}

main();
