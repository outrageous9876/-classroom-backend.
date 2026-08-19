import express from "express";
import { eq, and, desc, sql, getTableColumns } from "drizzle-orm";

import { db } from "../db/index.js";
import { enrollments, classes, user } from "../db/schema/index.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { classId, studentId, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, +page);
    const limitPerPage = Math.max(1, +limit);
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];

    if (classId) {
      filterConditions.push(eq(enrollments.classId, Number(classId)));
    }

    if (studentId) {
      filterConditions.push(eq(enrollments.studentId, String(studentId)));
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(enrollments)
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    const enrollmentsList = await db
      .select({
        ...getTableColumns(enrollments),
        student: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
        class: { ...getTableColumns(classes) },
      })
      .from(enrollments)
      .leftJoin(user, eq(enrollments.studentId, user.id))
      .leftJoin(classes, eq(enrollments.classId, classes.id))
      .where(whereClause)
      .orderBy(desc(enrollments.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: enrollmentsList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /enrollments error:", error);
    res.status(500).json({ error: "Failed to fetch enrollments" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { studentId, classId } = req.body;

    const [createdEnrollment] = await db
      .insert(enrollments)
      .values({ studentId, classId })
      .returning({ id: enrollments.id });

    if (!createdEnrollment) throw Error;

    res.status(201).json({ data: createdEnrollment });
  } catch (error) {
    console.error("POST /enrollments error:", error);
    res.status(500).json({ error: "Failed to create enrollment" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);

    if (!Number.isFinite(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment id" });
    }

    await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));

    res.status(200).json({ data: { id: enrollmentId } });
  } catch (error) {
    console.error("DELETE /enrollments/:id error:", error);
    res.status(500).json({ error: "Failed to delete enrollment" });
  }
});

export default router;
