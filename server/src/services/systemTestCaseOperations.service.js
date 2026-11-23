import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { inside, normalizeDiskPath } from "../utils/snapshotWorkspace.js";
import { resolveProjectRoot, resolveSnapshotRootDir } from "../utils/projectRootResolver.js";
import { generateText, withGeminiChannel } from "./gemini.service.js";
import { captureSystemSuiteManifest } from "./systemSuiteManifest.service.js";
import { commitSystemSuiteVersion } from "./systemSuiteVersion.service.js";
import { syncSystemScenarioCatalog } from "./systemScenarioCatalog.service.js";
import { summarizeSystemFailure } from "../../../shared/systemCaseCoverage.js";
import { extractSystemTestBlocks, parseTestAst as parseAst } from "../utils/testBlockExtractor.js";

export { extractSystemTestBlocks };

function assertValidSpecSyntax(code, label = "system spec") {
  try {
    parseAst(code);
  } catch (err) {
    throw new ServiceError(`Syntax error in ${label}: ${err.message}`, 400);
  }
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
  return String(raw || "")
    .trim()
    .replace(/^```(?:[a-zA-Z0-9_-]+)?\s*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim();
}

function resolveSafeSpecFile(snapshotRootDir, relSpecFile, { mustExist = true } = {}) {
  const diskRoot =
    resolveSnapshotRootDir(snapshotRootDir) ||
    normalizeDiskPath(snapshotRootDir) ||
    path.resolve(snapshotRootDir);
  const resolvedRoot = resolveProjectRoot(diskRoot) || diskRoot;
  const cleanRel = String(relSpecFile || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!cleanRel) {
    throw new ServiceError("testFile path is required.", 400);
  }
  const candDirect = path.resolve(diskRoot, cleanRel);
  const candRoot = path.resolve(resolvedRoot, cleanRel);
  const absPath = fs.existsSync(candDirect)
    ? candDirect
    : fs.existsSync(candRoot)
      ? candRoot
      : candDirect;

  if (!inside(path.resolve(diskRoot), absPath) && !inside(path.resolve(resolvedRoot), absPath)) {
    throw new ServiceError("Spec file path escapes project root.", 403);
  }
  if (mustExist && !fs.existsSync(absPath)) {
    throw new ServiceError(`System spec file not found: ${cleanRel}`, 404);
  }
  return {
    diskRoot: path.resolve(diskRoot),
    absPath,
    relPath: path.relative(path.resolve(diskRoot), absPath).replace(/\\/g, "/"),
  };
}

async function syncAndVersionSystemSuite({ snapshot, diskRoot, userId, actionLabel, detail }) {
  try {
    await syncSystemScenarioCatalog({ client: prisma, snapshotId: snapshot.id, rootDir: diskRoot }).catch(() => {});
    if (prisma.systemSuiteVersion && prisma.systemTestBlob) {
      const capture = await captureSystemSuiteManifest({ rootDir: diskRoot });
      await prisma.$transaction(async (tx) => {
        await commitSystemSuiteVersion({
          tx,
          snapshotId: snapshot.id,
          capture,
          userId: userId || "system",
          requestId: `sys-op-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
          action: "APPLY",
          provenance: { source: actionLabel, detail },
        });
      });
    }
  } catch (err) {
    console.warn("[systemTestCaseOperations] Catalog/version sync warning:", err.message);
  }
}

export async function getSystemTestCaseDetail({ snapshot, testFile, testName }) {
  const { absPath, relPath } = resolveSafeSpecFile(snapshot.rootDir, testFile, { mustExist: true });
  const content = fs.readFileSync(absPath, "utf8");
  const blocks = extractSystemTestBlocks(content);
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

export async function addSystemTestCase({ snapshot, userId, testFile, testName, code, runner = "playwright" }) {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ServiceError("System test code is required.", 400);
  }
  const defaultPath = runner === "cypress" ? "cypress/e2e/custom.cy.js" : "tests/system/custom.spec.js";
  const { diskRoot, absPath, relPath } = resolveSafeSpecFile(snapshot.rootDir, testFile || defaultPath, {
    mustExist: false,
  });
  const cleanSnippet = stripCodeFences(code);
  assertValidSpecSyntax(cleanSnippet, "new system scenario");

  const exists = fs.existsSync(absPath);
  const originalContent = exists ? fs.readFileSync(absPath, "utf8") : "";
  let updatedContent;

  if (!exists || originalContent.trim().length === 0) {
    const hasHeader = /\b(?:import|require)\b/.test(cleanSnippet);
    if (hasHeader) {
      updatedContent = cleanSnippet + "\n";
    } else if (runner === "cypress") {
      updatedContent = `describe(${JSON.stringify(path.basename(relPath, path.extname(relPath)))}, () => {\n  ${cleanSnippet}\n});\n`;
    } else {
      updatedContent = `import { test, expect } from '@playwright/test';\n\ntest.describe(${JSON.stringify(path.basename(relPath, path.extname(relPath)))}, () => {\n  ${cleanSnippet}\n});\n`;
    }
  } else {
    const blocks = extractSystemTestBlocks(originalContent);
    const describeBlocks = blocks.describeBlocks || [];
    const lastBlock = blocks[blocks.length - 1];
    const indented = cleanSnippet
      .split("\n")
      .map((l) => (l ? `  ${l}` : ""))
      .join("\n");
    if (lastBlock && blocks.describeBlocks?.length > 0) {
      updatedContent =
        originalContent.slice(0, lastBlock.end) + "\n\n" + indented + originalContent.slice(lastBlock.end);
    } else if (describeBlocks.length > 0 && describeBlocks[describeBlocks.length - 1].bodyEnd != null) {
      const insertAt = describeBlocks[describeBlocks.length - 1].bodyEnd - 1;
      updatedContent = originalContent.slice(0, insertAt) + `\n${indented}\n` + originalContent.slice(insertAt);
    } else {
      updatedContent = originalContent.trimEnd() + "\n\n" + cleanSnippet + "\n";
    }
  }

  assertValidSpecSyntax(updatedContent, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, updatedContent, "utf8");
  await syncAndVersionSystemSuite({ snapshot, diskRoot, userId, actionLabel: "ADD_SCENARIO", detail: testName || relPath });
  return { testFile: relPath, updatedContent, addedTestName: testName };
}

export async function updateSystemTestCase({ snapshot, userId, testFile, testName, code }) {
  if (!code || typeof code !== "string" || !code.trim()) {
    throw new ServiceError("Updated system test code is required.", 400);
  }
  const { diskRoot, absPath, relPath } = resolveSafeSpecFile(snapshot.rootDir, testFile, { mustExist: true });
  const originalContent = fs.readFileSync(absPath, "utf8");
  const cleanSnippet = stripCodeFences(code);
  assertValidSpecSyntax(cleanSnippet, relPath);

  const blocks = extractSystemTestBlocks(originalContent);
  const target = findMatchingBlock(blocks, testName);
  let updatedContent;

  if (target && !/\b(?:import|require\s*\(|describe\s*\(|test\.describe\s*\()\b/.test(cleanSnippet.slice(0, 140))) {
    updatedContent = originalContent.slice(0, target.start) + cleanSnippet + originalContent.slice(target.end);
  } else if (!target && !cleanSnippet.includes("describe(") && blocks.length > 0) {
    throw new ServiceError(`Scenario '${testName}' was not found in ${relPath}.`, 404);
  } else {
    updatedContent = cleanSnippet + "\n";
  }

  assertValidSpecSyntax(updatedContent, relPath);
  fs.writeFileSync(absPath, updatedContent, "utf8");
  await syncAndVersionSystemSuite({ snapshot, diskRoot, userId, actionLabel: "EDIT_SCENARIO", detail: testName || relPath });
  return { testFile: relPath, updatedContent, updatedTestName: testName };
}

export async function deleteSystemTestCase({ snapshot, userId, testFile, testName }) {
  const { diskRoot, absPath, relPath } = resolveSafeSpecFile(snapshot.rootDir, testFile, { mustExist: true });
  const originalContent = fs.readFileSync(absPath, "utf8");
  const blocks = extractSystemTestBlocks(originalContent);
  const target = findMatchingBlock(blocks, testName);
  if (!target) {
    throw new ServiceError(`Scenario '${testName}' not found in ${relPath}.`, 404);
  }

  let start = target.start;
  let end = target.end;
  while (start > 0 && (originalContent[start - 1] === " " || originalContent[start - 1] === "\t")) {
    start--;
  }
  while (end < originalContent.length && (originalContent[end] === "\r" || originalContent[end] === "\n")) {
    end++;
    if (originalContent[end - 1] === "\n") break;
  }

  const updatedContent = originalContent.slice(0, start) + originalContent.slice(end);
  assertValidSpecSyntax(updatedContent, relPath);
  fs.writeFileSync(absPath, updatedContent, "utf8");
  await syncAndVersionSystemSuite({ snapshot, diskRoot, userId, actionLabel: "DELETE_SCENARIO", detail: testName });
  return { testFile: relPath, deletedTestName: testName, remainingCount: Math.max(0, blocks.length - 1) };
}

export async function aiFixSystemTestCase({
  snapshot,
  userId,
  testFile,
  testName,
  failureMessage = "",
  failureStep = "",
  currentCode = "",
  runner = "playwright",
  model = null,
}) {
  const { diskRoot, absPath, relPath } = resolveSafeSpecFile(snapshot.rootDir, testFile, { mustExist: true });
  const originalContent = fs.readFileSync(absPath, "utf8");
  const blocks = extractSystemTestBlocks(originalContent);
  const target = findMatchingBlock(blocks, testName);
  const failingSnippet = currentCode || target?.code || originalContent;
  const failureSummary = summarizeSystemFailure(failureMessage);

  const prompt = [
    `Fix the failing ${runner.toUpperCase()} Full-Stack E2E system test scenario in "${relPath}".`,
    `Scenario title: ${JSON.stringify(testName || target?.title || "E2E test")}`,
    `Failure summary: ${failureSummary}`,
    failureStep ? `Failing step: ${failureStep}` : "",
    failureMessage ? `Raw Playwright/Cypress error:\n${String(failureMessage).slice(0, 2500)}` : "",
    `Current full spec file context:\n\`\`\`javascript\n${originalContent.slice(0, 12000)}\n\`\`\``,
    target ? `Failing scenario block to fix:\n\`\`\`javascript\n${failingSnippet}\n\`\`\`` : "",
    "",
    "REQUIREMENTS:",
    "- Full-Stack E2E tests execute against the REAL running frontend + backend server. NEVER use page.route(), context.route(), route.fulfill(), or API mocks.",
    "- Fix resilient locators (prefer getByRole, getByLabel, getByText, getByTestId, or waitForResponse/toBeVisible assertions), valid relative navigation URLs (page.goto('/...')), and proper async waits.",
    target
      ? "- Return ONLY the fixed `test(...)` or `it(...)` block keeping the test title intact (no prose)."
      : "- Return ONLY the complete fixed spec file content cleanly.",
  ]
    .filter(Boolean)
    .join("\n");

  const aiRaw = await withGeminiChannel("system_test", async () => {
    return await generateText(
      prompt,
      model || null,
      "You are an expert Playwright/Cypress Full-Stack E2E Testing Engineer. Return ONLY valid executable JavaScript/TypeScript test code with zero prose.",
      { temperature: 0.15 },
    );
  });

  const cleanFix = stripCodeFences(aiRaw);
  if (!cleanFix) {
    throw new ServiceError("AI Fix returned empty code.", 502);
  }
  assertValidSpecSyntax(cleanFix, `AI fix for ${testName}`);

  let updatedContent;
  if (target && !/\b(?:import|require\s*\(|describe\s*\(|test\.describe\s*\()\b/.test(cleanFix.slice(0, 140))) {
    updatedContent = originalContent.slice(0, target.start) + cleanFix + originalContent.slice(target.end);
  } else {
    updatedContent = cleanFix + "\n";
  }

  assertValidSpecSyntax(updatedContent, relPath);
  fs.writeFileSync(absPath, updatedContent, "utf8");
  await syncAndVersionSystemSuite({ snapshot, diskRoot, userId, actionLabel: "AI_FIX_SCENARIO", detail: testName || relPath });

  return {
    testFile: relPath,
    testName: testName || target?.title || "",
    fixedBlock: cleanFix,
    updatedContent,
    failureSummary,
  };
}
