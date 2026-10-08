import { useState, useEffect } from "react";
import {
  X,
  AlertOctagon,
  Code,
  Image,
  FileText,
  Wrench,
  Loader2,
  ExternalLink,
} from "lucide-react";
import Button from "../../common/Button.jsx";
import { getSystemTestEvidence } from "../../../services/systemTest.service.js";

export default function SystemTestBreakpointModal({
  isOpen,
  onClose,
  scenario,
  snapshotId,
  onOpenEditor,
}) {
  const [activeTab, setActiveTab] = useState("screenshot"); // "screenshot" | "dom"
  const [evidenceUrl, setEvidenceUrl] = useState(null);
  const [domData, setDomData] = useState(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState(null);

  useEffect(() => {
    if (!isOpen || !scenario || !snapshotId) return;

    let isMounted = true;
    let objectUrl = null;

    const loadEvidence = async () => {
      setLoadingEvidence(true);
      setEvidenceError(null);

      // Load Screenshot
      try {
        const blob = await getSystemTestEvidence(
          snapshotId,
          scenario.id,
          "image"
        );
        if (isMounted && blob) {
          objectUrl = URL.createObjectURL(blob);
          setEvidenceUrl(objectUrl);
        }
      } catch {
        if (isMounted) {
          setEvidenceError("Screenshot unavailable for this scenario");
        }
      }

      // Load DOM Snapshot if available
      try {
        const dom = await getSystemTestEvidence(
          snapshotId,
          scenario.id,
          "dom"
        );
        if (isMounted && dom) {
          setDomData(dom);
        }
      } catch {
        // DOM snapshot is optional
      } finally {
        if (isMounted) setLoadingEvidence(false);
      }
    };

    loadEvidence();

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isOpen, scenario, snapshotId]);

  if (!isOpen || !scenario) return null;

  const breakpoint = scenario.failureBreakpoint || {};
  const failureCategory =
    breakpoint.failureCategory || scenario.failureCategory || "EXECUTION_ERROR";
  const failureStep = breakpoint.failureStep || scenario.failureStep || null;
  const failureSnippet =
    breakpoint.failureCodeSnippet || scenario.failureCodeSnippet || null;
  const errorMessage =
    scenario.errorMessage || breakpoint.errorMessage || "Test step assertion failed or timed out.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
      <div className="w-full max-w-3xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/50">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 text-[var(--color-danger)] shrink-0">
              <AlertOctagon size={18} />
            </div>
            <div className="overflow-hidden">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/30 font-semibold uppercase tracking-wider">
                  {failureCategory}
                </span>
                <span className="text-xs text-[var(--color-text-muted)] font-mono truncate">
                  {scenario.testFile}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-[var(--color-text)] truncate mt-0.5">
                {scenario.title || scenario.name}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Failure Step box */}
          {failureStep && (
            <div>
              <label className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">
                Failing Test Step
              </label>
              <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-[12px] text-[var(--color-danger)] flex items-center gap-2 overflow-x-auto">
                <Code size={14} className="shrink-0 text-[var(--color-danger)]" />
                <span>{failureStep}</span>
              </div>
            </div>
          )}

          {/* Error Message */}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">
              Failure Reason & Stack
            </label>
            <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/5 border border-[var(--color-danger)]/20 text-[var(--color-danger)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-36">
              {errorMessage}
            </div>
          </div>

          {/* Code Snippet Highlight */}
          {failureSnippet && (
            <div>
              <label className="block text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">
                Code Context
              </label>
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)] overflow-x-auto max-h-48 border-l-4 border-l-[var(--color-danger)]">
                <pre className="m-0">{failureSnippet}</pre>
              </div>
            </div>
          )}

          {/* Evidence tabs */}
          <div>
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2 mb-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("screenshot")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] font-medium cursor-pointer transition-colors ${
                    activeTab === "screenshot"
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <Image size={13} />
                  <span>Failure Screenshot</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("dom")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] font-medium cursor-pointer transition-colors ${
                    activeTab === "dom"
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                  }`}
                >
                  <FileText size={13} />
                  <span>DOM Snapshot</span>
                </button>
              </div>
              {evidenceUrl && activeTab === "screenshot" && (
                <a
                  href={evidenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-[var(--color-primary)] hover:underline flex items-center gap-1"
                >
                  <span>Open Full Size</span>
                  <ExternalLink size={11} />
                </a>
              )}
            </div>

            {loadingEvidence ? (
              <div className="p-8 text-center text-[var(--color-text-muted)] flex flex-col items-center justify-center gap-2">
                <Loader2 size={20} className="animate-spin text-[var(--color-primary)]" />
                <span>Loading breakpoint evidence...</span>
              </div>
            ) : activeTab === "screenshot" ? (
              evidenceUrl ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden bg-black/40 flex items-center justify-center max-h-80">
                  <img
                    src={evidenceUrl}
                    alt={`Breakpoint for ${scenario.title}`}
                    className="max-w-full max-h-80 object-contain"
                  />
                </div>
              ) : (
                <div className="p-6 text-center text-[var(--color-text-muted)] italic border border-dashed border-[var(--color-border)] rounded-[var(--radius-md)]">
                  {evidenceError || "No screenshot available for this failure breakpoint."}
                </div>
              )
            ) : (
              <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px] overflow-x-auto max-h-64 text-[var(--color-text)]">
                {domData ? (
                  <pre className="m-0 whitespace-pre-wrap">
                    {typeof domData === "string" ? domData : JSON.stringify(domData, null, 2)}
                  </pre>
                ) : (
                  <div className="text-[var(--color-text-muted)] italic text-center py-4">
                    No DOM snapshot captured at this breakpoint.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-between">
          <div className="text-[11px] text-[var(--color-text-muted)]">
            Breakpoint ID: <span className="font-mono">{scenario.id || "N/A"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Wrench}
              onClick={() => {
                onClose();
                if (onOpenEditor) {
                  onOpenEditor({
                    filePath: scenario.testFile,
                    scenarioId: scenario.id,
                    initialMode: "FIX_BREAKPOINT",
                  });
                }
              }}
            >
              Fix in Editor
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

