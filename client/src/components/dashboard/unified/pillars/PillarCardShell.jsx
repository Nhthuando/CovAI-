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
  const topBorderColors = {
    unit: "border-t-[3px] border-t-[var(--ud-unit)]",
    integration: "border-t-[3px] border-t-[var(--ud-integration)]",
    system: "border-t-[3px] border-t-[var(--ud-system)]",
  };

  return (
    <article
      className={`rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 flex flex-col justify-between min-h-[380px] shadow-xs transition-colors hover:border-[var(--ud-border)]/90 ${
        topBorderColors[pillar] || topBorderColors.unit
      } ${className}`}
    >
      <div>
        {/* Card Header — Zero truncation with shrink-0 and whitespace-nowrap */}
        <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[var(--ud-border)] gap-1.5">
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

        {/* Content Body */}
        <div className="py-3 space-y-3">{children}</div>
      </div>

      {/* Card Footer */}
      <div className="pt-3 border-t border-[var(--ud-border)]">
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
