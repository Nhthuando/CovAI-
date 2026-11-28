import { useEffect, useRef, useState } from "react";
import { Loader2, Terminal, Trash2, X } from "lucide-react";
import Button from "../../../common/Button";

const SUGGESTED_COMMANDS = [
  "git status",
  "git pull",
  "git fetch",
  "git push",
  "git log -n 5 --oneline",
  "git diff --stat",
  "git branch -a",
];

const DEFAULT_PANEL_HEIGHT = 240;
const MIN_PANEL_HEIGHT = 140;

/**
 * VS Code-style docked bottom Git Output Console with interactive resize handle,
 * compact header + inline quick command chips, chronological auto-scrolling output,
 * and pinned bottom CLI prompt supporting Up/Down history.
 */
export default function GitOutputConsole({
  logs = [],
  onClearLogs,
  onRunCommand,
  onClose,
  running = false,
  containerRef = null,
}) {
  const [commandInput, setCommandInput] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const [resizing, setResizing] = useState(false);

  const draftRef = useRef("");
  const inputRef = useRef(null);
  const outputScrollRef = useRef(null);
  const dragCleanupRef = useRef(null);

  useEffect(() => {
    const el = outputScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const computeMaxHeight = () => {
    const hostHeight =
      containerRef?.current?.clientHeight ||
      (typeof window !== "undefined" ? window.innerHeight : 720);
    return Math.max(MIN_PANEL_HEIGHT + 40, Math.floor(hostHeight * 0.55));
  };

  const handleResizeStart = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;
    setResizing(true);

    const handleMove = (moveEvent) => {
      const delta = startY - moveEvent.clientY;
      const maxHeight = computeMaxHeight();
      const next = Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, startHeight + delta));
      setPanelHeight(next);
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", cleanup);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      dragCleanupRef.current = null;
      setResizing(false);
    };

    dragCleanupRef.current = cleanup;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", cleanup);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const raw = commandInput.trim();
    if (!raw || running) return;

    setHistory((prev) => [raw, ...prev.filter((item) => item !== raw)].slice(0, 50));
    setHistoryIdx(-1);
    draftRef.current = "";
    setCommandInput("");
    await onRunCommand?.(raw);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIdx === -1) {
        draftRef.current = commandInput;
      }
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setCommandInput(history[nextIdx]);
    } else if (e.key === "ArrowDown") {
      if (historyIdx === -1) return;
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setCommandInput(draftRef.current);
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setCommandInput(history[nextIdx]);
      }
    }
  };

  return (
    <div
      data-testid="git-output-console"
      style={{ height: panelHeight }}
      className="shrink-0 flex flex-col border-t border-[var(--color-border-strong)] bg-[var(--color-bg)] overflow-hidden"
    >
      {/* Top Interactive Resize Handle */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize Git Output Console"
        title="Drag to resize console (double-click to reset)"
        onMouseDown={handleResizeStart}
        onDoubleClick={() => setPanelHeight(DEFAULT_PANEL_HEIGHT)}
        className={`h-1.5 shrink-0 cursor-row-resize flex items-center justify-center transition-colors duration-150 ${
          resizing
            ? "bg-[var(--color-primary)]/40"
            : "bg-[var(--color-surface)] hover:bg-[var(--color-primary)]/25"
        }`}
      >
        <span className="w-8 h-0.5 rounded-full bg-[var(--color-border-strong)]" />
      </div>

      {/* Compact Single-Row Terminal Header + Inline Quick Chips */}
      <div className="shrink-0 flex items-center justify-between gap-2.5 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="font-mono text-[11.5px] font-semibold text-[var(--color-text)] flex items-center gap-1.5 shrink-0">
            <Terminal size={13} className="text-[var(--color-primary)]" />
            <span>Git Console</span>
          </span>

          <div className="hidden sm:flex items-center gap-1 min-w-0 flex-1 overflow-x-auto custom-scrollbar">
            {SUGGESTED_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => {
                  setCommandInput(cmd);
                  setHistoryIdx(-1);
                  inputRef.current?.focus();
                }}
                className="px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-muted)] border border-[var(--color-border)] text-[10.5px] font-mono text-[var(--color-text-secondary)] hover:text-[var(--color-text)] whitespace-nowrap shrink-0 cursor-pointer transition-colors duration-150"
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onClearLogs}
            title="Clear console output"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer transition-colors duration-150"
          >
            <Trash2 size={11} />
            <span>Clear</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Git Console"
              title="Close Console"
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer transition-colors duration-150"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Monospace Output Stream */}
      <div
        ref={outputScrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 bg-[var(--color-bg)] font-mono text-[11.5px] leading-relaxed space-y-1.5 custom-scrollbar"
      >
        {logs.length === 0 ? (
          <div className="text-[var(--color-text-muted)] text-[11px]">
            Run any safe Git command below (↑/↓ for history) or use toolbar actions to view live output.
          </div>
        ) : (
          logs.map((entry, idx) => {
            const isObj = entry && typeof entry === "object";
            const text = isObj ? entry.text : String(entry);
            const stamp = isObj && entry.timestamp ? `[${entry.timestamp}] ` : "";
            const isError = isObj ? Boolean(entry.isError) : /-> ERROR:/.test(text);
            return (
              <pre
                key={isObj && entry.id ? entry.id : idx}
                className={`m-0 whitespace-pre-wrap break-all ${
                  isError
                    ? "text-[var(--color-danger)]"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="text-[var(--color-text-muted)]">{stamp}</span>
                {text}
              </pre>
            );
          })
        )}
      </div>

      {/* Pinned Bottom Command Prompt Bar */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-surface)]"
      >
        <span className="font-mono text-xs font-semibold text-[var(--color-primary)] select-none">
          $
        </span>
        <input
          ref={inputRef}
          type="text"
          value={commandInput}
          onChange={(e) => {
            setCommandInput(e.target.value);
            if (historyIdx !== -1) setHistoryIdx(-1);
          }}
          onKeyDown={handleKeyDown}
          aria-label="Git CLI command input"
          placeholder="git status, git pull, git fetch, git log -n 5, git diff, git checkout <branch>..."
          className="flex-1 h-7 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] font-mono text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors duration-150"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!commandInput.trim() || running}
        >
          {running ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Running
            </span>
          ) : (
            "Run"
          )}
        </Button>
      </form>
    </div>
  );
}
