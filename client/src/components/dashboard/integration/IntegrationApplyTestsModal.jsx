import React, { useState } from "react";
import {
  FileCode,
  Folder,
  CheckCircle2,
  Play,
  X,
  Sparkles,
  AlertCircle,
  FileCheck,
  ArrowRight,
  HardDriveDownload,
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
  defaultFilePath = "tests/integration/api.test.js",
  onAppliedSuccess,
  onTriggerRerun,
}) {
  const [targetDir, setTargetDir] = useState("tests/integration");
  const [fileName, setFileName] = useState("api.test.js");
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");
  const [appliedResult, setAppliedResult] = useState(null);

  if (!isOpen) return null;

  const handleSelectPreset = (preset) => {
    setTargetDir(preset.dir);
    setFileName(preset.file);
  };

  const handleApply = async () => {
    if (!snapshotId) return;
    setIsApplying(true);
    setError("");

    try {
      const fullPath = targetDir ? `${targetDir.replace(/\/+$/, "")}/${fileName}` : fileName;
      const res = await applyIntegrationTests(snapshotId, {
        testIds,
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
                {appliedResult ? "Áp Dụng Test Thành Công" : "Lưu & Apply Test Vào Mã Nguồn"}
              </h3>
              <p className="text-[11px] text-[var(--color-text-secondary)] m-0 font-mono mt-0.5">
                {testIds.length} kịch bản test sẽ được ghi trực tiếp vào file repository
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
              {/* Directory & File Path Picker */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                  Đường dẫn thư mục đích (Target Directory)
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
                  Tên file kiểm thử (Test File Name)
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
                <span className="text-[11px] text-[var(--color-text-muted)]">Gợi ý đường dẫn phổ biến:</span>
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
                <span className="text-[var(--color-text-muted)]">File sẽ ghi:</span>
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
                    Đã lưu test thành công vào mã nguồn!
                  </h4>
                  <p className="text-[11px] text-[var(--color-text-secondary)] m-0 font-mono">
                    File: <span className="text-[var(--color-text)] font-semibold">{appliedResult.appliedFiles?.[0]?.filePath || fullDestinationPath}</span>
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex flex-col gap-2">
                <span className="text-xs font-semibold text-[var(--color-text)]">
                  Bạn có muốn chạy lại phân tích để kiểm tra độ bao phủ mới không?
                </span>
                <p className="text-[11px] text-[var(--color-text-muted)] m-0">
                  Hệ thống sẽ chạy bộ test vừa apply qua CovAI Tracing Engine và tính toán lại API Coverage % thực tế của dự án.
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
                Hủy
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={isApplying || !fileName.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-bold hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-50"
              >
                <HardDriveDownload size={13} />
                <span>{isApplying ? "Đang ghi file..." : "Lưu & Apply vào mã nguồn"}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              >
                Đóng
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
                <span>Chạy phân tích lại ngay</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

