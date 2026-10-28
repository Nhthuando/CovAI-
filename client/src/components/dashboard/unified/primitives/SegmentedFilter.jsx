export function SegmentedFilter({
  options = [],
  value,
  onChange,
  size = "sm",
  idPrefix = "ud-filter",
  className = "",
}) {
  const sizeStyles = {
    sm: "text-xs px-2.5 py-1",
    md: "text-xs px-3 py-1.5",
  };

  return (
    <div
      role="group"
      className={`inline-flex items-center rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface-2)] p-0.5 select-none ${className}`}
    >
      {options.map((opt) => {
        const isSelected = value === opt.value;
        const optId = `${idPrefix}-${String(opt.value).toLowerCase().replace(/\s+/g, "-")}`;
        return (
          <button
            key={opt.value}
            id={optId}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] font-medium transition-colors cursor-pointer ${
              sizeStyles[size] || sizeStyles.sm
            } ${
              isSelected
                ? "bg-[var(--ud-surface)] text-[var(--ud-text)] shadow-xs font-semibold"
                : "text-[var(--ud-text-muted)] hover:text-[var(--ud-text)]"
            }`}
          >
            {opt.icon && <opt.icon size={13} className="shrink-0" />}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`text-[10px] font-mono tabular-nums px-1 rounded ${
                  isSelected
                    ? "bg-[var(--ud-surface-2)] text-[var(--ud-text)]"
                    : "text-[var(--ud-text-muted)]"
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedFilter;
