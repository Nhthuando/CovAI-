import fs from "fs";
import path from "path";
import { detectCypress } from "../utils/cypressDetector.js";
import { detectPlaywright } from "../utils/playwrightDetector.js";

/**
 * Detects System Test frameworks (Playwright, Cypress) in a project
 * Returns a structured result with detected frameworks and metadata
 *
 * @param {string} rootDir - The root directory of the project
 * @returns {Object} Detection result with frameworks array
 */
export async function detectSystemTestFrameworks(rootDir) {
  if (!rootDir || typeof rootDir !== "string") {
    return {
      category: "SYSTEM",
      frameworks: [],
      hasSystemTests: false,
      error: "Invalid root directory",
    };
  }

  if (!fs.existsSync(rootDir)) {
    return {
      category: "SYSTEM",
      frameworks: [],
      hasSystemTests: false,
      error: "Root directory does not exist",
    };
  }

  const frameworks = [];
  const detectionErrors = [];

  // Detect Playwright
  try {
    const playwrightResult = detectPlaywright(rootDir);
    if (playwrightResult.hasPlaywright) {
      frameworks.push({
        name: "PLAYWRIGHT",
        detected: true,
        configPath: playwrightResult.configPath,
        testDirectory: playwrightResult.testDir,
        testFiles: playwrightResult.testFiles || [],
        testFileCount: (playwrightResult.testFiles || []).length,
        browsers: playwrightResult.browsers,
        command: playwrightResult.playwrightCommand,
        packageVersion: playwrightResult.packageVersion,
      });
    }
  } catch (error) {
    detectionErrors.push(`Playwright detection error: ${error.message}`);
  }

  // Detect Cypress
  try {
    const cypressResult = detectCypress(rootDir);
    if (cypressResult.detected) {
      frameworks.push({
        name: "CYPRESS",
        detected: true,
        configPath: cypressResult.configPath,
        testDirectory: cypressResult.testDirectory,
        testFiles: cypressResult.testFiles || [],
        testFileCount: (cypressResult.testFiles || []).length,
        version: cypressResult.version,
      });
    }
  } catch (error) {
    detectionErrors.push(`Cypress detection error: ${error.message}`);
  }

  return {
    category: "SYSTEM",
    frameworks,
    hasSystemTests: frameworks.length > 0,
    detectedCount: frameworks.length,
    errors: detectionErrors.length > 0 ? detectionErrors : undefined,
  };
}

/**
 * Detects system test frameworks for a specific snapshot
 * Used by the API endpoint
 *
 * @param {string} snapshotId - The snapshot ID
 * @param {Object} snapshot - The snapshot object from database
 * @returns {Object} Detection result
 */
export async function detectSystemTestFrameworksForSnapshot(
  snapshotId,
  snapshot,
) {
  if (!snapshot || !snapshot.rootDir) {
    return {
      category: "SYSTEM",
      frameworks: [],
      hasSystemTests: false,
      error: "Snapshot does not have a rootDir",
    };
  }

  return detectSystemTestFrameworks(snapshot.rootDir);
}
