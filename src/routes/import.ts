import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { importGames } from "../services/chesscom";
import { parseAllUnparsed } from "../services/positions";

const router = Router();

const chesscomImportSchema = z.object({
  username: z.string().min(1, "Username is required"),
});

// TODO: Add Lichess import route (POST /lichess)
// TODO: Add time-window filtering (optional startDate/endDate in body)
// TODO: Move position parsing to a background queue for large imports

router.post(
  "/chesscom",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username } = chesscomImportSchema.parse(req.body);
      const imported = await importGames(username);

      let parsed = 0;
      if (imported > 0) {
        parsed = await parseAllUnparsed();
      }

      res.json({ imported, parsed });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors });
        return;
      }
      next(err);
    }
  }
);

export default router;
