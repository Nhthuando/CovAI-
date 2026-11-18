import { ExternalLink } from "lucide-react";
import { PillarBadge } from "../primitives/PillarBadge.jsx";
import { StatusPill } from "../primitives/StatusPill.jsx";
import { Button } from "../../../common/Button.jsx";

export function PillarCardShell({
  pillar = "unit",
  framework = "Jest",
  status = "pass",
  statusLabel = null,
  counts = null,
  onOpenWorkspace,
  buttonLabel = "Open Workspace",
  buttonId = null,
  children,
  className = "",
}) {
  return (
    <article
      className={`rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between h-full min-h-[290px] transition-colors duration-150 hover:border-[var(--color-primary)]/40 ${className}`}
    >
      <div className="flex-1 flex flex-col">
        {/* Card Header — Zero truncation with shrink-0 and whitespace-nowrap */}
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[var(--ud-border)] gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <PillarBadge pillar={pillar} size="sm" className="shrink-0 whitespace-nowrap" />
            <span className="text-[11px] font-mono font-medium text-[var(--ud-text-muted)] bg-[var(--ud-surface-2)] px-1.5 py-0.5 rounded border border-[var(--ud-border)] shrink-0 whitespace-nowrap">
              {framework}
            </span>
          </div>
          <StatusPill
            status={status}
            label={statusLabel}
            counts={counts}
            size="sm"
            className="shrink-0 whitespace-nowrap"
          />
        </div>

        {/* Content Body — Stretches full vertical height for balanced empty states */}
        <div className="py-3 space-y-3 flex-1 flex flex-col">{children}</div>
      </div>

      {/* Card Footer */}
      <div className="pt-3 border-t border-[var(--ud-border)] shrink-0">
        <Button
          id={buttonId || `ud-pillar-${pillar}-open`}
          variant="secondary"
          size="sm"
          className="w-full justify-center"
          icon={ExternalLink}
          iconPosition="right"
          onClick={onOpenWorkspace}
        >
          {buttonLabel}
        </Button>
      </div>
    </article>
  );
}

export default PillarCardShell;
