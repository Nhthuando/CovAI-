import prisma from "./src/config/prisma.js";
import fs from "fs";

async function main() {
  const projects = await prisma.project.findMany({
    include: { snapshots: true },
  });
  console.log("PROJECTS_DATA:");
  console.log(
    JSON.stringify(
      projects.map((proj) => ({
        id: proj.id,
        name: proj.name,
        snapshots: proj.snapshots.map((s) => ({
          id: s.id,
          rootDir: s.rootDir,
          exists: s.rootDir ? fs.existsSync(s.rootDir) : false,
        })),
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("DB Error:", err);
  process.exit(1);
});
