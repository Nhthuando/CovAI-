import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";
import {
  GEMINI_CHANNELS,
  normalizeChannelId,
  fingerprintKey,
  maskApiKey,
  resolveChannelKeyInfo,
  recordGeminiTokenUsage,
  recordGeminiRateLimit,
  getAiQuotasSnapshot,
  resetAiQuotas,
  updateQuotaLimit,
  withGeminiChannel,
  getCurrentGeminiChannel,
} from "../services/geminiTokenTracker.service.js";

describe("Gemini Token Quota Settings & Tracking Engine", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env vars to baseline
    process.env.GEMINI_KEY_UNIT_TEST = "AIzaSyDedicatedUnitTestKey123456";
    process.env.GEMINI_KEY_INTEGRATION_TEST = "AIzaSyDedicatedIntegrationKey123456";
    delete process.env.GEMINI_KEY_E2E_TEST; // Fallback to GEMINI_API_KEY
    delete process.env.GEMINI_KEY_CHATBOX;  // Fallback to GEMINI_API_KEY
    process.env.GEMINI_API_KEY = "AIzaSySharedFallbackKey999999";
    process.env.GEMINI_DEFAULT_TOKEN_QUOTA = "1000000";

    // Clean up counters and reset limits
    resetAiQuotas(null, true);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("normalizes task type aliases to canonical Gemini channels", () => {
    expect(normalizeChannelId("unit")).toBe("UNIT_TEST");
    expect(normalizeChannelId("unit-test")).toBe("UNIT_TEST");
    expect(normalizeChannelId("integration")).toBe("INTEGRATION_TEST");
    expect(normalizeChannelId("supertest")).toBe("INTEGRATION_TEST");
    expect(normalizeChannelId("e2e")).toBe("E2E_TEST");
    expect(normalizeChannelId("system")).toBe("E2E_TEST");
    expect(normalizeChannelId("chat")).toBe("CHATBOX");
    expect(normalizeChannelId("chatbox")).toBe("CHATBOX");
  });

  it("safely masks API keys without leaking full raw credentials", () => {
    expect(maskApiKey("AIzaSyDedicatedUnitTestKey123456")).toBe("AIzaSy...3456");
    expect(maskApiKey("shortkey12")).toBe("sho...12");
    expect(maskApiKey("")).toBe("Not configured");
    expect(maskApiKey(null)).toBe("Not configured");
  });

  it("correctly distinguishes DEDICATED, FALLBACK, and UNCONFIGURED key modes", () => {
    const unitInfo = resolveChannelKeyInfo("UNIT_TEST");
    expect(unitInfo.keyMode).toBe("DEDICATED");
    expect(unitInfo.resolvedKey).toBe("AIzaSyDedicatedUnitTestKey123456");

    const e2eInfo = resolveChannelKeyInfo("E2E_TEST");
    expect(e2eInfo.keyMode).toBe("FALLBACK");
    expect(e2eInfo.resolvedKey).toBe("AIzaSySharedFallbackKey999999");

    delete process.env.GEMINI_API_KEY;
    const chatInfo = resolveChannelKeyInfo("CHATBOX");
    expect(chatInfo.keyMode).toBe("UNCONFIGURED");
    expect(chatInfo.maskedKey).toBe("Not configured");
  });

  it("propagates channel context via AsyncLocalStorage withGeminiChannel", () => {
    expect(getCurrentGeminiChannel()).toBeNull();
    withGeminiChannel("UNIT_TEST", () => {
      expect(getCurrentGeminiChannel()).toBe("UNIT_TEST");
    });
    expect(getCurrentGeminiChannel()).toBeNull();
  });

  it("records token usage from provider usageMetadata and updates both channel and physical key counters", () => {
    const usage = recordGeminiTokenUsage({
      taskType: "unit",
      modelName: "gemini-3.5-flash-lite",
      usageMetadata: {
        promptTokenCount: 1500,
        candidatesTokenCount: 500,
        totalTokenCount: 2000,
      },
    });

    expect(usage.channelId).toBe("UNIT_TEST");
    expect(usage.totalTokens).toBe(2000);

    const snapshot = getAiQuotasSnapshot();
    const unitChannel = snapshot.channels.find((c) => c.channelId === "UNIT_TEST");
    expect(unitChannel.channelUsedTokens.inputTokens).toBe(1500);
    expect(unitChannel.channelUsedTokens.outputTokens).toBe(500);
    expect(unitChannel.channelUsedTokens.totalTokens).toBe(2000);
    expect(unitChannel.channelUsedTokens.requestCount).toBe(1);
    expect(unitChannel.lastModelUsed).toBe("gemini-3.5-flash-lite");
    expect(unitChannel.remainingTokens).toBe(1000000 - 2000);
  });

  it("provides safe character-based token estimation when usageMetadata is missing", () => {
    const promptText = "a".repeat(400); // 400 chars ~ 100 tokens
    const responseText = "b".repeat(200); // 200 chars ~ 50 tokens

    const usage = recordGeminiTokenUsage({
      taskType: "chatbox",
      modelName: "gemini-3.8-flash",
      usageMetadata: null, // provider omitted metadata
      promptText,
      responseText,
    });

    expect(usage.channelId).toBe("CHATBOX");
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.totalTokens).toBe(150);
  });

  it("correctly aggregates shared physical key pools when multiple channels run in FALLBACK mode", () => {
    // Both E2E_TEST and CHATBOX fall back to GEMINI_API_KEY
    recordGeminiTokenUsage({
      taskType: "e2e",
      usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 1000, totalTokenCount: 4000 },
    });

    recordGeminiTokenUsage({
      taskType: "chatbox",
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 },
    });

    const snapshot = getAiQuotasSnapshot();
    const e2eChannel = snapshot.channels.find((c) => c.channelId === "E2E_TEST");
    const chatChannel = snapshot.channels.find((c) => c.channelId === "CHATBOX");

    // Channel-specific consumption
    expect(e2eChannel.channelUsedTokens.totalTokens).toBe(4000);
    expect(chatChannel.channelUsedTokens.totalTokens).toBe(1500);

    // Shared physical key consumption equals the sum (4000 + 1500 = 5500)
    expect(e2eChannel.effectiveUsedTokens).toBe(5500);
    expect(chatChannel.effectiveUsedTokens).toBe(5500);
    expect(e2eChannel.remainingTokens).toBe(1000000 - 5500);
    expect(chatChannel.remainingTokens).toBe(1000000 - 5500);
    expect(e2eChannel.sharedWithChannels).toContain("CHATBOX");
    expect(chatChannel.sharedWithChannels).toContain("E2E_TEST");
  });

  it("records rate-limit flags and calculates RATE_LIMITED status", () => {
    recordGeminiRateLimit({
      taskType: "e2e",
      modelName: "gemini-3.5-flash-lite",
      error: { message: "Resource has been exhausted (e.g. check quota)." },
    });

    const snapshot = getAiQuotasSnapshot();
    const e2eChannel = snapshot.channels.find((c) => c.channelId === "E2E_TEST");
    expect(e2eChannel.status).toBe("RATE_LIMITED");
    expect(e2eChannel.last429At).toBeDefined();
  });

  it("resets token usage counters for a specific channel or all channels", () => {
    recordGeminiTokenUsage({
      taskType: "unit",
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, totalTokenCount: 1500 },
    });
    recordGeminiTokenUsage({
      taskType: "integration",
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 1000, totalTokenCount: 3000 },
    });

    // Reset only unit test
    const afterUnitReset = resetAiQuotas("UNIT_TEST");
    expect(afterUnitReset.channels.find((c) => c.channelId === "UNIT_TEST").channelUsedTokens.totalTokens).toBe(0);
    expect(afterUnitReset.channels.find((c) => c.channelId === "INTEGRATION_TEST").channelUsedTokens.totalTokens).toBe(3000);

    // Reset all
    const afterAllReset = resetAiQuotas(null);
    expect(afterAllReset.channels.find((c) => c.channelId === "INTEGRATION_TEST").channelUsedTokens.totalTokens).toBe(0);
  });

  it("allows updating channel quota limit within valid range", () => {
    const updated = updateQuotaLimit("UNIT_TEST", 2500000);
    const unitChannel = updated.channels.find((c) => c.channelId === "UNIT_TEST");
    expect(unitChannel.quotaLimit).toBe(2500000);

    expect(() => updateQuotaLimit("UNIT_TEST", 500)).toThrow(); // Below 10,000
    expect(() => updateQuotaLimit("UNIT_TEST", 200000000)).toThrow(); // Above 100,000,000
  });
});
