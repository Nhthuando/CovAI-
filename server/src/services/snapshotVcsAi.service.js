import { randomUUID } from "node:crypto";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { generateText } from "./gemini.service.js";
import {
  consumeAiQuota,
  releaseAiQuota,
  reserveAiQuota,
} from "./aiQuota.service.js";
import { ServiceError } from "../utils/serviceError.js";

const MAX_AI_SNAPSHOT_DIFF_CHARS = 12_000;

const AiSummarySchema = z.object({
  label: z.string().min(2).max(120),
  message: z.string().max(1500).optional().default(""),
  suggestedTag: z.string().max(48).optional().nullable(),
});

function parseAiSummaryPayload(rawText) {
  const cleaned = String(rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const repaired = jsonrepair(cleaned);
    const parsed = JSON.parse(repaired);
    const validated = AiSummarySchema.parse(parsed);
    return {
      label: validated.label.replace(/[\r\n]+/g, " ").trim().slice(0, 120),
      message: (validated.message || "").trim(),
      suggestedTag: validated.suggestedTag
        ? validated.suggestedTag.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48)
        : null,
    };
  } catch {
    const firstLine =
      cleaned
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean) || "Checkpoint snapshot update";
    return {
      label: firstLine.slice(0, 120),
      message: cleaned.slice(0, 500),
      suggestedTag: null,
    };
  }
}

/**
 * Uses Gemini + CovAI quota tracker to generate a structured label, summary message,
 * and optional version tag for changed files before capturing a Snapshot Checkpoint.
 */
export async function generateSnapshotAiSummary({
  projectId,
  userId,
  changesSummaryText,
  model = null,
}) {
  if (!changesSummaryText || !changesSummaryText.trim()) {
    throw new ServiceError(
      "No changed files available to summarize for checkpoint",
      400,
      "SNAPSHOT_UNCHANGED",
    );
  }

  const prompt = [
    "You are an expert software engineer creating a concise checkpoint summary in English for a developer project snapshot.",
    "Analyze the changed files and unified diffs below, then return ONLY strict JSON (no markdown fences):",
    '{ "label": "short descriptive title <= 72 chars", "message": "1-3 concise bullet lines summarizing what changed and why", "suggestedTag": "optional release/milestone tag like v1.0.1 or null" }',
    "",
    changesSummaryText.slice(0, MAX_AI_SNAPSHOT_DIFF_CHARS),
  ].join("\n");

  const reservation = await reserveAiQuota({
    userId,
    requestKey: `snapshot-ai-summary:${projectId}:${randomUUID()}`,
  });

  let rawResponse;
  try {
    rawResponse = await generateText(
      prompt,
      model || null,
      "Return ONLY valid JSON with label, message, and suggestedTag.",
      {
        taskType: "chatbox",
        temperature: 0.2,
        maxOutputTokens: 450,
        userId,
      },
    );
    await consumeAiQuota(reservation.id).catch(() => {});
  } catch (err) {
    await releaseAiQuota(reservation.id).catch(() => {});
    throw err;
  }

  return parseAiSummaryPayload(rawResponse);
}
