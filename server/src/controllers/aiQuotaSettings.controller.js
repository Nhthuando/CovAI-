import {
  getAiQuotasSnapshot,
  resetAiQuotas,
  updateQuotaLimit,
} from "../services/geminiTokenTracker.service.js";

export const getAiQuotas = async (req, res) => {
  try {
    const snapshot = getAiQuotasSnapshot();
    return res.status(200).json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    console.error("[aiQuotaSettings] Error fetching AI quotas:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to retrieve AI quota status.",
    });
  }
};

export const resetAiQuotasEndpoint = async (req, res) => {
  try {
    const { channelId } = req.body || {};
    const snapshot = resetAiQuotas(channelId || null);
    return res.status(200).json({
      success: true,
      message: channelId
        ? `Token usage counters reset for channel ${channelId}.`
        : "Token usage counters reset for all Gemini channels.",
      data: snapshot,
    });
  } catch (error) {
    console.error("[aiQuotaSettings] Error resetting AI quotas:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to reset AI quota counters.",
    });
  }
};

export const updateAiQuotaLimitEndpoint = async (req, res) => {
  try {
    const { channelId, quotaLimit } = req.body || {};
    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "channelId is required.",
      });
    }
    const limitNum = Number(quotaLimit);
    if (!Number.isFinite(limitNum) || limitNum < 10_000 || limitNum > 100_000_000) {
      return res.status(400).json({
        success: false,
        message: "quotaLimit must be a number between 10,000 and 100,000,000 tokens.",
      });
    }

    const snapshot = updateQuotaLimit(channelId, limitNum);
    return res.status(200).json({
      success: true,
      message: `Quota limit updated for channel ${channelId}.`,
      data: snapshot,
    });
  } catch (error) {
    console.error("[aiQuotaSettings] Error updating quota limit:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update quota limit.",
    });
  }
};

