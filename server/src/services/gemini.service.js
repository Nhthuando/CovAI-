import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { runGeminiRequest, isDailyQuotaError } from './geminiRequestPolicy.service.js';

dotenv.config();

// Manage API keys & Configure Gemini SDK
const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
} else {
  console.warn(
    "[Gemini API] WARNING: GEMINI_API_KEY is not defined in the environment variables.",
  );
}

const VALID_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite"
];
const exhaustedModels = new Map();

/**
 * Checks if a model is currently exhausted and cleans up expired entries.
 */
function isModelExhausted(modelName) {
  if (!exhaustedModels.has(modelName)) return false;
  const retryAt = exhaustedModels.get(modelName);
  if (Date.now() >= retryAt) {
    exhaustedModels.delete(modelName);
    return false;
  }
  return true;
}

/**
 * Marks a model as quota-exhausted with a TTL (default 60s for rate limits, 10m for daily quota).
 */
export function markModelExhausted(modelName, isDailyQuota = false) {
  if (!modelName) return;
  const ttlMs = isDailyQuota ? 10 * 60 * 1000 : 60 * 1000;
  exhaustedModels.set(modelName, Date.now() + ttlMs);
  console.warn(`[Gemini API] Marked model ${modelName} as exhausted for ${ttlMs / 1000}s.`);
}

/**
 * Normalizes model names, replacing deprecated or quota-exhausted models
 * with the currently active and verified models.
 */
function resolveModelName(requestedModel) {
  const preferred = (requestedModel && requestedModel.trim()) || process.env.GEMINI_MODEL || "gemini-3.5-flash";
  
  if (VALID_MODELS.includes(preferred) && !isModelExhausted(preferred)) {
    return preferred;
  }
  for (const m of VALID_MODELS) {
    if (!isModelExhausted(m)) return m;
  }
  
  // If we reach here, all configured fallback models are exhausted.
  throw new Error("PROVIDER_QUOTA_EXHAUSTED: All available Gemini models have exhausted their free-tier quota.");
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
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

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
  let primaryModelName = resolveModelName(modelName);
  
  const createModelInstance = (mName) => {
    const modelOptions = { model: mName };
    if (systemInstruction) {
      modelOptions.systemInstruction = systemInstruction;
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
    primaryModelName = resolveModelName(modelName);
    try {
      const model = createModelInstance(primaryModelName);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
          ...providerConfig,
        },
      }, {signal});
      console.log(`[Gemini API] Successfully generated response using primary model: ${primaryModelName}`);
      if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        console.log(`[Gemini API] Provider returned version info (if any):`, result.response.modelVersion || 'N/A');
      }
      return result.response.text();
    } catch (primaryErr) {
      if (signal.aborted) throw primaryErr;
      const isRateLimit = primaryErr.status === 429 || (primaryErr.message && (primaryErr.message.includes("Quota exceeded") || primaryErr.message.includes("429")));
      const isDailyQuota = isRateLimit && isDailyQuotaError(primaryErr);
      const isUnavailable = primaryErr.status === 503 || (primaryErr.message && (primaryErr.message.includes("503") || primaryErr.message.includes("Service Unavailable")));
      
      if (isDailyQuota) {
        markModelExhausted(primaryModelName, true);
      } else if (isRateLimit || isUnavailable) {
        markModelExhausted(primaryModelName, false);
      }
      
      // Retry transient errors through the bounded request policy; 503 keeps the selected model.
      if (isUnavailable || isRateLimit || primaryErr.status >= 500 || primaryErr.message?.includes('fetch failed')) {
         throw primaryErr;
      }

      // If primary model failed with 404 or other model error, try secondary fallback model
      const fallbackModel = VALID_MODELS.find(m => m !== primaryModelName && !isModelExhausted(m)) || "gemini-3.5-flash-lite";
      console.warn(`[Gemini API] Primary model ${primaryModelName} error: ${primaryErr.message}. Attempting fallback with ${fallbackModel}...`);
      const model = createModelInstance(fallbackModel);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
          ...providerConfig,
        },
      }, {signal});
      console.log(`[Gemini API] Successfully generated response using fallback model: ${fallbackModel}`);
      if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        console.log(`[Gemini API] Provider returned version info (if any):`, result.response.modelVersion || 'N/A');
      }
      return result.response.text();
    }
  };

  return runGeminiRequest(apiCall,{requestTimeoutMs,totalTimeoutMs,maxAttempts,onRetry,onWait,retryBaseDelayMs});
};
