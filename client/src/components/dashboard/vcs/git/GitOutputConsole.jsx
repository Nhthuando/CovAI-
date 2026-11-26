import { useRef, useState } from "react";
import { Loader2, Terminal } from "lucide-react";
import Button from "../../../common/Button";

const SUGGESTED_COMMANDS = [
  "git status",
  "git pull",
  "git fetch",
  "git push",
  "git log -n 5 --oneline",
  "git diff --stat",
  "git branch -a",
  "git remote -v",
];

/**
 * Interactive single-input Git Output Console supporting safe read & write commands,
 * quick-fill suggestion chips, and terminal-style Up/Down command history.
 */
export default function GitOutputConsole({
  logs = [],
  onClearLogs,
  onRunCommand,
  running = false,
}) {
  const [commandInput, setCommandInput] = useState("");
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const draftRef = useRef("");
  const inputRef = useRef(null);

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
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/60 text-xs">
        <span className="font-mono font-semibold text-[var(--color-text)] flex items-center gap-1.5">
          <Terminal size={13} className="text-[var(--color-primary)]" />
          Git Output Console
          <span className="font-sans font-normal text-[11px] text-[var(--color-text-muted)]">
            (Safe interactive Git CLI + action log)
          </span>
        </span>
        <button
          type="button"
          onClick={onClearLogs}
          className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
        >
          Clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mr-1">
          Quick:
        </span>
        {SUGGESTED_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => {
              setCommandInput(cmd);
              setHistoryIdx(-1);
              inputRef.current?.focus();
            }}
            className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/50 border border-[var(--color-border)] text-[10.5px] font-mono text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer transition-colors duration-150"
          >
            {cmd}
          </button>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]"
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
          className="flex-1 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] font-mono text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none transition-colors duration-150"
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

      <div className="p-3 max-h-52 overflow-y-auto bg-[var(--color-bg)] font-mono text-[11px] space-y-1.5 custom-scrollbar">
        {logs.length === 0 ? (
          <div className="text-[var(--color-text-muted)]">
            Type any safe Git command above (↑/↓ for history) or use the toolbar controls.
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
                {stamp}
                {text}
              </pre>
            );
          })
        )}
      </div>
    </div>
  );
}
