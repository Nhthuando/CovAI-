import { Terminal, Network, MonitorPlay } from "lucide-react";

export function PillarBadge({
  pillar = "unit",
  size = "md",
  showIcon = true,
  className = "",
  label = null,
}) {
  const configs = {
    unit: {
      defaultLabel: "Unit",
      icon: Terminal,
      border: "border-[var(--ud-unit)]/40",
      bg: "bg-[var(--ud-unit)]/10",
      text: "text-[var(--ud-unit)]",
    },
    integration: {
      defaultLabel: "Integration",
      icon: Network,
      border: "border-[var(--ud-integration)]/40",
      bg: "bg-[var(--ud-integration)]/10",
      text: "text-[var(--ud-integration)]",
    },
    system: {
      defaultLabel: "System (E2E)",
      icon: MonitorPlay,
      border: "border-[var(--ud-system)]/40",
      bg: "bg-[var(--ud-system)]/10",
      text: "text-[var(--ud-system)]",
    },
  };

  const current = configs[pillar?.toLowerCase()] || configs.unit;
  const displayLabel = label || current.defaultLabel;
  const Icon = current.icon;

  const sizeStyles = {
    sm: "text-[10px] px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-0.5 gap-1.5",
    lg: "text-sm px-2.5 py-1 gap-2",
  };

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded-[var(--radius-sm)] border select-none whitespace-nowrap ${current.border} ${current.bg} ${current.text} ${sizeStyles[size] || sizeStyles.md} ${className}`}
    >
      {showIcon && <Icon size={size === "sm" ? 11 : 13} className="shrink-0" />}
      <span>{displayLabel}</span>
    </span>
  );
}

export default PillarBadge;
