"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { Chess, Square } from "chess.js";

const Chessboard = dynamic(
  () => import("react-chessboard").then((mod) => mod.Chessboard),
  { ssr: false }
);

const API_BASE = "http://localhost:3000";

const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const STARTING_PIECES: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const WHITE_PIECE_SYMBOLS: Record<string, string> = { p: "\u2659", n: "\u2658", b: "\u2657", r: "\u2656", q: "\u2655" };
const BLACK_PIECE_SYMBOLS: Record<string, string> = { p: "\u265F", n: "\u265E", b: "\u265D", r: "\u265C", q: "\u265B" };

interface MoveStatEntry {
  uci: string;
  san: string;
  count: number;
  pct: number;
}

interface BotResponse {
  move: string;
  san: string;
  source: string;
  stats: {
    moves: MoveStatEntry[];
    totalGames: number;
  };
}

interface MoveHistoryEntry {
  san: string;
  uci: string;
  isBot: boolean;
  source?: string;
}

interface SimulationGameProps {
  opponentUsername: string;
  opponentRating?: number;
  opponentSide: "white" | "black";
  opponentProfile?: { title?: string; countryCode?: string; avatarUrl?: string };
  timeCategory: string;
  onClose: () => void;
}

function countryCodeToFlag(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  player_data: { label: "Player Data", color: "#81b64c" },
  lichess_db: { label: "Lichess DB", color: "#5ba3d9" },
  stockfish: { label: "Stockfish", color: "#c27a30" },
  random: { label: "Random", color: "#9b9895" },
};

function getCapturedPieces(fen: string) {
  const board = fen.split(" ")[0];
  const white: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  const black: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };

  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (lower in white) {
      if (ch === lower) black[lower]++;
      else white[lower]++;
    }
  }

  const whiteCaptured: { piece: string; symbol: string }[] = [];
  const blackCaptured: { piece: string; symbol: string }[] = [];
  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (const piece of ["q", "r", "b", "n", "p"]) {
    const missingBlack = STARTING_PIECES[piece] - black[piece];
    const missingWhite = STARTING_PIECES[piece] - white[piece];
    for (let i = 0; i < missingBlack; i++) {
      whiteCaptured.push({ piece, symbol: BLACK_PIECE_SYMBOLS[piece] });
    }
    for (let i = 0; i < missingWhite; i++) {
      blackCaptured.push({ piece, symbol: WHITE_PIECE_SYMBOLS[piece] });
    }
    whiteMaterial += white[piece] * PIECE_VALUES[piece];
    blackMaterial += black[piece] * PIECE_VALUES[piece];
  }

  return { whiteCaptured, blackCaptured, materialDiff: whiteMaterial - blackMaterial };
}

const BOARD_SIZE = 560;

export default function SimulationGame({
  opponentUsername,
  opponentRating,
  opponentSide,
  opponentProfile,
  timeCategory,
  onClose,
}: SimulationGameProps) {
  const [game, setGame] = useState(() => new Chess());
  const [mounted, setMounted] = useState(false);
  const [moveHistory, setMoveHistory] = useState<MoveHistoryEntry[]>([]);
  const [thinking, setThinking] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [gameResult, setGameResult] = useState("");
  const [resigned, setResigned] = useState(false);
  const [lastMoveStats, setLastMoveStats] = useState<BotResponse["stats"] | null>(null);
  const [lastMoveSource, setLastMoveSource] = useState<string>("");
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [activeTimeCategory, setActiveTimeCategory] = useState(timeCategory);

  const gameRef = useRef(game);
  gameRef.current = game;
  const thinkingRef = useRef(false);
  const moveHistoryRef = useRef<HTMLDivElement>(null);

  const userSide = opponentSide === "white" ? "black" : "white";
  const boardOrientation = userSide;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (moveHistoryRef.current) {
      moveHistoryRef.current.scrollTop = moveHistoryRef.current.scrollHeight;
    }
  }, [moveHistory]);

  const checkGameOver = useCallback((chess: Chess) => {
    if (chess.isGameOver()) {
      setGameOver(true);
      if (chess.isCheckmate()) {
        const winner = chess.turn() === "w" ? "Black" : "White";
        setGameResult(`${winner} wins by checkmate`);
      } else if (chess.isStalemate()) {
        setGameResult("Draw by stalemate");
      } else if (chess.isDraw()) {
        setGameResult("Draw");
      }
      return true;
    }
    return false;
  }, []);

  const requestBotMove = useCallback(
    async (chess: Chess) => {
      if (thinkingRef.current) return;
      thinkingRef.current = true;
      setThinking(true);

      try {
        const res = await fetch(`${API_BASE}/simulation/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            opponentUsername,
            fen: chess.fen(),
            opponentSide,
            opponentRating,
            timeCategory: activeTimeCategory,
          }),
        });

        if (!res.ok) { console.error("Bot move request failed:", res.status); return; }

        const data: BotResponse = await res.json();
        const from = data.move.slice(0, 2);
        const to = data.move.slice(2, 4);
        const promotion = data.move.length > 4 ? data.move[4] : undefined;

        const newGame = new Chess(chess.fen());
        const move = newGame.move({
          from: from as Square,
          to: to as Square,
          ...(promotion ? { promotion: promotion as "q" | "r" | "b" | "n" } : {}),
        });

        if (move) {
          setGame(newGame);
          setMoveHistory((prev) => [
            ...prev,
            { san: move.san, uci: data.move, isBot: true, source: data.source },
          ]);
          setLastMoveStats(data.stats);
          setLastMoveSource(data.source);
          checkGameOver(newGame);
        }
      } catch (err) {
        console.error("Bot move error:", err);
      } finally {
        setThinking(false);
        thinkingRef.current = false;
      }
    },
    [opponentUsername, opponentSide, opponentRating, activeTimeCategory, checkGameOver]
  );

  useEffect(() => {
    if (opponentSide === "white") {
      requestBotMove(game);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBotTurn = () => {
    const turn = gameRef.current.turn();
    return (turn === "w" && opponentSide === "white") || (turn === "b" && opponentSide === "black");
  };

  const boardDisabled = gameOver || thinking || resigned;

  function tryMove(from: string, to: string): boolean {
    if (boardDisabled || isBotTurn()) return false;
    if (from === to) return false;

    const piece = gameRef.current.get(from as Square);
    const isPromotion =
      piece?.type === "p" &&
      ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"));

    const newGame = new Chess(gameRef.current.fen());
    let move;
    try {
      move = newGame.move({
        from: from as Square,
        to: to as Square,
        ...(isPromotion ? { promotion: "q" as const } : {}),
      });
    } catch { return false; }
    if (!move) return false;

    const uci = from + to + (move.promotion || "");
    setGame(newGame);
    setSelectedSquare(null);
    setMoveHistory((prev) => [...prev, { san: move.san, uci, isBot: false }]);

    if (!checkGameOver(newGame)) {
      setTimeout(() => requestBotMove(newGame), 300);
    }
    return true;
  }

  function handlePieceDrop({ sourceSquare, targetSquare }: {
    piece: { pieceType: string }; sourceSquare: string; targetSquare: string | null;
  }): boolean {
    if (!targetSquare) return false;
    return tryMove(sourceSquare, targetSquare);
  }

  function handlePieceClick({ square }: {
    isSparePiece: boolean; piece: { pieceType: string }; square: string | null;
  }) {
    if (!square || boardDisabled || isBotTurn()) return;
    if (selectedSquare === square) { setSelectedSquare(null); return; }
    if (selectedSquare && selectedSquare !== square) {
      if (tryMove(selectedSquare, square)) return;
    }
    const piece = gameRef.current.get(square as Square);
    if (piece) {
      const isWhitePiece = piece.color === "w";
      const isWhiteTurn = gameRef.current.turn() === "w";
      if (isWhitePiece === isWhiteTurn) { setSelectedSquare(square as Square); return; }
    }
    setSelectedSquare(null);
  }

  function handleSquareClick({ square }: { piece: { pieceType: string } | null; square: string }) {
    if (!selectedSquare || boardDisabled || isBotTurn()) return;
    if (tryMove(selectedSquare, square)) return;
    const clickedPiece = gameRef.current.get(square as Square);
    if (clickedPiece && (clickedPiece.color === "w") === (gameRef.current.turn() === "w")) {
      setSelectedSquare(square as Square); return;
    }
    setSelectedSquare(null);
  }

  function getSquareStyles(): Record<string, React.CSSProperties> {
    const styles: Record<string, React.CSSProperties> = {};
    if (selectedSquare && !boardDisabled && !isBotTurn()) {
      styles[selectedSquare] = { backgroundColor: "rgba(255, 255, 0, 0.4)" };
      const moves = gameRef.current.moves({ square: selectedSquare, verbose: true });
      for (const move of moves) {
        const hasPiece = gameRef.current.get(move.to as Square);
        styles[move.to] = hasPiece
          ? { background: "radial-gradient(circle, transparent 55%, rgba(0, 0, 0, 0.15) 55%)" }
          : { background: "radial-gradient(circle, rgba(0, 0, 0, 0.15) 25%, transparent 25%)" };
      }
    }
    return styles;
  }

  function handleResign() {
    setResigned(true);
    setGameOver(true);
    const winner = userSide === "white" ? "Black" : "White";
    setGameResult(`${winner} wins by resignation`);
  }

  function resetGame() {
    const newGame = new Chess();
    setGame(newGame);
    setMoveHistory([]);
    setGameOver(false);
    setGameResult("");
    setResigned(false);
    setLastMoveStats(null);
    setLastMoveSource("");
    setSelectedSquare(null);
    setThinking(false);
    thinkingRef.current = false;
    if (opponentSide === "white") {
      setTimeout(() => requestBotMove(newGame), 300);
    }
  }

  // Format move history into numbered pairs
  const formattedMoves: { number: number; white?: string; black?: string }[] = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    formattedMoves.push({
      number: Math.floor(i / 2) + 1,
      white: moveHistory[i]?.san,
      black: moveHistory[i + 1]?.san,
    });
  }

  const opponentDisplay = opponentProfile?.title
    ? `${opponentProfile.title} ${opponentUsername}`
    : opponentUsername;

  // Captured pieces
  const captured = getCapturedPieces(game.fen());
  const topIsWhite = boardOrientation === "black";
  const topCaptured = topIsWhite ? captured.whiteCaptured : captured.blackCaptured;
  const bottomCaptured = topIsWhite ? captured.blackCaptured : captured.whiteCaptured;
  const topMaterialDiff = topIsWhite ? captured.materialDiff : -captured.materialDiff;

  const isTopOpponent = boardOrientation === "white";
  const topName = isTopOpponent ? opponentDisplay : "You";
  const topRating = isTopOpponent ? opponentRating : undefined;
  const topCountry = isTopOpponent ? opponentProfile?.countryCode : undefined;
  const bottomName = isTopOpponent ? "You" : opponentDisplay;
  const bottomRating = isTopOpponent ? undefined : opponentRating;
  const bottomCountry = isTopOpponent ? undefined : opponentProfile?.countryCode;

  const PlayerBar = ({ name, rating, country, capturedPieces, materialAdv, showThinking }: {
    name: string; rating?: number; country?: string;
    capturedPieces: { piece: string; symbol: string }[];
    materialAdv: number; showThinking?: boolean;
  }) => (
    <div
      className="flex items-center gap-2 px-3"
      style={{ backgroundColor: "#272522", height: 38 }}
    >
      {country && (
        <span className="flex-shrink-0" style={{ fontSize: 14 }} title={country}>
          {countryCodeToFlag(country)}
        </span>
      )}
      <span className="text-sm font-semibold" style={{ color: "#fff" }}>{name}</span>
      {rating && <span className="text-xs" style={{ color: "#a09d9a" }}>({rating})</span>}
      <div className="flex items-center gap-0 ml-1" style={{ fontSize: 14, lineHeight: 1, color: "#d1cfcc" }}>
        {capturedPieces.map((cp, i) => (
          <span key={i} style={{ marginLeft: i > 0 && capturedPieces[i - 1]?.piece !== cp.piece ? 3 : 0 }}>
            {cp.symbol}
          </span>
        ))}
        {materialAdv > 0 && (
          <span className="text-xs font-bold ml-1" style={{ color: "#fff" }}>+{materialAdv}</span>
        )}
      </div>
      {showThinking && thinking && (
        <div
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 ml-auto"
          style={{ borderColor: "#4b4847", borderTopColor: "#81b64c" }}
        />
      )}
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-4" style={{ color: "#fff" }}>
      {/* Header row */}
      <div className="flex items-center justify-between w-full" style={{ maxWidth: BOARD_SIZE + 320 }}>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm font-bold transition-colors"
          style={{ backgroundColor: "#3d3a37", color: "#d1cfcc" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4b4847")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#3d3a37")}
        >
          &#8592; Back
        </button>
        <div className="flex items-center gap-3">
          <select
            value={activeTimeCategory}
            onChange={(e) => setActiveTimeCategory(e.target.value)}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 6,
              border: "none",
              backgroundColor: "#3d3a37",
              color: "#d1cfcc",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="bullet">Bullet</option>
            <option value="blitz">Blitz</option>
            <option value="rapid">Rapid</option>
          </select>
          <span className="font-bold" style={{ color: "#6b6966", fontSize: 14 }}>vs</span>
          {opponentProfile?.countryCode && (
            <span style={{ fontSize: 16 }}>{countryCodeToFlag(opponentProfile.countryCode)}</span>
          )}
          <span className="font-extrabold" style={{ color: "#fff", fontSize: 15 }}>
            {opponentDisplay}
          </span>
          {opponentRating && (
            <span className="text-sm" style={{ color: "#9b9895" }}>({opponentRating})</span>
          )}
        </div>
      </div>

      {/* Main layout: board + side panel */}
      <div className="flex gap-4 items-start">
        {/* Board column */}
        <div style={{ width: BOARD_SIZE }}>
          {/* Top player bar */}
          <PlayerBar
            name={topName}
            rating={topRating}
            country={topCountry}
            capturedPieces={topCaptured}
            materialAdv={topMaterialDiff}
            showThinking={isTopOpponent}
          />

          {/* Board */}
          <div style={{ width: BOARD_SIZE, height: BOARD_SIZE }}>
            {mounted ? (
              <Chessboard
                options={{
                  position: game.fen(),
                  onPieceDrop: handlePieceDrop,
                  onPieceClick: handlePieceClick,
                  onSquareClick: handleSquareClick,
                  boardOrientation: boardOrientation,
                  allowDragging: !boardDisabled && !isBotTurn(),
                  darkSquareStyle: { backgroundColor: "#779952" },
                  lightSquareStyle: { backgroundColor: "#edeed1" },
                  squareStyles: getSquareStyles(),
                }}
              />
            ) : (
              <div
                className="flex items-center justify-center w-full h-full"
                style={{ backgroundColor: "#272522" }}
              >
                <div
                  className="h-8 w-8 animate-spin rounded-full border-4"
                  style={{ borderColor: "#3d3a37", borderTopColor: "#81b64c" }}
                />
              </div>
            )}
          </div>

          {/* Bottom player bar */}
          <PlayerBar
            name={bottomName}
            rating={bottomRating}
            country={bottomCountry}
            capturedPieces={bottomCaptured}
            materialAdv={-topMaterialDiff}
            showThinking={!isTopOpponent}
          />

          {/* Game controls */}
          <div className="flex items-center justify-center gap-3 mt-3">
            {!gameOver ? (
              <button
                onClick={handleResign}
                disabled={moveHistory.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded transition-colors"
                style={{
                  backgroundColor: moveHistory.length === 0 ? "#3d3a37" : "#8b2020",
                  color: moveHistory.length === 0 ? "#6b6966" : "#fff",
                  border: "none",
                  cursor: moveHistory.length === 0 ? "default" : "pointer",
                }}
                onMouseEnter={(e) => { if (moveHistory.length > 0) e.currentTarget.style.backgroundColor = "#a52a2a"; }}
                onMouseLeave={(e) => { if (moveHistory.length > 0) e.currentTarget.style.backgroundColor = "#8b2020"; }}
              >
                <span style={{ fontSize: 14 }}>&#9873;</span> Resign
              </button>
            ) : (
              <button
                onClick={resetGame}
                className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded transition-colors"
                style={{ backgroundColor: "#81b64c", color: "#fff", border: "none", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#6fa33e")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#81b64c")}
              >
                New Game
              </button>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div
          className="flex flex-col rounded-md overflow-hidden"
          style={{
            width: 300,
            height: BOARD_SIZE + 76, /* board + both player bars */
            backgroundColor: "#272522",
          }}
        >
          {/* Game Over banner */}
          {gameOver && (
            <div
              className="px-4 py-3 flex items-center gap-3"
              style={{ borderBottom: "1px solid #3d3a37", backgroundColor: "#1c1b19" }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: resigned ? "#e05252" : "#81b64c" }}
              >
                <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>
                  {resigned ? "\u2715" : "\u2713"}
                </span>
              </div>
              <div>
                <p className="text-sm font-extrabold" style={{ color: "#fff" }}>
                  Game Over
                </p>
                <p className="text-xs font-bold" style={{ color: "#d1cfcc" }}>
                  {gameResult}
                </p>
              </div>
            </div>
          )}

          {/* Move Stats */}
          {lastMoveStats && lastMoveStats.moves.length > 0 && (
            <div className="px-4 py-3" style={{ borderBottom: "1px solid #3d3a37" }}>
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>
                  Opening Book
                </h3>
                {lastMoveSource && SOURCE_LABELS[lastMoveSource] && (
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded"
                    style={{
                      backgroundColor: SOURCE_LABELS[lastMoveSource].color + "20",
                      color: SOURCE_LABELS[lastMoveSource].color,
                    }}
                  >
                    {SOURCE_LABELS[lastMoveSource].label}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                {lastMoveStats.moves.slice(0, 6).map((m) => (
                  <div key={m.uci} className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono font-bold"
                      style={{ color: "#fff", width: 40, textAlign: "right" }}
                    >
                      {m.san}
                    </span>
                    <div
                      className="flex-1 rounded-sm overflow-hidden"
                      style={{ height: 16, backgroundColor: "#1c1b19" }}
                    >
                      <div
                        className="h-full rounded-sm"
                        style={{
                          width: `${Math.max(m.pct, 2)}%`,
                          backgroundColor: "#81b64c",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span
                      className="text-xs font-bold"
                      style={{ color: "#9b9895", width: 36, textAlign: "right" }}
                    >
                      {m.pct}%
                    </span>
                  </div>
                ))}
              </div>

              {lastMoveStats.totalGames > 0 && (
                <p className="text-xs mt-2" style={{ color: "#6b6966" }}>
                  {lastMoveStats.totalGames.toLocaleString()} games
                </p>
              )}
            </div>
          )}

          {/* Thinking */}
          {thinking && (
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid #3d3a37" }}
            >
              <div
                className="h-3.5 w-3.5 animate-spin rounded-full border-2"
                style={{ borderColor: "#4b4847", borderTopColor: "#81b64c" }}
              />
              <span className="text-xs font-bold" style={{ color: "#d1cfcc" }}>
                {opponentUsername} is thinking...
              </span>
            </div>
          )}

          {/* Move History */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 py-2" style={{ borderBottom: "1px solid #3d3a37" }}>
              <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "#9b9895" }}>
                Moves
              </h3>
            </div>
            <div
              ref={moveHistoryRef}
              className="flex-1 overflow-y-auto"
            >
              {formattedMoves.length === 0 ? (
                <div className="px-4 py-4">
                  <p className="text-xs" style={{ color: "#6b6966" }}>
                    {opponentSide === "white" ? "Waiting for opponent..." : "Your move..."}
                  </p>
                </div>
              ) : (
                <div>
                  {formattedMoves.map((m, idx) => (
                    <div
                      key={m.number}
                      className="flex items-center text-xs font-mono"
                      style={{
                        backgroundColor: idx % 2 === 0 ? "#272522" : "#232120",
                        padding: "6px 16px",
                      }}
                    >
                      <span style={{ color: "#6b6966", width: 28, fontWeight: 700 }}>{m.number}.</span>
                      <span style={{ color: "#fff", width: 70, fontWeight: 600 }}>
                        {m.white || ""}
                      </span>
                      <span style={{ color: "#d1cfcc", width: 70, fontWeight: 600 }}>
                        {m.black || ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
