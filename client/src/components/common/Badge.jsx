export function Badge({
  children,
  variant = "default",
  size = "md",
  className = "",
  icon: Icon,
  pill = false,
}) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium select-none border transition-colors whitespace-nowrap shrink-0";

  const sizeStyles = {
    sm: "text-[11px] px-2 py-0.5 gap-1",
    md: "text-xs px-2.5 py-1 gap-1.5",
    lg: "text-sm px-3 py-1.5 gap-2",
  };

  const radiusStyles = pill ? "rounded-full" : "rounded-[var(--radius-sm)]";

  const variantStyles = {
    default:
      "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
    primary:
      "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30",
    secondary:
      "bg-[var(--color-secondary)]/10 text-[var(--color-secondary)] border-[var(--color-secondary)]/30",
    success:
      "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30",
    warning:
      "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30",
    danger:
      "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30",
    info: "bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/30",
    outline:
      "bg-transparent text-[var(--color-text-secondary)] border-[var(--color-border)]",
  };

  return (
    <span
      className={`${baseStyles} ${sizeStyles[size] || sizeStyles.md} ${radiusStyles} ${
        variantStyles[variant] || variantStyles.default
      } ${className}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      {children}
    </span>
  );
}

export default Badge;
