import { GEMINI_MODEL_IDS, normalizeModelId } from '../../../shared/aiModels.js';
import { geminiQuotaError } from '../utils/geminiQuota.js';
import { ServiceError } from '../utils/serviceError.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { runGeminiRequest, isDailyQuotaError } from './geminiRequestPolicy.service.js';
import { currentAiJobBudget } from './aiJobBudget.service.js';
import { isCollaborationLocalTest } from '../config/collaborationLocal.js';
import { geminiConfiguration } from './geminiRouting.service.js';
import { buildAgentInstruction } from '../agents/registry.js';
import { chatThinkingConfig } from './chatResponsePolicy.service.js';
import {
  withGeminiChannel,
  getCurrentGeminiChannel,
  recordGeminiTokenUsage,
  recordGeminiRateLimit,
} from "./geminiTokenTracker.service.js";

export { withGeminiChannel, getCurrentGeminiChannel };

dotenv.config();

// Task-to-Environment-Variable mapping for independent quota separation
export const TASK_KEY_MAP = {
  unit: ["GEMINI_KEY_UNIT_TEST", "GEMINI_UNIT_TEST_API_KEY"],
  "unit-test": ["GEMINI_KEY_UNIT_TEST", "GEMINI_UNIT_TEST_API_KEY"],
  unit_test: ["GEMINI_KEY_UNIT_TEST", "GEMINI_UNIT_TEST_API_KEY"],
  integration: ["GEMINI_KEY_INTEGRATION_TEST", "GEMINI_INTEGRATION_TEST_API_KEY"],
  "integration-test": ["GEMINI_KEY_INTEGRATION_TEST", "GEMINI_INTEGRATION_TEST_API_KEY"],
  integration_test: ["GEMINI_KEY_INTEGRATION_TEST", "GEMINI_INTEGRATION_TEST_API_KEY"],
  supertest: ["GEMINI_KEY_INTEGRATION_TEST", "GEMINI_INTEGRATION_TEST_API_KEY"],
  e2e: ["GEMINI_KEY_E2E_TEST", "GEMINI_SYSTEM_TEST_API_KEY"],
  "e2e-test": ["GEMINI_KEY_E2E_TEST", "GEMINI_SYSTEM_TEST_API_KEY"],
  e2e_test: ["GEMINI_KEY_E2E_TEST", "GEMINI_SYSTEM_TEST_API_KEY"],
  system: ["GEMINI_KEY_E2E_TEST", "GEMINI_SYSTEM_TEST_API_KEY"],
  "system-test": ["GEMINI_KEY_E2E_TEST", "GEMINI_SYSTEM_TEST_API_KEY"],
  system_test: ["GEMINI_KEY_E2E_TEST", "GEMINI_SYSTEM_TEST_API_KEY"],
  chatbox: ["GEMINI_KEY_CHATBOX", "GEMINI_CHATBOX_API_KEY", "GEMINI_API_KEY"],
  chat: ["GEMINI_KEY_CHATBOX", "GEMINI_CHATBOX_API_KEY", "GEMINI_API_KEY"],
  chat_box: ["GEMINI_KEY_CHATBOX", "GEMINI_CHATBOX_API_KEY", "GEMINI_API_KEY"],
};

/**
 * Validates availability of task-specific environment keys on service startup.
 */
export function validateGeminiKeys() {
  const REQUIRED = [
    { label: "GEMINI_KEY_UNIT_TEST", vars: ["GEMINI_KEY_UNIT_TEST", "GEMINI_UNIT_TEST_API_KEY"] },
    { label: "GEMINI_KEY_INTEGRATION_TEST", vars: ["GEMINI_KEY_INTEGRATION_TEST", "GEMINI_INTEGRATION_TEST_API_KEY"] },
    { label: "GEMINI_KEY_E2E_TEST", vars: ["GEMINI_KEY_E2E_TEST", "GEMINI_SYSTEM_TEST_API_KEY"] },
    { label: "GEMINI_KEY_CHATBOX", vars: ["GEMINI_KEY_CHATBOX", "GEMINI_CHATBOX_API_KEY", "GEMINI_API_KEY"] },
  ];
  for (const req of REQUIRED) {
    const hasKey = req.vars.some(v => Boolean(process.env[v]?.trim()));
    if (!hasKey) {
      console.warn(
        `[Gemini API] WARNING: Dedicated environment variable ${req.label} is not defined. Falling back to GEMINI_API_KEY.`
      );
    }
  }
  if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_KEY_INTEGRATION_TEST && !process.env.GEMINI_INTEGRATION_TEST_API_KEY) {
    console.warn(
      "[Gemini API] CRITICAL: Neither GEMINI_KEY_INTEGRATION_TEST nor GEMINI_API_KEY is configured in environment.",
    );
  }
}
if (process.env.NODE_ENV !== 'test') {
  validateGeminiKeys();
}

/**
 * Resolves the appropriate Gemini API key for a given task type.
 * Priority: Dedicated Task Key -> Legacy GEMINI_API_KEY.
 *
 * @param {'unit' | 'integration' | 'e2e' | 'system' | 'chatbox' | 'chat'} taskType
 * @returns {string} The resolved API key
 */
export function getGeminiApiKey(taskType = "integration") {
  const normalizedTask = String(taskType || "integration").toLowerCase();
  const envVars = TASK_KEY_MAP[normalizedTask] || ["GEMINI_KEY_INTEGRATION_TEST", "GEMINI_INTEGRATION_TEST_API_KEY"];
  const list = Array.isArray(envVars) ? envVars : [envVars];
  for (const v of list) {
    if (process.env[v]?.trim()) return process.env[v].trim();
  }
  return process.env.GEMINI_API_KEY?.trim() || "";
}

// Client cache to avoid reinstantiating GoogleGenerativeAI on every request
const clientCache = new Map();

/**
 * Factory provider returning a cached GoogleGenerativeAI client instance for the specified task.
 *
 * @param {'unit' | 'integration' | 'e2e' | 'chatbox'} taskType
 * @param {string|null} explicitApiKey
 * @returns {GoogleGenerativeAI}
 */
export function getGeminiClient(
  taskType = "integration",
  explicitApiKey = null,
) {
  const key = explicitApiKey || getGeminiApiKey(taskType);
  if (!key) {
    throw new Error(
      `Gemini API key is not configured for task '${taskType}'. Please set ${
        TASK_KEY_MAP[taskType?.toLowerCase()] || "GEMINI_KEY_INTEGRATION_TEST"
      } or GEMINI_API_KEY in your environment.`,
    );
  }
  if (!clientCache.has(key)) {
    clientCache.set(key, new GoogleGenerativeAI(key));
  }
  return clientCache.get(key);
}

// Manage API keys & Configure Gemini SDK
const clients = new Map();

const VALID_MODELS = GEMINI_MODEL_IDS;
const exhaustedModels = new Map();

/**
 * Checks if a model is currently exhausted and cleans up expired entries.
 */
export function markModelExhausted(modelName, error = { message: 'daily quota' }, configuration = geminiConfiguration()) {
  if (modelName) exhaustedModels.set(`${configuration.credentialId}:${modelName}`, geminiQuotaError(error, modelName));
}

/**
 * Normalizes model names, replacing deprecated or quota-exhausted models
 * with the currently active and verified models.
 */
function resolveModelName(requestedModel, configuration) {
  const preferred = (requestedModel && requestedModel.trim()) || configuration?.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const normalized = normalizeModelId(preferred);
  if (!VALID_MODELS.includes(normalized)) {
    const fallback = normalizeModelId(configuration?.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
    if (VALID_MODELS.includes(fallback)) {
      console.warn(`[Gemini API] Model '${preferred}' is not in catalog. Falling back to '${fallback}'.`);
      return fallback;
    }
    throw new ServiceError('Select one of the supported Gemini models.', 400);
  }
  const quotaKey = `${configuration?.credentialId || 'default'}:${normalized}`;
  const blocked = exhaustedModels.get(quotaKey);
  if (blocked?.resetAt && Date.parse(blocked.resetAt) > Date.now()) throw blocked;
  exhaustedModels.delete(quotaKey);
  return normalized;
}

/**
 * Send prompts & Receive responses
 * @param {string} prompt - The prompt to send to the Gemini model
 * @param {string|null} modelOrInstruction - Optional model name (e.g., 'gemini-2.5-flash') or system instruction
 * @param {string|null} maybeInstruction - Optional system instruction if model name was provided as 2nd arg
 * @returns {Promise<string>} The generated text response
 */
export const generateText = async (
  prompt,
  modelOrInstruction = null,
  maybeInstructionOrConfig = null,
  maybeConfig = {},
) => {
  let modelName = null;
  let systemInstruction = null;
  let generationConfig = {};

  const isModelName = typeof modelOrInstruction === "string" &&
    !modelOrInstruction.includes(" ") &&
    !modelOrInstruction.includes("\n") &&
    (modelOrInstruction.startsWith("gemini-") || modelOrInstruction.startsWith("models/"));

  if (isModelName) {
    modelName = modelOrInstruction;
    if (
      typeof maybeInstructionOrConfig === "object" &&
      maybeInstructionOrConfig !== null
    ) {
      generationConfig = maybeInstructionOrConfig;
      systemInstruction = null;
    } else {
      systemInstruction = maybeInstructionOrConfig;
      generationConfig = maybeConfig || {};
    }
  } else if (
    typeof modelOrInstruction === "object" &&
    modelOrInstruction !== null
  ) {
    generationConfig = modelOrInstruction;
  } else {
    systemInstruction = modelOrInstruction;
    if (
      maybeInstructionOrConfig &&
      typeof maybeInstructionOrConfig === "object"
    ) {
      generationConfig = maybeInstructionOrConfig;
    }
  }

  return generateMultimodalText(
    prompt,
    [],
    systemInstruction,
    modelName,
    generationConfig,
  );
};

export const generateTextWithTelemetry = async (
  prompt,
  modelOrInstruction = null,
  maybeInstructionOrConfig = null,
  maybeConfig = {},
) => {
  let modelName = null;
  let systemInstruction = null;
  let generationConfig = {};

  if (
    typeof modelOrInstruction === "string" &&
    (modelOrInstruction.startsWith("gemini-") ||
      modelOrInstruction.includes("/"))
  ) {
    modelName = modelOrInstruction;
    if (
      typeof maybeInstructionOrConfig === "object" &&
      maybeInstructionOrConfig !== null
    ) {
      generationConfig = { ...maybeInstructionOrConfig, returnTelemetry: true };
      systemInstruction = null;
    } else {
      systemInstruction = maybeInstructionOrConfig;
      generationConfig = { ...(maybeConfig || {}), returnTelemetry: true };
    }
  } else if (
    typeof modelOrInstruction === "object" &&
    modelOrInstruction !== null
  ) {
    generationConfig = { ...modelOrInstruction, returnTelemetry: true };
  } else {
    systemInstruction = modelOrInstruction;
    if (
      maybeInstructionOrConfig &&
      typeof maybeInstructionOrConfig === "object"
    ) {
      generationConfig = { ...maybeInstructionOrConfig, returnTelemetry: true };
    } else {
      generationConfig = { ...(maybeConfig || {}), returnTelemetry: true };
    }
  }

  return generateMultimodalText(
    prompt,
    [],
    systemInstruction,
    modelName,
    generationConfig,
  );
};

/**
 * Send prompts & attachments (images) & Receive responses
 * @param {string} prompt - The prompt to send to the Gemini model
 * @param {Array<{ data: string, mimeType: string }>} images - Optional array of images in base64
 * @param {string|null} systemInstruction - Optional system instruction for the model
 * @param {string|object|null} modelNameOrConfig - Optional specific model name or generationConfig
 * @param {object} maybeConfig - Optional generationConfig
 * @returns {Promise<string>} The generated text response
 */
export const generateMultimodalText = async (
  prompt,
  images = [],
  systemInstruction = null,
  modelNameOrConfig = null,
  maybeConfig = {},
) => {
  if (process.env.AI_PROVIDER_MODE === "fixture") {
    if (!isCollaborationLocalTest()) {
      throw new ServiceError(
        "Fixture AI is restricted to the isolated collaboration test environment",
        503,
      );
    }
    if (
      String(prompt).startsWith(
        "Extract only explicit durable USER requirements",
      )
    )
      return '{"notes":[]}';
    if (String(prompt).startsWith("Summarize stored chat DATA"))
      return "[LOCAL AI FIXTURE] Shared conversation context retained for the collaboration test.";
    return "[LOCAL AI FIXTURE] Shared project chat response. This deterministic response verifies collaboration; no live Gemini request was made.";
  }
  const configuration = geminiConfiguration(undefined, { required: true });
  let genAI = clients.get(configuration.credentialId);
  if (!genAI) { genAI = new GoogleGenerativeAI(configuration.apiKey); clients.set(configuration.credentialId, genAI); }

  let modelName = null;
  let generationConfig = {};

  if (typeof modelNameOrConfig === "string") {
    modelName = modelNameOrConfig;
    generationConfig = maybeConfig || {};
  } else if (modelNameOrConfig && typeof modelNameOrConfig === "object") {
    generationConfig = modelNameOrConfig;
  } else {
    generationConfig = maybeConfig || {};
  }

  const taskType =
    generationConfig.taskType || getCurrentGeminiChannel() || configuration.feature || "integration";
  const resolvedApiKey = generationConfig.apiKey || configuration.apiKey || getGeminiApiKey(taskType);
  if (generationConfig.apiKey) {
    genAI = getGeminiClient(taskType, generationConfig.apiKey);
  }

  const {
    requestTimeoutMs,
    totalTimeoutMs,
    maxAttempts,
    onRetry,
    onWait,
    retryBaseDelayMs,
    taskType: _taskType,
    apiKey: _apiKey,
    returnTelemetry: _returnTelemetry,
    userId: _userId,
    ...providerConfig
  } = generationConfig;

  let primaryModelName = resolveModelName(modelName, configuration);

  const createModelInstance = (mName) => {
    const modelOptions = { model: mName };
    const specialist = ['general', 'chatbox'].includes(configuration.feature) ? '' : buildAgentInstruction(configuration.feature);
    if (specialist || systemInstruction) {
      modelOptions.systemInstruction = [specialist, systemInstruction].filter(Boolean).join('\n');
    }
    return genAI.getGenerativeModel(modelOptions);
  };

  const parts = [];

  if (Array.isArray(images) && images.length > 0) {
    for (const img of images) {
      if (!img?.data) continue;
      const base64Data = img.data.includes(";base64,")
        ? img.data.split(";base64,")[1]
        : img.data;
      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: img.mimeType || "image/png",
        },
      });
    }
  }

  parts.push({ text: prompt });

  const apiCall = async ({ signal }) => {
    primaryModelName = resolveModelName(modelName, configuration);
    const budget = currentAiJobBudget();
    await budget?.beforeRequest();
    const requestSignal = budget?.signal
      ? AbortSignal.any([signal, budget.signal])
      : signal;
    try {
      const model = createModelInstance(primaryModelName);
      const callStartTime = Date.now();
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
          ...providerConfig,
          ...(configuration.feature === 'chatbox' && chatThinkingConfig(primaryModelName) ? { thinkingConfig: chatThinkingConfig(primaryModelName) } : {}),
        },
      }, { signal: requestSignal });
      if (requestSignal.aborted) throw requestSignal.reason || new Error('AI request canceled');
      const durationMs = Date.now() - callStartTime;
      await budget?.record(result.response?.usageMetadata);
      console.log(`[Gemini API] feature=${configuration.feature} credential=${configuration.keyEnv} model=${primaryModelName} (${durationMs}ms)`);
      if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        console.log(`[Gemini API] Provider returned version info (if any):`, result.response.modelVersion || 'N/A');
      }
      let rawText = "";
      try {
        rawText =
          typeof result.response?.text === "function"
            ? result.response.text()
            : result.response?.text || "";
      } catch (_) {
        rawText = "";
      }

      const usageMetadata = result.response?.usageMetadata;
      const promptTokens =
        usageMetadata?.promptTokenCount ||
        Math.max(1, Math.round(prompt.length / 4));
      const completionTokens =
        usageMetadata?.candidatesTokenCount ||
        Math.max(1, Math.round((rawText || "").length / 4));
      const totalTokens =
        usageMetadata?.totalTokenCount || promptTokens + completionTokens;

      try {
        recordGeminiTokenUsage({
          taskType,
          apiKey: resolvedApiKey,
          modelName: primaryModelName,
          usageMetadata: result.response?.usageMetadata,
          promptText: prompt,
          responseText: rawText,
        });
      } catch (trackingErr) {
        console.warn(
          "[geminiTokenTracker] Error recording usage:",
          trackingErr.message,
        );
      }

      const telemetry = {
        durationMs,
        durationSeconds: Number((durationMs / 1000).toFixed(2)),
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: totalTokens,
        },
        model: primaryModelName,
      };

      if (generationConfig?.userId) {
        import("./aiQuota.service.js")
          .then(({ incrementTokenUsage }) => {
            incrementTokenUsage(generationConfig.userId, totalTokens).catch(
              () => {},
            );
          })
          .catch(() => {});
      }

      if (generationConfig?.returnTelemetry) {
        return {
          text: rawText,
          telemetry,
        };
      }

      return rawText;
    } catch (primaryErr) {
      if (signal.aborted) throw primaryErr;
      if (primaryErr.status === 429 || /429|quota exceeded|RESOURCE_EXHAUSTED/i.test(primaryErr.message || '')) {
        try {
          recordGeminiRateLimit({
            taskType,
            apiKey: resolvedApiKey,
            modelName: primaryModelName,
            error: primaryErr,
          });
        } catch (rateLimitErr) {
          console.warn(
            "[geminiTokenTracker] Error recording rate limit:",
            rateLimitErr.message,
          );
        }
        if (isDailyQuotaError(primaryErr)) markModelExhausted(primaryModelName, primaryErr, configuration);
        throw geminiQuotaError(primaryErr, primaryModelName);
      }
      throw primaryErr;
    }
  };

  return runGeminiRequest(apiCall, { requestTimeoutMs, totalTimeoutMs, maxAttempts, onRetry, onWait, retryBaseDelayMs });
};
