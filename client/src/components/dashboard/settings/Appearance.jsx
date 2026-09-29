import { useState } from "react";
import { Palette, Check, Code2, Sun, Moon, Monitor } from "lucide-react";
import { useToast } from "../ToastContext";
import { useTheme } from "../../../contexts/ThemeContext";
import Button from "../../common/Button";

export default function Appearance() {
  const { showToast } = useToast();
  const { theme, setTheme } = useTheme();

  const [selectedTheme, setSelectedTheme] = useState(
    theme || localStorage.getItem("covai_theme") || "dark",
  );
  const [fontSize, setFontSize] = useState(
    localStorage.getItem("editor_font_size") || "13px",
  );
  const [fontFamily, setFontFamily] = useState(
    localStorage.getItem("editor_font_family") || "JetBrains Mono",
  );
  const [showMinimap, setShowMinimap] = useState(
    localStorage.getItem("editor_minimap") !== "false",
  );
  const [lineNumbers, setLineNumbers] = useState(
    localStorage.getItem("editor_line_numbers") !== "false",
  );
  const [wordWrap, setWordWrap] = useState(
    localStorage.getItem("editor_word_wrap") === "true",
  );

  const themeOptions = [
    {
      id: "dark",
      name: "Dark Environment",
      desc: "Default developer dark theme with high syntax contrast",
      icon: Moon,
      bg: "#0b0f14",
      sidebar: "#11161d",
      accent: "#8b7cfd",
      border: "#29313d",
    },
    {
      id: "light",
      name: "Light Clean",
      desc: "Bright minimalist workspace with crisp typography & legibility",
      icon: Sun,
      bg: "#ffffff",
      sidebar: "#f8fafc",
      accent: "#6d5dfb",
      border: "#e2e8f0",
    },
    {
      id: "system",
      name: "System Default",
      desc: "Automatically synchronize with your operating system preference",
      icon: Monitor,
      bg: "var(--color-bg)",
      sidebar: "var(--color-surface)",
      accent: "var(--color-primary)",
      border: "var(--color-border)",
    },
  ];

  const handleSelectTheme = (themeId) => {
    setSelectedTheme(themeId);
    setTheme(themeId);
  };

  const handleSavePreferences = () => {
    setTheme(selectedTheme);
    localStorage.setItem("covai_theme", selectedTheme);
    localStorage.setItem("ide_theme", selectedTheme);
    localStorage.setItem("editor_font_size", fontSize);
    localStorage.setItem("editor_font_family", fontFamily);
    localStorage.setItem("editor_minimap", showMinimap);
    localStorage.setItem("editor_line_numbers", lineNumbers);
    localStorage.setItem("editor_word_wrap", wordWrap);

    showToast({
      type: "success",
      title: "Preferences Saved",
      message: "Editor and appearance settings have been applied.",
    });
  };

  return (
    <div className="max-w-4xl p-6 sm:p-8 font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] mb-1 flex items-center gap-2.5">
          <Palette size={22} className="text-[var(--color-primary)]" />
          Appearance & Editor
        </h1>
        <p className="text-xs sm:text-sm text-[var(--color-text-secondary)]">
          Customize the workspace theme, color modes, and code editor
          typography.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Theme Selection Card */}
        <div className="p-6 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Workspace Theme
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Select your visual mode for panels, code editor, and navigation
              chrome.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {themeOptions.map((t) => {
              const isSelected = selectedTheme === t.id;
              const Icon = t.icon;

              return (
                <div
                  key={t.id}
                  onClick={() => handleSelectTheme(t.id)}
                  className={`p-4 rounded-[var(--radius-md)] border cursor-pointer transition-all flex flex-col justify-between ${
                    isSelected
                      ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
                      : "bg-[var(--color-bg)] border-[var(--color-border)] hover:border-[var(--color-border-subtle)]"
                  }`}
                >
                  <div>
                    {/* Header: Icon & Check */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)]">
                        <Icon size={16} />
                      </div>
                      {isSelected && (
                        <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white shrink-0">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                    </div>

                    <div className="text-sm font-semibold text-[var(--color-text)]">
                      {t.name}
                    </div>
                    <div className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                      {t.desc}
                    </div>
                  </div>

                  {/* Visual preview strip */}
                  <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center gap-1.5">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-[var(--color-border)] inline-block shrink-0"
                      style={{ backgroundColor: t.accent }}
                    />
                    <span
                      className="h-2 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] inline-block"
                      style={{ backgroundColor: t.bg }}
                    />
                    <span
                      className="h-2 w-6 rounded-[var(--radius-sm)] border border-[var(--color-border)] inline-block"
                      style={{ backgroundColor: t.sidebar }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Code Editor Preferences Card */}
        <div className="p-6 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xs">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)]">
              <Code2 size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Code Editor Preferences
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Configure Monaco editor typography, font sizes, and layout
                options.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            {/* Font Family */}
            <div>
              <label
                htmlFor="font-family-select"
                className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5"
              >
                Font Family
              </label>
              <select
                id="font-family-select"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-xs text-[var(--color-text)] font-mono outline-none focus:border-[var(--color-primary)] cursor-pointer"
              >
                <option value="JetBrains Mono">
                  JetBrains Mono (Recommended)
                </option>
                <option value="Fira Code">Fira Code</option>
                <option value="Menlo">Menlo</option>
                <option value="Consolas">Consolas</option>
              </select>
            </div>

            {/* Font Size */}
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                Font Size
              </label>
              <div className="flex gap-2">
                {["12px", "13px", "14px", "15px", "16px"].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setFontSize(size)}
                    className={`flex-1 py-1.5 rounded-[var(--radius-md)] text-xs font-mono font-medium transition-colors cursor-pointer border ${
                      fontSize === size
                        ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                        : "bg-[var(--color-bg)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Editor Toggles */}
          <div className="flex flex-col gap-3.5 pt-4 border-t border-[var(--color-border)]">
            {/* Minimap */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-[var(--color-text)]">
                  Code Minimap
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                  Display miniature code outline on the right gutter
                </div>
              </div>
              <input
                type="checkbox"
                checked={showMinimap}
                onChange={(e) => setShowMinimap(e.target.checked)}
                className="w-4 h-4 accent-[var(--color-primary)] cursor-pointer"
              />
            </div>

            {/* Line Numbers */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-[var(--color-text)]">
                  Show Line Numbers
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                  Render line numbering alongside code in the active editor
                </div>
              </div>
              <input
                type="checkbox"
                checked={lineNumbers}
                onChange={(e) => setLineNumbers(e.target.checked)}
                className="w-4 h-4 accent-[var(--color-primary)] cursor-pointer"
              />
            </div>

            {/* Word Wrap */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-[var(--color-text)]">
                  Word Wrap
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                  Wrap long lines at viewport width instead of horizontal
                  scrolling
                </div>
              </div>
              <input
                type="checkbox"
                checked={wordWrap}
                onChange={(e) => setWordWrap(e.target.checked)}
                className="w-4 h-4 accent-[var(--color-primary)] cursor-pointer"
              />
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end mt-6 pt-4 border-t border-[var(--color-border)]">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleSavePreferences}
            >
              Save Preferences
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
