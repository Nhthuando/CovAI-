import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { nextMidnight } from "../utils/geminiQuota.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../.covai-data");
const isTestEnv = process.env.NODE_ENV === "test" || Boolean(process.env.JEST_WORKER_ID);
const DATA_FILE = path.join(
  DATA_DIR,
  isTestEnv ? "gemini-token-quotas.test.json" : "gemini-token-quotas.json"
);

const channelStorage = new AsyncLocalStorage();

export const GEMINI_CHANNELS = [
  {
    channelId: "UNIT_TEST",
    label: "Unit Test Generation",
    description: "Jest / Vitest unit test generation, input repair & code analysis",
    envVarName: "GEMINI_KEY_UNIT_TEST",
    aliases: ["unit", "unit-test"],
  },
  {
    channelId: "INTEGRATION_TEST",
    label: "Integration Test Engine",
    description: "Supertest / integration scenario generation & endpoint tests",
    envVarName: "GEMINI_KEY_INTEGRATION_TEST",
    aliases: ["integration", "integration-test", "supertest"],
  },
  {
    channelId: "E2E_TEST",
    label: "System / E2E Test Engine",
    description: "Playwright / Cypress system test synthesis & test booster",
    envVarName: "GEMINI_KEY_E2E_TEST",
    aliases: ["e2e", "system", "system-test"],
  },
  {
    channelId: "CHATBOX",
    label: "COV AI Chatbox",
    description: "Project assistant, context memory & semantic judge evaluation",
    envVarName: "GEMINI_KEY_CHATBOX",
    aliases: ["chatbox", "chat"],
  },
];

const ALIAS_MAP = {
  unit: "UNIT_TEST",
  "unit-test": "UNIT_TEST",
  unit_test: "UNIT_TEST",
  integration: "INTEGRATION_TEST",
  "integration-test": "INTEGRATION_TEST",
  integration_test: "INTEGRATION_TEST",
  supertest: "INTEGRATION_TEST",
  e2e: "E2E_TEST",
  system: "E2E_TEST",
  "system-test": "E2E_TEST",
  system_test: "E2E_TEST",
  e2e_test: "E2E_TEST",
  chatbox: "CHATBOX",
  chat: "CHATBOX",
};

export const normalizeChannelId = (channelOrTask) => {
  if (!channelOrTask) return "INTEGRATION_TEST";
  const str = String(channelOrTask).trim().toLowerCase();
  if (ALIAS_MAP[str]) return ALIAS_MAP[str];
  const upper = String(channelOrTask).trim().toUpperCase();
  if (GEMINI_CHANNELS.some((c) => c.channelId === upper)) return upper;
  return "INTEGRATION_TEST";
};

export const withGeminiChannel = (channelId, callback) => {
  const normalized = normalizeChannelId(channelId);
  return channelStorage.run(normalized, callback);
};

export const getCurrentGeminiChannel = () => {
  return channelStorage.getStore() || null;
};

export const fingerprintKey = (rawKey) => {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) return "unconfigured";
  return crypto.createHash("sha256").update(rawKey.trim()).digest("hex").slice(0, 16);
};

export const maskApiKey = (rawKey) => {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.trim()) return "Not configured";
  const trimmed = rawKey.trim();
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

export const getTodayDateString = (now = new Date()) => {
  const timeZone = process.env.AI_QUOTA_TIMEZONE || "Asia/Ho_Chi_Minh";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
};

const getDefaultQuotaLimit = () => {
  const parsed = Number(process.env.GEMINI_DEFAULT_TOKEN_QUOTA);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_000_000;
};

const createDefaultUsage = () => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  lastUsedAt: null,
  lastModelUsed: null,
  last429At: null,
  rateLimitedUntil: null,
  lastError: null,
});

let inMemoryState = null;

const ensureDataDir = () => {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn("[geminiTokenTracker] Unable to create data dir:", err.message);
  }
};

const loadState = () => {
  ensureDataDir();
  const today = getTodayDateString();
  const defaultLimit = getDefaultQuotaLimit();

  const defaultState = {
    usageDate: today,
    limits: {
      UNIT_TEST: defaultLimit,
      INTEGRATION_TEST: defaultLimit,
      E2E_TEST: defaultLimit,
      CHATBOX: defaultLimit,
    },
    channels: {
      UNIT_TEST: createDefaultUsage(),
      INTEGRATION_TEST: createDefaultUsage(),
      E2E_TEST: createDefaultUsage(),
      CHATBOX: createDefaultUsage(),
    },
    keys: {},
  };

  if (!fs.existsSync(DATA_FILE)) {
    inMemoryState = defaultState;
    saveState();
    return inMemoryState;
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    inMemoryState = {
      usageDate: parsed.usageDate || today,
      limits: { ...defaultState.limits, ...(parsed.limits || {}) },
      channels: {
        UNIT_TEST: { ...createDefaultUsage(), ...(parsed.channels?.UNIT_TEST || {}) },
        INTEGRATION_TEST: { ...createDefaultUsage(), ...(parsed.channels?.INTEGRATION_TEST || {}) },
        E2E_TEST: { ...createDefaultUsage(), ...(parsed.channels?.E2E_TEST || {}) },
        CHATBOX: { ...createDefaultUsage(), ...(parsed.channels?.CHATBOX || {}) },
      },
      keys: parsed.keys || {},
    };

    // Daily rollover
    if (inMemoryState.usageDate !== today) {
      inMemoryState.usageDate = today;
      for (const chId of Object.keys(inMemoryState.channels)) {
        const prev = inMemoryState.channels[chId];
        inMemoryState.channels[chId] = {
          ...createDefaultUsage(),
          lastUsedAt: prev.lastUsedAt,
          lastModelUsed: prev.lastModelUsed,
        };
      }
      for (const keyFp of Object.keys(inMemoryState.keys)) {
        const prev = inMemoryState.keys[keyFp];
        inMemoryState.keys[keyFp] = {
          ...createDefaultUsage(),
          quotaLimit: prev.quotaLimit || defaultLimit,
          lastUsedAt: prev.lastUsedAt,
        };
      }
      saveState();
    }
  } catch (err) {
    console.warn("[geminiTokenTracker] Error reading state file, re-initializing:", err.message);
    inMemoryState = defaultState;
  }

  return inMemoryState;
};

const saveState = () => {
  if (!inMemoryState) return;
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(inMemoryState, null, 2), "utf-8");
  } catch (err) {
    console.warn("[geminiTokenTracker] Failed to write token state to disk:", err.message);
  }
};

const getOrInitState = () => {
  if (!inMemoryState) {
    return loadState();
  }
  const today = getTodayDateString();
  if (inMemoryState.usageDate !== today) {
    return loadState();
  }
  return inMemoryState;
};

export const resolveChannelKeyInfo = (channelId) => {
  const normId = normalizeChannelId(channelId);
  const descriptor = GEMINI_CHANNELS.find((c) => c.channelId === normId);
  const envVarName = descriptor?.envVarName || "GEMINI_KEY_INTEGRATION_TEST";
  const dedicated = process.env[envVarName]?.trim() || "";
  const fallback = process.env.GEMINI_API_KEY?.trim() || "";

  if (dedicated) {
    return {
      channelId: normId,
      envVarName,
      keyMode: "DEDICATED",
      resolvedKey: dedicated,
      maskedKey: maskApiKey(dedicated),
      keyFingerprint: fingerprintKey(dedicated),
    };
  }

  if (fallback) {
    return {
      channelId: normId,
      envVarName,
      keyMode: "FALLBACK",
      resolvedKey: fallback,
      maskedKey: maskApiKey(fallback),
      keyFingerprint: fingerprintKey(fallback),
    };
  }

  return {
    channelId: normId,
    envVarName,
    keyMode: "UNCONFIGURED",
    resolvedKey: "",
    maskedKey: "Not configured",
    keyFingerprint: "unconfigured",
  };
};

export const emitAiQuotasUpdated = () => {
  try {
    if (global.io && typeof global.io.emit === "function") {
      const snapshot = getAiQuotasSnapshot();
      global.io.emit("ai_quotas:updated", snapshot);
    }
  } catch (err) {
    console.warn("[geminiTokenTracker] Failed to emit ai_quotas:updated via WebSocket:", err.message);
  }
};

export const recordGeminiTokenUsage = ({
  taskType,
  apiKey,
  modelName,
  usageMetadata,
  promptText,
  responseText,
}) => {
  const channelId = normalizeChannelId(taskType || getCurrentGeminiChannel() || "INTEGRATION_TEST");
  const keyInfo = resolveChannelKeyInfo(channelId);
  const resolvedKey = apiKey || keyInfo.resolvedKey;
  const keyFp = fingerprintKey(resolvedKey);

  let inputTokens = usageMetadata?.promptTokenCount;
  let outputTokens = usageMetadata?.candidatesTokenCount;
  let totalTokens = usageMetadata?.totalTokenCount;

  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    const promptLen = String(promptText || "").length;
    const respLen = String(responseText || "").length;
    inputTokens = Math.max(1, Math.ceil(promptLen / 4));
    outputTokens = Math.max(1, Math.ceil(respLen / 4));
    totalTokens = inputTokens + outputTokens;
  } else {
    inputTokens = Number.isFinite(inputTokens) ? inputTokens : 0;
    outputTokens = Number.isFinite(outputTokens) ? outputTokens : 0;
  }

  const state = getOrInitState();
  const nowIso = new Date().toISOString();

  // Update channel usage
  if (!state.channels[channelId]) state.channels[channelId] = createDefaultUsage();
  const ch = state.channels[channelId];
  ch.inputTokens += inputTokens;
  ch.outputTokens += outputTokens;
  ch.totalTokens += totalTokens;
  ch.requestCount += 1;
  ch.lastUsedAt = nowIso;
  if (modelName) ch.lastModelUsed = modelName;
  ch.rateLimitedUntil = null;

  // Update physical key usage
  if (!state.keys[keyFp]) {
    state.keys[keyFp] = {
      ...createDefaultUsage(),
      quotaLimit: state.limits[channelId] || getDefaultQuotaLimit(),
    };
  }
  const k = state.keys[keyFp];
  k.inputTokens += inputTokens;
  k.outputTokens += outputTokens;
  k.totalTokens += totalTokens;
  k.requestCount += 1;
  k.lastUsedAt = nowIso;
  k.rateLimitedUntil = null;

  saveState();
  emitAiQuotasUpdated();

  return {
    channelId,
    keyFingerprint: keyFp,
    inputTokens,
    outputTokens,
    totalTokens,
  };
};

export const recordGeminiRateLimit = ({
  taskType,
  apiKey,
  modelName,
  error,
}) => {
  const channelId = normalizeChannelId(taskType || getCurrentGeminiChannel() || "INTEGRATION_TEST");
  const keyInfo = resolveChannelKeyInfo(channelId);
  const resolvedKey = apiKey || keyInfo.resolvedKey;
  const keyFp = fingerprintKey(resolvedKey);
  const state = getOrInitState();
  const nowIso = new Date().toISOString();

  const retrySeconds = String(error?.message || "").match(/retry in ([\d.]+)s/i)?.[1];
  let rateLimitedUntil = null;
  if (error?.resetAt) {
    rateLimitedUntil = error.resetAt;
  } else if (error?.retryAt) {
    rateLimitedUntil = error.retryAt;
  } else if (retrySeconds) {
    rateLimitedUntil = new Date(Date.now() + (Number(retrySeconds) + 1) * 1000).toISOString();
  } else {
    rateLimitedUntil = new Date(Date.now() + 60 * 1000).toISOString();
  }

  const errMsg = error?.message || "Rate limit / Quota exceeded";

  if (!state.channels[channelId]) state.channels[channelId] = createDefaultUsage();
  const ch = state.channels[channelId];
  ch.last429At = nowIso;
  ch.rateLimitedUntil = rateLimitedUntil;
  ch.lastError = errMsg;

  if (!state.keys[keyFp]) {
    state.keys[keyFp] = {
      ...createDefaultUsage(),
      quotaLimit: state.limits[channelId] || getDefaultQuotaLimit(),
    };
  }
  const k = state.keys[keyFp];
  k.last429At = nowIso;
  k.rateLimitedUntil = rateLimitedUntil;
  k.lastError = errMsg;

  saveState();
  emitAiQuotasUpdated();
};

export const getAiQuotasSnapshot = () => {
  const state = getOrInitState();
  const timeZone = process.env.AI_QUOTA_TIMEZONE || "Asia/Ho_Chi_Minh";
  const defaultLimit = getDefaultQuotaLimit();
  const defaultKey = process.env.GEMINI_API_KEY?.trim() || "";
  const defaultKeyConfigured = Boolean(defaultKey);
  const defaultMaskedKey = maskApiKey(defaultKey);
  const now = Date.now();

  const channelKeyMap = {};
  for (const descriptor of GEMINI_CHANNELS) {
    channelKeyMap[descriptor.channelId] = resolveChannelKeyInfo(descriptor.channelId);
  }

  // Calculate channels
  const channels = GEMINI_CHANNELS.map((descriptor) => {
    const chId = descriptor.channelId;
    const info = channelKeyMap[chId];
    const keyFp = info.keyFingerprint;

    // Find other channels sharing this key
    const sharedWithChannels = GEMINI_CHANNELS.filter(
      (other) =>
        other.channelId !== chId &&
        channelKeyMap[other.channelId]?.resolvedKey &&
        channelKeyMap[other.channelId]?.resolvedKey === info.resolvedKey
    ).map((other) => other.channelId);

    const channelUsage = state.channels[chId] || createDefaultUsage();
    const quotaLimit =
      (sharedWithChannels.length > 0 && state.keys[keyFp]?.quotaLimit) ||
      state.limits[chId] ||
      (state.keys[keyFp]?.quotaLimit) ||
      defaultLimit;

    const effectiveUsedTokens =
      info.keyMode === "UNCONFIGURED"
        ? 0
        : sharedWithChannels.length > 0 && state.keys[keyFp]
        ? state.keys[keyFp].totalTokens
        : channelUsage.totalTokens;

    const remainingTokens = Math.max(0, quotaLimit - effectiveUsedTokens);
    const usagePercent = quotaLimit > 0
      ? Math.min(100, Number(((effectiveUsedTokens / quotaLimit) * 100).toFixed(1)))
      : 0;

    const isRateLimited =
      (channelUsage.rateLimitedUntil && Date.parse(channelUsage.rateLimitedUntil) > now) ||
      (state.keys[keyFp]?.rateLimitedUntil && Date.parse(state.keys[keyFp].rateLimitedUntil) > now) ||
      (info.keyMode !== "UNCONFIGURED" && remainingTokens <= 0);

    let status = "ACTIVE";
    if (info.keyMode === "UNCONFIGURED") {
      status = "MISSING_KEY";
    } else if (isRateLimited) {
      status = "RATE_LIMITED";
    } else if (info.keyMode === "FALLBACK" || usagePercent >= 80) {
      status = "WARNING";
    } else {
      status = "ACTIVE";
    }

    return {
      channelId: chId,
      label: descriptor.label,
      description: descriptor.description,
      envVarName: descriptor.envVarName,
      keyMode: info.keyMode,
      maskedKey: info.maskedKey,
      sharedWithChannels,
      quotaLimit,
      channelUsedTokens: {
        inputTokens: channelUsage.inputTokens,
        outputTokens: channelUsage.outputTokens,
        totalTokens: channelUsage.totalTokens,
        requestCount: channelUsage.requestCount,
      },
      effectiveUsedTokens,
      remainingTokens,
      usagePercent,
      status,
      lastUsedAt: channelUsage.lastUsedAt,
      lastModelUsed: channelUsage.lastModelUsed,
      last429At: channelUsage.last429At,
    };
  });

  // Calculate unique physical keys for summary
  const distinctKeyFingerprints = new Set();
  let totalQuotaPool = 0;
  let totalEffectiveUsedTokens = 0;

  for (const ch of channels) {
    const info = channelKeyMap[ch.channelId];
    if (info.keyMode !== "UNCONFIGURED" && !distinctKeyFingerprints.has(info.keyFingerprint)) {
      distinctKeyFingerprints.add(info.keyFingerprint);
      const keyUsage = state.keys[info.keyFingerprint];
      const keyLimit = ch.quotaLimit || defaultLimit;
      totalQuotaPool += keyLimit;
      totalEffectiveUsedTokens += keyUsage ? keyUsage.totalTokens : 0;
    }
  }

  const totalRemainingTokens = Math.max(0, totalQuotaPool - totalEffectiveUsedTokens);
  const totalRequests = channels.reduce((sum, ch) => sum + ch.channelUsedTokens.requestCount, 0);
  const fallbackChannelsCount = channels.filter((ch) => ch.keyMode === "FALLBACK").length;

  return {
    summary: {
      usageDate: state.usageDate,
      timeZone,
      nextResetAt: nextMidnight(timeZone).toISOString(),
      defaultKeyConfigured,
      defaultMaskedKey,
      totalDistinctActiveKeys: distinctKeyFingerprints.size,
      totalQuotaPool,
      totalEffectiveUsedTokens,
      totalRemainingTokens,
      totalRequests,
      fallbackChannelsCount,
      hasFallbackWarning: fallbackChannelsCount > 0,
    },
    channels,
  };
};

export const resetAiQuotas = (targetChannelId = null, resetLimits = false) => {
  const state = getOrInitState();
  const defaultLimit = getDefaultQuotaLimit();

  if (resetLimits) {
    for (const descriptor of GEMINI_CHANNELS) {
      state.limits[descriptor.channelId] = defaultLimit;
    }
  }

  if (targetChannelId && targetChannelId !== "ALL") {
    const chId = normalizeChannelId(targetChannelId);
    const keyInfo = resolveChannelKeyInfo(chId);
    const keyFp = keyInfo.keyFingerprint;
    const oldChannelTokens = state.channels[chId]?.totalTokens || 0;

    state.channels[chId] = createDefaultUsage();

    if (state.keys[keyFp]) {
      // If shared with other channels, decrement this channel's tokens; else reset key
      const otherShares = GEMINI_CHANNELS.filter(
        (c) => c.channelId !== chId && resolveChannelKeyInfo(c.channelId).keyFingerprint === keyFp
      );
      if (otherShares.length === 0) {
        state.keys[keyFp] = {
          ...createDefaultUsage(),
          quotaLimit: state.keys[keyFp].quotaLimit || defaultLimit,
        };
      } else {
        state.keys[keyFp].totalTokens = Math.max(0, (state.keys[keyFp].totalTokens || 0) - oldChannelTokens);
        state.keys[keyFp].rateLimitedUntil = null;
      }
    }
  } else {
    // Reset all
    for (const descriptor of GEMINI_CHANNELS) {
      state.channels[descriptor.channelId] = createDefaultUsage();
    }
    for (const keyFp of Object.keys(state.keys)) {
      state.keys[keyFp] = {
        ...createDefaultUsage(),
        quotaLimit: state.keys[keyFp]?.quotaLimit || defaultLimit,
      };
    }
  }

  saveState();
  emitAiQuotasUpdated();
  return getAiQuotasSnapshot();
};

export const updateQuotaLimit = (channelId, rawLimit) => {
  const chId = normalizeChannelId(channelId);
  const quotaLimit = Number(rawLimit);
  if (!Number.isFinite(quotaLimit) || quotaLimit < 10_000 || quotaLimit > 100_000_000) {
    throw new Error("Quota limit must be a number between 10,000 and 100,000,000 tokens.");
  }

  const state = getOrInitState();
  state.limits[chId] = quotaLimit;

  const keyInfo = resolveChannelKeyInfo(chId);
  if (keyInfo.keyFingerprint && keyInfo.keyFingerprint !== "unconfigured") {
    if (!state.keys[keyInfo.keyFingerprint]) {
      state.keys[keyInfo.keyFingerprint] = {
        ...createDefaultUsage(),
        quotaLimit,
      };
    } else {
      state.keys[keyInfo.keyFingerprint].quotaLimit = quotaLimit;
    }

    // Sync all channels sharing this key fingerprint
    for (const descriptor of GEMINI_CHANNELS) {
      const otherInfo = resolveChannelKeyInfo(descriptor.channelId);
      if (otherInfo.keyFingerprint === keyInfo.keyFingerprint) {
        state.limits[descriptor.channelId] = quotaLimit;
      }
    }
  }

  saveState();
  emitAiQuotasUpdated();
  return getAiQuotasSnapshot();
};
