import prisma from "../src/config/prisma.js";
import { createRunTestsJob } from "../src/services/job.service.js";
import { processRunTestsJob } from "../src/services/runTestsJob.service.js";

async function main() {
  const snapshotId = "cmus89czq00012ho2hsprbnha";
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    include: { project: true }
  });

  if (!snapshot) {
    console.error("Snapshot not found:", snapshotId);
    process.exit(1);
  }

  console.log("Creating RUN_TESTS job for snapshot:", snapshotId, "project:", snapshot.projectId);
  const job = await createRunTestsJob({
    projectId: snapshot.projectId,
    snapshotId: snapshot.id,
    userId: snapshot.project.ownerId,
    mode: "FULL"
  });

  console.log("Created job:", job.id, "status:", job.status);
  console.log("Starting processRunTestsJob...");
  await processRunTestsJob(job.id);
  console.log("processRunTestsJob completed!");

  const updatedSummary = await prisma.coverageSummary.findUnique({
    where: { snapshotId: snapshot.id }
  });
  console.log("\n=== UPDATED COVERAGE SUMMARY IN PRISMA DB ===");
  console.log(JSON.stringify(updatedSummary, null, 2));

  const completedJob = await prisma.job.findUnique({
    where: { id: job.id }
  });
  console.log("\n=== COMPLETED JOB RECORD ===");
  console.log("Job status:", completedJob?.status);
  console.log("Coverage Result:", completedJob?.coverageResultJson);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error executing script:", err);
    process.exit(1);
  });
