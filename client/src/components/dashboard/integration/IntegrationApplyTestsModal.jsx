import React, { useEffect, useMemo, useState } from "react";
import {
  FileCode,
  Folder,
  CheckCircle2,
  Play,
  X,
  AlertCircle,
  HardDriveDownload,
  Check,
} from "lucide-react";
import { applyIntegrationTests } from "../../../services/coverage.service.js";

const DEFAULT_PRESETS = [
  { label: "tests/integration/api.test.js", dir: "tests/integration", file: "api.test.js" },
  { label: "tests/api/routes.test.js", dir: "tests/api", file: "routes.test.js" },
  { label: "__tests__/api.spec.js", dir: "__tests__", file: "api.spec.js" },
];

export default function IntegrationApplyTestsModal({
  isOpen,
  onClose,
  snapshotId,
  testIds = [],
  scenarios = [],
  initialSelectedKeys = null,
  defaultFilePath = "tests/integration/api.test.js",
  onBeforeApply,
  onAppliedSuccess,
  onTriggerRerun,
}) {
  const [targetDir, setTargetDir] = useState("tests/integration");
  const [fileName, setFileName] = useState("api.test.js");
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");
  const [appliedResult, setAppliedResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setAppliedResult(null);
    if (Array.isArray(initialSelectedKeys) && initialSelectedKeys.length > 0) {
      setSelectedKeys(initialSelectedKeys);
    } else if (scenarios.length > 0) {
      setSelectedKeys(scenarios.map((s) => s.key));
    } else {
      setSelectedKeys([]);
    }
  }, [isOpen, initialSelectedKeys, scenarios]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const chosenScenarios = useMemo(
    () => scenarios.filter((s) => selectedKeySet.has(s.key)),
    [scenarios, selectedKeySet],
  );
  const passedScenarios = useMemo(
    () => scenarios.filter((s) => String(s.status || "").toLowerCase() === "passed"),
    [scenarios],
  );

  if (!isOpen) return null;

  const toggleScenarioKey = (key) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSelectPreset = (preset) => {
    setTargetDir(preset.dir);
    setFileName(preset.file);
  };

  const handleApply = async () => {
    if (!snapshotId) return;
    setIsApplying(true);
    setError("");

    try {
      if (onBeforeApply) {
        const ok = await onBeforeApply();
        if (ok === false) {
          setIsApplying(false);
          return;
        }
      }
      const fullPath = targetDir ? `${targetDir.replace(/\/+$/, "")}/${fileName}` : fileName;
      const resolvedTestIds =
        chosenScenarios.length > 0
          ? Array.from(new Set(chosenScenarios.map((s) => s.aiTestId).filter(Boolean)))
          : testIds;
      const selectedScenariosPayload = chosenScenarios.map((s) => ({
        aiTestId: s.aiTestId || null,
        scenarioId: s.scenarioId || null,
        testName: s.testName || s.title || "",
        title: s.title || s.testName || "",
      }));

      const res = await applyIntegrationTests(snapshotId, {
        testIds: resolvedTestIds,
        selectedScenarios: selectedScenariosPayload,
        targetFilePath: fullPath,
        fileName,
      });

      setAppliedResult(res.data || res);
      if (onAppliedSuccess) {
        onAppliedSuccess(res.data || res);
      }
    } catch (err) {
      console.error("[IntegrationApplyTestsModal] Apply error:", err);
      setError(err.message || "Failed to apply tests to source code.");
    } finally {
      setIsApplying(false);
    }
  };

  const fullDestinationPath = targetDir
    ? `${targetDir.replace(/\/+$/, "")}/${fileName}`
    : fileName;
  const activeCount = scenarios.length > 0 ? chosenScenarios.length : testIds.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden flex flex-col text-[var(--color-text)]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-surface-secondary)]/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <HardDriveDownload size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight text-[var(--color-text)] m-0">
                {appliedResult ? "Tests Applied Successfully" : "Save & Apply Tests to Repository"}
              </h3>
              <p className="text-[11px] text-[var(--color-text-secondary)] m-0 font-mono mt-0.5 tabular-nums">
                {activeCount} test scenario(s) selected to write to project repository
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col gap-4 text-xs">
          {error && (
            <div className="p-3 rounded bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!appliedResult ? (
            <>
              {/* Scenario Selector (All or Individual) */}
              {scenarios.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                      Scenarios to Apply ({chosenScenarios.length}/{scenarios.length})
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedKeys(scenarios.map((s) => s.key))}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)] cursor-pointer"
                      >
                        Select All
                      </button>
                      {passedScenarios.length > 0 && passedScenarios.length < scenarios.length && (
                        <button
                          type="button"
                          onClick={() => setSelectedKeys(passedScenarios.map((s) => s.key))}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 cursor-pointer"
                        >
                          Passed Only ({passedScenarios.length})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedKeys([])}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] border border-[var(--color-border)] cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] divide-y divide-[var(--color-border)]/60">
                    {scenarios.map((sc) => {
                      const checked = selectedKeySet.has(sc.key);
                      const statusLower = String(sc.status || "ready").toLowerCase();
                      const statusColor =
                        statusLower === "passed"
                          ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                          : statusLower === "failed"
                            ? "text-rose-400 bg-rose-500/10 border-rose-500/25"
                            : "text-[var(--color-text-muted)] bg-[var(--color-surface-secondary)] border-[var(--color-border)]";
                      return (
                        <button
                          key={sc.key}
                          type="button"
                          onClick={() => toggleScenarioKey(sc.key)}
                          className={`w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                            checked ? "bg-[var(--color-primary)]/5" : "hover:bg-[var(--color-surface-hover)]/60 opacity-75"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 ${
                                checked
                                  ? "bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                                  : "border-[var(--color-border)] bg-[var(--color-surface)]"
                              }`}
                            >
                              {checked && <Check size={10} strokeWidth={3} />}
                            </span>
                            <span className="px-1 py-0.5 rounded text-[9px] font-mono font-bold bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] shrink-0">
                              {sc.method || "API"}
                            </span>
                            <span className="text-[11px] font-mono text-[var(--color-text-muted)] truncate max-w-[110px] shrink-0">
                              {sc.path || "/"}
                            </span>
                            <span className="text-[11px] text-[var(--color-text)] truncate">
                              {sc.title || sc.testName}
                            </span>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase border shrink-0 ${statusColor}`}>
                            {statusLower}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Directory & File Path Picker */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Target Directory
                </label>
                <div className="relative">
                  <Folder size={14} className="absolute left-3 top-2.5 text-[var(--color-text-muted)]" />
                  <input
                    type="text"
                    value={targetDir}
                    onChange={(e) => setTargetDir(e.target.value)}
                    placeholder="e.g. tests/integration"
                    className="w-full pl-9 pr-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] text-xs font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Test File Name
                </label>
                <div className="relative">
                  <FileCode size={14} className="absolute left-3 top-2.5 text-[var(--color-text-muted)]" />
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="e.g. api.test.js"
                    className="w-full pl-9 pr-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] text-xs font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
              </div>

              {/* Path Presets */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] text-[var(--color-text-muted)]">Recommended directory presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  {DEFAULT_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleSelectPreset(p)}
                      className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                        targetDir === p.dir && fileName === p.file
                          ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/30 font-semibold"
                          : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview Target Full Path */}
              <div className="p-3 rounded bg-[var(--color-surface-secondary)]/40 border border-[var(--color-border)]/60 font-mono text-[11px] flex items-center justify-between">
                <span className="text-[var(--color-text-muted)]">Destination Path:</span>
                <span className="text-[var(--color-primary)] font-semibold truncate ml-2">
                  {fullDestinationPath}
                </span>
              </div>
            </>
          ) : (
            /* Post-Apply Success State with Re-Run Call To Action */
            <div className="flex flex-col gap-4 py-2">
              <div className="flex items-start gap-3 p-3.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <CheckCircle2 size={22} className="shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <h4 className="text-xs font-bold text-[var(--color-success)] m-0">
                    Test files saved successfully to repository!
                  </h4>
                  <p className="text-[11px] text-[var(--color-text-secondary)] m-0 font-mono">
                    File: <span className="text-[var(--color-text)] font-semibold">{appliedResult.appliedFiles?.[0]?.filePath || fullDestinationPath}</span>
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex flex-col gap-2">
                <span className="text-xs font-semibold text-[var(--color-text)]">
                  Re-run analysis to evaluate new coverage metrics?
                </span>
                <p className="text-[11px] text-[var(--color-text-muted)] m-0">
                  The system will execute the newly applied test suite through the CovAI Tracing Engine and calculate the updated API Coverage %.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 flex items-center justify-end gap-2.5">
          {!appliedResult ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isApplying}
                className="px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={isApplying || !fileName.trim() || (scenarios.length > 0 && chosenScenarios.length === 0)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-bold hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-50"
              >
                <HardDriveDownload size={13} />
                <span>{isApplying ? "Writing files..." : "Save & Apply to Repository"}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onTriggerRerun) onTriggerRerun();
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-success)] text-[var(--color-primary-foreground)] text-xs font-bold hover:opacity-90 transition-opacity shadow-xs cursor-pointer"
              >
                <Play size={13} fill="currentColor" />
                <span>Re-run Analysis Now</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
