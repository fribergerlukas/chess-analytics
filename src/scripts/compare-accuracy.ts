/**
 * Fine-grained search around k=0.003, d=0.085-0.110, wh f=20-35.
 * Also explore: dynamic floor, and the 100*exp(-d*diff) simple variant.
 */
import prisma from "../lib/prisma";
import { harmonicMean } from "../services/accuracy";

const USERNAME = process.argv[2] || "grandmother69";

function pgnHeader(pgn: string, header: string): string | null {
  const match = pgn.match(new RegExp(`\\[${header} "([^"]*)"\\]`));
  return match ? match[1] : null;
}

interface ChessComGame { url: string; accuracies?: { white: number; black: number }; }

async function fetchChessComGames(username: string, year: number, month: number): Promise<ChessComGame[]> {
  const mm = String(month).padStart(2, "0");
  const url = `https://api.chess.com/pub/player/${username.toLowerCase()}/games/${year}/${mm}`;
  const res = await fetch(url, { headers: { "User-Agent": "chess-analytics/1.0" } });
  if (!res.ok) return [];
  return ((await res.json()) as { games: ChessComGame[] }).games || [];
}

function cpToWP(cp: number, k: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-k * cp)) - 1);
}

function winsorizedHarmonic(accs: number[], floor: number): number {
  if (accs.length === 0) return 0;
  return harmonicMean(accs.map((v) => Math.max(v, floor)));
}

interface GameSample {
  id: number; pgn: string; isWhite: boolean; ccAccuracy: number;
  moves: { sideToMove: string; currEval: number; nextEval: number }[];
  evalDepth: number; result: string; moveCount: number;
}

async function main() {
  console.log(`Loading games...\n`);

  const allGames = await prisma.game.findMany({
    where: {
      user: { username: { equals: USERNAME, mode: "insensitive" } },
      positions: { some: { eval: { not: null } } },
    },
    select: { id: true, pgn: true, endDate: true, result: true },
    orderBy: { endDate: "desc" },
  });

  const monthsToFetch = new Set<string>();
  for (const g of allGames) { const d = new Date(g.endDate); monthsToFetch.add(`${d.getUTCFullYear()}/${d.getUTCMonth() + 1}`); }
  const ccGames: ChessComGame[] = [];
  for (const ym of monthsToFetch) { const [y, m] = ym.split("/").map(Number); ccGames.push(...(await fetchChessComGames(USERNAME, y, m))); }

  const samples: GameSample[] = [];
  for (const game of allGames) {
    const link = pgnHeader(game.pgn, "Link");
    if (!link) continue;
    const ccg = ccGames.find((x) => x.url === link);
    if (!ccg?.accuracies) continue;
    const isWhite = (pgnHeader(game.pgn, "White") || "").toLowerCase() === USERNAME.toLowerCase();

    const positions = await prisma.position.findMany({
      where: { gameId: game.id, eval: { not: null } },
      select: { ply: true, eval: true, evalDepth: true, sideToMove: true },
      orderBy: { ply: "asc" },
    });
    if (positions.length < 4) continue;

    const moves: GameSample["moves"] = [];
    let pm = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      moves.push({ sideToMove: positions[i].sideToMove, currEval: positions[i].eval!, nextEval: positions[i + 1].eval! });
      if ((isWhite && positions[i].sideToMove === "WHITE") || (!isWhite && positions[i].sideToMove === "BLACK")) pm++;
    }
    const minD = Math.min(...positions.filter(p => p.evalDepth != null).map(p => p.evalDepth!));
    samples.push({ id: game.id, pgn: game.pgn, isWhite, ccAccuracy: isWhite ? ccg.accuracies.white : ccg.accuracies.black, moves, evalDepth: minD, result: game.result, moveCount: pm });
  }

  const n = samples.length;
  const wins = samples.filter(s => s.result === "WIN");
  const losses = samples.filter(s => s.result === "LOSS");
  const d20 = samples.filter(s => s.evalDepth === 20);
  console.log(`${n} games (${wins.length}W, ${losses.length}L, ${d20.length} depth20)\n`);

  function getAccs(s: GameSample, sigK: number, decay: number): number[] {
    const accs: number[] = [];
    for (const m of s.moves) {
      if ((s.isWhite && m.sideToMove === "WHITE") || (!s.isWhite && m.sideToMove === "BLACK")) {
        const sign = s.isWhite ? 1 : -1;
        const wb = cpToWP(sign * m.currEval, sigK);
        const wa = cpToWP(sign * m.nextEval, sigK);
        if (wa >= wb) { accs.push(100); continue; }
        const diff = wb - wa;
        accs.push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-decay * diff) - 3.1669 + 1)));
      }
    }
    return accs;
  }

  function score(fn: (s: GameSample) => number, subset: GameSample[]) {
    const diffs = subset.map(s => fn(s) - s.ccAccuracy);
    const nn = diffs.length;
    return {
      avgDiff: diffs.reduce((a, b) => a + b, 0) / nn,
      avgAbs: diffs.reduce((a, b) => a + Math.abs(b), 0) / nn,
      rmse: Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / nn),
      w2: diffs.filter(d => Math.abs(d) <= 2).length,
      w5: diffs.filter(d => Math.abs(d) <= 5).length,
    };
  }

  // Fine grid
  const sigKs = [0.00250, 0.00275, 0.00300, 0.00325, 0.00350];
  const decays = [0.080, 0.085, 0.090, 0.095, 0.100, 0.105, 0.110, 0.115, 0.120];
  const floors = [20, 24, 28, 32, 36];

  type Result = {
    label: string; sigK: number; decay: number; floor: number;
    rmse: number; avgDiff: number; avgAbs: number; w2: number; w5: number;
    wDiff: number; lDiff: number; wRmse: number; lRmse: number;
    d20Rmse: number; d20Abs: number;
  };
  const results: Result[] = [];

  for (const sigK of sigKs) {
    for (const decay of decays) {
      for (const floor of floors) {
        const fn = (s: GameSample) => {
          const accs = getAccs(s, sigK, decay);
          return accs.length > 0 ? Math.round(winsorizedHarmonic(accs, floor) * 100) / 100 : 0;
        };
        const all = score(fn, samples);
        const w = score(fn, wins);
        const l = score(fn, losses);
        const dd = score(fn, d20);
        results.push({
          label: `k=${sigK.toFixed(4)} d=${decay.toFixed(3)} f=${floor}`,
          sigK, decay, floor,
          ...all, wDiff: w.avgDiff, lDiff: l.avgDiff, wRmse: w.rmse, lRmse: l.rmse,
          d20Rmse: dd.rmse, d20Abs: dd.avgAbs,
        });
      }
    }
  }

  results.sort((a, b) => a.rmse - b.rmse);

  console.log("Top 20 by RMSE:\n");
  console.log("Rank | Config                      | AvgDif | Avg|d| | RMSE  | ≤2%  | ≤5%  | W-Diff | L-Diff | D20-RMSE");
  console.log("-----|------------------------------|--------|--------|-------|------|------|--------|--------|--------");

  for (let i = 0; i < 20; i++) {
    const r = results[i];
    console.log(
      `${String(i+1).padStart(4)} | ${r.label.padEnd(28)} | ${(r.avgDiff>=0?"+":"")+r.avgDiff.toFixed(2).padStart(5)}% | ${r.avgAbs.toFixed(2).padStart(5)}% | ${r.rmse.toFixed(2).padStart(5)} | ${String(r.w2).padStart(3)}/${n} | ${String(r.w5).padStart(3)}/${n} | ${(r.wDiff>=0?"+":"")+r.wDiff.toFixed(1).padStart(5)}% | ${(r.lDiff>=0?"+":"")+r.lDiff.toFixed(1).padStart(5)}% | ${r.d20Rmse.toFixed(2).padStart(6)}`
    );
  }

  // Show depth-20 only leaderboard
  console.log(`\n\nTop 10 for depth-20 games only (${d20.length} games):\n`);
  const d20Results = results.map(r => {
    const fn = (s: GameSample) => {
      const accs = getAccs(s, r.sigK, r.decay);
      return accs.length > 0 ? Math.round(winsorizedHarmonic(accs, r.floor) * 100) / 100 : 0;
    };
    return { label: r.label, ...score(fn, d20) };
  });
  d20Results.sort((a, b) => a.rmse - b.rmse);
  for (let i = 0; i < 10; i++) {
    const r = d20Results[i];
    console.log(`${String(i+1).padStart(4)} | ${r.label.padEnd(28)} | RMSE=${r.rmse.toFixed(2)} Avg|d|=${r.avgAbs.toFixed(2)}% AvgDiff=${(r.avgDiff>=0?"+":"")+r.avgDiff.toFixed(2)}% ≤2%:${r.w2}/${d20.length} ≤5%:${r.w5}/${d20.length}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
