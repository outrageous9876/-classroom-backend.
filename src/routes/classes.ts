import express from "express";
import { randomInt } from "node:crypto";
import { eq, ilike, and, desc, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { classes, subjects, user, enrollments } from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Explicit projection for classes — excludes inviteCode from public responses.
// inviteCode is only meant to be known by the teacher who created the class
// and shared manually with students; it must never be exposed via list/detail APIs.
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
        ...publicClassColumns,
        subject: { ...getSubjectColumns() },
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

const MAX_INVITE_CODE_ATTEMPTS = 5;
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid ambiguity
const INVITE_CODE_LENGTH = 6;

// Cryptographically secure, fixed-width invite code — this is an access
// credential, so Math.random() (predictable, variable-length) is not
// acceptable here.
function generateInviteCode() {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

function isUniqueViolation(error: any): boolean {
  // Drizzle wraps the real Postgres error inside `cause`, so check both
  // the top-level code and error.cause.code to be safe across versions.
  return error?.code === "23505" || error?.cause?.code === "23505";
}

// Only logged-in teachers/admins can create a class.
router.post("/", requireAuth, requireRole("teacher", "admin"), async (req, res) => {
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
    } = req.body;

    let createdClass;
    let lastError;

    // Retry on invite code collisions — the client never sees or controls
    // the code, so a collision should be resolved internally, not surfaced
    // as a failure to create the class.
    for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
      try {
        [createdClass] = await db
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
            schedules: schedules ?? [],
            inviteCode: generateInviteCode(),
          })
          .returning({ id: classes.id, inviteCode: classes.inviteCode });

        lastError = undefined;
        break;
      } catch (error: any) {
        if (isUniqueViolation(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      return res.status(409).json({
        error: "Could not generate a unique invite code, please try again",
      });
    }

    if (!createdClass) throw new Error("Class creation returned no result");

    // The invite code is returned only here, to the creator, right after
    // creation — it is never included in list/detail responses.
    res.status(201).json({ data: createdClass });
  } catch (error) {
    console.error("POST /classes error:", error);
    res.status(500).json({ error: "Failed to create class" });
  }
});


// A student joins a class using its invite code. The invite code is the
// only way to discover the classId here — it is never exposed via list
// endpoints, so this is the sole entry point for enrollment by code.
router.post("/join", requireAuth, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Invite code is required" });
    }

    const [foundClass] = await db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(eq(classes.inviteCode, code.trim().toUpperCase()));

    if (!foundClass) {
      return res.status(404).json({ error: "Invalid invite code" });
    }

    const studentId = req.user!.id!;

    const [enrollment] = await db
      .insert(enrollments)
      .values({ studentId, classId: foundClass.id })
      .returning({ id: enrollments.id });

    if (!enrollment) throw new Error("Enrollment insert returned no result");

    res.status(201).json({
      data: { classId: foundClass.id, className: foundClass.name },
    });
  } catch (error: any) {
    if (error.code === "23505" || error?.cause?.code === "23505") {
      return res.status(409).json({ error: "You are already enrolled in this class" });
    }
    console.error("POST /classes/join error:", error);
    res.status(500).json({ error: "Failed to join class" });
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
        ...publicClassColumns,
        subject: { ...getSubjectColumns() },
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

// Update a class. Only fields that make sense to edit after creation are
// accepted — subjectId, teacherId, and inviteCode are intentionally NOT
// editable here (changing the teacher/subject of an existing class with
// enrollments would be a much bigger operation than a simple field edit).
router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const classId = Number(req.params.id);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    const [existingClass] = await db
      .select({ teacherId: classes.teacherId })
      .from(classes)
      .where(eq(classes.id, classId));

    if (!existingClass) {
      return res.status(404).json({ error: "Class not found" });
    }

    if (
      req.user!.role !== "admin" &&
      existingClass.teacherId !== req.user!.id
    ) {
      return res
        .status(403)
        .json({ error: "You can only modify your own classes." });
    }

    const {
      name,
      description,
      status,
      capacity,
      bannerUrl,
      bannerCldPubId,
      schedules,
    } = req.body;

    const [updatedClass] = await db
      .update(classes)
      .set({
        name,
        description,
        status,
        capacity,
        bannerUrl,
        bannerCldPubId,
        schedules,
        updatedAt: new Date(),
      })
      .where(eq(classes.id, classId))
      .returning({ id: classes.id });

    if (!updatedClass) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.status(200).json({ data: updatedClass });
  } catch (error) {
    console.error("PATCH /classes/:id error:", error);
    res.status(500).json({ error: "Failed to update class" });
  }
});


// List students enrolled in a class, with pagination.
router.get("/:id/users", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    const { page = 1, limit = 10 } = req.query;

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    const currentPage = Math.max(1, +page);
    const limitPerPage = Math.max(1, +limit);
    const offset = (currentPage - 1) * limitPerPage;

    const countResult = await db
    .select({ count: sql<number>`count(*)` })      
      .from(enrollments)
      .where(eq(enrollments.classId, classId));

    const totalCount = countResult[0]?.count ?? 0;

    const studentsList = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
      })
      .from(enrollments)
      .innerJoin(user, eq(enrollments.studentId, user.id))
      .where(eq(enrollments.classId, classId))
      .orderBy(desc(enrollments.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: studentsList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /classes/:id/users error:", error);
    res.status(500).json({ error: "Failed to fetch enrolled students" });
  }
});


// Only the owning teacher or an admin can delete a class.
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const classId = Number(req.params.id);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    const [existingClass] = await db
      .select({ teacherId: classes.teacherId })
      .from(classes)
      .where(eq(classes.id, classId));

    if (!existingClass) {
      return res.status(404).json({ error: "Class not found" });
    }

    if (
      req.user!.role !== "admin" &&
      existingClass.teacherId !== req.user!.id
    ) {
      return res
        .status(403)
        .json({ error: "You can only modify your own classes." });
    }

    const [deletedClass] = await db
      .delete(classes)
      .where(eq(classes.id, classId))
      .returning({ id: classes.id });

    if (!deletedClass) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.status(200).json({ data: { id: classId } });
  } catch (error) {
    console.error("DELETE /classes/:id error:", error);
    res.status(500).json({ error: "Failed to delete class" });
  }
});

function getSubjectColumns() {
  return {
    id: subjects.id,
    departmentId: subjects.departmentId,
    name: subjects.name,
    code: subjects.code,
    description: subjects.description,
    createdAt: subjects.createdAt,
    updatedAt: subjects.updatedAt,
  };
}

export default router;