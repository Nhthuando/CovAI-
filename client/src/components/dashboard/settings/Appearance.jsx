export default function Appearance() {
  return (
    <div style={{ maxWidth: "896px", padding: "24px" }}>
      <h1
        style={{
          fontSize: "24px",
          fontWeight: 600,
          color: "#e6edf3",
          marginBottom: "8px",
        }}
      >
        Appearance
      </h1>
      <p style={{ color: "#8b949e", marginBottom: "32px" }}>
        Customize the IDE visual environment.
      </p>

      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        <h3
          style={{
            fontSize: "16px",
            fontWeight: 500,
            color: "#e6edf3",
            marginBottom: "16px",
          }}
        >
          IDE Theme
        </h3>
        <div style={{ display: "flex", gap: "16px" }}>
          {["Light", "Dark", "System"].map((theme) => (
            <button
              key={theme}
              style={{
                flex: 1,
                padding: "16px",
                borderRadius: "8px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#e6edf3",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              {theme}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
