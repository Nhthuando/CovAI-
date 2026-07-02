import { User, Palette, Shield, Bell, CreditCard, LogOut } from "lucide-react";

const SETTINGS_OPTIONS = [
  { id: "profile", label: "Profile", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "security", label: "Security", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing", icon: CreditCard },
];

export default function SettingsSidebar({ activeSetting, onSelectSetting, variant = "sidebar" }) {
  if (variant === "tabs") {
    return (
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "10px 12px",
          overflowX: "auto",
          borderBottom: "1px solid #21262d",
          background: "#0d1117",
          position: "sticky",
          top: 0,
          zIndex: 5,
        }}
      >
        {SETTINGS_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = activeSetting === option.id;
          return (
            <button
              key={option.id}
              onClick={() => onSelectSetting(option.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                whiteSpace: "nowrap",
                flexShrink: 0,
                background: isActive ? "rgba(124,58,237,0.15)" : "rgba(255,255,255,0.03)",
                color: isActive ? "#c4b5fd" : "#8b949e",
                border: isActive ? "1px solid rgba(124,58,237,0.3)" : "1px solid #21262d",
                cursor: "pointer",
              }}
            >
              <Icon size={13} />
              {option.label}
            </button>
          );
        })}
        <button
          onClick={() => {
            localStorage.removeItem("token");
            window.location.reload();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            borderRadius: 999,
            fontSize: 12,
            whiteSpace: "nowrap",
            flexShrink: 0,
            background: "transparent",
            color: "#f85149",
            border: "1px solid #f8514930",
            cursor: "pointer",
          }}
        >
          <LogOut size={13} />
          Logout
        </button>
      </div>
    );
  }

  // --- default: sidebar dọc (desktop/tablet) ---
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "#0d1117",
        borderRight: "1px solid #30363d",
        width: "100%",
        justifyContent: "space-between",
      }}
    >
      <div>
        <div
          style={{
            padding: "16px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#8b949e",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Settings
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 8px" }}>
          {SETTINGS_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = activeSetting === option.id;
            return (
              <button
                key={option.id}
                onClick={() => onSelectSetting(option.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  fontSize: "14px",
                  background: isActive ? "rgba(255,255,255,0.05)" : "transparent",
                  color: isActive ? "#e6edf3" : "#8b949e",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <Icon size={16} />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "16px" }}>
        <button
          onClick={() => {
            localStorage.removeItem("token");
            window.location.reload();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "14px",
            background: "transparent",
            color: "#f85149",
            border: "1px solid #f8514930",
            cursor: "pointer",
            width: "100%",
            transition: "all 0.2s ease",
          }}
        >
          <LogOut size={16} />
          Logout
        </button>
      </div>
    </div>
  );
}