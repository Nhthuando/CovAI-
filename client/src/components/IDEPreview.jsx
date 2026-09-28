import { useState } from "react";
import {
  FileCode,
  Folder,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Copy,
  Check,
  Play,
} from "lucide-react";
import Badge from "./common/Badge";
import Button from "./common/Button";

const CODE_LINES = [
  { num: 1, text: "import { processPayment } from './payment';", cov: "covered" },
  { num: 2, text: "import { sendEmail } from './mailer';", cov: "covered" },
  { num: 3, text: "", cov: null },
  { num: 4, text: "export function checkout(cart, user) {", cov: "covered" },
  { num: 5, text: "  if (!cart || cart.items.length === 0) {", cov: "covered" },
  { num: 6, text: "    throw new Error('Cart is empty');", cov: "uncovered" },
  { num: 7, text: "  }", cov: "covered" },
  { num: 8, text: "", cov: null },
  { num: 9, text: "  const total = cart.items.reduce(", cov: "covered" },
  { num: 10, text: "    (sum, item) => sum + item.price, 0", cov: "covered" },
  { num: 11, text: "  );", cov: "covered" },
  { num: 12, text: "", cov: null },
  { num: 13, text: "  if (user.balance < total) {", cov: "partial" },
  { num: 14, text: "    throw new Error('Insufficient funds');", cov: "uncovered" },
  { num: 15, text: "  }", cov: "partial" },
  { num: 16, text: "", cov: null },
  { num: 17, text: "  const receipt = processPayment(total);", cov: "covered" },
  { num: 18, text: "  sendEmail(user.email, receipt);", cov: "covered" },
  { num: 19, text: "  return receipt;", cov: "covered" },
  { num: 20, text: "}", cov: "covered" },
];

export default function IDEPreview() {
  const [activeTab, setActiveTab] = useState("coverage"); // 'coverage' | 'cfg' | 'test'
  const [copiedTest, setCopiedTest] = useState(false);

  const testSnippet = `describe('checkout() edge cases', () => {
  it('should throw Insufficient funds when balance is low', () => {
    const cart = { items: [{ price: 100 }] };
    const user = { balance: 25 };
    expect(() => checkout(cart, user)).toThrow('Insufficient funds');
  });

  it('should reject empty cart items', () => {
    expect(() => checkout({ items: [] }, { balance: 50 }))
      .toThrow('Cart is empty');
  });
});`;

  const handleCopyTest = () => {
    navigator.clipboard.writeText(testSnippet);
    setCopiedTest(true);
    setTimeout(() => setCopiedTest(false), 2000);
  };

  const getLineGutter = (cov) => {
    if (cov === "covered") {
      return (
        <span className="text-[var(--color-success)] font-mono text-[11px] leading-none select-none">
          ✓
        </span>
      );
    }
    if (cov === "uncovered") {
      return (
        <span className="text-[var(--color-danger)] font-mono text-[11px] leading-none font-bold select-none">
          ×
        </span>
      );
    }
    if (cov === "partial") {
      return (
        <span className="text-[var(--color-warning)] font-mono text-[10px] leading-none select-none">
          ⚑
        </span>
      );
    }
    return null;
  };

  const getLineBg = (cov) => {
    if (cov === "covered") return "bg-[var(--color-success)]/[0.04]";
    if (cov === "uncovered") return "bg-[var(--color-danger)]/[0.08]";
    if (cov === "partial") return "bg-[var(--color-warning)]/[0.06]";
    return "transparent";
  };

  return (
    <section
      id="ide-preview"
      className="py-20 md:py-28 bg-[var(--color-surface)] border-b border-[var(--color-border)]"
    >
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <Badge variant="primary" size="md" className="mb-3" pill>
            IDE & COVERAGE INSPECTOR
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tracking-tight mb-3">
            Real-Time Coverage Diagnostics & Test Generation
          </h2>
          <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
            Inspect statement and branch gaps with Istanbul-style visual gutter
            annotations, and trigger AI test synthesis directly from code.
          </p>
        </div>

        {/* IDE Mock Window */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden shadow-sm">
          {/* Top Window Bar */}
          <div className="h-10 px-4 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 mr-2">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-danger)]/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)]/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]/80" />
              </div>
              <span className="text-[var(--color-text-muted)] font-mono">src / services /</span>
              <span className="font-mono font-medium text-[var(--color-text)]">checkout.js</span>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="warning" size="sm">
                Branch: 55%
              </Badge>
              <span className="text-[var(--color-text-muted)] font-mono hidden sm:inline">
                JavaScript (ES2024)
              </span>
            </div>
          </div>

          {/* Editor Workspace: 3-column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[440px]">
            {/* Left Column: Explorer (2 cols) */}
            <div className="hidden md:block lg:col-span-2 bg-[var(--color-surface-secondary)] border-r border-[var(--color-border)] p-3 text-xs font-mono">
              <div className="text-[var(--color-text-muted)] text-[10px] font-bold uppercase tracking-wider mb-2 px-1">
                Explorer
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[var(--color-text-secondary)] font-medium px-1 py-0.5">
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  <Folder className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" />
                  <span>src/services</span>
                </div>
                <div className="pl-4 space-y-0.5">
                  <div className="flex items-center justify-between px-1.5 py-1 rounded-[var(--radius-sm)] bg-[var(--color-surface)] text-[var(--color-text)] font-semibold border border-[var(--color-border)]">
                    <div className="flex items-center gap-1.5 truncate">
                      <FileCode className="w-3.5 h-3.5 text-[var(--color-warning)] shrink-0" />
                      <span className="truncate">checkout.js</span>
                    </div>
                    <span className="text-[9px] px-1 rounded bg-[var(--color-danger)]/10 text-[var(--color-danger)] font-mono">
                      -2
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-1.5 py-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
                    <div className="flex items-center gap-1.5 truncate">
                      <FileCode className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">payment.js</span>
                    </div>
                    <span className="text-[9px] text-[var(--color-success)] font-mono">
                      100%
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-1.5 py-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
                    <div className="flex items-center gap-1.5 truncate">
                      <FileCode className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">mailer.js</span>
                    </div>
                    <span className="text-[9px] text-[var(--color-success)] font-mono">
                      95%
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-[var(--color-text-secondary)] font-medium px-1 py-0.5 mt-3">
                  <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  <Folder className="w-3.5 h-3.5 shrink-0" />
                  <span>tests</span>
                </div>
              </div>
            </div>

            {/* Middle Column: Code Editor with Line Gutter (6 cols on lg) */}
            <div className="lg:col-span-6 bg-[var(--color-bg)] overflow-x-auto p-4 border-b lg:border-b-0 lg:border-r border-[var(--color-border)]">
              {/* CodeLens Action Banner */}
              <div className="mb-3 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
                  <Sparkles className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                  <span>Line 14: Uncovered branch detected</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("test")}
                  className="text-xs font-medium text-[var(--color-primary)] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <span>Synthesize Test Case</span>
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Code Viewer */}
              <div className="font-mono text-xs leading-relaxed">
                {CODE_LINES.map((line) => (
                  <div
                    key={line.num}
                    className={`flex items-center group py-0.5 px-1 rounded-sm ${getLineBg(
                      line.cov
                    )}`}
                  >
                    {/* Coverage Gutter Glyph */}
                    <div className="w-4 flex items-center justify-center shrink-0">
                      {getLineGutter(line.cov)}
                    </div>
                    {/* Line Number */}
                    <div className="w-8 text-right pr-3 select-none text-[var(--color-text-muted)] text-[11px] shrink-0">
                      {line.num}
                    </div>
                    {/* Code Text */}
                    <div className="flex-1 whitespace-pre text-[var(--color-text)] overflow-hidden text-ellipsis">
                      {line.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Inspector Panel (4 cols on lg) */}
            <div className="lg:col-span-4 bg-[var(--color-surface)] flex flex-col">
              {/* Inspector Tab Bar */}
              <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]">
                <button
                  type="button"
                  onClick={() => setActiveTab("coverage")}
                  className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                    activeTab === "coverage"
                      ? "border-[var(--color-primary)] text-[var(--color-text)] bg-[var(--color-surface)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  Diagnostics
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("cfg")}
                  className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                    activeTab === "cfg"
                      ? "border-[var(--color-primary)] text-[var(--color-text)] bg-[var(--color-surface)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  CFG Branches
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("test")}
                  className={`flex-1 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                    activeTab === "test"
                      ? "border-[var(--color-primary)] text-[var(--color-text)] bg-[var(--color-surface)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  Synthesized Test
                </button>
              </div>

              {/* Inspector Content */}
              <div className="p-4 flex-1">
                {activeTab === "coverage" && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--color-text)]">
                        Coverage Metrics
                      </span>
                      <Badge variant="warning" size="sm">
                        Overall: 72.5%
                      </Badge>
                    </div>

                    {[
                      { label: "Statements", val: 78, status: "warning" },
                      { label: "Branches", val: 55, status: "danger" },
                      { label: "Functions", val: 85, status: "success" },
                      { label: "Lines", val: 72, status: "warning" },
                    ].map((m) => (
                      <div key={m.label} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--color-text-secondary)]">
                            {m.label}
                          </span>
                          <span className="font-mono font-medium text-[var(--color-text)]">
                            {m.val}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--color-surface-secondary)] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              m.status === "success"
                                ? "bg-[var(--color-success)]"
                                : m.status === "warning"
                                ? "bg-[var(--color-warning)]"
                                : "bg-[var(--color-danger)]"
                            }`}
                            style={{ width: `${m.val}%` }}
                          />
                        </div>
                      </div>
                    ))}

                    <div className="pt-3 border-t border-[var(--color-border)]">
                      <div className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
                        Istanbul engine identified 2 uncovered branch paths in{" "}
                        <code className="font-mono text-[var(--color-text)]">
                          checkout.js
                        </code>
                        .
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "cfg" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--color-text)]">
                        Branch Decision Nodes
                      </span>
                      <Badge variant="default" size="sm">
                        Complexity: M=4
                      </Badge>
                    </div>

                    <div className="space-y-2">
                      <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-danger)]/30 text-xs">
                        <div className="flex items-center gap-1.5 font-mono text-[var(--color-danger)] font-medium mb-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Line 14: Unreached Branch</span>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-secondary)] font-mono">
                          Predicate: user.balance &lt; total
                        </p>
                        <div className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
                          True branch evaluated 0 times in test suite.
                        </div>
                      </div>

                      <div className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-warning)]/30 text-xs">
                        <div className="flex items-center gap-1.5 font-mono text-[var(--color-warning)] font-medium mb-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Line 6: Guard Clause</span>
                        </div>
                        <p className="text-[11px] text-[var(--color-text-secondary)] font-mono">
                          Predicate: !cart || cart.items.length === 0
                        </p>
                        <div className="mt-1.5 text-[10px] text-[var(--color-text-muted)]">
                          Empty cart exception branch missing test assertions.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "test" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs font-semibold text-[var(--color-text)]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-success)]" />
                        <span>Jest Spec Synthesized</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyTest}
                        className="p-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-xs flex items-center gap-1 cursor-pointer"
                      >
                        {copiedTest ? (
                          <>
                            <Check className="w-3 h-3 text-[var(--color-success)]" />
                            <span className="text-[10px]">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span className="text-[10px]">Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    <pre className="p-2.5 rounded-[var(--radius-md)] bg-[var(--color-bg)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text)] overflow-x-auto leading-relaxed max-h-52">
                      {testSnippet}
                    </pre>

                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      icon={Play}
                    >
                      Run in Test Sandbox
                    </Button>
                  </div>
                )}
              </div>

              {/* Status Bar */}
              <div className="h-7 px-3 bg-[var(--color-surface-secondary)] border-t border-[var(--color-border)] flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-mono">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-success)]" />
                  <span>Sandbox: Ready</span>
                </div>
                <span>Jest Engine v29</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
