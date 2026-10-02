import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { generateText } from "./gemini.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { parseJavaScriptCode } from "./babelParser.service.js";
import { extractFunctions } from "./functionExtraction.service.js";

const memoryCache = new Map();

/**
 * Generates or retrieves cached AI architecture summary for a specific file and its functions.
 */
export const getArchitectureAiSummary = async ({
  projectId,
  snapshotId,
  filePath,
  userId,
  force = false,
}) => {
  if (!projectId || !snapshotId || !filePath) {
    throw new ServiceError("Missing required parameters", 400);
  }

  const cacheKey = `${snapshotId}:${filePath}`;
  if (!force && memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey);
  }

  const snapshot = await prisma.projectSnapshot.findFirst({
    where: {
      id: snapshotId,
      projectId,
      project: { ownerId: userId },
    },
    select: { id: true, rootDir: true },
  });

  if (!snapshot || !snapshot.rootDir) {
    throw new ServiceError("Project snapshot not found or unauthorized", 404);
  }

  let rootDir = snapshot.rootDir;
  if (!fs.existsSync(rootDir) && rootDir.startsWith("/app/")) {
    const localRoot = path.resolve(
      process.cwd(),
      rootDir.replace(/^\/app\//, ""),
    );
    if (fs.existsSync(localRoot)) {
      rootDir = localRoot;
    }
  }

  const fullPath = path.resolve(rootDir, filePath);
  if (!fullPath.startsWith(path.resolve(rootDir))) {
    throw new ServiceError("Invalid file path", 400);
  }

  if (!fs.existsSync(fullPath)) {
    throw new ServiceError("File does not exist in snapshot", 404);
  }

  const fileContent = fs.readFileSync(fullPath, "utf-8");
  const truncatedCode = fileContent.slice(0, 12000);

  const parsed = parseJavaScriptCode(fileContent);
  const functions = parsed.success
    ? extractFunctions(parsed.ast, filePath)
    : [];
  const functionItems = functions.map((f) => {
    const isArrow = f.type === "ArrowFunctionExpression";
    const isAnon = !f.name || f.name === "anonymous";
    const displayName = isAnon
      ? isArrow
        ? "arrow function"
        : "anonymous"
      : f.name;
    const lookupKey = `${displayName}@L${f.startLine}`;
    return {
      name: f.name,
      displayName,
      type: f.type,
      startLine: f.startLine,
      endLine: f.endLine,
      lookupKey,
    };
  });

  const prompt = `
You are a Senior Software Architect.
Analyze the following source code file from a web project and provide a concise, high-level architectural explanation in English:

File path: "${filePath}"
Detected functions with line positions:
${functionItems.map((f) => `- "${f.displayName}" (lines L${f.startLine}-L${f.endLine})`).join("\n")}

Source code:
\`\`\`
${truncatedCode}
\`\`\`

Strictly return valid JSON only in the following format (no markdown, no extra commentary):
{
  "fileSummary": "A concise 1-2 sentence overview explaining the architectural responsibility of this file in the project.",
  "functionSummaries": {
    ${functionItems
      .map((f) => {
        const hasDuplicates =
          functionItems.filter((x) => x.displayName === f.displayName).length >
          1;
        const key = hasDuplicates
          ? `${f.displayName} (L${f.startLine})`
          : f.displayName;
        return `"${key}": "A concise 1-sentence explanation of what this specific function does."`;
      })
      .join(",\n    ")}
  }
}
`;

  try {
    const rawResponse = await generateText(
      prompt,
      "You are a software architect analyzing code modules. Always output valid JSON only.",
    );

    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid response format from AI");
    }

    const result = JSON.parse(jsonMatch[0]);
    const rawSummaries = result.functionSummaries || {};
    const normalizedSummaries = { ...rawSummaries };

    functionItems.forEach((f) => {
      const lineKey = `${f.displayName} (L${f.startLine})`;
      const summary =
        rawSummaries[lineKey] ||
        rawSummaries[`${f.name} (L${f.startLine})`] ||
        rawSummaries[f.displayName] ||
        rawSummaries[f.name] ||
        rawSummaries[`L${f.startLine}`];

      if (summary) {
        normalizedSummaries[f.lookupKey] = summary;
        normalizedSummaries[`${f.name}@L${f.startLine}`] = summary;
        normalizedSummaries[lineKey] = summary;
        if (f.name && f.name !== "anonymous") {
          normalizedSummaries[f.name] = summary;
        }
      }
    });

    const summaryData = {
      filePath,
      fileSummary:
        result.fileSummary ||
        `Module ${filePath.split("/").pop()} handles core architectural responsibilities.`,
      functionSummaries: normalizedSummaries,
    };

    memoryCache.set(cacheKey, summaryData);
    return summaryData;
  } catch (error) {
    console.error(
      "[architectureAiSummary] AI generation error:",
      error.message,
    );
    const fallbackData = {
      filePath,
      fileSummary: `Module ${filePath.split("/").pop()} handles logic operations in the system architecture.`,
      functionSummaries: functionItems.reduce((acc, f) => {
        const desc = `Function ${f.displayName} (L${f.startLine}) executes logic in ${filePath.split("/").pop()}.`;
        acc[f.lookupKey] = desc;
        acc[`${f.displayName} (L${f.startLine})`] = desc;
        if (f.name && f.name !== "anonymous") {
          acc[f.name] = desc;
        }
        return acc;
      }, {}),
    };
    return fallbackData;
  }
};
