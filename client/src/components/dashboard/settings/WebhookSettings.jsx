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
          message: "Webhook secret has been copied to clipboard.",
        });
      }
    } catch (error) {
      console.error("[WebhookSettings] Error enabling webhook:", error);
      showToast({
        type: "error",
        title: "Enable Failed",
        message: error.message || "Failed to enable webhook",
      });
    } finally {
      setEnabling(false);
    }
  };

  const handleDisableWebhook = async () => {
    try {
      setDisabling(true);
      await disableWebhookApi(projectId);

      showToast({
        type: "success",
        title: "Webhook Disabled",
        message: "GitHub webhook has been deactivated.",
      });

      setConfig({
        ...config,
        webhookEnabled: false,
      });
    } catch (error) {
      console.error("[WebhookSettings] Error disabling webhook:", error);
      showToast({
        type: "error",
        title: "Disable Failed",
        message: error.message || "Failed to disable webhook",
      });
    } finally {
      setDisabling(false);
    }
  };

  const handleBranchUpdate = async (branch) => {
    try {
      await updateWebhookBranchApi(projectId, branch);
      setSelectedBranch(branch);

      showToast({
        type: "success",
        title: "Branch Updated",
        message: `Now tracking '${branch}' branch for automatic analysis.`,
      });

      setConfig({
        ...config,
        webhookBranch: branch,
      });
    } catch (error) {
      console.error("[WebhookSettings] Error updating branch:", error);
      showToast({
        type: "error",
        title: "Update Failed",
        message: error.message || "Failed to update tracked branch",
      });
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(true);
    showToast({
      type: "info",
      title: "Copied",
      message: "Webhook URL copied to clipboard",
    });
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-[var(--color-text-secondary)] font-sans">
        <Loader2
          size={20}
          className="animate-spin text-[var(--color-primary)] mr-2"
        />
        <span className="text-xs">Loading webhook configuration...</span>
      </div>
    );
  }

  return (
    <div className="max-w-[920px] p-6 sm:p-8 font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-[var(--color-text)] mb-1.5 flex items-center gap-2.5">
          <Webhook size={20} className="text-[var(--color-primary)]" />
          GitHub Webhook Integration
        </h1>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Automatically trigger analysis and coverage calculations when code is
          pushed to GitHub.
        </p>
      </div>

      {/* Main Settings Card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6 mb-6"
      >
        {/* Webhook Status */}
        <div className="flex justify-between items-center pb-6 border-b border-[var(--color-border)] mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
              <Webhook size={20} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Automatic Analysis on Push
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {config?.webhookEnabled
                  ? `Enabled on branch: ${config?.webhookBranch || "main"}`
                  : "Not enabled"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={
              config?.webhookEnabled
                ? handleDisableWebhook
                : handleEnableWebhook
            }
            disabled={enabling || disabling}
            className={`px-4 py-2 rounded-[var(--radius-md)] text-xs font-semibold cursor-pointer border transition-colors flex items-center gap-2 ${
              enabling || disabling ? "opacity-60 cursor-not-allowed" : ""
            } ${
              config?.webhookEnabled
                ? "bg-[var(--color-danger)]/10 border-[var(--color-danger)]/25 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20"
                : "bg-[var(--color-primary)] border-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] shadow-xs"
            }`}
          >
            {enabling || disabling ? (
              <Loader2 size={13} className="animate-spin" />
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
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-4"
          >
            {/* Webhook URL */}
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                Webhook URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={config?.webhookUrl || ""}
                  className="flex-1 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-xs font-mono select-all focus:outline-none focus:border-[var(--color-primary)]"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(config?.webhookUrl || "")}
                  title="Copy URL"
                  aria-label="Copy URL"
                  className="p-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer flex items-center justify-center"
                >
                  {copySuccess ? (
                    <Check size={14} className="text-[var(--color-success)]" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>

            {/* Branch Selection */}
            <div>
              <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                Tracked Branch
              </label>
              <select
                value={selectedBranch}
                onChange={(e) => handleBranchUpdate(e.target.value)}
                className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-xs cursor-pointer focus:outline-none focus:border-[var(--color-primary)] font-mono"
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
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                  Last Analyzed Commit
                </label>
                <div className="px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-secondary)] text-xs font-mono">
                  {config.lastAnalyzedCommit.substring(0, 12)}
                </div>
              </div>
            )}

            {/* Info Box */}
            <div className="flex gap-2.5 p-3.5 rounded-[var(--radius-md)] bg-[var(--color-info)]/10 border border-[var(--color-info)]/20 text-[var(--color-info)] text-xs">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <p className="leading-relaxed opacity-90 m-0">
                When enabled, every push to the selected branch will
                automatically trigger code analysis. Analysis results and
                coverage reports will update in real time.
              </p>
            </div>
          </motion.div>
        )}

        {/* Setup Instructions */}
        {!config?.webhookEnabled && (
          <div className="flex gap-2.5 p-3.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
            <AlertCircle
              size={15}
              className="shrink-0 mt-0.5 text-[var(--color-text-muted)]"
            />
            <p className="leading-relaxed m-0">
              Enable webhook to automatically analyze your code whenever you
              push to GitHub. Click the enable button above to get started.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
