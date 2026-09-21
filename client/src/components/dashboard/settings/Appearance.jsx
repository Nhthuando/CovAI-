import { useState } from "react";
import { motion } from "framer-motion";
import {
  Palette,
  Check,
  Code2,
  Sliders,
  Sparkles,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useToast } from "../ToastContext";

export default function Appearance() {
  const { showToast } = useToast();
  const [selectedTheme, setSelectedTheme] = useState(
    localStorage.getItem("ide_theme") || "dark_violet",
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

  const themes = [
    {
      id: "dark_violet",
      name: "Dark Violet",
      desc: "Default TestCovAI neon palette with rich purple accents",
      bg: "#0d1117",
      accent: "#7c3aed",
      sidebar: "#161b22",
      border: "rgba(124, 58, 237, 0.4)",
    },
    {
      id: "midnight",
      name: "Midnight Slate",
      desc: "Deep navy blue palette inspired by VS Code Dark+",
      bg: "#0f172a",
      accent: "#38bdf8",
      sidebar: "#1e293b",
      border: "rgba(56, 189, 248, 0.4)",
    },
    {
      id: "obsidian",
      name: "Obsidian Black",
      desc: "High contrast pure black environment for OLED screens",
      bg: "#000000",
      accent: "#a78bfa",
      sidebar: "#0a0a0a",
      border: "rgba(255, 255, 255, 0.2)",
    },
    {
      id: "light",
      name: "Light Clean",
      desc: "Bright minimalist workspace with high legibility",
      bg: "#f8fafc",
      accent: "#6366f1",
      sidebar: "#f1f5f9",
      border: "rgba(99, 102, 241, 0.4)",
    },
  ];

  const handleSavePreferences = () => {
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
    <div
      style={{
        maxWidth: "920px",
        padding: "32px 28px 64px",
        fontFamily: "var(--font-sans)",
        color: "#e6edf3",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "#e6edf3",
            marginBottom: "6px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <Palette size={22} style={{ color: "#a78bfa" }} />
          Appearance & Editor
        </h1>
        <p style={{ color: "#8b949e", fontSize: "13px", margin: 0 }}>
          Customize the IDE theme, color palettes, and code editor typography.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Theme Selection Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div style={{ marginBottom: "18px" }}>
            <h3
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "#e6edf3",
                margin: 0,
              }}
            >
              IDE Theme Palette
            </h3>
            <p
              style={{ fontSize: "12px", color: "#8b949e", margin: "4px 0 0" }}
            >
              Select your preferred visual style for sidebar, panels, and editor
              background.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "14px",
            }}
          >
            {themes.map((t) => {
              const isSelected = selectedTheme === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTheme(t.id)}
                  style={{
                    background: isSelected
                      ? "rgba(124, 58, 237, 0.1)"
                      : "rgba(255, 255, 255, 0.02)",
                    border: isSelected
                      ? `2px solid ${t.accent}`
                      : "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "12px",
                    padding: "14px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    position: "relative",
                  }}
                >
                  {/* Color Swatch Preview */}
                  <div
                    style={{
                      height: "44px",
                      borderRadius: "8px",
                      background: t.bg,
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 10px",
                      gap: "8px",
                      marginBottom: "12px",
                    }}
                  >
                    <div
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "50%",
                        background: t.accent,
                        boxShadow: `0 0 8px ${t.accent}`,
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        height: "6px",
                        borderRadius: "3px",
                        background: t.sidebar,
                      }}
                    />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: isSelected ? "#fff" : "#c9d1d9",
                        }}
                      >
                        {t.name}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#6e7681",
                          marginTop: "2px",
                        }}
                      >
                        {t.desc.slice(0, 32)}…
                      </div>
                    </div>
                    {isSelected && (
                      <div
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          background: t.accent,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          flexShrink: 0,
                        }}
                      >
                        <Check size={12} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Code Editor Preferences Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "18px",
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(34, 211, 238, 0.12)",
                border: "1px solid rgba(34, 211, 238, 0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Code2 size={16} style={{ color: "#22d3ee" }} />
            </div>
            <div>
              <h3
                style={{
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#e6edf3",
                  margin: 0,
                }}
              >
                Code Editor Preferences
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: "#8b949e",
                  margin: "2px 0 0",
                }}
              >
                Fine-tune the typography and layout of the Monaco code editor.
              </p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "20px",
              marginBottom: "20px",
            }}
          >
            {/* Font Family */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#8b949e",
                  marginBottom: "6px",
                }}
              >
                Font Family
              </label>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  background: "rgba(0, 0, 0, 0.35)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  color: "#e6edf3",
                  fontSize: "13px",
                  outline: "none",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <option
                  value="JetBrains Mono"
                  style={{ background: "#161b22" }}
                >
                  JetBrains Mono (Recommended)
                </option>
                <option value="Fira Code" style={{ background: "#161b22" }}>
                  Fira Code
                </option>
                <option value="Menlo" style={{ background: "#161b22" }}>
                  Menlo
                </option>
                <option value="Consolas" style={{ background: "#161b22" }}>
                  Consolas
                </option>
              </select>
            </div>

            {/* Font Size */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#8b949e",
                  marginBottom: "6px",
                }}
              >
                Font Size
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                {["12px", "13px", "14px", "15px", "16px"].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setFontSize(size)}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: "8px",
                      background:
                        fontSize === size
                          ? "rgba(124, 58, 237, 0.2)"
                          : "rgba(0, 0, 0, 0.3)",
                      border:
                        fontSize === size
                          ? "1px solid #7c3aed"
                          : "1px solid rgba(255, 255, 255, 0.1)",
                      color: fontSize === size ? "#c4b5fd" : "#8b949e",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Editor Toggles */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              paddingTop: "16px",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Minimap */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#e6edf3",
                  }}
                >
                  Code Minimap
                </div>
                <div style={{ fontSize: "12px", color: "#8b949e" }}>
                  Display visual miniature overview of the code on the right
                  gutter
                </div>
              </div>
              <input
                type="checkbox"
                checked={showMinimap}
                onChange={(e) => setShowMinimap(e.target.checked)}
                style={{
                  width: "18px",
                  height: "18px",
                  accentColor: "#7c3aed",
                  cursor: "pointer",
                }}
              />
            </div>

            {/* Line Numbers */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#e6edf3",
                  }}
                >
                  Show Line Numbers
                </div>
                <div style={{ fontSize: "12px", color: "#8b949e" }}>
                  Render line numbering alongside code in the active editor
                </div>
              </div>
              <input
                type="checkbox"
                checked={lineNumbers}
                onChange={(e) => setLineNumbers(e.target.checked)}
                style={{
                  width: "18px",
                  height: "18px",
                  accentColor: "#7c3aed",
                  cursor: "pointer",
                }}
              />
            </div>

            {/* Word Wrap */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "#e6edf3",
                  }}
                >
                  Word Wrap
                </div>
                <div style={{ fontSize: "12px", color: "#8b949e" }}>
                  Soft wrap long lines at viewport width rather than scrolling
                  horizontally
                </div>
              </div>
              <input
                type="checkbox"
                checked={wordWrap}
                onChange={(e) => setWordWrap(e.target.checked)}
                style={{
                  width: "18px",
                  height: "18px",
                  accentColor: "#7c3aed",
                  cursor: "pointer",
                }}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "24px",
              paddingTop: "20px",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={handleSavePreferences}
              style={{
                padding: "9px 22px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
                border: "none",
                fontSize: "13px",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 2px 10px rgba(124, 58, 237, 0.35)",
              }}
            >
              Save Preferences
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
