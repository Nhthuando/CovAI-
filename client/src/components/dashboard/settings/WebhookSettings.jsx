import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Webhook, Copy, Check, AlertCircle, Loader2 } from "lucide-react";
import {
  enableWebhookApi,
  disableWebhookApi,
  getWebhookConfigApi,
  updateWebhookBranchApi,
} from "../../../services/webhook.service.js";
import { useToast } from "../ToastContext.js";

export default function WebhookSettings({ projectId }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("main");
  const { showToast } = useToast();

  useEffect(() => {
    const fetchWebhookConfig = async () => {
      try {
        setLoading(true);
        const response = await getWebhookConfigApi(projectId);
        setConfig(response.config);
        setSelectedBranch(response.config.webhookBranch || "main");
      } catch (error) {
        console.error("[WebhookSettings] Error fetching config:", error);
        setConfig(null);
      } finally {
        setLoading(false);
      }
    };

    fetchWebhookConfig();
  }, [projectId]);

  const handleEnableWebhook = async () => {
    try {
      setEnabling(true);
      const response = await enableWebhookApi(projectId, selectedBranch);

      showToast({
        type: "success",
        title: "Webhook Enabled",
        message: "GitHub webhook is now active for automatic analysis.",
      });

      setConfig({
        ...config,
        webhookEnabled: true,
        webhookUrl: response.webhookUrl,
      });

      // Copy secret to clipboard
      if (response.secret) {
        navigator.clipboard.writeText(response.secret);
        showToast({
          type: "info",
          title: "Secret Copied",
          message:
            "Webhook secret has been copied to clipboard. Use this in GitHub webhook setup.",
        });
      }
    } catch (error) {
      showToast({
        type: "error",
        title: "Failed to Enable Webhook",
        message: error.message || "An error occurred while enabling webhook.",
      });
    } finally {
      setEnabling(false);
    }
  };

  const handleDisableWebhook = async () => {
    if (!window.confirm("Are you sure you want to disable the webhook?"))
      return;

    try {
      setDisabling(true);
      await disableWebhookApi(projectId);

      showToast({
        type: "success",
        title: "Webhook Disabled",
        message: "GitHub webhook has been disabled.",
      });

      setConfig({
        ...config,
        webhookEnabled: false,
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "Failed to Disable Webhook",
        message: error.message || "An error occurred while disabling webhook.",
      });
    } finally {
      setDisabling(false);
    }
  };

  const handleBranchUpdate = async (newBranch) => {
    try {
      setSelectedBranch(newBranch);
      await updateWebhookBranchApi(projectId, newBranch);

      showToast({
        type: "success",
        title: "Branch Updated",
        message: `Webhook is now tracking the '${newBranch}' branch.`,
      });

      setConfig({
        ...config,
        webhookBranch: newBranch,
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "Failed to Update Branch",
        message: error.message || "An error occurred while updating branch.",
      });
      setSelectedBranch(config?.webhookBranch || "main");
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "896px", padding: "24px" }}>
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "24px",
            fontWeight: 600,
            color: "#e6edf3",
            marginBottom: "8px",
          }}
        >
          GitHub Webhook Integration
        </h1>
        <p style={{ color: "#8b949e", marginBottom: "0" }}>
          Automatically trigger analysis when code is pushed to GitHub.
        </p>
      </div>

      {/* Main Settings Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "12px",
          padding: "24px",
          marginBottom: "24px",
        }}
      >
        {/* Webhook Status */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
            paddingBottom: "24px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                background: "rgba(124,58,237,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(124,58,237,0.3)",
              }}
            >
              <Webhook size={24} style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "#e6edf3",
                  margin: "0 0 4px 0",
                }}
              >
                Automatic Analysis on Push
              </h3>
              <p
                style={{
                  fontSize: "13px",
                  color: "#8b949e",
                  margin: 0,
                }}
              >
                {config?.webhookEnabled
                  ? `Enabled on branch: ${config?.webhookBranch || "main"}`
                  : "Not enabled"}
              </p>
            </div>
          </div>

          <button
            onClick={
              config?.webhookEnabled
                ? handleDisableWebhook
                : handleEnableWebhook
            }
            disabled={enabling || disabling}
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: config?.webhookEnabled
                ? "rgba(239, 68, 68, 0.1)"
                : "rgba(124,58,237,0.1)",
              color: config?.webhookEnabled ? "#ef4444" : "#a78bfa",
              fontSize: "13px",
              fontWeight: 500,
              cursor: enabling || disabling ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              opacity: enabling || disabling ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!enabling && !disabling) {
                e.target.style.background = config?.webhookEnabled
                  ? "rgba(239, 68, 68, 0.2)"
                  : "rgba(124,58,237,0.2)";
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.background = config?.webhookEnabled
                ? "rgba(239, 68, 68, 0.1)"
                : "rgba(124,58,237,0.1)";
            }}
          >
            {enabling || disabling ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            {enabling
              ? "Enabling..."
              : disabling
                ? "Disabling..."
                : config?.webhookEnabled
                  ? "Disable"
                  : "Enable"}
          </button>
        </div>

        {/* Webhook Details */}
        {config?.webhookEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            style={{ display: "flex", flexDirection: "column", gap: "20px" }}
          >
            {/* Webhook URL */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#8b949e",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Webhook URL
              </label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <input
                  type="text"
                  readOnly
                  value={config?.webhookUrl || ""}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.02)",
                    color: "#8b949e",
                    fontSize: "12px",
                    fontFamily: "monospace",
                  }}
                />
                <button
                  onClick={() => copyToClipboard(config?.webhookUrl || "")}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.02)",
                    color: copySuccess ? "#3fb950" : "#8b949e",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = "rgba(255,255,255,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = "rgba(255,255,255,0.02)";
                  }}
                >
                  {copySuccess ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {/* Branch Selection */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#8b949e",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Tracked Branch
              </label>
              <select
                value={selectedBranch}
                onChange={(e) => handleBranchUpdate(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  color: "#e6edf3",
                  fontSize: "13px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <option value="main">main</option>
                <option value="master">master</option>
                <option value="develop">develop</option>
                <option value="dev">dev</option>
              </select>
            </div>

            {/* Last Analyzed Commit */}
            {config?.lastAnalyzedCommit && (
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#8b949e",
                    marginBottom: "8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Last Analyzed Commit
                </label>
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#8b949e",
                    fontSize: "12px",
                    fontFamily: "monospace",
                  }}
                >
                  {config.lastAnalyzedCommit.substring(0, 12)}
                </div>
              </div>
            )}

            {/* Info Box */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                padding: "12px 16px",
                borderRadius: "8px",
                background: "rgba(59, 130, 246, 0.05)",
                border: "1px solid rgba(59, 130, 246, 0.2)",
              }}
            >
              <AlertCircle
                size={16}
                style={{ color: "#3b82f6", flexShrink: 0, marginTop: "2px" }}
              />
              <p
                style={{
                  fontSize: "12px",
                  color: "#6b7280",
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                When enabled, every push to the selected branch will
                automatically trigger code analysis. Analysis results and
                coverage reports will be updated in real-time.
              </p>
            </div>
          </motion.div>
        )}

        {/* Setup Instructions */}
        {!config?.webhookEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "12px",
                padding: "12px 16px",
                borderRadius: "8px",
                background: "rgba(107, 114, 128, 0.05)",
                border: "1px solid rgba(107, 114, 128, 0.2)",
              }}
            >
              <AlertCircle
                size={16}
                style={{ color: "#6b7280", flexShrink: 0, marginTop: "2px" }}
              />
              <p
                style={{
                  fontSize: "12px",
                  color: "#6b7280",
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                Enable webhook to automatically analyze your code whenever you
                push to GitHub. Click the enable button above to get started.
              </p>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
