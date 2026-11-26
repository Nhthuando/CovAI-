import { randomUUID } from "node:crypto";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { generateText } from "./gemini.service.js";
import {
  consumeAiQuota,
  releaseAiQuota,
  reserveAiQuota,
} from "./aiQuota.service.js";
import { execGit } from "./gitCredentialHelper.service.js";
import { parsePorcelainV2Z } from "./gitPorcelainParser.service.js";
import { ServiceError } from "../utils/serviceError.js";

const MAX_AI_DIFF_CHARS = 12_000;

const AiCommitSchema = z.object({
  type: z
    .enum([
      "feat",
      "fix",
      "refactor",
      "docs",
      "test",
      "chore",
      "style",
      "perf",
      "build",
      "ci",
    ])
    .default("chore"),
  scope: z.string().max(40).optional().nullable(),
  subject: z.string().min(3).max(120),
  body: z.string().max(1500).optional().default(""),
});

function parseAiCommitPayload(rawText) {
  const cleaned = String(rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const repaired = jsonrepair(cleaned);
    const parsed = JSON.parse(repaired);
    const validated = AiCommitSchema.parse(parsed);
    const cleanScope = validated.scope ? validated.scope.trim() : "";
    const headerPrefix = cleanScope
      ? `${validated.type}(${cleanScope}): `
      : `${validated.type}: `;
    const subjectLine = validated.subject
      .replace(/[\r\n]+/g, " ")
      .replace(/\.$/, "")
      .trim();
    const subject = subjectLine.startsWith(`${validated.type}:`) ||
      subjectLine.startsWith(`${validated.type}(`)
      ? subjectLine
      : `${headerPrefix}${subjectLine}`;

    const body = (validated.body || "").trim();
    return {
      type: validated.type,
      scope: cleanScope || null,
      subject,
      body,
      fullMessage: body ? `${subject}\n\n${body}` : subject,
    };
  } catch {
    const firstLine =
      cleaned
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean) || "chore: update project changes";
    return {
      type: "chore",
      scope: null,
      subject: firstLine.slice(0, 120),
      body: "",
      fullMessage: firstLine.slice(0, 120),
    };
  }
}

/**
 * Generates a Conventional Commit message from the currently staged (or unstaged) diff.
 */
export async function generateGitCommitMessage({
  projectId,
  userId,
  rootDir,
  model = null,
}) {
  const { stdout: cachedDiff } = await execGit(rootDir, [
    "diff",
    "--cached",
    "--no-color",
    "--stat",
    "-p",
  ]);

  let sourceLabel = "staged changes";
  let diffSnippet = cachedDiff || "";

  if (!diffSnippet.trim()) {
    const { stdout: workingDiff } = await execGit(rootDir, [
      "diff",
      "--no-color",
      "--stat",
      "-p",
    ]);
    diffSnippet = workingDiff || "";
    sourceLabel = "working tree changes";
  }

  const { stdout: statusRaw } = await execGit(
    rootDir,
    ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"],
    { rawOutput: true },
  );
  const parsedStatus = parsePorcelainV2Z(statusRaw);
  const untrackedList = parsedStatus.untracked.map((f) => f.path).slice(0, 30);

  if (!diffSnippet.trim() && untrackedList.length === 0) {
    throw new ServiceError(
      "No local changes available to generate a commit message",
      400,
      "NOTHING_TO_COMMIT",
    );
  }

  const promptDiff = diffSnippet.slice(0, MAX_AI_DIFF_CHARS);
  const untrackedNote = untrackedList.length
    ? `\nUntracked new files:\n- ${untrackedList.join("\n- ")}`
    : "";

  const prompt = [
    "You are an expert software engineer writing a clear Conventional Commit message in English.",
    `Analyze the following ${sourceLabel} git diff${untrackedNote ? " and new files" : ""}.`,
    "Return ONLY strict JSON matching this shape (no markdown fences):",
    '{ "type": "feat|fix|refactor|docs|test|chore|style|perf|build|ci", "scope": "optional short module name or null", "subject": "imperative summary <= 72 chars without trailing period", "body": "optional concise bullet summary or empty string" }',
    "",
    promptDiff,
    untrackedNote,
  ].join("\n");

  const reservation = await reserveAiQuota({
    userId,
    requestKey: `git-ai-commit:${projectId}:${randomUUID()}`,
  });

  let rawResponse;
  try {
    rawResponse = await generateText(
      prompt,
      model || null,
      "Generate only valid JSON for a Conventional Commit message.",
      {
        taskType: "chatbox",
        temperature: 0.2,
        maxOutputTokens: 400,
        userId,
      },
    );
    await consumeAiQuota(reservation.id).catch(() => {});
  } catch (err) {
    await releaseAiQuota(reservation.id).catch(() => {});
    throw err;
  }

  return parseAiCommitPayload(rawResponse);
}
