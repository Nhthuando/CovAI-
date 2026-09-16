/**
 * CoveragePanel: Panel chứa 3 nút để chọn loại coverage: Unit, Integration, System
 * Khi nhấn từng nút sẽ đổi mode tương ứng. Chỉ là UI & state local. Có thể custom hoặc lấy coverageType via prop nếu cần kết nối ngoài.
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
        background: "var(--ide-sidebar)",
        borderRight: "1px solid var(--ide-border)",
        width: sidebarWidth,
        minWidth: 180,
        maxWidth: 440,
        position: "relative",
      }}
    >
      <div
        className="flex flex-col items-start px-6 pt-7 pb-2"
        style={{ borderBottom: "1px solid var(--ide-border)" }}
      >
        <span
          style={{
            color: "#a78bfa",
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "var(--font-sans)",
            letterSpacing: "-0.02em",
            marginBottom: 12,
            textTransform: "uppercase",
          }}
        >
          Coverage Type
        </span>
        <div className="flex flex-col gap-2 w-full mt-2">
          {typeLabels.map((t) => (
            <button
              key={t.key}
              onClick={() => setCoverageType(t.key)}
              style={{
                width: "100%",
                background:
                  coverageType === t.key
                    ? "linear-gradient(90deg, #a78bfa33 0%, #7c3aed33 100%)"
                    : "transparent",
                border:
                  coverageType === t.key
                    ? "1.5px solid #a78bfa"
                    : "1.5px solid transparent",
                color: coverageType === t.key ? "#a78bfa" : "#b6b6b6",
                fontWeight: coverageType === t.key ? 600 : 500,
                fontSize: 15,
                borderRadius: 8,
                padding: "8px 12px",
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
                boxShadow:
                  coverageType === t.key
                    ? "0 0 6px rgba(167,139,250,.12)"
                    : "none",
                transition: "all 0.15s",
                marginBottom: 2,
                outline: "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
