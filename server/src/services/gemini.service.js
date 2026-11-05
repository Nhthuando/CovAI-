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

dotenv.config();

// Manage API keys & Configure Gemini SDK
const clients = new Map();

const VALID_MODELS = GEMINI_MODEL_IDS;
const exhaustedModels = new Map();

/**
 * Checks if a model is currently exhausted and cleans up expired entries.
 */
export function markModelExhausted(modelName, error = {message:'daily quota'}, configuration = geminiConfiguration()) {
  if(modelName) exhaustedModels.set(`${configuration.credentialId}:${modelName}`,geminiQuotaError(error,modelName));
}

/**
 * Normalizes model names, replacing deprecated or quota-exhausted models
 * with the currently active and verified models.
 */
function resolveModelName(requestedModel, configuration) {
  const preferred = (requestedModel && requestedModel.trim()) || configuration.model || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const normalized = normalizeModelId(preferred);
  if(!VALID_MODELS.includes(normalized)) throw new ServiceError('Select one of the four supported Gemini models.',400);
  const quotaKey = `${configuration.credentialId}:${normalized}`;
  const blocked=exhaustedModels.get(quotaKey);
  if(blocked?.resetAt && Date.parse(blocked.resetAt)>Date.now()) throw blocked;
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
export const generateText = async (prompt, modelOrInstruction = null, maybeInstructionOrConfig = null, maybeConfig = {}) => {
  let modelName = null;
  let systemInstruction = null;
  let generationConfig = {};

  if (typeof modelOrInstruction === "string" && (modelOrInstruction.startsWith("gemini-") || modelOrInstruction.includes("/"))) {
    modelName = modelOrInstruction;
    systemInstruction = maybeInstructionOrConfig;
    generationConfig = maybeConfig || {};
  } else {
    systemInstruction = modelOrInstruction;
    if (maybeInstructionOrConfig && typeof maybeInstructionOrConfig === "object") {
      generationConfig = maybeInstructionOrConfig;
    }
  }

  return generateMultimodalText(prompt, [], systemInstruction, modelName, generationConfig);
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
  maybeConfig = {}
) => {
  if (process.env.AI_PROVIDER_MODE === "fixture") {
    if (!isCollaborationLocalTest()) {
      throw new ServiceError("Fixture AI is restricted to the isolated collaboration test environment", 503);
    }
    if (String(prompt).startsWith("Extract only explicit durable USER requirements")) return '{"notes":[]}';
    if (String(prompt).startsWith("Summarize stored chat DATA")) return "[LOCAL AI FIXTURE] Shared conversation context retained for the collaboration test.";
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

  const {requestTimeoutMs,totalTimeoutMs,maxAttempts,onRetry,onWait,retryBaseDelayMs,...providerConfig}=generationConfig;
  let primaryModelName = resolveModelName(modelName, configuration);
  
  const createModelInstance = (mName) => {
    const modelOptions = { model: mName };
    const specialist = configuration.feature === 'general' ? '' : buildAgentInstruction(configuration.feature);
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

  const apiCall = async ({signal}) => {
    primaryModelName = resolveModelName(modelName, configuration);
    const budget = currentAiJobBudget();
    await budget?.beforeRequest();
    const requestSignal = budget?.signal ? AbortSignal.any([signal, budget.signal]) : signal;
    try {
      const model = createModelInstance(primaryModelName);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
          ...providerConfig,
        },
      }, {signal:requestSignal});
      if (requestSignal.aborted) throw requestSignal.reason || new Error('AI request canceled');
      await budget?.record(result.response?.usageMetadata);
      console.log(`[Gemini API] feature=${configuration.feature} credential=${configuration.keyEnv} model=${primaryModelName}`);
      if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        console.log(`[Gemini API] Provider returned version info (if any):`, result.response.modelVersion || 'N/A');
      }
      return result.response.text();
    } catch (primaryErr) {
      if (signal.aborted) throw primaryErr;
      if(primaryErr.status === 429 || /429|quota exceeded|RESOURCE_EXHAUSTED/i.test(primaryErr.message || '')) {
        if(isDailyQuotaError(primaryErr)) markModelExhausted(primaryModelName,primaryErr,configuration);
        throw geminiQuotaError(primaryErr,primaryModelName);
      }
      throw primaryErr;
    }
  };

  return runGeminiRequest(apiCall,{requestTimeoutMs,totalTimeoutMs,maxAttempts,onRetry,onWait,retryBaseDelayMs});
};
