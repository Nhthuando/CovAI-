import { useState } from "react";

const BEFORE_LINES = [
  { num: 1, code: "export async function verifyWebhook(req, secret) {", state: "normal" },
  { num: 2, code: "  const sig = req.headers['x-covai-signature'];", state: "normal" },
  { num: 3, code: "  if (!sig || !timingSafeEqual(sig, secret)) {", state: "normal" },
  { num: 4, code: "    throw new AuthError('ERR_INVALID_HMAC_DIGEST');", state: "fault" },
  { num: 5, code: "  }", state: "normal" },
  { num: 6, code: "  if (Date.now() - req.timestamp > 300_000) {", state: "normal" },
  { num: 7, code: "    throw new AuthError('ERR_REPLAY_WINDOW_EXPIRED');", state: "fault" },
  { num: 8, code: "  }", state: "normal" },
  { num: 9, code: "  return { verified: true, eventId: req.body.id };", state: "normal" },
  { num: 10, code: "}", state: "normal" },
];

const AFTER_LINES = [
  { num: 1, code: "describe('verifyWebhook() branch verification', () => {", state: "normal" },
  { num: 2, code: "  it('rejects tampered HMAC digest (line 4)', async () => {", state: "verified" },
  { num: 3, code: "    const req = mockRequest({ sig: '0xdeadbeef' });", state: "normal" },
  { num: 4, code: "    await expect(verifyWebhook(req, SECRET))", state: "verified" },
  { num: 5, code: "      .rejects.toThrow('ERR_INVALID_HMAC_DIGEST');", state: "verified" },
  { num: 6, code: "  });", state: "normal" },
  { num: 7, code: "  it('blocks expired replay timestamp (line 7)', async () => {", state: "verified" },
  { num: 8, code: "    const req = mockRequest({ timestamp: Date.now() - 600_000 });", state: "normal" },
  { num: 9, code: "    await expect(verifyWebhook(req, SECRET))", state: "verified" },
  { num: 10, code: "      .rejects.toThrow('ERR_REPLAY_WINDOW_EXPIRED');", state: "verified" },
  { num: 11, code: "  });", state: "normal" },
  { num: 12, code: "});", state: "normal" },
];

export default function CodePreview() {
  const [view, setView] = useState("spec"); // "spec" | "ast"
  const lines = view === "spec" ? AFTER_LINES : BEFORE_LINES;

  return (
    <div className="w-full rounded-xl lp-machined overflow-hidden lp-mono text-xs select-none">
      {/* Header Bar */}
      <div className="px-4 py-2.5 bg-[var(--lp-surface)] border-b border-[var(--lp-line)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              view === "spec" ? "bg-[var(--lp-signal)]" : "bg-[var(--lp-fault)]"
            }`}
          />
          <span className="text-[var(--lp-ink)] text-[11px] font-medium">
            {view === "spec"
              ? "tests/unit/verifyWebhook.spec.ts"
              : "src/security/verifyWebhook.ts"}
          </span>
        </div>

        <div className="inline-flex items-center p-0.5 rounded-md bg-[var(--lp-pill-bg)] border border-[var(--lp-line)] text-[10px]">
          <button
            type="button"
            onClick={() => setView("ast")}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              view === "ast"
                ? "bg-[var(--lp-pill-active)] text-[var(--lp-ink)] shadow-xs"
                : "text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)]"
            }`}
          >
            Untested AST
          </button>
          <button
            type="button"
            onClick={() => setView("spec")}
            className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
              view === "spec"
                ? "bg-[var(--lp-pill-active)] text-[var(--lp-signal)] shadow-xs"
                : "text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)]"
            }`}
          >
            Verified Spec
          </button>
        </div>
      </div>

      {/* Code Lines */}
      <div className="p-3.5 bg-[var(--lp-inset)] leading-[1.7] overflow-x-auto">
        {lines.map((line) => (
          <div
            key={line.num}
            className={`flex items-center px-2 py-0.5 transition-colors ${
              line.state === "verified"
                ? "bg-[var(--lp-signal-bg)] border-l-2 border-[var(--lp-signal)]"
                : line.state === "fault"
                  ? "bg-[var(--lp-fault-bg)] border-l-2 border-[var(--lp-fault)]"
                  : "border-l-2 border-transparent"
            }`}
          >
            <span className="w-6 text-right pr-3 select-none text-[var(--lp-ink-muted)] text-[10px] shrink-0">
              {line.num}
            </span>
            <span
              className={`whitespace-pre ${
                line.state === "verified"
                  ? "text-[var(--lp-signal)] font-medium"
                  : line.state === "fault"
                    ? "text-[var(--lp-fault-ink)]"
                    : "text-[var(--lp-ink)]"
              }`}
            >
              {line.code}
            </span>
          </div>
        ))}
      </div>

      {/* Status Footer */}
      <div className="px-4 py-2.5 bg-[var(--lp-surface)] border-t border-[var(--lp-line)] flex items-center justify-between text-[11px]">
        <span className="text-[var(--lp-ink-secondary)]">
          {view === "spec"
            ? "Docker runner: 2 passed (14ms)"
            : "2 unreached branches detected"}
        </span>
        <span
          className={`font-semibold ${
            view === "spec" ? "text-[var(--lp-signal)]" : "text-[var(--lp-fault)]"
          }`}
        >
          {view === "spec" ? "100% branch cov" : "50% branch cov"}
        </span>
      </div>
    </div>
  );
}
