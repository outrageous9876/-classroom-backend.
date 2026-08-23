import express from "express";
import { eq, and, desc, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { enrollments, classes, user } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Explicit projection — excludes inviteCode, same reasoning as classes.ts
// and subjects.ts: it's an access credential, never returned in list/detail
// responses.
const publicClassColumns = {
  id: classes.id,
  subjectId: classes.subjectId,
  teacherId: classes.teacherId,
  name: classes.name,
  description: classes.description,
  status: classes.status,
  capacity: classes.capacity,
  bannerUrl: classes.bannerUrl,
  bannerCldPubId: classes.bannerCldPubId,
  schedules: classes.schedules,
  createdAt: classes.createdAt,
  updatedAt: classes.updatedAt,
};

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
        id: enrollments.id,
        studentId: enrollments.studentId,
        classId: enrollments.classId,
        createdAt: enrollments.createdAt,
        updatedAt: enrollments.updatedAt,
        student: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
        class: { ...publicClassColumns },
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

// A student enrolls themselves — studentId always comes from the
// authenticated session, never from the request body. Trusting a
// client-supplied studentId would let anyone enroll someone else.
router.post("/", requireAuth, async (req, res) => {
  try {
    const studentId = req.user!.id!;
    const { classId } = req.body;

    if (!classId) {
      return res.status(400).json({ error: "classId is required" });
    }

    const [createdEnrollment] = await db
      .insert(enrollments)
      .values({ studentId, classId })
      .returning({ id: enrollments.id });

    if (!createdEnrollment) throw Error;

    res.status(201).json({ data: createdEnrollment });
  } catch (error: any) {
    if (error.code === "23505" || error?.cause?.code === "23505") {
      return res.status(409).json({ error: "Already enrolled in this class" });
    }
    console.error("POST /enrollments error:", error);
    res.status(500).json({ error: "Failed to create enrollment" });
  }
});

// A student can remove their own enrollment. A teacher can remove an
// enrollment only for a class they own. Admins can remove any enrollment.
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const enrollmentId = Number(req.params.id);

    if (!Number.isFinite(enrollmentId)) {
      return res.status(400).json({ error: "Invalid enrollment id" });
    }

    const [existing] = await db
      .select({
        studentId: enrollments.studentId,
        classTeacherId: classes.teacherId,
      })
      .from(enrollments)
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .where(eq(enrollments.id, enrollmentId));

    if (!existing) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    const isOwner = existing.studentId === req.user!.id;
    const isAdmin = req.user!.role === "admin";
    const isOwningTeacher =
      req.user!.role === "teacher" &&
      existing.classTeacherId === req.user!.id;

    if (!isOwner && !isAdmin && !isOwningTeacher) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const [deleted] = await db
      .delete(enrollments)
      .where(eq(enrollments.id, enrollmentId))
      .returning({ id: enrollments.id });

    if (!deleted) {
      return res.status(404).json({ error: "Enrollment not found" });
    }

    res.status(200).json({ data: { id: enrollmentId } });
  } catch (error) {
    console.error("DELETE /enrollments/:id error:", error);
    res.status(500).json({ error: "Failed to delete enrollment" });
  }
});

export default router;