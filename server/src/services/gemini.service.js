import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// Manage API keys & Configure Gemini SDK
const apiKey = process.env.GEMINI_API_KEY;
let genAI = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
} else {
  console.warn("[Gemini API] WARNING: GEMINI_API_KEY is not defined in the environment variables.");
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
      const isServerError = error.status >= 500 || error.message.includes("fetch failed");

      if ((isRateLimit || isServerError) && retries < maxRetries - 1) {
        retries++;
        // Exponential backoff: 2s, 4s, 8s...
        const waitTime = Math.pow(2, retries) * 1000;
        console.warn(`[Gemini API] Rate limit or server error. Retrying in ${waitTime}ms... (Attempt ${retries}/${maxRetries})`);
        await delay(waitTime);
      } else {
        // Handle API errors
        console.error("[Gemini API] Error:", error.message);
        throw new Error(`Gemini API Error: ${error.message}`);
      }
    }
  }
}

/**
 * Send prompts & Receive responses
 * @param {string} prompt - The prompt to send to the Gemini model
 * @param {string|null} systemInstruction - Optional system instruction for the model
 * @returns {Promise<string>} The generated text response
 */
export const generateText = async (prompt, systemInstruction = null) => {
  if (!genAI) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  // Use gemini-2.5-flash as the default fast model
  const modelOptions = { model: "gemini-2.5-flash" };
  if (systemInstruction) {
    modelOptions.systemInstruction = systemInstruction;
  }

  const model = genAI.getGenerativeModel(modelOptions);

  const apiCall = async () => {
    // Send prompts
    const result = await model.generateContent(prompt);
    // Receive responses
    return result.response.text();
  };

  return executeWithRetry(apiCall);
};
