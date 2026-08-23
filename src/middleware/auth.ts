import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.js";

/**
 * Populates req.user from the Better Auth session, if one exists.
 * Does NOT block the request — use requireAuth (below) for that.
 * This lets routes that work differently for guests vs logged-in users
 * (e.g. different rate limits) see who's making the request either way.
 */
export const attachUser = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (session?.user) {
      req.user = {
        id: session.user.id,
        role: session.user.role as "admin" | "teacher" | "student",
      };
    }

    next();
  } catch (error) {
    console.error("attachUser error:", error);
    next();
  }
};

/**
 * Blocks the request with 401 if there's no authenticated session.
 * Use after attachUser, on routes that require login.
 */
export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
};

/**
 * Blocks the request with 403 if the authenticated user's role isn't
 * in the allowed list. Use after requireAuth.
 */
export const requireRole = (...roles: Array<"admin" | "teacher" | "student">) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role as any)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
};