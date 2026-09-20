import {
  User,
  Palette,
  Shield,
  Bell,
  CreditCard,
  LogOut,
  Settings,
} from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import { useNavigate } from "react-router-dom";

const SETTINGS_OPTIONS = [
  {
    id: "profile",
    label: "Profile",
    icon: User,
    desc: "Personal info & avatar",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    desc: "Themes & editor font",
  },
  { id: "security", label: "Security", icon: Shield, desc: "Password & 2FA" },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    desc: "Alerts & preferences",
  },
  {
    id: "billing",
    label: "Billing",
    icon: CreditCard,
    desc: "Plans & AI quotas",
  },
];

export default function SettingsSidebar({
  activeSetting,
  onSelectSetting,
  variant = "sidebar",
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  if (variant === "tabs") {
    return (
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "10px 14px",
          overflowX: "auto",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
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
                padding: "6px 14px",
                borderRadius: "8px",
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: "nowrap",
                flexShrink: 0,
                background: isActive
                  ? "rgba(124, 58, 237, 0.15)"
                  : "rgba(255, 255, 255, 0.03)",
                color: isActive ? "#c4b5fd" : "#8b949e",
                border: isActive
                  ? "1px solid rgba(124, 58, 237, 0.35)"
                  : "1px solid rgba(255, 255, 255, 0.06)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <Icon
                size={13}
                style={{ color: isActive ? "#a78bfa" : "#8b949e" }}
              />
              {option.label}
            </button>
          );
        })}
        <button
          onClick={handleLogout}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: "8px",
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
            flexShrink: 0,
            background: "rgba(239, 68, 68, 0.06)",
            color: "#f87171",
            border: "1px solid rgba(239, 68, 68, 0.2)",
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
        borderRight: "1px solid rgba(255, 255, 255, 0.08)",
        width: "100%",
        justifyContent: "space-between",
        userSelect: "none",
      }}
    >
      <div>
        <div
          style={{
            padding: "18px 16px 12px",
            fontSize: "11px",
            fontWeight: 700,
            color: "#8b949e",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Settings size={13} style={{ color: "#a78bfa" }} />
          Preferences & Settings
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: "0 10px",
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
                  gap: "12px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: isActive ? 600 : 500,
                  background: isActive
                    ? "rgba(124, 58, 237, 0.14)"
                    : "transparent",
                  color: isActive ? "#e6edf3" : "#8b949e",
                  border: isActive
                    ? "1px solid rgba(124, 58, 237, 0.3)"
                    : "1px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  textAlign: "left",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background =
                      "rgba(255, 255, 255, 0.04)";
                    e.currentTarget.style.color = "#c9d1d9";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "#8b949e";
                  }
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: isActive
                      ? "rgba(124, 58, 237, 0.25)"
                      : "rgba(255, 255, 255, 0.03)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon
                    size={15}
                    style={{ color: isActive ? "#c4b5fd" : "#8b949e" }}
                  />
                </div>
                <div>
                  <div>{option.label}</div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: isActive ? "#a78bfa" : "#6e7681",
                      fontWeight: 400,
                    }}
                  >
                    {option.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          padding: "16px",
          borderTop: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <button
          onClick={handleLogout}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "9px 12px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 500,
            background: "rgba(239, 68, 68, 0.06)",
            color: "#f87171",
            border: "1px solid rgba(239, 68, 68, 0.2)",
            cursor: "pointer",
            width: "100%",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
            e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.06)";
            e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.2)";
          }}
        >
          <LogOut size={15} />
          Log Out
        </button>
      </div>
    </div>
  );
}
