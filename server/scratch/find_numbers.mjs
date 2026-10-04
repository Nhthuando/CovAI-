import prisma from "../src/config/prisma.js";
import fs from "fs";
import path from "path";

async function main() {
  const summaries = await prisma.coverageSummary.findMany();
  console.log("All summaries:", summaries);

  const snapshots = await prisma.projectSnapshot.findMany({
    include: { project: true }
  });
  console.log("All snapshots:", snapshots.map(s => ({ id: s.id, rootDir: s.rootDir, project: s.project?.name })));

  // Search storage for coverage-summary.json
  const storageDir = path.resolve("./storage");
  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(full);
      } else if (ent.name.endsWith(".json")) {
        try {
          const content = fs.readFileSync(full, "utf8");
          if (content.includes("1621") || content.includes("1,621") || content.includes("1162") || content.includes("1,162")) {
            console.log("FOUND IN FILE:", full);
          }
        } catch (_) {}
      }
    }
  }
  scanDir(storageDir);
}

main().finally(() => prisma.$disconnect());
