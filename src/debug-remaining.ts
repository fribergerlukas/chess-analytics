import { Chess, Square } from "chess.js";

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

const positions = [
  { id: "fork", fen: "r1b2rk1/ppp1bppp/2n5/3qp3/2B1P1N1/2NP4/PPP2PPP/R1BQ1RK1 w - - 0 13",
    best: "g4f6", pv: ["g4f6","g8h8","f6d5"], side: "WHITE", desc: "Nf6+ forks Kg8 and Qd5" },
  { id: "pin", fen: "r1bqkb1r/pp3ppp/2n1pn2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w kq - 0 13",
    best: "c4b5", pv: ["c4b5","f8d6","b5c6"], side: "WHITE", desc: "Bb5 pins Nc6 to Ke8" },
  { id: "skewer", fen: buildFen({
    "g1":"K","f1":"R","a1":"R","d1":"Q","c1":"B","c3":"N","f3":"N",
    "a2":"P","b2":"P","c2":"P","d3":"P","f2":"P","g2":"P","h2":"P",
    "e6":"k","e8":"r","a8":"r","d8":"q","c8":"b","f8":"b","b8":"n","f6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","g7":"p","h7":"p",
  }, "w"), best: "f1e1", pv: ["f1e1","e6d6","e1e8"], side: "WHITE", desc: "Re1+ skewers Ke6/Re8" },
  { id: "discovered_attack", fen: buildFen({
    "g1":"K","d1":"Q","a1":"R","f1":"R","b2":"B","c4":"B","d4":"N","f3":"N",
    "a2":"P","c2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g7":"k","d8":"q","a8":"r","f8":"r","c8":"b","e7":"b","c6":"n","b8":"n",
    "a7":"p","b7":"p","d7":"p","f7":"p","g6":"p","h7":"p",
  }, "w"), best: "d4b5", pv: ["d4b5","g7g8","b5c7"], side: "WHITE", desc: "Nb5 reveals discovered check from Bb2 on Kg7" },
  { id: "deflection", fen: buildFen({
    "g1":"K","e3":"Q","f1":"R","c1":"R","g5":"B","h5":"B","a3":"N","f3":"N",
    "a2":"P","b2":"P","d2":"P","f2":"P","g2":"P","h2":"P",
    "e8":"k","a5":"q","a8":"r","h8":"r","c2":"b","f8":"b","d4":"n","b8":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","e6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "e3e6", pv: ["e3e6","d4e6","a3c2"], side: "WHITE", desc: "Qxe6+ deflects Nd4 from defending Bc2" },
  { id: "smothered_mate", fen: buildFen({
    "g1":"K","d1":"Q","a1":"R","c1":"R","c4":"B","g5":"B","e5":"N","c3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","f2":"P","g2":"P","h2":"P",
    "h8":"k","g8":"r","a8":"r","d8":"q","c8":"b","e7":"b","b8":"n","a6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "e5f7", pv: ["e5f7"], side: "WHITE", desc: "Nf7# smothered mate" },
  { id: "clearance", fen: buildFen({
    "g1":"K","d1":"R","a1":"R","c1":"B","c4":"B","d4":"N","f3":"N","e3":"Q",
    "a2":"P","b2":"P","c2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d7":"q","a8":"r","f8":"r","c8":"b","e7":"b","c6":"n","b6":"n",
    "a7":"p","b7":"p","e6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "d4f5", pv: ["d4f5","d7d8","f5e7"], side: "WHITE", desc: "Nf5 clears d-file for Rd1 to attack Qd7" },
  { id: "double_attack", fen: buildFen({
    "g1":"K","d1":"R","a1":"R","c2":"B","g5":"B","c3":"N","f3":"N","h3":"Q",
    "a2":"P","b2":"P","d2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "e8":"k","d8":"q","a8":"r","b8":"r","c8":"b","e7":"b","c6":"n","f6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "e4e5", pv: ["e4e5","f6d5","c2h7"], side: "WHITE", desc: "e5 creates double attack: pawn threatens Nf6, Bc2 threatens h7" },
  { id: "intermezzo", fen: buildFen({
    "g1":"K","d1":"Q","a1":"R","f1":"R","c1":"B","c4":"B","d4":"N","h3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e4":"P","g2":"P","h2":"P",
    "e7":"k","d8":"q","a7":"r","h8":"r","c8":"b","f8":"b","b8":"n","e5":"n",
    "a6":"p","b7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "d4c6", pv: ["d4c6","e7e8","c6a7"], side: "WHITE", desc: "Nc6+ intermezzo check, Ke8, Nxa7 captures rook" },
  { id: "removal_of_defender", fen: buildFen({
    "g1":"K","d1":"Q","a1":"R","f1":"R","f5":"B","c1":"B","c3":"N","h3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","a8":"r","f8":"r","c8":"b","e6":"b","d5":"n","a6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","d6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "f5e6", pv: ["f5e6","f7e6","e4d5"], side: "WHITE", desc: "Bxe6 removes defender of Nd5 (Be6 defended d5), fxe6, exd5 wins knight" },
  { id: "checkmate", fen: buildFen({
    "g1":"K","d1":"R","a1":"R","c4":"B","c1":"B","c3":"N","g6":"N","e3":"Q",
    "a2":"P","b2":"P","c2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","h3":"q","a7":"r","b5":"r","c8":"b","b6":"b","a6":"n","h4":"n",
    "b7":"p","c7":"p","e6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "d1d8", pv: ["d1d8"], side: "WHITE", desc: "Rd8# mate in 1 -- Ng6 controls f8/h8, pawns block g7/f7/h7" },
  { id: "back_rank", fen: buildFen({
    "g1":"K","a4":"R","h3":"R","h5":"B","g5":"B","a3":"N","h4":"N",
    "c2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","e2":"q","d2":"r","h8":"r","g3":"n","c8":"b","d6":"b","c6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "b"), best: "d2d1", pv: ["d2d1"], side: "BLACK", desc: "Rd1# back rank mate -- Qe2 covers f1, Ng3 covers h1" },
  { id: "x_ray", fen: buildFen({
    "g1":"K","d1":"R","a1":"R","d4":"Q","g5":"B","c1":"B","c3":"N","f3":"N",
    "a2":"P","b2":"P","c2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","a8":"r","f8":"r","c8":"b","e7":"b","b8":"n","h5":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "d4d7", pv: ["d4d7","d8d7","d1d7"], side: "WHITE", desc: "Qxd7 creates x-ray battery with Rd1 targeting Qd8" },
  { id: "attraction", fen: buildFen({
    "g1":"K","d1":"Q","a1":"R","h1":"R","c4":"B","c1":"B","f3":"N","c3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","a8":"r","e5":"r","d7":"b","b4":"b","a6":"n","h5":"n",
    "a7":"p","b7":"p","c7":"p","d6":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "c4f7", pv: ["c4f7","g8f7","f3e5"], side: "WHITE", desc: "Bxf7+ attracts Kxf7, Nxe5+ wins rook" },
  { id: "trapped_piece", fen: buildFen({
    "g1":"K","a1":"R","f1":"R","d1":"Q","c1":"B","g5":"B","c3":"N","f3":"N",
    "b2":"P","c2":"P","d2":"P","e4":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","d8":"q","e8":"r","h8":"r","a8":"b","e7":"b","b8":"n","c6":"n",
    "b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "h2h3", pv: ["h2h3","h7h6","a1a8"], side: "WHITE", desc: "h3 quiet move; Ba8 is trapped (0 escape squares, Ra1 attacks)" },
  { id: "mate_threat", fen: buildFen({
    "g1":"K","f3":"Q","h1":"R","d1":"R","c4":"B","c1":"B","d7":"N","c3":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","e2":"P","f2":"P","g2":"P",
    "g8":"k","f7":"p","g7":"p","h7":"p",
  }, "w"), best: "f3h5", pv: ["f3h5","h7h6","h5h6"], side: "WHITE", desc: "Qh5 threatens Qxh7# (Rh1 defends h7, Nd7 controls f8)" },
];

for (const pos of positions) {
  console.log(`\n${pos.id}:`);
  console.log(`  FEN: ${pos.fen}`);
  console.log(`  bestMoveUci: ${pos.best}`);
  console.log(`  pvMoves: [${pos.pv.map(m => `"${m}"`).join(", ")}]`);
  console.log(`  sideToMove: ${pos.side}`);
  console.log(`  description: ${pos.desc}`);
}
