import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  X,
  FlaskConical,
  AlertTriangle,
  FileCode2,
  Check,
  Loader2,
  Info,
  Sparkles,
} from "lucide-react";

/**
 * Helper to test if variable name represents sensitive data
 */
function isSensitiveKey(keyName = "") {
  return /SECRET|KEY|PASSWORD|TOKEN|AUTH|CREDENTIAL|PRIVATE|CERT/i.test(keyName);
}

/**
 * Dialog content component that initializes fresh state whenever modal opens
 */
function UnitTestEnvVarModalDialog({
  onClose,
  missingRequired = [],
  detectedVariables = [],
  existingVariables = {},
  onSaveAndRun,
  onRunHermetic,
  isSaving = false,
  isLight = false,
  operationOnly = false,
}) {
  const initialFormValues = useMemo(() => {
    const initial = {};
    for (const v of detectedVariables) {
      const existingVal = existingVariables?.[v.name];
      initial[v.name] = existingVal !== undefined && existingVal !== null && existingVal !== ""
        ? String(existingVal)
        : "";
    }
    return initial;
  }, [detectedVariables, existingVariables]);

  const [formValues, setFormValues] = useState(initialFormValues);
  const [showSecret, setShowSecret] = useState({});
  const [isSubmittingInternalSave, setIsSubmittingInternalSave] = useState(false);
  const [isSubmittingInternalHermetic, setIsSubmittingInternalHermetic] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [activeTab, setActiveTab] = useState(
    !missingRequired || missingRequired.length === 0 ? "all" : "missing"
  );

  const isOperationBusy = isSaving || isSubmittingInternalSave || isSubmittingInternalHermetic;

  // Handle ESC key to dismiss
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !isOperationBusy) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOperationBusy, onClose]);

  // Categorize variables
  const missingVars = useMemo(() => {
    return detectedVariables.filter((v) => missingRequired.includes(v.name) || (v.required && !v.isDefined));
  }, [detectedVariables, missingRequired]);

  const optionalVars = useMemo(() => {
    return detectedVariables.filter((v) => !missingRequired.includes(v.name) && (!v.required || v.isDefined));
  }, [detectedVariables, missingRequired]);

  const displayedVars = activeTab === "missing" && missingVars.length > 0 ? missingVars : detectedVariables;

  const handleInputChange = (name, value) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
    if (validationErrors[name]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleToggleVisibility = (name) => {
    setShowSecret((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleResetToMock = (v) => {
    handleInputChange(v.name, v.inferredMock || "");
  };

  const handleSaveAndRunSubmit = async (e) => {
    e?.preventDefault();
    if (isOperationBusy) return;

    // Validate that required variables are not empty
    const errors = {};
    for (const reqName of missingRequired) {
      const val = formValues[reqName];
      if (val === undefined || val === null || String(val).trim() === "") {
        errors[reqName] = "This environment variable is required to execute tests.";
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      setSubmitError("Please provide values for all required environment variables, or use Clean Mock Data.");
      return;
    }

    setSubmitError("");
    setIsSubmittingInternalSave(true);
    try {
      await onSaveAndRun?.(Object.fromEntries(Object.entries(formValues).filter(([, value]) => String(value).trim() !== '')));
      onClose?.();
    } catch (err) {
      console.error("[UnitTestEnvVarModal] Save error:", err);
      setSubmitError(err.message || "Failed to save environment variables.");
    } finally {
      setIsSubmittingInternalSave(false);
    }
  };

  const handleHermeticFallbackSubmit = async () => {
    if (isOperationBusy) return;
    setSubmitError("");
    setIsSubmittingInternalHermetic(true);
    try {
      await onRunHermetic?.();
      onClose?.();
    } catch (err) {
      console.error("[UnitTestEnvVarModal] Hermetic run error:", err);
      setSubmitError(err.message || "Failed to initiate hermetic test execution.");
    } finally {
      setIsSubmittingInternalHermetic(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1050] flex items-center justify-center p-4 sm:p-6"
      style={{
        background: "rgba(3, 7, 18, 0.78)",
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isOperationBusy) {
          onClose?.();
        }
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{
          background: isLight ? "#ffffff" : "#0f172a",
          border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(139, 92, 246, 0.35)",
          boxShadow: "0 25px 60px -15px rgba(0,0,0,0.8), 0 0 30px rgba(99,102,241,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{
            background: isLight ? "#f8fafc" : "#1e293b",
            borderBottom: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{
                background: "rgba(245, 158, 11, 0.15)",
                border: "1px solid rgba(245, 158, 11, 0.35)",
              }}
            >
              <Lock size={20} className="text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100">
                  Configure Environment Variables
                </h3>
                {missingRequired.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    {missingRequired.length} required
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Missing environment variables detected in your test suite or source code.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isOperationBusy}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter Tabs (if both missing & optional exist) */}
        {missingVars.length > 0 && optionalVars.length > 0 && (
          <div className="flex items-center gap-2 px-6 pt-3 pb-1 border-b border-slate-800 bg-slate-900/60 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("missing")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === "missing"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Missing Required ({missingVars.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === "all"
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              All Detected ({detectedVariables.length})
            </button>
          </div>
        )}

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Notice Callout */}
          <div
            className="flex items-start gap-3 p-3.5 rounded-xl text-xs leading-relaxed"
            style={{
              background: "rgba(99, 102, 241, 0.08)",
              border: "1px solid rgba(99, 102, 241, 0.25)",
              color: "#cbd5e1",
            }}
          >
            <Info size={16} className="text-indigo-400 flex-shrink-0 mt-0.5" />
            <div>
              Values saved here are written to <strong className="text-white font-mono">.env</strong> at the workspace root and immediately synchronized with the project file explorer. Alternatively, you can run tests with hermetic mocks in RAM without saving any file.
            </div>
          </div>

          {/* Error Banner */}
          {submitError && (
            <div
              className="flex items-center gap-2.5 p-3 rounded-xl text-xs"
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.35)",
                color: "#fca5a5",
              }}
            >
              <AlertTriangle size={15} className="flex-shrink-0 text-rose-400" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Variable Fields List */}
          <form id="unit-env-var-form" onSubmit={handleSaveAndRunSubmit} className="space-y-4">
            {displayedVars.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                No environment variables detected for this filter.
              </div>
            ) : (
              displayedVars.map((v) => {
                const isSensitive = isSensitiveKey(v.name);
                const isShowing = showSecret[v.name];
                const inputType = isSensitive && !isShowing ? "password" : "text";
                const isReq = v.required || missingRequired.includes(v.name);
                const hasErr = Boolean(validationErrors[v.name]);

                return (
                  <div
                    key={v.name}
                    className="p-3.5 rounded-xl transition-all"
                    style={{
                      background: isLight ? "#f8fafc" : "rgba(30, 41, 59, 0.5)",
                      border: hasErr
                        ? "1px solid #ef4444"
                        : isReq
                        ? "1px solid rgba(245, 158, 11, 0.35)"
                        : "1px solid rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    {/* Variable Header: Name, Badges & Reset to Mock */}
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        {isSensitive ? (
                          <KeyRound size={14} className="text-amber-400 flex-shrink-0" />
                        ) : (
                          <FileCode2 size={14} className="text-cyan-400 flex-shrink-0" />
                        )}
                        <span className="font-mono text-sm font-bold text-slate-100 truncate">
                          {v.name}
                        </span>
                        {isReq ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 uppercase tracking-wider">
                            Required
                          </span>
                        ) : v.hasDefault ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30">
                            Has Default
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-700 text-slate-300">
                            Optional
                          </span>
                        )}
                        {v.isDefined && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                            Configured in .env
                          </span>
                        )}
                      </div>

                      {v.inferredMock && (
                        <button
                          type="button"
                          onClick={() => handleResetToMock(v)}
                          className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
                          title="Fill with inferred mock value"
                        >
                          <Sparkles size={12} />
                          <span>Use suggested mock</span>
                        </button>
                      )}
                    </div>

                    {/* Input Field with Eye Toggle */}
                    <div className="relative">
                      <input
                        type={inputType}
                        value={formValues[v.name] ?? ""}
                        onChange={(e) => handleInputChange(v.name, e.target.value)}
                        placeholder={v.inferredMock ? `e.g. ${v.inferredMock}` : "Enter value..."}
                        disabled={isOperationBusy}
                        className={`w-full font-mono text-xs px-3.5 py-2.5 pr-10 rounded-lg outline-none transition-all ${
                          isLight
                            ? "bg-white border-slate-300 text-slate-900 focus:border-indigo-500"
                            : "bg-slate-950/80 border-slate-700/80 text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
                        } ${hasErr ? "border-rose-500 ring-1 ring-rose-500/50" : ""}`}
                      />
                      {isSensitive && (
                        <button
                          type="button"
                          onClick={() => handleToggleVisibility(v.name)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1"
                          title={isShowing ? "Mask secret" : "Reveal secret"}
                        >
                          {isShowing ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      )}
                    </div>

                    {/* Validation Error */}
                    {hasErr && (
                      <div className="text-[11px] text-rose-400 mt-1 font-medium">
                        {validationErrors[v.name]}
                      </div>
                    )}

                    {/* References Hint */}
                    {Array.isArray(v.references) && v.references.length > 0 && (
                      <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-500">Referenced in:</span>
                        {v.references.slice(0, 3).map((ref, idx) => (
                          <span
                            key={idx}
                            className="font-mono px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60 text-[10px]"
                          >
                            {ref.file}:{ref.line}
                          </span>
                        ))}
                        {v.references.length > 3 && (
                          <span className="text-slate-500 text-[10px]">
                            +{v.references.length - 3} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </form>
        </div>

        {/* Footer CTAs */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0 gap-3 flex-wrap"
          style={{
            background: isLight ? "#f8fafc" : "#0b0f19",
            borderTop: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.08)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isOperationBusy}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg border border-slate-700 hover:bg-slate-800/80 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2.5">
            {/* Secondary CTA: Hermetic RAM Mock Fallback */}
            <button
              type="button"
              onClick={handleHermeticFallbackSubmit}
              disabled={isOperationBusy}
              hidden={operationOnly}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all border border-slate-700 bg-slate-800/90 text-slate-200 hover:bg-slate-700/80 hover:text-white disabled:opacity-50"
              title="Execute tests in RAM with clean mock data without modifying workspace files"
            >
              {isSubmittingInternalHermetic ? (
                <>
                  <Loader2 size={14} className="animate-spin text-purple-400" />
                  <span>Running with Mocks...</span>
                </>
              ) : (
                <>
                  <FlaskConical size={14} className="text-purple-400" />
                  <span>Run with Clean Mock Data</span>
                </>
              )}
            </button>

            {/* Primary CTA: Save to .env & Run Tests */}
            <button
              type="submit"
              form="unit-env-var-form"
              disabled={isOperationBusy}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-all text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
              }}
              title="Write variables to .env and immediately run test suite"
            >
              {(isSaving || isSubmittingInternalSave) ? (
                <>
                  <Loader2 size={14} className="animate-spin text-white" />
                  <span>Saving & Running...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>{operationOnly ? 'Use for This Test Run & Resume Apply' : 'Save to .env & Run Tests'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * UnitTestEnvVarModal
 *
 * Prompts user to configure missing environment variables required by unit tests
 * or target source code before execution, with two primary pathways:
 * 1. Primary: Save configured values to root .env & run tests
 * 2. Secondary: Hermetic Fallback (run tests in RAM with clean mock data without modifying workspace)
 */
export default function UnitTestEnvVarModal({
  isOpen,
  onClose,
  data = null,
  missingRequired: propMissingRequired,
  detectedVariables: propDetectedVariables,
  existingVariables: propExistingVariables,
  onSaveAndRun,
  onRunHermeticFallback,
  onRunHermetic,
  isSaving = false,
  isLight = false,
  operationOnly = false,
}) {
  const missingRequired = useMemo(() => {
    return propMissingRequired || data?.missingRequired || [];
  }, [propMissingRequired, data?.missingRequired]);

  const detectedVariables = useMemo(() => {
    return propDetectedVariables || data?.detectedVariables || [];
  }, [propDetectedVariables, data?.detectedVariables]);

  const existingVariables = useMemo(() => {
    return propExistingVariables || data?.existingVariables || {};
  }, [propExistingVariables, data?.existingVariables]);

  const handleHermeticAction = onRunHermeticFallback || onRunHermetic;

  return (
    <AnimatePresence>
      {isOpen && (
        <UnitTestEnvVarModalDialog
          onClose={onClose}
          missingRequired={missingRequired}
          detectedVariables={detectedVariables}
          existingVariables={existingVariables}
          onSaveAndRun={onSaveAndRun}
          onRunHermetic={handleHermeticAction}
          isSaving={isSaving}
          isLight={isLight}
          operationOnly={operationOnly}
        />
      )}
    </AnimatePresence>
  );
}
