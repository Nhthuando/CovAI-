import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";

export function ThemeSelector({ className = "", compact = false }) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const options = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];

  if (compact) {
    // Quick single-button cycle: light -> dark -> system
    const nextTheme =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    const ActiveIcon =
      resolvedTheme === "light" ? Sun : theme === "system" ? Monitor : Moon;

    return (
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        title={`Theme: ${theme} (Click to switch to ${nextTheme})`}
        aria-label={`Current theme is ${theme}. Switch to ${nextTheme}`}
        className={`w-8 h-8 rounded-[var(--radius-sm)] flex items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] cursor-pointer ${className}`}
      >
        <ActiveIcon className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Theme selection"
      className={`inline-flex items-center p-0.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => setTheme(opt.id)}
            aria-pressed={isActive}
            aria-label={`${opt.label} theme`}
            title={`${opt.label} theme`}
            className={`flex items-center justify-center px-2 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors cursor-pointer ${
              isActive
                ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
            }`}
          >
            <Icon className="w-3.5 h-3.5 mr-1" />
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ThemeSelector;
