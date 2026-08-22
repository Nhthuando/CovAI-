import fs from "fs";
import { dockerRunner } from "./dockerRunner.service.js";

const SYSTEM_TEST_TIMEOUT_MS = 10 * 60 * 1000;
const RUNNER_IMAGES = Object.freeze({
  playwright: process.env.PLAYWRIGHT_DOCKER_IMAGE || "mcr.microsoft.com/playwright:v1.52.0-jammy",
  cypress: process.env.CYPRESS_DOCKER_IMAGE || "cypress/browsers:node-22.14.0-chrome-131.0.6778.264-1-ff-133.0.3-edge-131.0.2903.86-1",
});

export const runSystemTests = async ({ jobId, rootDir, execution }) => {
  fs.mkdirSync(execution.reportDirectory, { recursive: true });
  return dockerRunner.run({
    snapshotPath: rootDir,
    command: execution.command,
    timeoutMs: SYSTEM_TEST_TIMEOUT_MS,
    jobId,
    image: RUNNER_IMAGES[execution.runner],
  });
};
