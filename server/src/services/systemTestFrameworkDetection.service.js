import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { detectCypress } from "../utils/cypressDetector.js";
import { detectPlaywright } from "../utils/playwrightDetector.js";
import {
  scanSystemTestFiles,
  parseTestFileDetails,
} from "../utils/testFileParser.js";

/**
 * Detects System Test frameworks (Playwright, Cypress) in a project
 * Returns a structured result with detected frameworks, test files, and metadata
 *
 * @param {string} rootDir - The root directory of the project
 * @returns {Promise<Object>} Detection result with frameworks array and test files
 */
export async function detectSystemTestFrameworks(rootDir) {
  if (!rootDir || typeof rootDir !== "string") {
    return {
      category: "SYSTEM",
      frameworks: [],
      hasSystemTests: false,
      hasTestFiles: false,
      isZeroTestProject: true,
      detectedCount: 0,
      totalFilesCount: 0,
      totalScenariosCount: 0,
      allTestFiles: [],
      error: "Invalid root directory",
    };
  }

  if (!fs.existsSync(rootDir)) {
    return {
      category: "SYSTEM",
      frameworks: [],
      hasSystemTests: false,
      hasTestFiles: false,
      isZeroTestProject: true,
      detectedCount: 0,
      totalFilesCount: 0,
      totalScenariosCount: 0,
      allTestFiles: [],
      error: "Root directory does not exist",
    };
  }

  const frameworks = [];
  const detectionErrors = [];

  // 1. Recursive scan for all system test files in rootDir
  const { playwrightFiles: scannedPlaywright, cypressFiles: scannedCypress } =
    scanSystemTestFiles(rootDir);

  // 2. Detect Playwright framework
  try {
    const playwrightResult = detectPlaywright(rootDir);

    // Merge scanned test files with playwrightResult files
    const fileMap = new Map();
    for (const f of scannedPlaywright) {
      fileMap.set(f.filePath, f);
    }
    for (const f of playwrightResult.testFiles || []) {
      const rel = typeof f === "string" ? f : f.path || f.filePath;
      if (rel && !fileMap.has(rel)) {
        fileMap.set(rel, parseTestFileDetails(rootDir, rel, "PLAYWRIGHT"));
      }
    }
    const mergedPlaywrightFiles = Array.from(fileMap.values());
    const scenarioCount = mergedPlaywrightFiles.reduce(
      (sum, file) => sum + (file.scenarioCount || 0),
      0,
    );

    const isDetected =
      playwrightResult.hasPlaywright || mergedPlaywrightFiles.length > 0;

    if (isDetected) {
      frameworks.push({
        name: "PLAYWRIGHT",
        detected: true,
        configPath: playwrightResult.configPath,
        testDirectory:
          playwrightResult.testDir ||
          (mergedPlaywrightFiles.length > 0
            ? path.dirname(mergedPlaywrightFiles[0].filePath)
            : null),
        testFiles: mergedPlaywrightFiles,
        testFileCount: mergedPlaywrightFiles.length,
        scenarioCount,
        browsers: playwrightResult.browsers,
        command: playwrightResult.playwrightCommand,
        packageVersion: playwrightResult.packageVersion,
      });
    }
  } catch (error) {
    detectionErrors.push(`Playwright detection error: ${error.message}`);
  }

  // 3. Detect Cypress framework
  try {
    const cypressResult = detectCypress(rootDir);

    // Merge scanned test files with cypressResult files
    const fileMap = new Map();
    for (const f of scannedCypress) {
      fileMap.set(f.filePath, f);
    }
    for (const f of cypressResult.testFiles || []) {
      const rel = typeof f === "string" ? f : f.path || f.filePath;
      if (rel && !fileMap.has(rel)) {
        fileMap.set(rel, parseTestFileDetails(rootDir, rel, "CYPRESS"));
      }
    }
    const mergedCypressFiles = Array.from(fileMap.values());
    const scenarioCount = mergedCypressFiles.reduce(
      (sum, file) => sum + (file.scenarioCount || 0),
      0,
    );

    const isDetected =
      cypressResult.detected || mergedCypressFiles.length > 0;

    if (isDetected) {
      frameworks.push({
        name: "CYPRESS",
        detected: true,
        configPath: cypressResult.configPath,
        testDirectory:
          cypressResult.testDirectory ||
          (mergedCypressFiles.length > 0
            ? path.dirname(mergedCypressFiles[0].filePath)
            : null),
        testFiles: mergedCypressFiles,
        testFileCount: mergedCypressFiles.length,
        scenarioCount,
        command: cypressResult.command || cypressResult.cypressCommand,
        packageVersion: cypressResult.version,
        version: cypressResult.version,
      });
    }
  } catch (error) {
    detectionErrors.push(`Cypress detection error: ${error.message}`);
  }

  // 4. Aggregate all test files
  const allTestFilesMap = new Map();
  for (const fw of frameworks) {
    for (const tf of fw.testFiles || []) {
      allTestFilesMap.set(tf.filePath, tf);
    }
  }
  const allTestFiles = Array.from(allTestFilesMap.values());
  const totalFilesCount = allTestFiles.length;
  const totalScenariosCount = allTestFiles.reduce(
    (sum, f) => sum + (f.scenarioCount || 0),
    0,
  );
  const hasTestFiles = totalFilesCount > 0;
  const isZeroTestProject = !hasTestFiles;
  const hasSystemTests = frameworks.length > 0 || hasTestFiles;

  return {
    category: "SYSTEM",
    frameworks,
    hasSystemTests,
    hasTestFiles,
    isZeroTestProject,
    detectedCount: frameworks.length,
    totalFilesCount,
    totalScenariosCount,
    allTestFiles,
    errors: detectionErrors.length > 0 ? detectionErrors : undefined,
  };
}

/**
 * Detects system test frameworks for a specific snapshot and synchronizes DB flags
 * Used by the API endpoint
 *
 * @param {string} snapshotId - The snapshot ID
 * @param {Object} snapshot - The snapshot object from database
 * @returns {Promise<Object>} Detection result
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
      hasTestFiles: false,
      isZeroTestProject: true,
      error: "Snapshot does not have a rootDir",
    };
  }

  const detection = await detectSystemTestFrameworks(snapshot.rootDir);

  // Sync flags to ProjectSnapshot and Project in database
  if (snapshotId) {
    const playwright = detection.frameworks.find(
      (f) => f.name === "PLAYWRIGHT",
    );
    const cypress = detection.frameworks.find((f) => f.name === "CYPRESS");

    try {
      const updateData = {
        hasPlaywright: Boolean(playwright?.detected),
        playwrightCommand: playwright?.command || null,
        playwrightConfigPath: playwright?.configPath || null,
        playwrightTestDir: playwright?.testDirectory || null,
        playwrightBrowsers: playwright?.browsers || null,
        hasCypress: Boolean(cypress?.detected),
        cypressCommand: cypress?.command || null,
        cypressConfigPath: cypress?.configPath || null,
        cypressTestDir: cypress?.testDirectory || null,
        cypressVersion: cypress?.packageVersion || null,
      };

      await prisma.projectSnapshot.update({
        where: { id: snapshotId },
        data: updateData,
      });

      if (snapshot.projectId) {
        await prisma.project.update({
          where: { id: snapshot.projectId },
          data: updateData,
        });
      }
    } catch (err) {
      console.warn(
        `[detectSystemTestFrameworksForSnapshot] Failed to update snapshot DB: ${err.message}`,
      );
    }
  }

  return detection;
}
