import { useState } from "react";
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
import ConfirmDialog from "../../common/ConfirmDialog";

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
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate("/", { replace: true });
  };

  if (variant === "tabs") {
    return (
      <div className="flex gap-1.5 p-2.5 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-10 font-sans">
        {SETTINGS_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = activeSetting === option.id;
          return (
            <button
              key={option.id}
              onClick={() => onSelectSetting(option.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                isActive
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/30 font-semibold"
                  : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={13} />
              {option.label}
            </button>
          );
        })}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] text-xs font-medium whitespace-nowrap shrink-0 bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/25 hover:bg-[var(--color-danger)]/20 transition-colors cursor-pointer"
        >
          <LogOut size={13} />
          Logout
        </button>

        <ConfirmDialog
          isOpen={showLogoutConfirm}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={handleLogout}
          title="Sign Out"
          message="Are you sure you want to sign out? You will be redirected to the home landing page."
          confirmText="Sign Out"
          cancelText="Cancel"
          variant="danger"
          icon={LogOut}
        />
      </div>
    );
  }

  // --- default: sidebar dọc (desktop/tablet) ---
  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] w-full justify-between select-none font-sans">
      <div>
        <div className="p-4 pb-2.5 text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
          <Settings size={13} className="text-[var(--color-primary)]" />
          Preferences & Settings
        </div>

        <div className="flex flex-col gap-1 px-2.5">
          {SETTINGS_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = activeSetting === option.id;
            return (
              <button
                key={option.id}
                onClick={() => onSelectSetting(option.id)}
                className={`flex items-center gap-3 p-2.5 rounded-[var(--radius-md)] text-xs transition-colors cursor-pointer text-left w-full border ${
                  isActive
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-text)] border-[var(--color-primary)]/30 font-semibold"
                    : "border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-[var(--radius-md)] flex items-center justify-center shrink-0 ${
                    isActive
                      ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)]"
                      : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]"
                  }`}
                >
                  <Icon size={15} />
                </div>
                <div>
                  <div className="text-xs font-semibold">{option.label}</div>
                  <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 font-normal">
                    {option.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3 border-t border-[var(--color-border)]">
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="flex items-center justify-center gap-2 p-2 rounded-[var(--radius-md)] text-xs font-medium bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/25 hover:bg-[var(--color-danger)]/20 transition-colors cursor-pointer w-full"
        >
          <LogOut size={14} />
          Log Out
        </button>
      </div>

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        title="Sign Out"
        message="Are you sure you want to sign out? You will be redirected to the home landing page."
        confirmText="Sign Out"
        cancelText="Cancel"
        variant="danger"
        icon={LogOut}
      />
    </div>
  );
}
