import express from "express";
import { eq, ilike, and, desc, sql, getTableColumns } from "drizzle-orm";

import { db } from "../db/index.js";
import { classes, subjects, user, enrollments } from "../db/schema/index.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { search, subject, teacher, page = 1, limit = 10 } = req.query;

    const currentPage = Math.max(1, +page);
    const limitPerPage = Math.max(1, +limit);
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];

    if (search) {
      filterConditions.push(ilike(classes.name, `%${search}%`));
    }

    if (subject) {
      filterConditions.push(eq(classes.subjectId, Number(subject)));
    }

    if (teacher) {
      filterConditions.push(eq(classes.teacherId, String(teacher)));
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(classes)
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    const classesList = await db
      .select({
        ...getTableColumns(classes),
        subject: { ...getTableColumns(subjects) },
        teacher: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(whereClause)
      .orderBy(desc(classes.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: classesList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /classes error:", error);
    res.status(500).json({ error: "Failed to fetch classes" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      subjectId,
      teacherId,
      name,
      description,
      status,
      capacity,
      bannerUrl,
      bannerCldPubId,
      schedules,
      inviteCode,
    } = req.body;

    const [createdClass] = await db
      .insert(classes)
      .values({
        subjectId,
        teacherId,
        name,
        description,
        status,
        capacity,
        bannerUrl,
        bannerCldPubId,
        schedules,
        inviteCode,
      })
      .returning({ id: classes.id });

    if (!createdClass) throw Error;

    res.status(201).json({ data: createdClass });
  } catch (error) {
    console.error("POST /classes error:", error);
    res.status(500).json({ error: "Failed to create class" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const classId = Number(req.params.id);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    const [classDetails] = await db
      .select({
        ...getTableColumns(classes),
        subject: { ...getTableColumns(subjects) },
        teacher: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(eq(classes.id, classId));

    if (!classDetails) {
      return res.status(404).json({ error: "Class not found" });
    }

    const enrollmentsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(enrollments)
      .where(eq(enrollments.classId, classId));

    res.status(200).json({
      data: {
        ...classDetails,
        totals: {
          enrollments: enrollmentsCount[0]?.count ?? 0,
        },
      },
    });
  } catch (error) {
    console.error("GET /classes/:id error:", error);
    res.status(500).json({ error: "Failed to fetch class details" });
  }
});

export default router;
