import React, { useState, useMemo } from "react";
import {
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowDown,
  Network,
} from "lucide-react";
import { cleanDisplayPath } from "./CoverageTypeDashboard.jsx";

export default function FileBranchCFGView({
  filePath,
  fileCoverage,
  onOpenFile,
  onSuggestTestcase,
}) {
  const branches = fileCoverage?.branches || [];
  const functions = fileCoverage?.functions || [];
  const sourceCode = fileCoverage?.sourceCode || "";

  // Group branches by function or by line
  const functionsWithCfg = useMemo(() => {
    if (functions.length === 0) {
      // Fallback: create a synthetic function container for the file
      return [
        {
          name: cleanDisplayPath(filePath),
          startLine: 1,
          endLine: 999,
          branches: branches,
        },
      ];
    }

    return functions.map((fn) => {
      const fnStart = fn.startLine || fn.line || 1;
      const fnEnd = fn.endLine || 9999;
      const fnBranches = branches.filter(
        (b) => b.line >= fnStart && b.line <= fnEnd,
      );
      return {
        ...fn,
        name: fn.realName || fn.name || `function_${fn.id}`,
        branches: fnBranches,
      };
    });
  }, [functions, branches, filePath]);

  const [selectedFnIndex, setSelectedFnIndex] = useState(0);
  const activeFn = functionsWithCfg[selectedFnIndex] || functionsWithCfg[0];

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--color-warning)]/10 border-b border-[var(--color-border)] flex-wrap gap-2.5">
        <div className="flex items-center gap-2">
          <GitBranch size={15} className="text-[var(--color-warning)]" />
          <span className="text-xs font-bold text-[var(--color-text)] font-mono">
            Control Flow Graph (CFG) — {cleanDisplayPath(filePath)}
          </span>
        </div>

        {/* Function Selector Tabs */}
        {functionsWithCfg.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              Function:
            </span>
            {functionsWithCfg.map((fn, idx) => {
              const isSelected = idx === selectedFnIndex;
              const hasBranches = fn.branches.length > 0;
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedFnIndex(idx)}
                  className={`text-[11px] font-mono px-2 py-0.5 rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[var(--color-warning)]/20 text-[var(--color-warning)] font-bold border border-[var(--color-warning)]/40"
                      : "bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
                  }`}
                >
                  {fn.name}() {hasBranches ? `(${fn.branches.length} branches)` : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* CFG Graph Canvas */}
      <div className="p-6 flex flex-col items-center gap-3.5 bg-[var(--color-bg)]">
        {/* Function Entry Node */}
        <div className="px-5 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/40 text-[var(--color-primary)] text-xs font-bold font-mono text-center min-w-[150px] shadow-sm">
          {activeFn?.name || "function"}()
        </div>

        {/* Down Arrow */}
        <div className="flex flex-col items-center text-[var(--color-text-muted)]">
          <div className="w-[2px] h-4 bg-[var(--color-border)]" />
          <div className="text-[10px] -mt-1">▼</div>
        </div>

        {/* If Function Has Branches */}
        {activeFn?.branches && activeFn.branches.length > 0 ? (
          activeFn.branches.map((branch, bIdx) => {
            const truePath =
              branch.paths?.find((p) => p.type === "True") || branch.paths?.[0];
            const falsePath =
              branch.paths?.find((p) => p.type === "False") ||
              branch.paths?.[1];

            const isTrueCovered = (truePath?.hits || 0) > 0;
            const isFalseCovered = (falsePath?.hits || 0) > 0;

            // Clean condition snippet
            let condText =
              branch.condition || branch.fullConditionText || "condition";
            if (!condText.endsWith("?")) condText += " ?";

            // Clean true snippet
            const trueCode =
              truePath?.codeSnippet
                ?.replace(/return\s+/, "")
                ?.replace(/;$/, "") || "true";

            // Clean false snippet
            const falseCode =
              falsePath?.codeSnippet
                ?.replace(/return\s+/, "")
                ?.replace(/;$/, "") || "false";

            return (
              <div
                key={branch.id || bIdx}
                className="flex flex-col items-center w-full max-w-[580px]"
              >
                {/* Decision Condition Node */}
                <div className="px-5 py-2 rounded-[var(--radius-md)] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/40 text-[var(--color-warning)] text-xs font-bold font-mono text-center min-w-[160px] shadow-sm">
                  {condText}
                </div>

                {/* Split Paths Diagram */}
                <div className="grid grid-cols-2 gap-8 w-full mt-2">
                  {/* TRUE Path Column */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex items-center gap-1 text-[11px] font-bold font-mono mb-1 ${
                        isTrueCovered
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-danger)]"
                      }`}
                    >
                      <span>TRUE</span>
                      <span className="text-xs">
                        {isTrueCovered ? "🟢" : "🔴"}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        ({truePath?.hits || 0} hits)
                      </span>
                    </div>

                    <div
                      className={`w-[2px] h-4 ${
                        isTrueCovered
                          ? "bg-[var(--color-success)]"
                          : "bg-[var(--color-danger)]"
                      }`}
                    />
                    <div
                      className={`text-[10px] -mt-1 ${
                        isTrueCovered
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-danger)]"
                      }`}
                    >
                      ▼
                    </div>

                    {/* True Block Box */}
                    <div
                      className={`mt-1 px-4 py-2 rounded-[var(--radius-sm)] font-mono text-xs font-semibold text-center w-[85%] min-h-[38px] flex items-center justify-center ${
                        isTrueCovered
                          ? "bg-[var(--color-success)]/10 border border-[var(--color-success)]/30 text-[var(--color-success)]"
                          : "bg-[var(--color-danger)]/10 border border-dashed border-[var(--color-danger)] text-[var(--color-danger)]"
                      }`}
                    >
                      {trueCode}
                    </div>

                    {/* Connector line down to return */}
                    <div className="w-[2px] h-5 bg-[var(--color-border)] mt-1" />
                  </div>

                  {/* FALSE Path Column */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex items-center gap-1 text-[11px] font-bold font-mono mb-1 ${
                        isFalseCovered
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-danger)]"
                      }`}
                    >
                      <span>FALSE</span>
                      <span className="text-xs">
                        {isFalseCovered ? "🟢" : "🔴"}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        ({falsePath?.hits || 0} hits)
                      </span>
                    </div>

                    <div
                      className={`w-[2px] h-4 ${
                        isFalseCovered
                          ? "bg-[var(--color-success)]"
                          : "bg-[var(--color-danger)]"
                      }`}
                    />
                    <div
                      className={`text-[10px] -mt-1 ${
                        isFalseCovered
                          ? "text-[var(--color-success)]"
                          : "text-[var(--color-danger)]"
                      }`}
                    >
                      ▼
                    </div>

                    {/* False Block Box */}
                    <div
                      className={`mt-1 px-4 py-2 rounded-[var(--radius-sm)] font-mono text-xs font-semibold text-center w-[85%] min-h-[38px] flex items-center justify-center ${
                        isFalseCovered
                          ? "bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 text-[var(--color-primary)]"
                          : "bg-[var(--color-danger)]/10 border border-dashed border-[var(--color-danger)] text-[var(--color-danger)]"
                      }`}
                    >
                      {falseCode}
                    </div>

                    {/* Connector line down to return */}
                    <div className="w-[2px] h-5 bg-[var(--color-border)] mt-1" />
                  </div>
                </div>

                {/* Missing Branch Warning & Suggest Button */}
                {(!isTrueCovered || !isFalseCovered) && onSuggestTestcase && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="text-xs text-[var(--color-danger)]">
                      ⚠️ Uncovered branches remain
                    </span>
                    <button
                      onClick={() => onSuggestTestcase(filePath)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs cursor-pointer font-medium transition-colors border-none"
                    >
                      <Sparkles size={11} />
                      <span>Suggest testcase</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          /* Function has no branches: straight pipeline */
          <div className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] text-xs font-mono">
            Sequential execution (No conditional branches)
          </div>
        )}

        {/* Merge Arrow to Return */}
        <div className="flex flex-col items-center text-[var(--color-text-muted)] -mt-1.5">
          <div className="w-[2px] h-4 bg-[var(--color-border)]" />
          <div className="text-[10px] -mt-1">▼</div>
        </div>

        {/* Exit / Return Node */}
        <div className="px-6 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-secondary)]/10 border border-[var(--color-secondary)]/40 text-[var(--color-secondary)] text-xs font-bold font-mono text-center min-w-[120px] shadow-sm">
          return
        </div>
      </div>
    </div>
  );
}
