import "dotenv/config";
import { db } from "../src/db/index.js";
import { departments } from "../src/db/schema/index.js";

const DEPARTMENTS = [
  { name: "Computer Science", code: "CS" },
  { name: "Mathematics", code: "MATH" },
  { name: "Physics", code: "PHYS" },
  { name: "Chemistry", code: "CHEM" },
  { name: "Biology", code: "BIO" },
  { name: "English", code: "ENG" },
  { name: "History", code: "HIST" },
  { name: "Geography", code: "GEO" },
  { name: "Economics", code: "ECON" },
  { name: "Business Administration", code: "BUS" },
  { name: "Engineering", code: "ENGR" },
  { name: "Psychology", code: "PSY" },
  { name: "Sociology", code: "SOC" },
  { name: "Political Science", code: "POLI" },
  { name: "Philosophy", code: "PHIL" },
  { name: "Education", code: "EDU" },
  { name: "Fine Arts", code: "ART" },
  { name: "Music", code: "MUS" },
  { name: "Physical Education", code: "PE" },
  { name: "Law", code: "LAW" },
];

async function main() {
  console.log("Seeding departments...");

  const inserted = await db
    .insert(departments)
    .values(DEPARTMENTS)
    .onConflictDoNothing({ target: departments.code })
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
