import express from "express";
import { eq, ilike, desc, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { departments, subjects } from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, +page);
    const limitPerPage = Math.max(1, +limit);
    const offset = (currentPage - 1) * limitPerPage;

    const whereClause = search
      ? ilike(departments.name, `%${search}%`)
      : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(departments)
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    const departmentsList = await db
      .select()
      .from(departments)
      .where(whereClause)
      .orderBy(desc(departments.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: departmentsList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /departments error:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});

// Only logged-in admins can create a department.
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { code, name, description } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: "Code and name are required" });
    }

    const [createdDepartment] = await db
      .insert(departments)
      .values({ code, name, description })
      .returning({ id: departments.id });

    if (!createdDepartment) throw Error;

    res.status(201).json({ data: createdDepartment });
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Department code already exists" });
    }
    console.error("POST /departments error:", error);
    res.status(500).json({ error: "Failed to create department" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const departmentId = Number(req.params.id);

    if (!Number.isFinite(departmentId)) {
      return res.status(400).json({ error: "Invalid department id" });
    }

    const [department] = await db
      .select()
      .from(departments)
      .where(eq(departments.id, departmentId));

    if (!department) {
      return res.status(404).json({ error: "Department not found" });
    }

    const subjectsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(subjects)
      .where(eq(subjects.departmentId, departmentId));

    res.status(200).json({
      data: {
        ...department,
        totals: {
          subjects: subjectsCount[0]?.count ?? 0,
        },
      },
    });
  } catch (error) {
    console.error("GET /departments/:id error:", error);
    res.status(500).json({ error: "Failed to fetch department details" });
  }
});

// Only logged-in admins can delete a department.
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const departmentId = Number(req.params.id);

    if (!Number.isFinite(departmentId)) {
      return res.status(400).json({ error: "Invalid department id" });
    }

    const [deletedDepartment] = await db
      .delete(departments)
      .where(eq(departments.id, departmentId))
      .returning({ id: departments.id });

    if (!deletedDepartment) {
      return res.status(404).json({ error: "Department not found" });
    }

    res.status(200).json({ data: deletedDepartment });
  } catch (error) {
    console.error("DELETE /departments/:id error:", error);
    res.status(500).json({ error: "Failed to delete department" });
  }
});

export default router;