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
      const isServerError =
        error.status >= 500 || error.message.includes("fetch failed");

      if ((isRateLimit || isServerError) && retries < maxRetries - 1) {
        retries++;
        // Exponential backoff: 2s, 4s, 8s...
        const waitTime = Math.pow(2, retries) * 1000;
        console.warn(
          `[Gemini API] Rate limit or server error. Retrying in ${waitTime}ms... (Attempt ${retries}/${maxRetries})`,
        );
        await delay(waitTime);
      } else {
        // Handle API errors
        console.error("[Gemini API] Error:", error.message);
        throw new Error(`Gemini API Error: ${error.message}`);
      }
    }
  }
}

const VALID_MODELS = ["gemini-2.5-flash", "gemini-3.5-flash"];

/**
 * Normalizes model names, replacing deprecated models (1.5-pro, 1.5-flash, 2.0-flash, 3.5-flash-lite)
 * with the currently active and verified models.
 */
function resolveModelName(requestedModel) {
  if (!requestedModel) {
    return process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }
  const clean = requestedModel.trim();
  if (VALID_MODELS.includes(clean)) {
    return clean;
  }
  // If requesting a deprecated model or unknown model, fall back to gemini-2.5-flash
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

/**
 * Send prompts & Receive responses
 * @param {string} prompt - The prompt to send to the Gemini model
 * @param {string|null} modelOrInstruction - Optional model name (e.g., 'gemini-2.5-flash') or system instruction
 * @param {string|null} maybeInstruction - Optional system instruction if model name was provided as 2nd arg
 * @returns {Promise<string>} The generated text response
 */
export const generateText = async (prompt, modelOrInstruction = null, maybeInstruction = null) => {
  let modelName = null;
  let systemInstruction = null;

  if (typeof modelOrInstruction === "string" && (modelOrInstruction.startsWith("gemini-") || modelOrInstruction.includes("/"))) {
    modelName = modelOrInstruction;
    systemInstruction = maybeInstruction;
  } else {
    systemInstruction = modelOrInstruction;
  }

  return generateMultimodalText(prompt, [], systemInstruction, modelName);
};

/**
 * Send prompts & attachments (images) & Receive responses
 * @param {string} prompt - The prompt to send to the Gemini model
 * @param {Array<{ data: string, mimeType: string }>} images - Optional array of images in base64
 * @param {string|null} systemInstruction - Optional system instruction for the model
 * @param {string|null} modelName - Optional specific model name
 * @returns {Promise<string>} The generated text response
 */
export const generateMultimodalText = async (
  prompt,
  images = [],
  systemInstruction = null,
  modelName = null,
) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const primaryModelName = resolveModelName(modelName);
  
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
    try {
      const model = createModelInstance(primaryModelName);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
        },
      });
      return result.response.text();
    } catch (primaryErr) {
      // If primary model failed with 404 or model error, try secondary fallback model
      const fallbackModel = primaryModelName === "gemini-2.5-flash" ? "gemini-3.5-flash" : "gemini-2.5-flash";
      console.warn(`[Gemini API] Primary model ${primaryModelName} error: ${primaryErr.message}. Attempting fallback with ${fallbackModel}...`);
      const model = createModelInstance(fallbackModel);
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 65536,
        },
      });
      return result.response.text();
    }
  };

  return executeWithRetry(apiCall);
};
