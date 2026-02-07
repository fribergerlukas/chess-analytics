import express, { Request, Response, NextFunction } from "express";
import importRouter from "./routes/import";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use("/import", importRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
