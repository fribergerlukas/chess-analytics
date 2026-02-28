import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { detectLabels } from "../services/puzzleClassification";

/**
 * SF-first motif redesign — with per-evaluation timeouts.
 * Spawns a fresh Stockfish per evaluation to avoid state issues.
 */

interface EvalResult {
  bestMove: string;
  score: number;
  pv: string;
}

function evalOnce(fen: string, depth = 18, timeoutMs = 20000): Promise<EvalResult> {
  return new Promise((resolve, reject) => {
    const sf = spawn("/opt/homebrew/bin/stockfish");
    let buf = "";
    let listener: ((line: string) => void) | null = null;

    sf.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) {
        if (listener) listener(l);
      }
    });

    function send(cmd: string) { sf.stdin.write(cmd + "\n"); }
    function waitFor(s: string) {
      return new Promise<void>((r) => {
        listener = (l) => { if (l.startsWith(s)) { listener = null; r(); } };
      });
    }

    const timer = setTimeout(() => {
      send("stop");
      setTimeout(() => { sf.kill(); reject(new Error("Timeout")); }, 3000);
    }, timeoutMs);

    (async () => {
      send("uci");
      await waitFor("uciok");
      send(`position fen ${fen}`);
      send("isready");
      await waitFor("readyok");

      let lastScore = 0;
      let lastPv = "";
      let lastBest = "";
      await new Promise<void>((r) => {
        listener = (l) => {
          if (l.includes("score cp")) {
            const m = l.match(/score cp (-?\d+)/);
            if (m) lastScore = parseInt(m[1]);
            const pm = l.match(/\bpv (.+)/);
            if (pm) lastPv = pm[1].trim();
          } else if (l.includes("score mate")) {
            const m = l.match(/score mate (-?\d+)/);
            lastScore = m && parseInt(m[1]) > 0 ? 10000 : -10000;
            const pm = l.match(/\bpv (.+)/);
            if (pm) lastPv = pm[1].trim();
          }
          if (l.startsWith("bestmove")) {
            clearTimeout(timer);
            lastBest = l.split(" ")[1];
            listener = null;
            r();
          }
        };
        send(`go depth ${depth}`);
      });

      send("quit");
      sf.kill();
      resolve({ bestMove: lastBest, score: lastScore, pv: lastPv });
    })().catch((e) => { clearTimeout(timer); sf.kill(); reject(e); });
  });
}

interface Candidate { motif: string; fen: string; description: string; }

const candidates: Candidate[] = [
  // ═══ SKEWER ═══
  { motif: "skewer", fen: "8/8/8/8/4k2r/8/6PP/R5K1 w - - 0 40",
    description: "Ra4+ skewers Ke4 then Rxh4" },
  // Bishop skewer: check king, capture piece behind on diagonal
  { motif: "skewer", fen: "8/8/5k2/8/8/6q1/1B4PP/6K1 w - - 0 40",
    description: "Bd4+ skewers Kf6, captures Qg3 behind" },
  // Rook skewer on file
  { motif: "skewer", fen: "8/4k3/8/4q3/8/8/4R1PP/6K1 w - - 0 40",
    description: "Re5? or Re4? skewer king+queen on e-file" },

  // ═══ DOUBLE ATTACK ═══
  { motif: "double_attack", fen: "1k6/3r1p2/8/3N4/8/8/5PPP/3R2K1 w - - 0 25",
    description: "Nc7+ checks Kb8, discovers Rd1→Rd7" },
  { motif: "double_attack", fen: "2kr4/3p4/8/3Nn3/8/8/5PPP/3R2K1 w - - 0 25",
    description: "Nb6+ discovers Rd1 vs d-file, checks" },
  // Knight on c4 blocks Bc1→f4 diagonal AND rook. Moving creates two threats.
  { motif: "double_attack", fen: "r1b1k3/ppp2p2/2n5/8/8/4N3/PPP3PP/4R1K1 w - - 0 20",
    description: "Nd5 discovers Re1→Ke8 check + Nc7/Nxc7" },

  // ═══ REMOVAL OF DEFENDER ═══
  { motif: "removal_of_defender", fen: "r4rk1/pp2bppp/2n2n2/1B1N4/8/8/PPP2PPP/R4RK1 w - - 0 15",
    description: "Bxc6 removes Nc6 defending Be7, then Nxe7+" },
  // Nxf6 removes defender of queen
  { motif: "removal_of_defender", fen: "r1bqr1k1/ppp2ppp/2n2n2/3pp3/3PP3/2N2N2/PPP2PPP/R1BQR1K1 w - - 0 8",
    description: "Nxe5 or dxe5 removes a central defender" },
  // Bxf6 removes knight defending d7
  { motif: "removal_of_defender", fen: "r4rk1/pp1qbppp/2n1bn2/4p3/4P3/1NN1B3/PPP2PPP/R2QR1K1 w - - 0 12",
    description: "Nd5 or Bxf6 removes a defender" },

  // ═══ SACRIFICE ═══
  { motif: "sacrifice", fen: "5rk1/5ppp/4pn2/8/8/3B1N2/5PPP/3Q2K1 w - - 0 20",
    description: "Bxh7+ Nxh7 Greek Gift sacrifice" },
  { motif: "sacrifice", fen: "r4rk1/pp3ppp/2n1pn2/3p4/3P4/3BPN2/PP3PPP/R2Q1RK1 w - - 0 12",
    description: "Bxh7+ Kxh7 classical Greek Gift" },
  // Nxe6 sacrifice in Sicilian-style
  { motif: "sacrifice", fen: "r1b1kb1r/1p1n1ppp/p2ppn2/6B1/3NPP2/2N5/PPP3PP/R2QKB1R w KQkq - 0 9",
    description: "Nxe6 or Bxf6 sacrifice combo" },

  // ═══ CLEARANCE ═══
  { motif: "clearance", fen: "5rk1/pp4pp/8/8/8/5N2/PPP3PP/5RK1 w - - 0 25",
    description: "Knight off f3 clears Rf1→Rf8" },
  { motif: "clearance", fen: "3r2k1/5ppp/8/8/3N4/8/5PPP/3R2K1 w - - 0 25",
    description: "Knight off d4 clears Rd1→Rd8" },
  { motif: "clearance", fen: "3r2k1/5ppp/8/8/8/3B4/5PPP/3R2K1 w - - 0 25",
    description: "Bh7+ clears d-file for Rd1→Rd8" },
  { motif: "clearance", fen: "4r1k1/5ppp/8/4N3/8/8/5PPP/4R1K1 w - - 0 25",
    description: "Ne5 moves, clears Re1→Re8" },

  // ═══ INTERFERENCE ═══
  { motif: "interference", fen: "4r1k1/5ppp/8/8/8/2N5/4r1PP/R5K1 w - - 0 25",
    description: "Nd5 between Re8 and Re2 on e-file" },
  { motif: "interference", fen: "1r4k1/5ppp/8/8/8/2N5/1r3PPP/R5K1 w - - 0 25",
    description: "Nb5 between Rb8 and Rb2 on b-file" },
  { motif: "interference", fen: "6k1/1q3ppp/8/8/4b3/2N5/PP3PPP/R5K1 w - - 0 25",
    description: "Nd5 between Qb7 and Be4 diagonal" },
  // Pawn push interference
  { motif: "interference", fen: "1r2r1k1/5ppp/8/8/8/4P3/4R1PP/4R1K1 w - - 0 25",
    description: "e4 between Black's rooks on files" },

  // ═══ DESPERADO ═══
  { motif: "desperado", fen: "6k1/8/8/8/8/5b2/6PP/3RK3 b - - 0 30",
    description: "Bf3 attacked by g2, Bxd1 grabs rook" },
  { motif: "desperado", fen: "6k1/8/8/8/8/1P6/2n3PP/R5K1 b - - 0 30",
    description: "Nc2 attacked by b3, Nxa1 grabs rook" },
  { motif: "desperado", fen: "r3k2r/ppp2ppp/2n5/3np3/2B1P3/5N2/PPPP1PPP/R1B1K2R b KQkq - 0 7",
    description: "Nd5 attacked by Bc4, Nxf3+ desperado" },
  // Bishop attacked by pawn, takes knight
  { motif: "desperado", fen: "6k1/5ppp/8/5b2/4P3/3N4/3R2PP/6K1 b - - 0 30",
    description: "Bf5 attacked by e4, Bxd3 Rxd3 desperado" },

  // ═══ ATTRACTION ═══
  { motif: "attraction", fen: "4k3/5b2/8/8/2B5/8/6PP/3Q2K1 w - - 0 20",
    description: "Bxf7+ Kxf7 Qd5+ king exposed" },
  { motif: "attraction", fen: "6k1/5pRp/8/8/8/8/6PP/3Q2K1 w - - 0 30",
    description: "Rxg7+/Rxf7 Kxf7 then exploit" },
  { motif: "attraction", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 4",
    description: "Bxf7+ Kxf7 Italian Game (Fried Liver approach)" },
  // Nxf7 Kxf7 exploitation
  { motif: "attraction", fen: "r1bqkb1r/pppp1ppp/2n5/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 5",
    description: "Nxf7 Kxf7 or Rxf7 attraction" },

  // ═══ TRAPPED PIECE ═══
  { motif: "trapped_piece", fen: "6k1/5ppp/8/8/6b1/5N1P/5PP1/6K1 w - - 0 25",
    description: "h3 traps Bg4" },
  { motif: "trapped_piece", fen: "6k1/5ppp/8/p7/Pn6/1P6/6PP/1R4K1 w - - 0 25",
    description: "Quiet move traps Nb4" },
  { motif: "trapped_piece", fen: "6k1/5ppp/8/8/8/1P6/P1P3PP/nR4K1 w - - 0 25",
    description: "Quiet move traps Na1" },
  // Bishop trapped on h7 after king moves
  { motif: "trapped_piece", fen: "r4rk1/pppb1pp1/4pn1p/8/3P4/2NB1N2/PPP2PPP/R4RK1 w - - 0 12",
    description: "Bxh6 or something traps a piece" },

  // ═══ DISCOVERED ATTACK ═══
  { motif: "discovered_attack", fen: "4k3/8/8/4N3/8/8/8/4R1K1 w - - 0 40",
    description: "Knight off e-file discovers Re1+ check" },
  { motif: "discovered_attack", fen: "2r3k1/5ppp/8/8/2N5/8/5PPP/2R3K1 w - - 0 25",
    description: "Knight off c-file discovers Rc1→Rc8" },
  { motif: "discovered_attack", fen: "r7/pp4kp/4p3/4N3/8/8/PB3PPP/4R1K1 w - - 0 20",
    description: "Nc6 discovers Bb2→Kg7 (original)" },
  // Bishop moves off diagonal, revealing rook attack
  { motif: "discovered_attack", fen: "3r2k1/5ppp/8/3B4/8/8/5PPP/3R2K1 w - - 0 25",
    description: "Bishop off d5 discovers Rd1→Rd8" },
];

async function testCandidate(c: Candidate): Promise<{
  pass: boolean; sfBest: string; sfPv: string[]; sfScore: number; labels: string[];
} | null> {
  try {
    const result = await evalOnce(c.fen, 18, 20000);
    const sfBest = result.bestMove;
    const sfPv = result.pv.split(" ");
    const sfScore = result.score;
    const labels = detectLabels(c.fen, sfBest, sfPv, null);
    const pass = labels.includes(c.motif as any);
    return { pass, sfBest, sfPv, sfScore, labels };
  } catch {
    return null;
  }
}

async function main() {
  const results: Record<string, {
    fen: string; sfBest: string; sfPv: string[]; sfScore: number;
    labels: string[]; description: string;
  }> = {};

  for (const c of candidates) {
    const r = await testCandidate(c);
    if (!r) {
      console.log(`⏰ ${c.motif.padEnd(22)} | TIMEOUT | ${c.description}`);
      continue;
    }
    const evalStr = r.sfScore >= 10000 ? "M+" : r.sfScore <= -10000 ? "M-" : `${r.sfScore}cp`;
    const icon = r.pass ? "✓" : "✗";
    const pvStr = r.sfPv.slice(0, 4).join(" ");
    console.log(`${icon} ${c.motif.padEnd(22)} | SF: ${r.sfBest.padEnd(7)} ${evalStr.padEnd(8)} | pv: ${pvStr.padEnd(28)} | labels: [${r.labels.join(", ")}] | ${c.description}`);
    if (r.pass && !results[c.motif]) {
      results[c.motif] = {
        fen: c.fen, sfBest: r.sfBest, sfPv: r.sfPv,
        sfScore: r.sfScore, labels: r.labels, description: c.description,
      };
    }
  }

  // Summary
  console.log("\n\n=== RESULTS SUMMARY ===\n");
  const allMotifs = [
    "skewer", "double_attack", "removal_of_defender", "sacrifice", "clearance",
    "interference", "desperado", "attraction", "trapped_piece", "discovered_attack",
  ];
  let passing = 0;
  for (const motif of allMotifs) {
    const r = results[motif];
    if (r) {
      passing++;
      const evalStr = r.sfScore >= 10000 ? "M+" : r.sfScore <= -10000 ? "M-" : `${r.sfScore}cp`;
      console.log(`✓ ${motif}:`);
      console.log(`  fen: "${r.fen}"`);
      console.log(`  bestMoveUci: "${r.sfBest}"`);
      console.log(`  pvMoves: [${r.sfPv.slice(0, 6).map(m => `"${m}"`).join(", ")}]`);
      console.log(`  eval: ${evalStr}`);
      console.log(`  labels: [${r.labels.join(", ")}]`);
      console.log();
    } else {
      console.log(`✗ ${motif}: NO PASSING CANDIDATE\n`);
    }
  }
  console.log(`\n${passing}/${allMotifs.length} motifs have SF-validated positions`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
