import "dotenv/config";
import { db } from "../src/db/index.js";
import { departments } from "../src/db/schema/index.js";

const DEPARTMENT_NAMES = [
  "Computer Science",
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "History",
  "Geography",
  "Economics",
  "Business Administration",
  "Engineering",
  "Psychology",
  "Sociology",
  "Political Science",
  "Philosophy",
  "Education",
  "Fine Arts",
  "Music",
  "Physical Education",
  "Law",
];

async function main() {
  console.log("Seeding departments...");

  const inserted = await db
    .insert(departments)
    .values(DEPARTMENT_NAMES.map((name) => ({ name })))
    .onConflictDoNothing({ target: departments.name })
    .returning({ id: departments.id, name: departments.name });

  console.log(`Seeded ${inserted.length} department(s).`);
}

main()
  .then(() => {
    console.log("Seeding complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  });
