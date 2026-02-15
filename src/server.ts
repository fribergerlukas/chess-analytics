import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import importRouter from "./routes/import";
import gamesRouter from "./routes/games";
import puzzlesRouter from "./routes/puzzles";
import arenaRouter from "./routes/arena";
import simulationRouter from "./routes/simulation";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/auth", authRouter);
app.use("/import", importRouter);
app.use(gamesRouter);
app.use(puzzlesRouter);
app.use(arenaRouter);
app.use(simulationRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
