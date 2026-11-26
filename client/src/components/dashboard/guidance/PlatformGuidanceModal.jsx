import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Lightbulb,
  Link2,
  MapPin,
  Sparkles,
  AlertCircle,
  X,
} from "lucide-react";
import {
  GUIDANCE_STEPS,
  GUIDANCE_TRACKS,
  resolveInitialGuideStep,
} from "./platformGuidanceData.js";

const VISITED_STORAGE_KEY = "covai_guidance_visited_v1";

function loadVisitedSteps() {
  try {
    const raw = localStorage.getItem(VISITED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveVisitedSteps(set) {
  try {
    localStorage.setItem(VISITED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // Ignore storage quota errors
  }
}

export default function PlatformGuidanceModal({
  isOpen,
  onClose,
  initialStepId = null,
  currentContext = {},
  onNavigateTarget = null,
  onAskAi = null,
}) {
  const contextMatchedStepId = useMemo(
    () => resolveInitialGuideStep(currentContext),
    [currentContext],
  );

  if (!isOpen) return null;

  const targetId =
    initialStepId || contextMatchedStepId || GUIDANCE_STEPS[0].id;
  const resolvedInitialStepId = GUIDANCE_STEPS.some((s) => s.id === targetId)
    ? targetId
    : GUIDANCE_STEPS[0].id;

  return (
    <PlatformGuidanceDialog
      key={resolvedInitialStepId}
      initialStepId={resolvedInitialStepId}
      contextMatchedStepId={contextMatchedStepId}
      onClose={onClose}
      onNavigateTarget={onNavigateTarget}
      onAskAi={onAskAi}
    />
  );
}

function PlatformGuidanceDialog({
  initialStepId,
  contextMatchedStepId,
  onClose,
  onNavigateTarget,
  onAskAi,
}) {
  const dialogRef = useRef(null);
  const contentScrollRef = useRef(null);
  const titleId = useId();

  const [activeStepId, setActiveStepId] = useState(initialStepId);
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [syncWorkspace, setSyncWorkspace] = useState(false);
  const [visitedIds, setVisitedIds] = useState(() => {
    const initial = loadVisitedSteps();
    if (!initial.has(initialStepId)) {
      initial.add(initialStepId);
      saveVisitedSteps(initial);
    }
    return initial;
  });

  const currentIndex = useMemo(() => {
    const idx = GUIDANCE_STEPS.findIndex((s) => s.id === activeStepId);
    return idx >= 0 ? idx : 0;
  }, [activeStepId]);

  const currentStep = GUIDANCE_STEPS[currentIndex] || GUIDANCE_STEPS[0];
  const totalSteps = GUIDANCE_STEPS.length;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < totalSteps - 1;

  const activeStage =
    currentStep.stages?.[activeStageIdx] || currentStep.stages?.[0] || null;

  const goToStep = (nextId, { sync = syncWorkspace } = {}) => {
    const nextStepObj = GUIDANCE_STEPS.find((s) => s.id === nextId);
    if (!nextStepObj) return;
    setActiveStepId(nextStepObj.id);
    setActiveStageIdx(0);
    setVisitedIds((prev) => {
      if (prev.has(nextStepObj.id)) return prev;
      const next = new Set(prev);
      next.add(nextStepObj.id);
      saveVisitedSteps(next);
      return next;
    });
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0;
    }
    if (sync && nextStepObj.target && onNavigateTarget) {
      onNavigateTarget(nextStepObj.target, { keepGuideOpen: true });
    }
  };

  const handlePrev = () => {
    if (!hasPrev) return;
    goToStep(GUIDANCE_STEPS[currentIndex - 1].id);
  };

  const handleNext = () => {
    if (!hasNext) return;
    goToStep(GUIDANCE_STEPS[currentIndex + 1].id);
  };

  // Focus management & keyboard shortcuts (Esc, Left/Right arrows)
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const inInput = tag === "input" || tag === "textarea" || tag === "select";

      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (!inInput && e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentIndex > 0) {
          goToStep(GUIDANCE_STEPS[currentIndex - 1].id);
        }
      } else if (!inInput && e.key === "ArrowRight") {
        e.preventDefault();
        if (currentIndex < totalSteps - 1) {
          goToStep(GUIDANCE_STEPS[currentIndex + 1].id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const StepIcon = currentStep.icon || BookOpen;
  const currentTrackLabel =
    GUIDANCE_TRACKS.find((t) => t.id === currentStep.track)?.label ||
    "Workflow";
  const progressPct = Math.round(((currentIndex + 1) / totalSteps) * 100);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[85] flex items-center justify-center p-3 sm:p-5 bg-black/75 font-sans"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="portfolio-studio w-full max-w-5xl h-[min(88vh,740px)] flex flex-col overflow-hidden rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-strong)] text-[var(--color-text)] outline-none"
      >
        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <header className="shrink-0 px-5 py-3.5 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-md bg-[var(--color-surface)] border border-[var(--color-border-strong)] flex items-center justify-center text-[var(--color-primary)] shrink-0">
              <BookOpen size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2
                  id={titleId}
                  className="text-sm font-semibold tracking-tight text-[var(--color-text)] m-0"
                >
                  CovAI Workspace Guide
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                  {currentTrackLabel}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] m-0 mt-0.5 truncate">
                Interactive walkthrough across testing tiers, chatbot evaluation &amp; connected tools
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {onNavigateTarget && (
              <button
                type="button"
                role="switch"
                aria-checked={syncWorkspace}
                onClick={() => {
                  const next = !syncWorkspace;
                  setSyncWorkspace(next);
                  if (next && currentStep.target) {
                    onNavigateTarget(currentStep.target, {
                      keepGuideOpen: true,
                    });
                  }
                }}
                title="Automatically switch the workspace tab behind this guide as you press Next / Prev"
                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors duration-150 cursor-pointer ${
                  syncWorkspace
                    ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 text-[var(--color-text)]"
                    : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    syncWorkspace
                      ? "bg-[var(--color-primary)]"
                      : "bg-[var(--color-text-muted)]"
                  }`}
                />
                <span>Sync view</span>
              </button>
            )}

            <span className="px-2 py-1 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[11px] tabular-nums text-[var(--color-text-secondary)]">
              {String(currentIndex + 1).padStart(2, "0")} /{" "}
              {String(totalSteps).padStart(2, "0")}
            </span>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close guide"
              title="Close (Esc)"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] border border-transparent hover:border-[var(--color-border)] transition-colors duration-150 cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </header>

        {/* Subtle flat progress track */}
        <div className="shrink-0 h-0.5 bg-[var(--color-bg)] w-full">
          <div
            className="h-full bg-[var(--color-primary)] transition-all duration-200"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Mobile / Tablet compact step switcher */}
        <div className="md:hidden shrink-0 px-4 py-2.5 bg-[var(--color-bg)] border-b border-[var(--color-border)] flex items-center gap-2">
          <label
            htmlFor="guidance-mobile-select"
            className="text-[11px] font-mono text-[var(--color-text-muted)] shrink-0"
          >
            Topic:
          </label>
          <select
            id="guidance-mobile-select"
            value={currentStep.id}
            onChange={(e) => goToStep(e.target.value)}
            className="flex-1 min-w-0 h-8 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] px-2.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          >
            {GUIDANCE_STEPS.map((step) => (
              <option key={step.id} value={step.id}>
                {String(step.number).padStart(2, "0")}. {step.shortTitle}
              </option>
            ))}
          </select>
        </div>

        {/* ── BODY: CHAPTER RAIL + DETAILED CONTENT ─────────────────── */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left Chapter Rail */}
          <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] overflow-y-auto custom-scrollbar p-3 space-y-4">
            {GUIDANCE_TRACKS.map((track) => {
              const trackSteps = GUIDANCE_STEPS.filter(
                (s) => s.track === track.id,
              );
              if (!trackSteps.length) return null;
              return (
                <div key={track.id} className="space-y-1">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    {track.label}
                  </div>
                  <div className="space-y-0.5">
                    {trackSteps.map((step) => {
                      const Icon = step.icon;
                      const isActive = step.id === currentStep.id;
                      const isVisited = visitedIds.has(step.id);
                      const isContextMatch = step.id === contextMatchedStepId;
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => goToStep(step.id)}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-xs transition-colors duration-150 cursor-pointer border ${
                            isActive
                              ? "bg-[var(--color-surface-secondary)] border-[var(--color-border-strong)] text-[var(--color-text)] font-medium"
                              : "border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                          }`}
                        >
                          <span
                            className={`w-5 h-5 rounded flex items-center justify-center shrink-0 font-mono text-[10px] tabular-nums border ${
                              isActive
                                ? "bg-[var(--color-primary)]/15 border-[var(--color-primary)]/40 text-[var(--color-primary)]"
                                : isVisited
                                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                                  : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-muted)]"
                            }`}
                          >
                            {isVisited && !isActive ? (
                              <Check size={11} />
                            ) : (
                              String(step.number).padStart(2, "0")
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {step.shortTitle}
                          </span>
                          {isContextMatch && (
                            <span
                              title="Matches your current screen"
                              className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0"
                            >
                              Here
                            </span>
                          )}
                          {!isContextMatch && isActive && (
                            <Icon
                              size={12}
                              className="text-[var(--color-primary)] shrink-0"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </aside>

          {/* Right Detailed Step Pane */}
          <div
            ref={contentScrollRef}
            className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-5 sm:p-6 space-y-5 bg-[var(--color-surface)]"
          >
            {/* Step Intro */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-secondary)]">
                  <MapPin size={12} className="text-[var(--color-primary)]" />
                  <span>{currentStep.location}</span>
                </div>

                {currentStep.id === contextMatchedStepId && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    Current Screen
                  </span>
                )}
              </div>

              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] shrink-0 mt-0.5">
                  <StepIcon size={18} />
                </div>
                <div className="min-w-0 space-y-1">
                  <h3 className="text-base sm:text-lg font-semibold tracking-tight text-[var(--color-text)] m-0">
                    {currentStep.title}
                  </h3>
                  <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed m-0">
                    {currentStep.summary}
                  </p>
                </div>
              </div>
            </div>

            {/* Interactive Workflow Stages */}
            {Array.isArray(currentStep.stages) &&
              currentStep.stages.length > 0 && (
                <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Step-by-Step Workflow
                    </span>
                    <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                      Click a stage to inspect actions
                    </span>
                  </div>

                  {/* Stage Selector Tabs */}
                  <div className="px-3 pt-3 flex flex-wrap gap-1.5 border-b border-[var(--color-border)] pb-3">
                    {currentStep.stages.map((stage, idx) => {
                      const selected = idx === activeStageIdx;
                      return (
                        <button
                          key={stage.id}
                          type="button"
                          onClick={() => setActiveStageIdx(idx)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors duration-150 cursor-pointer ${
                            selected
                              ? "bg-[var(--color-surface-secondary)] border-[var(--color-primary)]/50 text-[var(--color-text)]"
                              : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
                          }`}
                        >
                          {stage.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Active Stage Details */}
                  {activeStage && (
                    <div className="p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[var(--color-text)]">
                          {activeStage.label}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)]">
                          UI: {activeStage.action}
                        </span>
                      </div>

                      <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed m-0">
                        {activeStage.detail}
                      </p>

                      {activeStage.tip && (
                        <div className="flex items-start gap-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)]">
                          <Lightbulb
                            size={14}
                            className="text-amber-400 shrink-0 mt-0.5"
                          />
                          <span className="leading-relaxed">
                            <strong className="text-[var(--color-text)] font-medium">
                              Tip:{" "}
                            </strong>
                            {activeStage.tip}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}

            {/* Cross-Component Interaction Map */}
            {Array.isArray(currentStep.connections) &&
              currentStep.connections.length > 0 && (
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                    <Link2 size={13} />
                    <span>Connected Components &amp; Cross-Navigation</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {currentStep.connections.map((conn, idx) => (
                      <div
                        key={`${conn.label}-${idx}`}
                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 flex flex-col justify-between gap-2.5 hover:border-[var(--color-border-strong)] transition-colors duration-150"
                      >
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-[var(--color-text)]">
                            {conn.label}
                          </div>
                          <p className="text-[11px] text-[var(--color-text-muted)] leading-snug m-0">
                            {conn.desc}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 pt-1 border-t border-[var(--color-border)]">
                          {conn.stepId && (
                            <button
                              type="button"
                              onClick={() => goToStep(conn.stepId)}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
                            >
                              <span>Read guide</span>
                              <ArrowRight size={11} />
                            </button>
                          )}
                          {conn.target && onNavigateTarget && (
                            <button
                              type="button"
                              onClick={() => {
                                onNavigateTarget(conn.target, {
                                  keepGuideOpen: false,
                                });
                                onClose?.();
                              }}
                              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                            >
                              <span>Open</span>
                              <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

            {/* Common Gotchas / Important Notes */}
            {Array.isArray(currentStep.gotchas) &&
              currentStep.gotchas.length > 0 && (
                <section className="rounded-md border border-amber-500/20 bg-amber-500/10 px-4 py-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                    <AlertCircle size={13} />
                    <span>Key Notes &amp; Safeguards</span>
                  </div>
                  <ul className="space-y-1 m-0 pl-4 text-xs text-[var(--color-text-secondary)] list-disc">
                    {currentStep.gotchas.map((note, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {note}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
          </div>
        </div>

        {/* ── FOOTER: PREV / INTERACTIVE ACTIONS / NEXT ──────────────── */}
        <footer className="shrink-0 px-4 sm:px-5 py-3 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={!hasPrev}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-surface)] hover:bg-[var(--color-bg)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-xs font-medium transition-colors duration-150 active:scale-[0.98] cursor-pointer disabled:opacity-45 disabled:pointer-events-none"
            >
              <ChevronLeft size={14} />
              <span>Prev</span>
            </button>

            <span className="hidden lg:inline text-[11px] font-mono text-[var(--color-text-muted)] pl-1">
              Use ← / → keys
            </span>
          </div>

          {/* Interactive Center/Right Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {onAskAi && currentStep.aiPrompt && (
              <button
                type="button"
                onClick={() => {
                  onAskAi(currentStep.aiPrompt);
                  onClose?.();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-surface)] hover:bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-xs font-medium transition-colors duration-150 active:scale-[0.98] cursor-pointer"
                title="Open AI Chatbot with a contextual prompt for this step"
              >
                <Sparkles size={13} className="text-[var(--color-primary)]" />
                <span>Ask AI</span>
              </button>
            )}

            {onNavigateTarget && currentStep.target && (
              <button
                type="button"
                onClick={() => {
                  onNavigateTarget(currentStep.target, {
                    keepGuideOpen: false,
                  });
                  onClose?.();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--color-surface)] hover:bg-[var(--color-bg)] text-[var(--color-text)] border border-[var(--color-border-strong)] text-xs font-medium transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              >
                <ExternalLink size={12} />
                <span>{currentStep.target.label || "Open View"}</span>
              </button>
            )}

            {hasNext ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              >
                <Check size={14} />
                <span>Finish Guide</span>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
