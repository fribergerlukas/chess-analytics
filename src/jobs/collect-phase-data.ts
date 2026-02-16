/**
 * Collect per-phase accuracy data one rating bracket at a time.
 *
 * Discovers real chess.com players via titled player + country player APIs,
 * imports their blitz games, evaluates with Stockfish, then computes
 * per-phase harmonic mean accuracy.
 *
 * Targets 10 players / 20 games each per bracket for statistical soundness
 * (~200 games per bracket). Appends to existing data file so you can run
 * one bracket at a time.
 *
 * Usage:
 *   npx ts-node src/jobs/collect-phase-data.ts 0-800
 *   npx ts-node src/jobs/collect-phase-data.ts 800-1000
 *   npx ts-node src/jobs/collect-phase-data.ts all          (run all brackets sequentially)
 *   npx ts-node src/jobs/collect-phase-data.ts status        (show current data counts)
 */

import { importGames } from "../services/chesscom";
import { parseAllUnparsed } from "../services/positions";
import { evaluateGamePositions } from "../services/evaluation";
import { computeAllAccuracy } from "../services/accuracy";
import { StockfishEngine } from "../services/stockfish";
import { cpToWinPercent, moveAccuracy, harmonicMean } from "../services/accuracy";
import prisma from "../lib/prisma";
import * as fs from "fs";
import * as path from "path";

// ── Configuration ────────────────────────────────────────────────────────

const GAMES_PER_PLAYER = 20;
const EVAL_DEPTH = 12;
const TARGET_PER_BRACKET = 30;
const API_DELAY_MS = 600;

const DATA_FILE = path.join(__dirname, "../../phase-accuracy-data.json");

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

// Title lists ordered so lower-rated titles come first (better for filling low brackets)
// and higher-rated titles come later. We'll query all but stop early once the target bracket is full.
const TITLE_SOURCES: { title: string; sampleSize: number }[] = [
  { title: "WCM", sampleSize: 80 },
  { title: "WNM", sampleSize: 30 },
  { title: "WFM", sampleSize: 80 },
  { title: "CM",  sampleSize: 80 },
  { title: "NM",  sampleSize: 80 },
  { title: "WIM", sampleSize: 60 },
  { title: "FM",  sampleSize: 80 },
  { title: "WGM", sampleSize: 40 },
  { title: "IM",  sampleSize: 60 },
  { title: "GM",  sampleSize: 60 },
];

// Countries for discovering untitled low-rated players
const COUNTRY_CODES = ["IS", "LU", "MT", "CY", "LI", "EE", "LV", "HR", "SI", "SK"];
const SAMPLES_PER_COUNTRY = 60;

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

interface PhaseDataPoint {
  username: string;
  rating: number;
  bracket: string;
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}

function loadExistingData(): PhaseDataPoint[] {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }
  return [];
}

function saveData(data: PhaseDataPoint[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Chess.com API wrappers ──────────────────────────────────────────────

async function apiFetch(url: string): Promise<any | null> {
  await delay(API_DELAY_MS);
  try {
    const res = await fetch(url);
    if (res.status === 429) {
      console.log("  Rate limited, waiting 15s...");
      await delay(15000);
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
  gameCount: number;
}> {
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
  });
  if (!user) return { opening: null, middlegame: null, endgame: null, gameCount: 0 };

  const games = await prisma.game.findMany({
    where: { userId: user.id },
    select: { id: true, pgn: true },
  });

  const phaseGameAccuracies: Record<"opening" | "middlegame" | "endgame", number[]> = {
    opening: [],
    middlegame: [],
    endgame: [],
  };

  let gamesWithData = 0;

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
    gamesWithData++;

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
        const capped = phaseAccs[phase].map((v) => Math.max(v, 24));
        phaseGameAccuracies[phase].push(harmonicMean(capped));
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
    gameCount: gamesWithData,
  };
}

// ── Player Discovery (for a single target bracket) ──────────────────────

async function discoverPlayersForBracket(
  targetBracket: { min: number; max: number; label: string },
  existingUsernames: Set<string>,
): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>(existingUsernames);

  async function tryPlayer(username: string): Promise<boolean> {
    const key = username.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);

    const rating = await fetchBlitzRating(username);
    if (rating == null) return false;
    if (rating < targetBracket.min || rating >= targetBracket.max) return false;

    found.push(username);
    console.log(`  Found: ${username} (${rating}) [${found.length}/${TARGET_PER_BRACKET}]`);
    return true;
  }

  // For brackets under 1600, prioritize country lists (untitled players)
  // For brackets 1600+, prioritize titled players
  const useCountriesFirst = targetBracket.max <= 1600;

  if (useCountriesFirst) {
    console.log(`\nDiscovering untitled players from country lists...`);
    for (const code of COUNTRY_CODES) {
      if (found.length >= TARGET_PER_BRACKET) break;
      console.log(`  Fetching ${code}...`);
      const players = await fetchCountryPlayers(code);
      if (players.length === 0) continue;
      console.log(`  Got ${players.length} players, sampling ${SAMPLES_PER_COUNTRY}...`);
      const sampled = shuffle(players).slice(0, SAMPLES_PER_COUNTRY);
      for (const u of sampled) {
        if (found.length >= TARGET_PER_BRACKET) break;
        await tryPlayer(u);
      }
    }
  }

  // Titled player discovery
  if (found.length < TARGET_PER_BRACKET) {
    console.log(`\nDiscovering from titled player lists...`);
    for (const { title, sampleSize } of TITLE_SOURCES) {
      if (found.length >= TARGET_PER_BRACKET) break;
      console.log(`  Fetching ${title}s...`);
      const players = await fetchTitledPlayers(title);
      if (players.length === 0) continue;
      console.log(`  Got ${players.length}, sampling ${sampleSize}...`);
      const sampled = shuffle(players).slice(0, sampleSize);
      for (const u of sampled) {
        if (found.length >= TARGET_PER_BRACKET) break;
        await tryPlayer(u);
      }
    }
  }

  // For high brackets, also try country lists if still short
  if (!useCountriesFirst && found.length < TARGET_PER_BRACKET) {
    console.log(`\nSupplementing from country player lists...`);
    for (const code of COUNTRY_CODES) {
      if (found.length >= TARGET_PER_BRACKET) break;
      const players = await fetchCountryPlayers(code);
      if (players.length === 0) continue;
      const sampled = shuffle(players).slice(0, SAMPLES_PER_COUNTRY);
      for (const u of sampled) {
        if (found.length >= TARGET_PER_BRACKET) break;
        await tryPlayer(u);
      }
    }
  }

  return found;
}

// ── Process a single player ─────────────────────────────────────────────

async function processPlayer(
  engine: StockfishEngine,
  username: string,
  bracketLabel: string,
): Promise<PhaseDataPoint | null> {
  // Get rating
  const rating = await fetchBlitzRating(username);
  if (rating == null) {
    console.log(`  Skipping: no blitz rating`);
    return null;
  }
  console.log(`  Rating: ${rating}`);

  // Import games
  const imported = await importGames(username, "blitz", true, GAMES_PER_PLAYER);
  console.log(`  Imported: ${imported} new games`);

  // Parse positions
  const parsed = await parseAllUnparsed();
  console.log(`  Parsed: ${parsed} games`);

  // Evaluate only this user's games (not the entire DB backlog)
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
  });
  if (user) {
    const unevaluatedGames = await prisma.game.findMany({
      where: {
        userId: user.id,
        positionsParsed: true,
        positions: { some: { eval: null } },
      },
      select: { id: true },
    });
    let evalCount = 0;
    for (const { id } of unevaluatedGames) {
      try {
        const count = await evaluateGamePositions(engine, id, EVAL_DEPTH);
        if (count > 0) evalCount++;
      } catch (err) {
        console.error(`  Game ${id}: eval failed —`, err);
      }
    }
    console.log(`  Evaluated: ${evalCount} games (depth ${EVAL_DEPTH})`);
  }

  // Compute accuracy (cpLoss) — only for games missing it
  const accuracyComputed = await computeAllAccuracy();
  if (accuracyComputed > 0) console.log(`  Accuracy: ${accuracyComputed} games`);

  // Compute phase accuracies
  const phaseAcc = await computePhaseAccuracyForUser(username);
  console.log(`  Phase accuracy: OPN=${phaseAcc.opening?.toFixed(1) ?? "—"} MID=${phaseAcc.middlegame?.toFixed(1) ?? "—"} END=${phaseAcc.endgame?.toFixed(1) ?? "—"} (${phaseAcc.gameCount} games)`);

  if (phaseAcc.opening == null && phaseAcc.middlegame == null && phaseAcc.endgame == null) {
    return null;
  }

  return {
    username,
    rating,
    bracket: bracketLabel,
    opening: phaseAcc.opening,
    middlegame: phaseAcc.middlegame,
    endgame: phaseAcc.endgame,
  };
}

// ── Harvest existing DB players (no Stockfish needed) ────────────────────

async function harvestExistingPlayers(): Promise<number> {
  console.log("\n═══ Harvesting phase accuracy from existing DB players ═══\n");

  const allData = loadExistingData();
  const existingUsernames = new Set(allData.map((d) => d.username.toLowerCase()));

  // Find all users with at least 5 evaluated games
  const users = await prisma.user.findMany({
    select: { id: true, username: true },
  });

  let added = 0;

  for (const user of users) {
    if (existingUsernames.has(user.username.toLowerCase())) {
      console.log(`  ${user.username}: already in data file, skipping`);
      continue;
    }

    // Count evaluated games
    const evalGameCount = await prisma.game.count({
      where: { userId: user.id, positions: { some: { eval: { not: null } } } },
    });

    if (evalGameCount < 5) {
      console.log(`  ${user.username}: only ${evalGameCount} evaluated games, skipping (need 5+)`);
      continue;
    }

    // Fetch blitz rating from chess.com
    const rating = await fetchBlitzRating(user.username);
    if (rating == null) {
      console.log(`  ${user.username}: no blitz rating on chess.com, skipping`);
      continue;
    }

    const bracket = BRACKETS.find((b) => rating >= b.min && rating < b.max);
    if (!bracket) {
      console.log(`  ${user.username}: rating ${rating} doesn't fit any bracket, skipping`);
      continue;
    }

    // Compute phase accuracy (fast — just DB reads, no Stockfish)
    const phaseAcc = await computePhaseAccuracyForUser(user.username);

    if (phaseAcc.opening == null && phaseAcc.middlegame == null && phaseAcc.endgame == null) {
      console.log(`  ${user.username}: no phase accuracy data, skipping`);
      continue;
    }

    const point: PhaseDataPoint = {
      username: user.username,
      rating,
      bracket: bracket.label,
      opening: phaseAcc.opening,
      middlegame: phaseAcc.middlegame,
      endgame: phaseAcc.endgame,
    };

    // Append immediately
    const currentData = loadExistingData();
    currentData.push(point);
    saveData(currentData);
    added++;

    console.log(`  ${user.username}: rating ${rating} → ${bracket.label} | OPN=${phaseAcc.opening?.toFixed(1) ?? "—"} MID=${phaseAcc.middlegame?.toFixed(1) ?? "—"} END=${phaseAcc.endgame?.toFixed(1) ?? "—"} (${phaseAcc.gameCount} games)`);
  }

  console.log(`\nHarvested ${added} new data points from existing DB players.`);
  return added;
}

// ── Status command ──────────────────────────────────────────────────────

function showStatus(): void {
  const data = loadExistingData();
  console.log(`\nPhase Accuracy Data — ${data.length} total data points\n`);

  for (const b of BRACKETS) {
    const points = data.filter((d) => d.bracket === b.label);
    const opn = points.filter((d) => d.opening != null);
    const mid = points.filter((d) => d.middlegame != null);
    const end = points.filter((d) => d.endgame != null);

    const avgOpn = opn.length > 0 ? (opn.reduce((s, d) => s + d.opening!, 0) / opn.length).toFixed(1) : "—";
    const avgMid = mid.length > 0 ? (mid.reduce((s, d) => s + d.middlegame!, 0) / mid.length).toFixed(1) : "—";
    const avgEnd = end.length > 0 ? (end.reduce((s, d) => s + d.endgame!, 0) / end.length).toFixed(1) : "—";

    const status = points.length >= TARGET_PER_BRACKET ? "DONE" : `${points.length}/${TARGET_PER_BRACKET}`;
    console.log(`  ${b.label.padEnd(10)} ${status.padEnd(7)} OPN=${avgOpn.toString().padEnd(5)} MID=${avgMid.toString().padEnd(5)} END=${avgEnd.toString().padEnd(5)}  (n=${points.length})`);
  }

  const complete = BRACKETS.filter((b) => data.filter((d) => d.bracket === b.label).length >= TARGET_PER_BRACKET).length;
  console.log(`\n${complete}/${BRACKETS.length} brackets complete`);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.log("Usage:");
    console.log("  npx ts-node src/jobs/collect-phase-data.ts <bracket>   Run one bracket");
    console.log("  npx ts-node src/jobs/collect-phase-data.ts all         Run all brackets");
    console.log("  npx ts-node src/jobs/collect-phase-data.ts status      Show current data");
    console.log("  npx ts-node src/jobs/collect-phase-data.ts harvest     Harvest existing DB players");
    console.log("\nBrackets:", BRACKETS.map((b) => b.label).join(", "));
    await prisma.$disconnect();
    return;
  }

  if (arg === "status") {
    showStatus();
    await prisma.$disconnect();
    return;
  }

  if (arg === "harvest") {
    await harvestExistingPlayers();
    showStatus();
    await prisma.$disconnect();
    return;
  }

  // Determine which brackets to run
  const bracketsToRun = arg === "all"
    ? BRACKETS
    : BRACKETS.filter((b) => b.label === arg);

  if (bracketsToRun.length === 0) {
    console.error(`Unknown bracket: "${arg}"`);
    console.log("Available:", BRACKETS.map((b) => b.label).join(", "));
    await prisma.$disconnect();
    return;
  }

  const engine = new StockfishEngine();
  await engine.init();
  console.log("Stockfish initialized\n");

  for (const bracket of bracketsToRun) {
    console.log(`\n${"═".repeat(50)}`);
    console.log(`  Bracket: ${bracket.label} (target: ${TARGET_PER_BRACKET} players)`);
    console.log(`${"═".repeat(50)}`);

    // Load existing data and see how many we already have for this bracket
    const allData = loadExistingData();
    const existingForBracket = allData.filter((d) => d.bracket === bracket.label);
    const existingUsernames = new Set(allData.map((d) => d.username.toLowerCase()));
    const needed = TARGET_PER_BRACKET - existingForBracket.length;

    if (needed <= 0) {
      console.log(`\nAlready have ${existingForBracket.length} players — skipping.`);
      continue;
    }
    console.log(`\nHave ${existingForBracket.length}, need ${needed} more players.`);

    // Discover players
    const players = await discoverPlayersForBracket(bracket, existingUsernames);
    const toProcess = players.slice(0, needed);

    if (toProcess.length === 0) {
      console.log(`\nCould not find enough players for ${bracket.label}.`);
      continue;
    }

    console.log(`\nProcessing ${toProcess.length} players...\n`);

    // Process each player
    for (let i = 0; i < toProcess.length; i++) {
      const username = toProcess[i];
      console.log(`\n[${i + 1}/${toProcess.length}] ${username}`);

      try {
        const result = await processPlayer(engine, username, bracket.label);
        if (result) {
          // Append to data file immediately
          const currentData = loadExistingData();
          currentData.push(result);
          saveData(currentData);
          console.log(`  Saved. Total: ${currentData.filter((d) => d.bracket === bracket.label).length}/${TARGET_PER_BRACKET} for ${bracket.label}`);
        }
      } catch (err) {
        console.error(`  Error processing ${username}:`, err);
      }
    }

    // Show bracket summary
    const finalData = loadExistingData();
    const bracketData = finalData.filter((d) => d.bracket === bracket.label);
    const opn = bracketData.filter((d) => d.opening != null);
    const mid = bracketData.filter((d) => d.middlegame != null);
    const end = bracketData.filter((d) => d.endgame != null);
    console.log(`\n── ${bracket.label} Summary ──`);
    console.log(`  Players: ${bracketData.length}`);
    console.log(`  Opening:    ${opn.length > 0 ? (opn.reduce((s, d) => s + d.opening!, 0) / opn.length).toFixed(1) + "%" : "—"} (n=${opn.length})`);
    console.log(`  Middlegame: ${mid.length > 0 ? (mid.reduce((s, d) => s + d.middlegame!, 0) / mid.length).toFixed(1) + "%" : "—"} (n=${mid.length})`);
    console.log(`  Endgame:    ${end.length > 0 ? (end.reduce((s, d) => s + d.endgame!, 0) / end.length).toFixed(1) + "%" : "—"} (n=${end.length})`);
  }

  engine.shutdown();

  // Final status
  console.log("\n");
  showStatus();

  await prisma.$disconnect();
}

main();
