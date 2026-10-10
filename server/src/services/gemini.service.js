import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

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

// Utility for delaying execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handle API errors & Handle rate limits
 * Wrapper to execute a Gemini API call with retry logic for rate limits.
 */
async function executeWithRetry(apiCall, maxRetries = 3) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await apiCall();
    } catch (error) {
      const isRateLimit = error.status === 429 || error.message.includes("429");
      const isDailyQuota = isRateLimit && (error.message.includes("PerDay") || error.message.includes("generate_content_free_tier_requests"));
      const isUnavailable = error.status === 503 || error.message.includes("503");
      const isServerError =
        error.status >= 500 || error.message.includes("fetch failed");

      if ((isRateLimit || isUnavailable || isServerError) && retries < maxRetries - 1) {
        retries++;
        
        let waitTime = Math.pow(2, retries) * 1000 + (Math.random() * 500);
        const retryMatch = error.message.match(/retry in ([\d\.]+)s/i);
        
        if (isDailyQuota) {
           waitTime = 0; // Immediate retry to fallback model
        } else if (isRateLimit && retryMatch && retryMatch[1]) {
           waitTime = (parseFloat(retryMatch[1]) + 1) * 1000;
           if (waitTime > 45000) waitTime = 45000;
        } else if (isUnavailable) {
           waitTime = Math.pow(2, retries) * 2000 + (Math.random() * 1000);
        }

        console.warn(
          `[Gemini API] ${isDailyQuota ? 'Daily Quota Exhausted' : isRateLimit ? 'Rate limit (429)' : isUnavailable ? 'Service Unavailable (503)' : 'Server error'}. Retrying in ${Math.round(waitTime)}ms... (Attempt ${retries}/${maxRetries})`,
        );
        if (waitTime > 0) {
          await delay(waitTime);
        }
      } else {
        console.error("[Gemini API] Error:", error.message);
        throw new Error(`Gemini API Error: ${error.message}`);
      }
    }
  }
}

const VALID_MODELS = ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"];
const exhaustedModels = new Set();

/**
 * Marks a model as quota-exhausted for the remainder of this process session.
 */
export function markModelExhausted(modelName) {
  if (modelName) exhaustedModels.add(modelName);
}

/**
 * Normalizes model names, replacing deprecated or quota-exhausted models
 * with the currently active and verified models.
 */
function resolveModelName(requestedModel) {
  const preferred = (requestedModel && requestedModel.trim()) || process.env.GEMINI_MODEL || "gemini-3.8-flash";
  
  if (VALID_MODELS.includes(preferred) && !exhaustedModels.has(preferred)) {
    return preferred;
  }
  for (const m of VALID_MODELS) {
    if (!exhaustedModels.has(m)) return m;
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
  }

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

  const apiCall = async () => {
    primaryModelName = resolveModelName(modelName);
    try {
      const model = createModelInstance(primaryModelName);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
          ...generationConfig,
        },
      });
      console.log(`[Gemini API] Successfully generated response using primary model: ${primaryModelName}`);
      if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        console.log(`[Gemini API] Provider returned version info (if any):`, result.response.modelVersion || 'N/A');
      }
      return result.response.text();
    } catch (primaryErr) {
      const isRateLimit = primaryErr.message && (primaryErr.message.includes("Quota exceeded") || primaryErr.message.includes("429"));
      const isUnavailable = primaryErr.message && (primaryErr.message.includes("503") || primaryErr.message.includes("Service Unavailable"));
      
      if (isRateLimit) {
        markModelExhausted(primaryModelName);
      }
      
      // If it's a 503 or 429, we throw immediately so the outer executeWithRetry can handle backoff and retry the SAME model (if 503) or let resolveModelName pick a new one on next retry
      if (isUnavailable || isRateLimit) {
         throw primaryErr;
      }

      // If primary model failed with 404 or other model error, try secondary fallback model
      const fallbackModel = VALID_MODELS.find(m => m !== primaryModelName && !exhaustedModels.has(m)) || "gemini-3.8-flash";
      console.warn(`[Gemini API] Primary model ${primaryModelName} error: ${primaryErr.message}. Attempting fallback with ${fallbackModel}...`);
      const model = createModelInstance(fallbackModel);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
          ...generationConfig,
        },
      });
      console.log(`[Gemini API] Successfully generated response using fallback model: ${fallbackModel}`);
      if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        console.log(`[Gemini API] Provider returned version info (if any):`, result.response.modelVersion || 'N/A');
      }
      return result.response.text();
    }
  };

  return executeWithRetry(apiCall, 4); // Use 4 max retries to give it more chances
};
