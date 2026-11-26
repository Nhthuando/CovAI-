import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Link2, Sparkles, X } from "lucide-react";
import { GUIDANCE_TOURS } from "./platformGuidanceData.js";
import { hasSeenTour, markTourSeen } from "./guidanceStorage.js";

const SPOTLIGHT_PADDING = 6;
const POPOVER_GAP = 14;
const POPOVER_WIDTH = 376;

function findVisibleElement(selector) {
  if (!selector || typeof document === "undefined") return null;
  const parts = selector
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const part of parts) {
    const candidates = document.querySelectorAll(part);
    for (const el of candidates) {
      const rects = el.getClientRects();
      if (!rects.length) continue;
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        return el;
      }
    }
  }
  return null;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function computePopoverPosition(rect, preferredPlacement, popWidth, popHeight) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 12;

  if (!rect || preferredPlacement === "center") {
    return {
      top: Math.max(margin, Math.round((vh - popHeight) / 2)),
      left: Math.max(margin, Math.round((vw - popWidth) / 2)),
    };
  }

  const padded = {
    top: rect.top - SPOTLIGHT_PADDING,
    bottom: rect.bottom + SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    right: rect.right + SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  };

  const fitsBottom = padded.bottom + POPOVER_GAP + popHeight <= vh - margin;
  const fitsTop = padded.top - POPOVER_GAP - popHeight >= margin;
  const fitsRight = padded.right + POPOVER_GAP + popWidth <= vw - margin;
  const fitsLeft = padded.left - POPOVER_GAP - popWidth >= margin;

  let placement = preferredPlacement || "bottom";
  if (placement === "bottom" && !fitsBottom) {
    placement = fitsTop ? "top" : fitsRight ? "right" : fitsLeft ? "left" : "bottom";
  } else if (placement === "top" && !fitsTop) {
    placement = fitsBottom ? "bottom" : fitsRight ? "right" : fitsLeft ? "left" : "top";
  } else if (placement === "right" && !fitsRight) {
    placement = fitsLeft ? "left" : fitsBottom ? "bottom" : fitsTop ? "top" : "right";
  } else if (placement === "left" && !fitsLeft) {
    placement = fitsRight ? "right" : fitsBottom ? "bottom" : fitsTop ? "top" : "left";
  }

  let top = margin;
  let left = margin;

  if (placement === "bottom") {
    top = clamp(padded.bottom + POPOVER_GAP, margin, vh - popHeight - margin);
    left = clamp(
      padded.left + padded.width / 2 - popWidth / 2,
      margin,
      vw - popWidth - margin,
    );
  } else if (placement === "top") {
    top = clamp(padded.top - POPOVER_GAP - popHeight, margin, vh - popHeight - margin);
    left = clamp(
      padded.left + padded.width / 2 - popWidth / 2,
      margin,
      vw - popWidth - margin,
    );
  } else if (placement === "right") {
    top = clamp(
      padded.top + padded.height / 2 - popHeight / 2,
      margin,
      vh - popHeight - margin,
    );
    left = clamp(padded.right + POPOVER_GAP, margin, vw - popWidth - margin);
  } else if (placement === "left") {
    top = clamp(
      padded.top + padded.height / 2 - popHeight / 2,
      margin,
      vh - popHeight - margin,
    );
    left = clamp(padded.left - POPOVER_GAP - popWidth, margin, vw - popWidth - margin);
  }

  return { top: Math.round(top), left: Math.round(left) };
}

export default function SpotlightTourOverlay({
  tourKey,
  userId,
  suppressed = false,
}) {
  const [activeTourKey, setActiveTourKey] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!tourKey || suppressed) return undefined;
    const tour = GUIDANCE_TOURS[tourKey];
    if (!tour || !tour.steps?.length) return undefined;
    if (hasSeenTour(userId, tourKey)) return undefined;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 24; // ~6 seconds max wait for async workspaces/skeletons

    const tryActivate = () => {
      if (cancelled) return true;
      const firstMatch = tour.steps.some((step) =>
        Boolean(findVisibleElement(step.selector)),
      );
      if (firstMatch) {
        setActiveTourKey(tourKey);
        setStepIndex(0);
        return true;
      }
      return false;
    };

    const initialTimer = window.setTimeout(() => {
      if (tryActivate()) return;
      const interval = window.setInterval(() => {
        attempts += 1;
        if (tryActivate() || attempts >= maxAttempts) {
          window.clearInterval(interval);
        }
      }, 250);
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
    };
  }, [tourKey, userId, suppressed]);

  const dismissTour = useCallback(() => {
    const keyToMark = activeTourKey || tourKey;
    if (keyToMark) {
      markTourSeen(userId, keyToMark);
    }
    setActiveTourKey(null);
    setStepIndex(0);
  }, [activeTourKey, tourKey, userId]);

  if (suppressed || !activeTourKey || activeTourKey !== tourKey) {
    return null;
  }

  const tour = GUIDANCE_TOURS[activeTourKey];
  if (!tour?.steps?.length) return null;

  return (
    <ActiveSpotlight
      key={activeTourKey}
      tour={tour}
      stepIndex={stepIndex}
      setStepIndex={setStepIndex}
      onDismiss={dismissTour}
    />
  );
}

function ActiveSpotlight({ tour, stepIndex, setStepIndex, onDismiss }) {
  const titleId = useId();
  const cardRef = useRef(null);
  const [targetRect, setTargetRect] = useState(null);
  const [popoverSize, setPopoverSize] = useState({ width: POPOVER_WIDTH, height: 240 });

  const safeIndex = Math.max(0, Math.min(stepIndex, tour.steps.length - 1));
  const step = tour.steps[safeIndex];
  const stepSelector = step?.selector || "";
  const stepPlacement = step?.placement || "bottom";
  const totalSteps = tour.steps.length;
  const isFirst = safeIndex === 0;
  const isLast = safeIndex === totalSteps - 1;

  const measureTarget = useCallback(() => {
    const el = findVisibleElement(stepSelector);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTargetRect({
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
  }, [stepSelector]);

  useEffect(() => {
    const el = findVisibleElement(stepSelector);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
    const frame = requestAnimationFrame(measureTarget);
    const settleTimer = window.setTimeout(measureTarget, 220);

    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    const observer = new MutationObserver(measureTarget);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
      observer.disconnect();
    };
  }, [measureTarget, stepSelector]);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const box = cardRef.current.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) {
      setPopoverSize((prev) =>
        Math.abs(prev.width - box.width) < 2 && Math.abs(prev.height - box.height) < 2
          ? prev
          : { width: box.width, height: box.height },
      );
    }
  }, [safeIndex, targetRect]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (isLast) onDismiss();
        else setStepIndex((i) => Math.min(totalSteps - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!isFirst) setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFirst, isLast, onDismiss, setStepIndex, totalSteps]);

  const popoverPos = useMemo(
    () =>
      computePopoverPosition(
        targetRect,
        stepPlacement,
        popoverSize.width,
        popoverSize.height,
      ),
    [targetRect, stepPlacement, popoverSize.width, popoverSize.height],
  );

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  const cutout = targetRect
    ? {
        top: Math.max(0, targetRect.top - SPOTLIGHT_PADDING),
        left: Math.max(0, targetRect.left - SPOTLIGHT_PADDING),
        right: Math.min(vw, targetRect.right + SPOTLIGHT_PADDING),
        bottom: Math.min(vh, targetRect.bottom + SPOTLIGHT_PADDING),
      }
    : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[85] pointer-events-none font-sans"
      aria-live="polite"
    >
      {/* 4-panel flat dark scrim leaving the highlighted UI target crisp & visible */}
      {cutout ? (
        <>
          <div
            onClick={onDismiss}
            className="fixed left-0 right-0 top-0 bg-black/65 pointer-events-auto transition-all duration-150"
            style={{ height: cutout.top }}
          />
          <div
            onClick={onDismiss}
            className="fixed left-0 right-0 bottom-0 bg-black/65 pointer-events-auto transition-all duration-150"
            style={{ top: cutout.bottom }}
          />
          <div
            onClick={onDismiss}
            className="fixed left-0 bg-black/65 pointer-events-auto transition-all duration-150"
            style={{
              top: cutout.top,
              height: Math.max(0, cutout.bottom - cutout.top),
              width: cutout.left,
            }}
          />
          <div
            onClick={onDismiss}
            className="fixed right-0 bg-black/65 pointer-events-auto transition-all duration-150"
            style={{
              top: cutout.top,
              height: Math.max(0, cutout.bottom - cutout.top),
              left: cutout.right,
            }}
          />
          {/* Crisp 2px highlight frame around the live UI control */}
          <div
            className="portfolio-studio fixed rounded-md border-2 border-[var(--color-primary)] pointer-events-none transition-all duration-150"
            style={{
              top: cutout.top,
              left: cutout.left,
              width: Math.max(0, cutout.right - cutout.left),
              height: Math.max(0, cutout.bottom - cutout.top),
              backgroundColor: "transparent",
            }}
          />
        </>
      ) : (
        <div
          onClick={onDismiss}
          className="fixed inset-0 bg-black/65 pointer-events-auto"
        />
      )}

      {/* Compact Anchored Guidance Popover */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          top: popoverPos.top,
          left: popoverPos.left,
          width: `min(${POPOVER_WIDTH}px, calc(100vw - 24px))`,
        }}
        className="portfolio-studio fixed pointer-events-auto rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-strong)] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)] text-[var(--color-text)] overflow-hidden transition-all duration-150"
      >
        {/* Header */}
        <div className="px-4 py-2.5 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={13} className="text-[var(--color-primary)] shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] truncate">
              {tour.label}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-[10px] tabular-nums text-[var(--color-text-muted)]">
              {String(safeIndex + 1).padStart(2, "0")} /{" "}
              {String(totalSteps).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close tour"
              title="Skip guide (Esc)"
              className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <h3
              id={titleId}
              className="text-sm font-semibold tracking-tight text-[var(--color-text)] m-0"
            >
              {step.title}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed m-0">
              {step.description}
            </p>
          </div>

          {Array.isArray(step.connections) && step.connections.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {step.connections.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]"
                >
                  <Link2 size={10} className="text-[var(--color-primary)] shrink-0" />
                  <span>{item}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer: Skip / Dots / Prev / Next */}
        <div className="px-4 py-2.5 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
          >
            Skip
          </button>

          {totalSteps > 1 && (
            <div className="flex items-center gap-1" aria-hidden="true">
              {tour.steps.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStepIndex(idx)}
                  title={s.title}
                  className={`h-1.5 rounded-sm transition-all duration-150 cursor-pointer ${
                    idx === safeIndex
                      ? "w-4 bg-[var(--color-primary)]"
                      : "w-1.5 bg-[var(--color-border-strong)] hover:bg-[var(--color-text-muted)]"
                  }`}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[var(--color-surface)] hover:bg-[var(--color-bg)] text-[var(--color-text)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-xs font-medium transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              >
                <ChevronLeft size={13} />
                <span>Prev</span>
              </button>
            )}

            {!isLast ? (
              <button
                type="button"
                onClick={() => setStepIndex((i) => Math.min(totalSteps - 1, i + 1))}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-[var(--color-primary-foreground)] text-xs font-semibold transition-colors duration-150 active:scale-[0.98] cursor-pointer"
              >
                <Check size={13} />
                <span>Done</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
