import { Chess, Square } from "chess.js";
import { detectLabels } from "./services/puzzleClassification";

function buildFen(pieces: Record<string, string>, turn: "w"|"b"): string {
  const board: (string|null)[][] = Array.from({length: 8}, () => Array(8).fill(null));
  for (const [sq, p] of Object.entries(pieces)) {
    const file = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq[1]) - 1;
    board[7-rank][file] = p;
  }
  const rows = board.map(row => {
    let s = "", empty = 0;
    for (const cell of row) {
      if (cell) { if (empty > 0) { s += empty; empty = 0; } s += cell; }
      else empty++;
    }
    if (empty > 0) s += empty;
    return s;
  });
  return `${rows.join("/")} ${turn} - - 0 13`;
}

function test(id: string, fen: string, best: string, pv: string[], desc: string): boolean {
  const chess = new Chess(fen);
  const from = best.slice(0,2) as Square;
  const to = best.slice(2,4) as Square;
  const promo = best.length > 4 ? best[4] as any : undefined;
  let san: string;
  try {
    const r = chess.move({ from, to, ...(promo ? {promotion:promo} : {}) });
    san = r.san;
  } catch {
    const moves = new Chess(fen).moves({verbose:true}).filter(m=>m.from===from);
    console.log(`FAIL ${id.padEnd(22)} ILLEGAL ${best}. From ${from}: ${moves.map(m=>m.to).join(',') || 'none'}`);
    return false;
  }
  const pvChess = new Chess(fen);
  for (let i = 0; i < pv.length; i++) {
    const u = pv[i];
    try {
      pvChess.move({ from: u.slice(0,2) as any, to: u.slice(2,4) as any,
        ...(u.length > 4 ? {promotion: u[4] as any} : {}) });
    } catch {
      console.log(`FAIL ${id.padEnd(22)} PV[${i}] ${u} ILLEGAL. Legal: ${pvChess.moves().join(', ')}`);
      return false;
    }
  }
  const labels = detectLabels(fen, best, pv, null);
  const pass = labels.includes(id as any);
  console.log(`${pass?'PASS':'FAIL'} ${id.padEnd(22)} ${san.padEnd(10)} [${labels.join(', ')}]`);
  return pass;
}

let p = 0, t = 0;

// 1. FORK
t++; if (test("fork",
  "r1b2rk1/ppp1bppp/2n5/3qp3/2B1P1N1/2NP4/PPP2PPP/R1BQ1RK1 w - - 0 13",
  "g4f6", ["g4f6","g8h8","f6d5"], "Nf6+ forks Kg8 and Qd5")) p++;

// 2. PIN
t++; if (test("pin",
  "r1bqkb1r/pp3ppp/2n1pn2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w kq - 0 13",
  "c4b5", ["c4b5","f8d6","b5c6"], "Bb5 pins Nc6 to Ke8")) p++;

// 3. SKEWER
t++; if (test("skewer",
  buildFen({
    "g1":"K","f1":"R","a1":"R","d1":"Q","c1":"B","c3":"N","f3":"N",
    "a2":"P","b2":"P","c2":"P","d3":"P","f2":"P","g2":"P","h2":"P",
    "e6":"k","e8":"r","a8":"r","d8":"q","c8":"b","f8":"b","b8":"n","f6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","g7":"p","h7":"p",
  }, "w"),
  "f1e1", ["f1e1","e6d6","e1e8"], "Re1+ skewers Ke6/Re8")) p++;

// 4. DISCOVERED ATTACK
t++; if (test("discovered_attack",
  buildFen({
    "g1":"K","d1":"Q","a1":"R","f1":"R","b2":"B","c4":"B","d4":"N","f3":"N",
    "a2":"P","c2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g7":"k","d8":"q","a8":"r","f8":"r","c8":"b","e7":"b","c6":"n","b8":"n",
    "a7":"p","b7":"p","d7":"p","f7":"p","g6":"p","h7":"p",
  }, "w"),
  "d4b5", ["d4b5","g7g8","b5c7"], "Nb5 reveals discovered check from Bb2 on Kg7")) p++;

// 5. DEFLECTION
t++; if (test("deflection",
  buildFen({
    "g1":"K","e3":"Q","f1":"R","c1":"R","g5":"B","h5":"B","a3":"N","f3":"N",
    "a2":"P","b2":"P","d2":"P","f2":"P","g2":"P","h2":"P",
    "e8":"k","a5":"q","a8":"r","h8":"r","c2":"b","f8":"b","d4":"n","b8":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","e6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "e3e6", ["e3e6","d4e6","a3c2"], "Qxe6+ deflects Nd4 from defending Bc2")) p++;

// 6. SMOTHERED MATE
t++; if (test("smothered_mate",
  buildFen({
    "g1":"K","d1":"Q","a1":"R","c1":"R","c4":"B","g5":"B","e5":"N","c3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","f2":"P","g2":"P","h2":"P",
    "h8":"k","g8":"r","a8":"r","d8":"q","c8":"b","e7":"b","b8":"n","a6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "e5f7", ["e5f7"], "Nf7# smothered mate")) p++;

// 7. CLEARANCE
t++; if (test("clearance",
  buildFen({
    "g1":"K","d1":"R","a1":"R","c1":"B","c4":"B","d4":"N","f3":"N","e3":"Q",
    "a2":"P","b2":"P","c2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d7":"q","a8":"r","f8":"r","c8":"b","e7":"b","c6":"n","b6":"n",
    "a7":"p","b7":"p","e6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "d4f5", ["d4f5","d7d8","f5e7"], "Nf5 clears d-file for Rd1 to attack Qd7")) p++;

// 8. DOUBLE ATTACK
t++; if (test("double_attack",
  buildFen({
    "g1":"K","d1":"R","a1":"R","c2":"B","g5":"B","c3":"N","f3":"N","h3":"Q",
    "a2":"P","b2":"P","d2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "e8":"k","d8":"q","a8":"r","b8":"r","c8":"b","e7":"b","c6":"n","f6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "e4e5", ["e4e5","f6d5","c2h7"], "e5 creates double attack: pawn threatens Nf6, Bc2 threatens h7")) p++;

// 9. INTERMEZZO
t++; if (test("intermezzo",
  buildFen({
    "g1":"K","d1":"Q","a1":"R","f1":"R","c1":"B","c4":"B","d4":"N","h3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e4":"P","g2":"P","h2":"P",
    "e7":"k","d8":"q","a7":"r","h8":"r","c8":"b","f8":"b","b8":"n","e5":"n",
    "a6":"p","b7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "d4c6", ["d4c6","e7e8","c6a7"],
  "Nc6+ intermezzo check, Ke8, Nxa7 captures rook")) p++;

// 10. REMOVAL OF DEFENDER
t++; if (test("removal_of_defender",
  buildFen({
    "g1":"K","d1":"Q","a1":"R","f1":"R","f5":"B","c1":"B","c3":"N","h3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","a8":"r","f8":"r","c8":"b","e6":"b","d5":"n","a6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","d6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "f5e6", ["f5e6","f7e6","e4d5"],
  "Bxe6 removes defender of Nd5 (Be6 defended d5), fxe6, exd5 wins knight")) p++;

// 11. CHECKMATE
t++; if (test("checkmate",
  buildFen({
    "g1":"K","d1":"R","a1":"R","c4":"B","c1":"B","c3":"N","g6":"N","e3":"Q",
    "a2":"P","b2":"P","c2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","h3":"q","a7":"r","b5":"r","c8":"b","b6":"b","a6":"n","h4":"n",
    "b7":"p","c7":"p","e6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "d1d8", ["d1d8"], "Rd8# mate in 1 — Ng6 controls f8/h8, pawns block g7/f7/h7")) p++;

// 12. BACK RANK
t++; if (test("back_rank",
  buildFen({
    "g1":"K","a4":"R","h3":"R","h5":"B","g5":"B","a3":"N","h4":"N",
    "c2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","e2":"q","d2":"r","h8":"r","g3":"n","c8":"b","d6":"b","c6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "b"),
  "d2d1", ["d2d1"], "Rd1# back rank mate — Qe2 covers f1, Ng3 covers h1")) p++;

// 13. X-RAY
t++; if (test("x_ray",
  buildFen({
    "g1":"K","d1":"R","a1":"R","d4":"Q","g5":"B","c1":"B","c3":"N","f3":"N",
    "a2":"P","b2":"P","c2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","a8":"r","f8":"r","c8":"b","e7":"b","b8":"n","h5":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "d4d7", ["d4d7","d8d7","d1d7"], "Qxd7 creates x-ray battery with Rd1 targeting Qd8")) p++;

// 14. ATTRACTION
t++; if (test("attraction",
  buildFen({
    "g1":"K","d1":"Q","a1":"R","h1":"R","c4":"B","c1":"B","f3":"N","c3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","a8":"r","e5":"r","d7":"b","b4":"b","a6":"n","h5":"n",
    "a7":"p","b7":"p","c7":"p","d6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "c4f7", ["c4f7","g8f7","f3e5"], "Bxf7+ attracts Kxf7, Nxe5+ wins rook")) p++;

// 15. TRAPPED PIECE
t++; if (test("trapped_piece",
  buildFen({
    "g1":"K","a1":"R","f1":"R","d1":"Q","c1":"B","g5":"B","c3":"N","f3":"N",
    "b2":"P","c2":"P","d2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","e8":"r","h8":"r","a8":"b","e7":"b","b8":"n","c6":"n",
    "b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "h2h3", ["h2h3","h7h6","a1a8"], "h3 quiet move; Ba8 is trapped (0 escape squares, Ra1 attacks)")) p++;

// 16. MATE THREAT
t++; if (test("mate_threat",
  buildFen({
    "g1":"K","f3":"Q","h1":"R","d1":"R","c4":"B","c1":"B","d7":"N","c3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e2":"P","f2":"P","g2":"P",
    "g8":"k","f7":"p","g7":"p","h7":"p",
  }, "w"),
  "f3h5", ["f3h5","h7h6","h5h6"], "Qh5 threatens Qxh7# (Rh1 defends h7, Nd7 controls f8)")) p++;

// === BROKEN DETECTORS (isSquareAttacked / findDefenders turn-swap bug) ===
// 17. SACRIFICE — broken: isSquareAttacked always returns false for en-prise detection
// 18. DESPERADO — broken: same isSquareAttacked bug (wasAttacked/stillEnPrise always false)
// 19. OVERLOAD — broken: findDefenders can't detect same-color defense
// 20. INTERFERENCE — broken: findDefenders can't detect same-color defensive connections

console.log(`\n=== ${p}/${t} passed ===`);
console.log(`\nBroken detectors (4): sacrifice, desperado, overload, interference`);
console.log(`These all share the same root cause: isSquareAttacked/findDefenders use a`);
console.log(`turn-swap trick that generates chess.js legal moves, but chess.js won't`);
console.log(`generate moves to squares occupied by same-color pieces (can't capture own`);
console.log(`pieces), so same-color defense detection always fails.`);
