import fs from "node:fs";
import path from "node:path";
import { ServiceError } from "../utils/serviceError.js";
import { inside, normalizeDiskPath } from "../utils/snapshotWorkspace.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
import { saveUnitTestFileVersions } from "./unitTestVersion.service.js";
import { generateText, withGeminiChannel } from "./gemini.service.js";
import { summarizeUnitFailure } from "../../../shared/unitTestCaseCoverage.js";
import { extractUnitTestBlocks, parseTestAst as parseAst } from "../utils/testBlockExtractor.js";

export { extractUnitTestBlocks };

function assertValidTestSyntax(code, label = "test file") {
  try {
    parseAst(code);
  } catch (err) {
    throw new ServiceError(`Syntax error in ${label}: ${err.message}`, 400);
  }
}

/**
 * Resolves a snapshot rootDir and safe absolute file path inside it.
 */
function resolveSafeTestFile(snapshotRootDir, relTestFile, { mustExist = true } = {}) {
  const diskRoot = normalizeDiskPath(snapshotRootDir) || path.resolve(snapshotRootDir);
  const resolvedRoot = resolveProjectRoot(diskRoot) || diskRoot;
  const cleanRel = String(relTestFile || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!cleanRel) {
    throw new ServiceError("testFile path is required.", 400);
  }
  const candidateDirect = path.resolve(diskRoot, cleanRel);
  const candidateRoot = path.resolve(resolvedRoot, cleanRel);
  const absPath = fs.existsSync(candidateDirect)
    ? candidateDirect
    : fs.existsSync(candidateRoot)
      ? candidateRoot
      : candidateRoot;

  if (!inside(path.resolve(diskRoot), absPath) && !inside(path.resolve(resolvedRoot), absPath)) {
    throw new ServiceError("Test file path escapes project root.", 403);
  }
  if (mustExist && !fs.existsSync(absPath)) {
    throw new ServiceError(`Test file not found: ${cleanRel}`, 404);
  }
  return {
    diskRoot: path.resolve(diskRoot),
    resolvedRoot: path.resolve(resolvedRoot),
    absPath,
    relPath: path.relative(path.resolve(diskRoot), absPath).replace(/\\/g, "/"),
  };
}

function findMatchingBlock(blocks, targetTitle) {
  const norm = String(targetTitle || "").trim();
  if (!norm) return null;
  return (
    blocks.find((b) => b.title === norm) ||
    blocks.find((b) => b.title.trim().toLowerCase() === norm.toLowerCase()) ||
    null
  );
}

function stripCodeFences(raw = "") {
  let s = String(raw || "").trim();
  s = s.replace(/^```(?:[a-zA-Z0-9_-]+)?\s*\r?\n?/, "");
  s = s.replace(/\r?\n?```\s*$/, "");
  return s.trim();
}

function inferDefaultUnitTestPath(rootDir, sourceFile, framework = "jest") {
  const cleanSrc = String(sourceFile || "src/module.js").replace(/\\/g, "/").replace(/^\/+/, "");
  const ext = path.extname(cleanSrc) || ".js";
  const base = path.basename(cleanSrc, ext);
  const parts = cleanSrc.split("/");
  const subpkg = ["server", "backend", "api", "client", "frontend"].includes(parts[0]) ? parts[0] : "";
  const testDir = subpkg ? `${subpkg}/tests/unit` : "tests/unit";
  const prefix = `${testDir}/${base}.test${ext}`;
  return { testFile: prefix, framework };
}

function readOptionalSource(rootDir, relSourceFile) {
  if (!relSourceFile) return "";
  const clean = String(relSourceFile).replace(/\\/g, "/").replace(/^\/+/, "");
  for (const cand of [path.resolve(rootDir, clean), path.resolve(rootDir, "server", clean)]) {
    if (inside(rootDir, cand) && fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return fs.readFileSync(cand, "utf8").slice(0, 14000);
    }
  }
  return "";
}

function persistWithVersion({ snapshotId, diskRoot, projectId, sourceFile, relTestFile, originalContent, updatedContent, summary, isExisting }) {
  try {
    saveUnitTestFileVersions({
      snapshotId,
      rootDir: diskRoot,
      projectId,
      sourceFile,
      testFile: relTestFile,
      originalContent,
      updatedContent,
      summary,
      isExisting,
      status: "APPLIED",
    });
  } catch (verErr) {
    console.warn("[unitTestCaseOperations] Version save warning:", verErr.message);
  }
}

/**
 * Reads a unit test file and extracts a specific test case block (or full file).
 */
export async function getUnitTestCaseDetail({ snapshot, testFile, testName }) {
  const { absPath, relPath } = resolveSafeTestFile(snapshot.rootDir, testFile, { mustExist: true });
  const content = fs.readFileSync(absPath, "utf8");
  const blocks = extractUnitTestBlocks(content);
  const block = testName ? findMatchingBlock(blocks, testName) : null;
  return {
    testFile: relPath,
    testName: block?.title || testName || "",
    code: block?.code || content,
    fullContent: content,
    isSingleBlock: Boolean(block),
    startLine: block?.startLine || 1,
    endLine: block?.endLine || content.split("\n").length,
  };
}

/**
 * Updates an existing unit test case block (`it(...)` / `test(...)`) in place.
 */
export async function updateUnitTestCase({ snapshot, sourceFile, testFile, testName, code }) {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ServiceError("Updated test code is required.", 400);
  }
  const { diskRoot, absPath, relPath } = resolveSafeTestFile(snapshot.rootDir, testFile, { mustExist: true });
  const originalContent = fs.readFileSync(absPath, "utf8");
  const cleanSnippet = stripCodeFences(code);
  assertValidTestSyntax(cleanSnippet, relPath);

  const blocks = extractUnitTestBlocks(originalContent);
  const target = findMatchingBlock(blocks, testName);

  let updatedContent;
  if (target && !/\b(?:describe|import|require\s*\()\b/.test(cleanSnippet.slice(0, 120))) {
    const normalizedSnippet = cleanSnippet.endsWith(";") ? cleanSnippet : cleanSnippet;
    updatedContent =
      originalContent.slice(0, target.start) +
      normalizedSnippet +
      originalContent.slice(target.end);
  } else if (!target && !cleanSnippet.includes("describe(") && blocks.length > 0) {
    throw new ServiceError(`Could not locate test case '${testName}' in ${relPath}.`, 404);
  } else {
    updatedContent = cleanSnippet + "\n";
  }

  assertValidTestSyntax(updatedContent, relPath);
  fs.writeFileSync(absPath, updatedContent, "utf8");

  persistWithVersion({
    snapshotId: snapshot.id,
    diskRoot,
    projectId: snapshot.projectId,
    sourceFile,
    relTestFile: relPath,
    originalContent,
    updatedContent,
    summary: `Edited unit test case: ${testName || path.basename(relPath)}`,
    isExisting: true,
  });

  return { testFile: relPath, updatedContent, updatedTestName: testName };
}

/**
 * Adds a new unit test case block (`it(...)` / `test(...)`) to an existing or new unit test file.
 */
export async function addUnitTestCase({ snapshot, sourceFile, testFile, testName, code, framework = "jest" }) {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ServiceError("Test case code is required.", 400);
  }
  const targetRel = testFile || inferDefaultUnitTestPath(snapshot.rootDir, sourceFile, framework).testFile;
  const { diskRoot, absPath, relPath } = resolveSafeTestFile(snapshot.rootDir, targetRel, { mustExist: false });
  const cleanSnippet = stripCodeFences(code);
  assertValidTestSyntax(cleanSnippet, "new test case");

  const exists = fs.existsSync(absPath);
  const originalContent = exists ? fs.readFileSync(absPath, "utf8") : "";
  let updatedContent;

  if (!exists || originalContent.trim().length === 0) {
    const isFullFile = /\b(?:import|require|describe)\b/.test(cleanSnippet);
    if (isFullFile) {
      updatedContent = cleanSnippet + "\n";
    } else {
      const suiteTitle = path.basename(sourceFile || relPath).replace(/\.[cm]?[jt]sx?$/i, "");
      const indented = cleanSnippet
        .split("\n")
        .map((line) => (line ? `  ${line}` : ""))
        .join("\n");
      updatedContent = `describe(${JSON.stringify(suiteTitle)}, () => {\n${indented}\n});\n`;
    }
  } else {
    const blocks = extractUnitTestBlocks(originalContent);
    const describeBlocks = blocks.describeBlocks || [];
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock) {
      const indented = cleanSnippet
        .split("\n")
        .map((line) => (line ? `  ${line}` : ""))
        .join("\n");
      updatedContent =
        originalContent.slice(0, lastBlock.end) +
        "\n\n" +
        indented +
        originalContent.slice(lastBlock.end);
    } else if (describeBlocks.length > 0 && describeBlocks[describeBlocks.length - 1].bodyEnd != null) {
      const insertAt = describeBlocks[describeBlocks.length - 1].bodyEnd - 1;
      updatedContent =
        originalContent.slice(0, insertAt) +
        `\n  ${cleanSnippet}\n` +
        originalContent.slice(insertAt);
    } else {
      updatedContent = originalContent.trimEnd() + "\n\n" + cleanSnippet + "\n";
    }
  }

  assertValidTestSyntax(updatedContent, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, updatedContent, "utf8");

  persistWithVersion({
    snapshotId: snapshot.id,
    diskRoot,
    projectId: snapshot.projectId,
    sourceFile,
    relTestFile: relPath,
    originalContent,
    updatedContent,
    summary: `Added unit test case: ${testName || "custom case"}`,
    isExisting: exists,
  });

  return { testFile: relPath, updatedContent, addedTestName: testName };
}

/**
 * Deletes a single unit test case block (`it(...)` / `test(...)`) from a unit test file.
 */
export async function deleteUnitTestCase({ snapshot, sourceFile, testFile, testName }) {
  const { diskRoot, absPath, relPath } = resolveSafeTestFile(snapshot.rootDir, testFile, { mustExist: true });
  const originalContent = fs.readFileSync(absPath, "utf8");
  const blocks = extractUnitTestBlocks(originalContent);
  const target = findMatchingBlock(blocks, testName);
  if (!target) {
    throw new ServiceError(`Test case '${testName}' not found in ${relPath}.`, 404);
  }

  let start = target.start;
  let end = target.end;
  // Trim preceding indentation/newlines cleanly
  while (start > 0 && (originalContent[start - 1] === " " || originalContent[start - 1] === "\t")) {
    start--;
  }
  while (end < originalContent.length && (originalContent[end] === "\r" || originalContent[end] === "\n")) {
    end++;
    if (originalContent[end - 1] === "\n") break;
  }

  const updatedContent = originalContent.slice(0, start) + originalContent.slice(end);
  assertValidTestSyntax(updatedContent, relPath);
  fs.writeFileSync(absPath, updatedContent, "utf8");

  persistWithVersion({
    snapshotId: snapshot.id,
    diskRoot,
    projectId: snapshot.projectId,
    sourceFile,
    relTestFile: relPath,
    originalContent,
    updatedContent,
    summary: `Deleted unit test case: ${testName}`,
    isExisting: true,
  });

  return { testFile: relPath, deletedTestName: testName, remainingCount: Math.max(0, blocks.length - 1) };
}

/**
 * Uses Gemini AI to diagnose and repair a failing unit test case (Integration-style AI Fix),
 * writes the repaired block onto disk with version backup, and returns the updated code.
 */
export async function aiFixUnitTestCase({
  snapshot,
  sourceFile,
  testFile,
  testName,
  failureMessage = "",
  currentCode = "",
  framework = "jest",
  model = null,
}) {
  const { diskRoot, absPath, relPath } = resolveSafeTestFile(snapshot.rootDir, testFile, { mustExist: true });
  const originalContent = fs.readFileSync(absPath, "utf8");
  const blocks = extractUnitTestBlocks(originalContent);
  const target = findMatchingBlock(blocks, testName);

  const failingSnippet = currentCode || target?.code || originalContent;
  const sourceCode = readOptionalSource(diskRoot, sourceFile);
  const failureSummary = summarizeUnitFailure(failureMessage);

  const prompt = [
    `Fix the failing ${framework.toUpperCase()} unit test case in "${relPath}".`,
    `Test name: ${JSON.stringify(testName || target?.title || "unit test")}`,
    `Failure summary: ${failureSummary}`,
    failureMessage ? `Raw failure output:\n${String(failureMessage).slice(0, 2500)}` : "",
    sourceCode ? `Target source code (${sourceFile}):\n\`\`\`javascript\n${sourceCode}\n\`\`\`` : "",
    `Current full test file context:\n\`\`\`javascript\n${originalContent.slice(0, 10000)}\n\`\`\``,
    target
      ? `Failing test block to fix:\n\`\`\`javascript\n${failingSnippet}\n\`\`\``
      : "",
    "",
    "REQUIREMENTS:",
    "- Fix ONLY the root cause making this unit test fail (wrong mock return value, missing await, wrong assertion vs real source behavior, import/module mismatch, etc.).",
    "- Preserve existing module system (ESM import vs CommonJS require) and framework globals.",
    target
      ? "- Return ONLY a single valid `it(...)` or `test(...)` block keeping the test name intact (no markdown explanation outside code)."
      : "- Return the complete fixed test file content cleanly.",
  ]
    .filter(Boolean)
    .join("\n");

  const systemInstruction =
    "You are an expert JavaScript/TypeScript Unit Testing Engineer. Return ONLY valid executable test code with zero prose.";

  const aiRaw = await withGeminiChannel("unit_test", async () => {
    return await generateText(prompt, model || null, systemInstruction, {
      temperature: 0.15,
    });
  });

  const cleanFix = stripCodeFences(aiRaw);
  if (!cleanFix) {
    throw new ServiceError("AI Fix returned empty code.", 502);
  }
  assertValidTestSyntax(cleanFix, `AI fix for ${testName}`);

  let updatedContent;
  if (target && !/\b(?:import|require\s*\(|describe\s*\()\b/.test(cleanFix.slice(0, 120))) {
    updatedContent =
      originalContent.slice(0, target.start) +
      cleanFix +
      originalContent.slice(target.end);
  } else {
    updatedContent = cleanFix + "\n";
  }

  assertValidTestSyntax(updatedContent, relPath);
  fs.writeFileSync(absPath, updatedContent, "utf8");

  persistWithVersion({
    snapshotId: snapshot.id,
    diskRoot,
    projectId: snapshot.projectId,
    sourceFile,
    relTestFile: relPath,
    originalContent,
    updatedContent,
    framework,
    summary: `AI Fix for failing test: ${testName || path.basename(relPath)} (${failureSummary})`,
    isExisting: true,
  });

  return {
    testFile: relPath,
    testName: testName || target?.title || "",
    fixedBlock: cleanFix,
    updatedContent,
    failureSummary,
  };
}
