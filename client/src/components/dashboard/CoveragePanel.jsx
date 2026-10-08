/**
 * CoveragePanel: Panel with 3 buttons to select coverage type: Unit, Integration, System
 * Clicking each button switches the corresponding mode. Local UI & state only.
 */
const typeLabels = [
  { key: "unit", label: "Unit Test" },
  { key: "integration", label: "Integration Test" },
  { key: "system", label: "System Test" },
];

export default function CoveragePanel({
  sidebarWidth = 260,
  coverageType,
  setCoverageType,
}) {
  return (
    <div
      className="flex flex-col h-full flex-shrink-0"
      style={{
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        width: sidebarWidth,
        minWidth: 180,
        maxWidth: 440,
        position: "relative",
      }}
    >
      <div
        className="flex flex-col items-start px-6 pt-7 pb-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <span
          style={{
            color: "var(--color-primary)",
            fontWeight: 700,
            fontSize: 12,
            fontFamily: "var(--font-sans)",
            letterSpacing: "0.05em",
            marginBottom: 12,
            textTransform: "uppercase",
          }}
        >
          Coverage Type
        </span>
        <div className="flex flex-col gap-1.5 w-full mt-2">
          {typeLabels.map((t) => {
            const isSelected = coverageType === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setCoverageType(t.key)}
                className="transition-colors cursor-pointer text-left"
                style={{
                  width: "100%",
                  background: isSelected
                    ? "rgba(109, 93, 251, 0.12)"
                    : "transparent",
                  border: isSelected
                    ? "1px solid var(--color-primary)"
                    : "1px solid transparent",
                  color: isSelected
                    ? "var(--color-primary)"
                    : "var(--color-text-secondary)",
                  fontWeight: isSelected ? 600 : 500,
                  fontSize: 13,
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontFamily: "var(--font-sans)",
                  boxShadow: "none",
                  outline: "none",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "var(--color-bg)";
                    e.currentTarget.style.color = "var(--color-text)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "var(--color-text-secondary)";
                  }
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
