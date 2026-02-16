import { spawn, ChildProcessWithoutNullStreams } from "child_process";

export interface EvalResult {
  /** Centipawns from the side-to-move's perspective */
  score: number;
  depth: number;
  bestMove: string;
  pv: string;
}

// TODO: Add MultiPV support for narrowness constraint in defending puzzles.
// evaluateMultiPv(fen, depth, numPv) → MultiPvLine[]
// This would enable checking that only 1-2 acceptable defensive moves exist,
// which is a key quality signal for defending puzzles.

export class StockfishEngine {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private listener: ((line: string) => void) | null = null;

  async init(): Promise<void> {
    const bin = process.env.STOCKFISH_PATH || "stockfish";
    this.process = spawn(bin);

    this.process.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer
      this.buffer = lines.pop()!;
      for (const line of lines) {
        if (this.listener) this.listener(line);
      }
    });

    this.process.on("error", (err) => {
      throw new Error(`Failed to start Stockfish: ${err.message}`);
    });

    await this.sendAndWait("uci", "uciok");
    this.send("isready");
    await this.waitFor("readyok");
  }

  /**
   * Evaluate a FEN position at the given depth.
   * Returns the score from the side-to-move's perspective.
   */
  async evaluate(fen: string, depth = 20): Promise<EvalResult> {
    this.send(`position fen ${fen}`);
    this.send("isready");
    await this.waitFor("readyok");

    let lastScore = 0;
    let lastDepth = 0;
    let lastPv = "";

    const result = await new Promise<EvalResult>((resolve) => {
      this.listener = (line: string) => {
        if (line.startsWith("info") && line.includes(" score ")) {
          const depthMatch = line.match(/\bdepth (\d+)/);
          const cpMatch = line.match(/\bscore cp (-?\d+)/);
          const mateMatch = line.match(/\bscore mate (-?\d+)/);
          const pvMatch = line.match(/\bpv (.+)/);

          if (depthMatch) lastDepth = parseInt(depthMatch[1], 10);
          if (pvMatch) lastPv = pvMatch[1].trim();

          if (cpMatch) {
            lastScore = parseInt(cpMatch[1], 10);
          } else if (mateMatch) {
            const mateIn = parseInt(mateMatch[1], 10);
            lastScore = mateIn > 0 ? 10000 : -10000;
          }
        }

        if (line.startsWith("bestmove")) {
          const bestMove = line.split(" ")[1] || "";
          this.listener = null;
          resolve({ score: lastScore, depth: lastDepth, bestMove, pv: lastPv });
        }
      };

      this.send(`go depth ${depth}`);
    });

    return result;
  }

  shutdown(): void {
    if (this.process) {
      this.send("quit");
      this.process.kill();
      this.process = null;
    }
  }

  private send(cmd: string): void {
    this.process!.stdin.write(cmd + "\n");
  }

  private sendAndWait(cmd: string, sentinel: string): Promise<void> {
    this.send(cmd);
    return this.waitFor(sentinel);
  }

  private waitFor(sentinel: string): Promise<void> {
    return new Promise((resolve) => {
      this.listener = (line: string) => {
        if (line.startsWith(sentinel)) {
          this.listener = null;
          resolve();
        }
      };
    });
  }
}
