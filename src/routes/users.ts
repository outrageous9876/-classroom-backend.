import express from "express";
import { eq, ilike, or, and, desc, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { user } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Faculty & Users directory (GET /, GET /:id) is browsable by every
// authenticated role, including students — the frontend has no role gate
// on this page. Only admins/teachers get the email field in the response;
// students see everything else (name, role, image, etc.) with email
// stripped out.
function stripEmailUnlessStaff<T extends { email: string }>(
  record: T,
  role: string | undefined
): T | Omit<T, "email"> {
  if (role === "admin" || role === "teacher") {
    return record;
  }
  const { email, ...rest } = record;
  return rest;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const { search, role, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, +page);
    const limitPerPage = Math.max(1, +limit);
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];

    if (search) {
      filterConditions.push(
        or(ilike(user.name, `%${search}%`), ilike(user.email, `%${search}%`))
      );
    }

    if (role === "admin" || role === "teacher" || role === "student") {
      filterConditions.push(eq(user.role, role));
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(user)
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    const usersList = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        role: user.role,
        imageCldPubId: user.imageCldPubId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(whereClause)
      .orderBy(desc(user.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    const responseData = usersList.map((u) =>
      stripEmailUnlessStaff(u, req.user!.role)
    );

    res.status(200).json({
      data: responseData,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [foundUser] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        role: user.role,
        imageCldPubId: user.imageCldPubId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(eq(user.id, String(req.params.id)));

    if (!foundUser) {
      return res.status(404).json({ error: "User not found" });
    }

    res
      .status(200)
      .json({ data: stripEmailUnlessStaff(foundUser, req.user!.role) });
  } catch (error) {
    console.error("GET /users/:id error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
