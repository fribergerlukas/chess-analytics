import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import prisma from "../lib/prisma";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "chess-arena-dev-secret";
const JWT_EXPIRES_IN = "30d";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  username: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /auth/signup
 */
router.post(
  "/signup",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
      }

      const email = parsed.data.email.toLowerCase();
      const username = parsed.data.username.toLowerCase();
      const passwordHash = await bcrypt.hash(parsed.data.password, 10);

      // Check for duplicate email
      const existingEmail = await prisma.user.findFirst({
        where: { email },
      });
      if (existingEmail) {
        res.status(409).json({ error: "Email already in use" });
        return;
      }

      // Check if a User row already exists for this chess.com username (from prior import)
      const existingUser = await prisma.user.findUnique({
        where: { username },
      });

      let user;
      if (existingUser && !existingUser.passwordHash) {
        // Claim the existing row by adding auth fields
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: { email, passwordHash },
        });
      } else if (existingUser && existingUser.passwordHash) {
        res.status(409).json({ error: "Username already registered" });
        return;
      } else {
        user = await prisma.user.create({
          data: { username, email, passwordHash },
        });
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
      });

      res.json({ token, username: user.username });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/login
 */
router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0].message });
        return;
      }

      const email = parsed.data.email.toLowerCase();
      const user = await prisma.user.findFirst({ where: { email } });

      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
      });

      res.json({ token, username: user.username });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /auth/me
 */
router.get(
  "/me",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "No token provided" });
        return;
      }

      const token = authHeader.slice(7);
      let payload: { userId: number };
      try {
        payload = jwt.verify(token, JWT_SECRET) as { userId: number };
      } catch {
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      res.json({ username: user.username });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
