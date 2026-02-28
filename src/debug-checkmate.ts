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

// === CHECKMATE FIX: Qxe8+ Ndxe8 Rd8# ===
// Need: e-file clear from e3 to e8. No pawn on e6!
console.log("=== CHECKMATE ===");
{
  const fen = buildFen({
    "g1":"K","e3":"Q","d1":"R","a1":"R","c4":"B","g5":"B","c3":"N","b1":"N",
    "a2":"P","b2":"P","c2":"P","f2":"P","g2":"P","h2":"P",
    // Black: Kg8, Nd6 (takes on e8), other pieces NOT able to capture d8
    "g8":"k","a7":"q","a8":"r","b8":"r","c8":"b","b6":"b","d6":"n","h5":"n",
    "b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "w");
  const c = new Chess(fen);
  console.log(c.ascii());
  // Check e-file
  for (const sq of ["e4","e5","e6","e7","e8"]) {
    const p = c.get(sq as Square);
    if (p) console.log(`  ${sq}: ${p.color}${p.type} BLOCKING`);
    else console.log(`  ${sq}: clear`);
  }
  // PV: Qe8+ Nxe8 Rd8#
  const pv = new Chess(fen);
  for (const u of ["e3e8","d6e8","d1d8"]) {
    try {
      const m = pv.move({from: u.slice(0,2) as any, to: u.slice(2,4) as any});
      console.log(`  ${m.san} Check=${pv.isCheck()} Mate=${pv.isCheckmate()}`);
    } catch {
      console.log(`  ${u} ILLEGAL. Legal: ${pv.moves().join(', ')}`);
      break;
    }
  }
  if (pv.isCheckmate()) {
    const labels = detectLabels(fen, "e3e8", ["e3e8","d6e8","d1d8"], null);
    console.log(`  MATE ✓ Labels: [${labels.join(', ')}]`);
  }
}

// === BACK RANK: Need mate in 1 delivered on rank 1/8 ===
// Simplest approach: Black plays Qb1# or similar.
// Black Qb2, White Kg1, pawns f2 g2 h2. Qb2→b1? b2→b1 one square.
// After Qb1+: check on g1? b1→c2→d3...→g1: not a queen line directly.
// b1 and g1: (2,1) to (7,1) = same rank (rank 1). Qb1 attacks rank 1.
// Between b1 and g1: c1, d1, e1, f1. Need all empty.
// If clear: Qb1 checks g1 along rank 1.
// Kg1 escapes: f1(Qb1 controls rank 1), f2(pawn), g2(pawn), h1(Qb1 controls), h2(pawn).
// ALL controlled! MATE!
// But: can any White piece capture Qb1 or block?
// If White has Ra1: a1 is on rank 1. Ra1xb1 captures! Not mate.
// Need no White rook on a1. White: Kg1, pawns f2 g2 h2, no rook on a-file.
// White pieces elsewhere: Bg5, Bh3, Nc3(but Nc3 can go to b1!), etc.
// Nc3→b1: (3,3)→(2,1) = (-1,-2). YES. Nc3 captures Qb1.
// Need no knight that can reach b1.
// White: Kg1, Rh1(blocked by h2 pawn? no, rook on h1 attacks h-file only if h2 pawn blocks above).
// Hmm Rh1 is on rank 1: can it go to b1? h1→b1 same rank. Through g1(king), f1, e1, d1, c1.
// g1 has king! Blocked! Rh1 can NOT reach b1 through g1. ✓
// So White Rh1 stays put. Can Rh1 go to g1? h1→g1: blocked by own king. No.
// Any other piece? White Bf4: can't reach rank 1 interposition squares.
// Bd3: d3→c2→b1 diagonal! Bd3 blocks on c2 or captures on b1.
// Actually Bd3→b1: (4,3)→(2,1) = (-2,-2) diagonal. Path: c2 clear. Bd3xQb1!
// Need no bishop on the a4-e8 or c2-a4 diagonal that can reach b1.
// Put bishops on different diagonals.
//
// Simplest: just have White with very limited pieces.
// White: Kg1, Rh1, Bg6, Ba3, Ng5, Ne3, pawns f2 g2 h2.
// Can anything block or capture?
// Ba3: a3→b2(diagonal), c1(diagonal). Not b1. ✓
// Bg6: can it reach b1? g6→f5→e4→d3→c2→b1. 5-square diagonal. YES!
// Bg6→b1: but this is a legal move only if path is clear. f5,e4,d3,c2 empty? Probably yes.
// So Bg6 CAN capture Qb1. Not mate.
// Put bishop on h7 instead? h7→g6→f5→... same diagonal. Still reaches b1.
// Put bishop on h5? h5→g4→f3→e2→d1→... reaches d1 not b1.
// h5→g6→f7: different diagonal direction.
// Actually h5 is on two diagonals: h5-g6-f7 and h5-g4-f3-e2-d1. Neither reaches b1.
// So Bh5 can't reach b1. ✓
// Ne3: e3→c2, c4, d1, d5, f1, f5, g2, g4. Goes to d1 (interposition) or c2 (interposition)!
// Ne3 blocks on d1 or c2. Not mate.
// Need no knight on e3. Use Nh4 instead: h4→f3, f5, g2, g6. Can't reach b1-g1 path. ✓
// Ng5: g5→e4, e6, f3, f7, h3, h7. Can go to f3 but f3 doesn't block b1-g1 rank.
// Actually: f3 is not on rank 1. But can Ng5 go to e4 or h3? Neither on rank 1. ✓
//
// White: Kg1, Rh1, Bh5, Ba3, Nh4, Ng5. Pawns f2 g2 h2.
// After Qb1#: rank 1 from b1 to g1 clear? c1, d1, e1, f1 empty? ✓ (no White pieces there).
// Captures: Rh1 blocked by king. Ba3, Bh5 can't reach b1. Nh4, Ng5 can't reach rank 1 interposition.
// MATE!

console.log("\n=== BACK RANK ===");
{
  const fen = buildFen({
    "g1":"K","h1":"R","h5":"B","a3":"B","h4":"N","g5":"N",
    "a2":"P","b2":"P","c2":"P","d2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","b2":"q",// wait b2 has a pawn AND queen? Conflict!
    "a8":"r","d8":"r","c8":"b","e7":"b","c6":"n","d6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "b");
  // b2 conflict! Let me put queen on a2 instead. But a2 has white pawn.
  // Use b3 for queen instead.
  const fen2 = buildFen({
    "g1":"K","h1":"R","h5":"B","a3":"B","h4":"N","g5":"N",
    "b2":"P","c2":"P","d2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","b3":"q","a8":"r","d8":"r","c8":"b","e7":"b","c6":"n","d6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "b");
  const c = new Chess(fen2);
  console.log(c.ascii());
  // Qb3→b1: b3→b2→b1. b2 has WHITE pawn blocking! Nope.
  // Try Qa4: a4→b3→c2→d1. No, a4→a1? Same file.
  // Qb4→b1: b4→b3→b2→b1. b2 pawn blocks.
  // Hmm, need the queen's path to b1 clear.
  // Put queen on b5. b5→b1: b-file. b4, b3, b2(pawn!). Blocked.
  // Remove b2 pawn. Then queen can reach b1.
  const fen3 = buildFen({
    "g1":"K","h1":"R","h5":"B","a3":"B","h4":"N","g5":"N",
    "c2":"P","d2":"P","e2":"P","f2":"P","g2":"P","h2":"P",
    "g8":"k","b5":"q","a8":"r","d8":"r","c8":"b","e7":"b","c6":"n","d6":"n",
    "a7":"p","b7":"p","c7":"p","d7":"p","f7":"p","g7":"p","h7":"p",
  }, "b");
  const c3 = new Chess(fen3);
  console.log(c3.ascii());

  try {
    c3.move({from:"b5",to:"b1"});
    console.log(`Qb1: Check=${c3.isCheck()} Mate=${c3.isCheckmate()}`);
    if (c3.isCheckmate()) {
      console.log("BACK RANK MATE ✓");
      const labels = detectLabels(fen3, "b5b1", ["b5b1"], null);
      console.log(`Labels: [${labels.join(', ')}]`);
    } else {
      console.log(`Replies: ${c3.moves().join(', ')}`);
    }
  } catch {
    console.log("ILLEGAL");
    const moves = new Chess(fen3).moves({verbose:true}).filter(m=>m.from==="b5");
    console.log(`From b5: ${moves.map(m=>m.to+'('+m.san+')').join(', ')}`);
  }
}
