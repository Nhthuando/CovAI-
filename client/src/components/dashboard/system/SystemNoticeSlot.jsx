import { CheckCircle2, X, FileCheck2 } from "lucide-react";
import { Button } from "../../ui/button.jsx";
import { ExternalServicesBanner } from "./ExternalTestKeyNotices.jsx";
import GenerationProgressStrip from "./GenerationProgressStrip.jsx";
import SystemTestErrorNotice from "./SystemTestErrorNotice.jsx";
import { summarizeSystemTestPlan } from "../../../../../shared/systemTestPlan.js";

export default function SystemNoticeSlot({ generation, error, draft, external }) {
  const { task, dismissedId, onCancel, onReview, onRetry, onDismiss } = generation;
  const visibleTask = task && task.state !== "CANCELED" && task.id !== dismissedId;

  if (visibleTask && task.state === "RUNNING") {
    return <GenerationProgressStrip key={task.id} task={task} onCancel={onCancel} />;
  }
  if (error.message) return <SystemTestErrorNotice {...error} />;

  const { latest, count, applying, onApply, canUseAi, filling, onFillMissing } = draft;
  const hasPendingDraft =
    latest &&
    !latest.applied &&
    !latest.appliedAt &&
    !latest.stale &&
    ["GENERATED", "REVIEWED", "PENDING", "DRAFT"].includes(
      String(latest.state || latest.status || "DRAFT").toUpperCase(),
    );
  const applyDraft = hasPendingDraft ? () => onApply(latest) : undefined;
  const missing = summarizeSystemTestPlan(latest?.testPlan)?.missing || 0;
  const fillAction = hasPendingDraft && canUseAi && missing > 0 && (
    <Button size="sm" variant="secondary" loading={filling} disabled={applying || filling} onClick={() => onFillMissing(latest)}>
      Generate missing ({missing})
    </Button>
  );

  if (visibleTask) {
    return (
      <GenerationProgressStrip
        key={task.id}
        task={task}
        onReview={onReview}
        onRetry={onRetry}
        onDismiss={onDismiss}
        onApply={task.state === "SUCCEEDED" ? applyDraft : undefined}
        applying={applying || filling}
        fillAction={task.state === "SUCCEEDED" && task.draftId === latest?.aiTestId ? fillAction : null}
      />
    );
  }
  if (hasPendingDraft) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-sm">
        <FileCheck2 size={16} className="shrink-0 text-[var(--color-text-secondary)]" aria-hidden="true" />
        <p className="min-w-0 flex-1">Draft ready · {count} {count === 1 ? "test" : "tests"}</p>
        <Button size="sm" variant="outline" onClick={onReview}>Review</Button>
        {fillAction}
        <Button size="sm" onClick={applyDraft} loading={applying} disabled={filling}>Apply</Button>
      </div>
    );
  }
  return <ExternalServicesBanner {...external} />;
}

export function SystemNoticeToast({ message, onDismiss }) {
  if (!message) return null;

  return (
    <div role="status" className="fixed right-4 bottom-4 z-50 flex w-max max-w-[calc(100vw_-_2rem)] items-center gap-2 rounded-lg border border-emerald-500/30 bg-[var(--color-surface)] px-3 py-2 text-sm shadow-lg">
      <CheckCircle2 size={16} className="shrink-0 text-[color:color-mix(in_srgb,var(--color-text)_65%,#10b981)]" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss notification">
        <X />
      </Button>
    </div>
  );
}
