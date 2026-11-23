import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { normalizeDiskPath } from "../utils/snapshotWorkspace.js";
import { detectCypress } from "../utils/cypressDetector.js";
import { detectPlaywright } from "../utils/playwrightDetector.js";
import { classifySystemTestFile, parseTestFileDetails, scanSystemTestFiles } from "../utils/testFileParser.js";
import { resolveSnapshotRootDir } from "../utils/snapshotWorkspace.js";

/**
 * Detects System Test frameworks (Playwright, Cypress) in a project
 * Returns a structured result with detected frameworks, test files, and metadata
 *
 * @param {string} rootDir - The root directory of the project
 * @returns {Promise<Object>} Detection result with frameworks array and test files
 */
export async function detectSystemTestFrameworks(rawRootDir) {
  const rootDir = normalizeDiskPath(rawRootDir) || rawRootDir;
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

  if (
    /^\/?app\/(?:storage|uploads)\//i.test(rootDir.replace(/\\/g, "/")) &&
    !fs.existsSync(rootDir)
  ) {
    rootDir = resolveSnapshotRootDir(rootDir) || rootDir;
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
  const seenFiles = new Set([...scannedPlaywright, ...scannedCypress].map(file => file.filePath));
  const detectAndMerge = (detect, detectorFramework, label) => {
    try {
      const result = detect(rootDir);
      const testDir = result.configPath && (result.testDir || result.testDirectory);
      for (const file of result.testFiles) {
        const filePath = typeof file === "string" ? file : file.path;
        const relativePath = path.relative(rootDir, path.resolve(rootDir, filePath)).replace(/\\/g, "/");
        if (seenFiles.has(relativePath) || /(?:^|\/)(?:\.covai-system-test|node_modules)(?:\/|$)/i.test(relativePath)) {
          continue;
        }
        let framework = classifySystemTestFile(rootDir, relativePath);
        if (!framework && testDir) {
          const fromTestDir = path.relative(path.resolve(rootDir, testDir), path.resolve(rootDir, relativePath));
          if (fromTestDir && fromTestDir !== ".." && !fromTestDir.startsWith(`..${path.sep}`) && !path.isAbsolute(fromTestDir)) {
            framework = detectorFramework;
          }
        }
        if (!framework) continue;

        const details = parseTestFileDetails(rootDir, relativePath, framework);
        const bucket = framework === "CYPRESS" ? scannedCypress : scannedPlaywright;
        bucket.push(details);
        seenFiles.add(details.filePath);
      }
      return result;
    } catch (error) {
      detectionErrors.push(`${label} detection error: ${error.message}`);
      return null;
    }
  };

  // 2. Detect Playwright framework
  const playwrightResult = detectAndMerge(detectPlaywright, "PLAYWRIGHT", "Playwright");
  // 3. Detect Cypress framework
  const cypressResult = detectAndMerge(detectCypress, "CYPRESS", "Cypress");

  if (playwrightResult) {
    const scenarioCount = scannedPlaywright.reduce(
      (sum, file) => sum + (file.scenarioCount || 0),
      0,
    );

    const isDetected =
      scannedPlaywright.length > 0 ||
      playwrightResult.configPath ||
      playwrightResult.packageVersion ||
      (playwrightResult.hasPlaywright && !playwrightResult.testFiles.length);

    if (isDetected) {
      frameworks.push({
        name: "PLAYWRIGHT",
        detected: true,
        configPath: playwrightResult.configPath,
        testDirectory:
          playwrightResult.testDir ||
          (scannedPlaywright.length > 0
            ? path.dirname(scannedPlaywright[0].filePath)
            : null),
        testFiles: scannedPlaywright,
        testFileCount: scannedPlaywright.length,
        scenarioCount,
        browsers: playwrightResult.browsers,
        command: playwrightResult.playwrightCommand,
        packageVersion: playwrightResult.packageVersion,
      });
    }
  }

  if (cypressResult) {
    const scenarioCount = scannedCypress.reduce(
      (sum, file) => sum + (file.scenarioCount || 0),
      0,
    );

    const isDetected =
      scannedCypress.length > 0 ||
      cypressResult.configPath ||
      cypressResult.version ||
      cypressResult.command?.startsWith("npm run ");

    if (isDetected) {
      frameworks.push({
        name: "CYPRESS",
        detected: true,
        configPath: cypressResult.configPath,
        testDirectory:
          cypressResult.testDirectory ||
          (scannedCypress.length > 0
            ? path.dirname(scannedCypress[0].filePath)
            : null),
        testFiles: scannedCypress,
        testFileCount: scannedCypress.length,
        scenarioCount,
        command: cypressResult.command || "npx cypress run",
        packageVersion: cypressResult.version,
        version: cypressResult.version,
      });
    }
  }

  // 4. Aggregate all test files & classify 3-rule framework resolution
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

  const pwFramework = frameworks.find((f) => f.name === "PLAYWRIGHT");
  const cyFramework = frameworks.find((f) => f.name === "CYPRESS");
  const hasPlaywrightDep = Boolean(pwFramework?.packageVersion || pwFramework?.configPath);
  const hasCypressDep = Boolean(cyFramework?.packageVersion || cyFramework?.version || cyFramework?.configPath);
  const hasDependencies = hasPlaywrightDep || hasCypressDep;
  const installedFrameworks = [
    ...(hasPlaywrightDep ? ["PLAYWRIGHT"] : []),
    ...(hasCypressDep ? ["CYPRESS"] : []),
  ];
  const hasPlaywrightTests = (pwFramework?.testFileCount || 0) > 0;
  const hasCypressTests = (cyFramework?.testFileCount || 0) > 0;

  let permutation = "ZERO_TESTS_NO_DEPS";
  let detectionSource = "user_selection_required";
  let recommendedFramework = null;
  let inferredFramework = null;
  let needsUserSelection = false;

  if (hasDependencies) {
    permutation = hasTestFiles ? "HAS_TESTS_AND_DEPS" : "HAS_DEPS_NO_TESTS";
    detectionSource = "package_json";
    recommendedFramework = hasPlaywrightDep ? "playwright" : "cypress";
    inferredFramework = recommendedFramework;
  } else if (hasTestFiles) {
    permutation = "HAS_TESTS_NO_DEPS";
    detectionSource = "test_syntax";
    inferredFramework = hasPlaywrightTests ? "playwright" : hasCypressTests ? "cypress" : null;
    recommendedFramework = inferredFramework;
  } else {
    permutation = "ZERO_TESTS_NO_DEPS";
    detectionSource = "user_selection_required";
    needsUserSelection = true;
  }

  return {
    category: "SYSTEM",
    frameworks,
    hasSystemTests,
    hasTestFiles,
    isZeroTestProject,
    hasDependencies,
    installedFrameworks,
    inferredFramework,
    recommendedFramework,
    detectionSource,
    permutation,
    needsUserSelection,
    proposedFrameworks: ["PLAYWRIGHT", "CYPRESS"],
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

  const effectiveRootDir =
    normalizeDiskPath(snapshot.rootDir || snapshot.storagePath) ||
    snapshot.rootDir;
  const detection = await detectSystemTestFrameworks(effectiveRootDir);

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
