import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(serverRoot, ".env") });

const TOKEN_REMOTE_REGEX =
  /https:\/\/(?:x-access-token:[^@\s]+|[^:@/\s]+:[^@\s]+)@github\.com\//gi;

/**
 * Scrubs plaintext credentials from any legacy .git/config files under storage/projects.
 */
export function scrubLegacyGitConfigs(storageRoot, apply = false) {
  const summary = { scanned: 0, cleaned: 0, files: [] };
  if (!fs.existsSync(storageRoot)) return summary;

  const projectDirs = fs.readdirSync(storageRoot, { withFileTypes: true });
  for (const projDir of projectDirs) {
    if (!projDir.isDirectory()) continue;
    const githubRoot = path.join(storageRoot, projDir.name, "github");
    if (!fs.existsSync(githubRoot)) continue;

    const cloneDirs = fs.readdirSync(githubRoot, { withFileTypes: true });
    for (const cloneDir of cloneDirs) {
      if (!cloneDir.isDirectory()) continue;
      const gitConfigPath = path.join(githubRoot, cloneDir.name, "repo", ".git", "config");
      if (!fs.existsSync(gitConfigPath)) continue;

      summary.scanned += 1;
      const original = fs.readFileSync(gitConfigPath, "utf8");
      if (TOKEN_REMOTE_REGEX.test(original)) {
        TOKEN_REMOTE_REGEX.lastIndex = 0;
        const sanitized = original.replace(TOKEN_REMOTE_REGEX, "https://github.com/");
        summary.cleaned += 1;
        summary.files.push(gitConfigPath);
        if (apply) {
          fs.writeFileSync(gitConfigPath, sanitized, "utf8");
        }
      }
    }
  }
  return summary;
}

/**
 * Backfills missing ProjectSnapshot.versionNumber and Project.activeSnapshotId.
 */
async function backfillSnapshotMetadata(prisma, apply = false) {
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      activeSnapshotId: true,
      snapshots: {
        orderBy: { createdAt: "asc" },
        select: { id: true, versionNumber: true, createdAt: true },
      },
    },
  });

  let updatedSnapshots = 0;
  let updatedProjects = 0;

  for (const project of projects) {
    if (!project.snapshots.length) continue;

    let maxVersion = project.snapshots.reduce(
      (max, snap) =>
        typeof snap.versionNumber === "number" && snap.versionNumber > max
          ? snap.versionNumber
          : max,
      0,
    );

    for (const snap of project.snapshots) {
      if (snap.versionNumber == null) {
        maxVersion += 1;
        updatedSnapshots += 1;
        if (apply) {
          await prisma.projectSnapshot.update({
            where: { id: snap.id },
            data: { versionNumber: maxVersion },
            select: { id: true },
          });
        }
      }
    }

    if (!project.activeSnapshotId) {
      const latestSnap = project.snapshots[project.snapshots.length - 1];
      if (latestSnap) {
        updatedProjects += 1;
        if (apply) {
          await prisma.project.update({
            where: { id: project.id },
            data: { activeSnapshotId: latestSnap.id },
            select: { id: true },
          });
        }
      }
    }
  }

  return { projectsScanned: projects.length, updatedSnapshots, updatedProjects };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const skipDb = process.argv.includes("--skip-db");
  const storageRoot = path.join(serverRoot, "storage", "projects");

  console.log(`[backfillVersionControlV2] Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  const gitReport = scrubLegacyGitConfigs(storageRoot, apply);
  console.log(
    `  Git configs scanned: ${gitReport.scanned}, needing scrub: ${gitReport.cleaned}`,
  );
  for (const f of gitReport.files) {
    console.log(`    - ${f}`);
  }

  if (!skipDb) {
    const { default: prisma } = await import("../src/config/prisma.js");
    try {
      const dbReport = await backfillSnapshotMetadata(prisma, apply);
      console.log(
        `  Projects scanned: ${dbReport.projectsScanned}, snapshots numbered: ${dbReport.updatedSnapshots}, activeSnapshotId backfilled: ${dbReport.updatedProjects}`,
      );
    } finally {
      await prisma.$disconnect();
    }
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  main().catch((err) => {
    console.error("[backfillVersionControlV2] Failed:", err);
    process.exit(1);
  });
}
