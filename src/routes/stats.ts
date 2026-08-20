import express from "express";
import { sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { user, departments, subjects, classes, enrollments } from "../db/schema/index.js";

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const [
      usersCount,
      teachersCount,
      adminsCount,
      departmentsCount,
      subjectsCount,
      classesCount,
      enrollmentsCount,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(user),
      db
        .select({ count: sql<number>`count(*)` })
        .from(user)
        .where(sql`${user.role} = 'teacher'`),
      db
        .select({ count: sql<number>`count(*)` })
        .from(user)
        .where(sql`${user.role} = 'admin'`),
      db.select({ count: sql<number>`count(*)` }).from(departments),
      db.select({ count: sql<number>`count(*)` }).from(subjects),
      db.select({ count: sql<number>`count(*)` }).from(classes),
      db.select({ count: sql<number>`count(*)` }).from(enrollments),
    ]);

    res.status(200).json({
      data: {
        users: usersCount[0]?.count ?? 0,
        teachers: teachersCount[0]?.count ?? 0,
        admins: adminsCount[0]?.count ?? 0,
        departments: departmentsCount[0]?.count ?? 0,
        subjects: subjectsCount[0]?.count ?? 0,
        classes: classesCount[0]?.count ?? 0,
        enrollments: enrollmentsCount[0]?.count ?? 0,
      },
    });
  } catch (error) {
    console.error("GET /stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
