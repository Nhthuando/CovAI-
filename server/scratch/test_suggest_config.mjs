import { suggestUnitTestcases } from "../src/services/unitTestSuggestion.service.js";
import prisma from "../src/config/prisma.js";

async function run() {
  const snapshotId = "cmus89czq00012ho2hsprbnha";
  const snap = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    include: { project: true }
  });
  console.log("Snapshot found:", snap.id, snap.project.name, snap.project.ownerId);

  const res = await suggestUnitTestcases({
    projectId: snap.projectId,
    snapshotId: snap.id,
    filePath: "src/configuration.ts",
    userId: snap.project.ownerId
  });

  console.log("Suggestion result:");
  console.log("Explanation:", res.explanation);
  console.log("suggestedTestCode:\n", res.suggestedTestCode);
  console.log("fullUpdatedContent:\n", res.fullUpdatedContent);
}

run().catch(console.error).finally(() => prisma.$disconnect());
