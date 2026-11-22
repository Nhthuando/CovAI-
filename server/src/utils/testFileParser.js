import fs from "fs";
import path from "path";

/**
 * Extracts suite and scenario titles from test file content.
 * Handles single quotes, double quotes, and template literals (backticks).
 *
 * @param {string} content
 * @param {string} framework - "PLAYWRIGHT" | "CYPRESS" | "AUTO"
 * @returns {{ suites: string[], scenarios: string[] }}
 */
export function extractSuitesAndScenarios(content, framework = "AUTO") {
  const suites = [];
  const scenarios = [];

  if (!content || typeof content !== "string") {
    return { suites, scenarios };
  }

  // Regex for suite blocks: describe('...', ...), test.describe('...', ...), context('...', ...)
  const suiteRegex =
    /(?:(?:\btest\s*\.\s*)?\bdescribe\b|\bcontext\b)(?:\.(?:only|skip|serial|parallel))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let match;
  while ((match = suiteRegex.exec(content)) !== null) {
    if (match[2] && match[2].trim()) {
      suites.push(match[2].trim());
    }
  }

  // Regex for scenario/test blocks: test('...', ...), it('...', ...), specify('...', ...)
  const scenarioRegex =
    /(?:\btest\b|\bit\b|\bspecify\b)(?:\.(?:only|skip|fixme|fail))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  while ((match = scenarioRegex.exec(content)) !== null) {
    if (match[2] && match[2].trim()) {
      scenarios.push(match[2].trim());
    }
  }

  return { suites, scenarios };
}

function readTestFileContent(fullPath) {
  if (!fs.existsSync(fullPath)) return null;
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch (error) {
    console.warn(`[testFileParser] Unable to read ${fullPath}: ${error.message}`);
    return null;
  }
}

export function classifySystemTestContent(content) {
  if (!content) return null;
  if (
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](?:@playwright\/test|playwright)["']/.test(content)
  ) {
    return "PLAYWRIGHT";
  }
  if (
    /\bcy\.(visit|get|request|contains|intercept|login|fixture|wait|url|session)\b/.test(content) ||
    /\/\/\/\s*<reference\s+types=["']cypress["']/.test(content) ||
    /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']cypress["']/.test(content)
  ) {
    return "CYPRESS";
  }
  return null;
}

const isCypressPath = (fileName, relPath) =>
  /\.cy\.[cm]?[jt]sx?$/i.test(fileName) || /(?:^|\/)cypress\//i.test(relPath);

export function classifySystemTestFile(rootDir, relPath) {
  const normalizedPath = relPath.replace(/\\/g, "/");
  const content = readTestFileContent(path.resolve(rootDir, normalizedPath));
  const framework = classifySystemTestContent(content);
  if (framework) return framework;
  if (isCypressPath(path.basename(normalizedPath), normalizedPath)) return "CYPRESS";
  if (/(?:^|\/)(?:e2e|playwright|system)\//i.test(normalizedPath)) return "PLAYWRIGHT";
  return null;
}

/**
 * Parses a single test file and returns structured metadata.
 *
 * @param {string} rootDir - Root directory of snapshot/project
 * @param {string} relativePath - Relative path or full path of test file
 * @param {string} defaultFramework - "PLAYWRIGHT" | "CYPRESS"
 * @returns {Object} Structured test file metadata
 */
export function parseTestFileDetails(
  rootDir,
  relativePath,
  defaultFramework = "PLAYWRIGHT",
) {
  const fullPath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(rootDir, relativePath);
  const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
  const fileName = path.basename(fullPath);
  const content = readTestFileContent(fullPath);
  let framework = classifySystemTestContent(content);
  if (!framework && (isCypressPath(fileName, relPath) || /\bcy\.\w+/.test(content))) {
    framework = "CYPRESS";
  }
  if (!framework && /(?:^|\/)(?:e2e|tests\/system)\//i.test(relPath)) {
    framework = "PLAYWRIGHT";
  }
  framework ||= defaultFramework;
  return buildTestFileDetails(fileName, relPath, framework, content);
}

function buildTestFileDetails(fileName, relPath, framework, content) {
  const { suites, scenarios } = extractSuitesAndScenarios(content ?? "", framework);
  return {
    fileName,
    filePath: relPath,
    path: relPath,
    framework,
    suiteCount: suites.length,
    scenarioCount: scenarios.length,
    suites,
    scenarios,
    lineCount: content === null ? 0 : content.split("\n").length,
    toString() {
      return relPath;
    },
  };
}

/**
 * Recursively scans a directory for system test files.
 *
 * @param {string} rootDir
 * @param {Object} options
 * @param {string[]} [options.ignoreDirs]
 * @returns {{ playwrightFiles: Object[], cypressFiles: Object[], allFiles: Object[] }}
 */
export function scanSystemTestFiles(rootDir, options = {}) {
  const IGNORED = new Set(
    options.ignoreDirs || [
      "node_modules",
      ".git",
      "coverage",
      "dist",
      "build",
      ".next",
      ".vite",
      ".vitest",
      "storage",
      "uploads",
      ".covai-system-test",
      ".covai",
    ],
  );

  const playwrightFiles = [];
  const cypressFiles = [];
  const allFiles = [];

  const visit = (currentDir) => {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (!IGNORED.has(entry.name)) {
          visit(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      // Check if it matches test file extension patterns
      const isTestExt = /\.[cm]?[jt]sx?$/i.test(entry.name);
      if (!isTestExt) continue;

      const cypressPath = isCypressPath(entry.name, relPath);
      const isSpec = /(?:^|\.)(?:spec|test)\.[cm]?[jt]sx?$/i.test(entry.name);
      if (!cypressPath && !isSpec) continue;

      const framework = classifySystemTestFile(rootDir, relPath);
      if (!framework) continue;

      const content = readTestFileContent(fullPath);
      const details = buildTestFileDetails(entry.name, relPath, framework, content);
      (framework === "CYPRESS" ? cypressFiles : playwrightFiles).push(details);
      allFiles.push(details);
    }
  };

  if (fs.existsSync(rootDir)) {
    visit(rootDir);
  }

  // Deduplicate by filePath
  const uniquePlaywright = Array.from(
    new Map(playwrightFiles.map((f) => [f.filePath, f])).values(),
  );
  const uniqueCypress = Array.from(
    new Map(cypressFiles.map((f) => [f.filePath, f])).values(),
  );
  const uniqueAll = Array.from(
    new Map(allFiles.map((f) => [f.filePath, f])).values(),
  );

  return {
    playwrightFiles: uniquePlaywright,
    cypressFiles: uniqueCypress,
    allFiles: uniqueAll,
  };
}

