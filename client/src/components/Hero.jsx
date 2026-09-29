import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Terminal,
  Copy,
  Check,
  GitBranch,
  ShieldCheck,
  Cpu,
  ChevronRight,
} from "lucide-react";
import Button from "./common/Button";

export default function Hero() {
  const [copied, setCopied] = useState(false);
  const cliCommand = "npx covai-cli analyze --coverage";

  const handleCopy = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const capabilities = [
    {
      icon: GitBranch,
      title: "Control Flow Analysis",
      desc: "AST traversal & cyclomatic graph computation",
    },
    {
      icon: Cpu,
      title: "Automated Test Synthesis",
      desc: "Targeted Jest & Vitest suites for uncovered branches",
    },
    {
      icon: ShieldCheck,
      title: "Sandbox Validation",
      desc: "Pre-commit execution verifying zero false positives",
    },
  ];

  return (
    <section
      id="hero"
      className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden bg-[var(--color-bg)] border-b border-[var(--color-border)]"
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* Hero Header Content */}
        <div className="max-w-3xl mx-auto text-center">
          {/* Release / Capability Pill */}
          <div className="inline-flex items-center justify-center mb-6">
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] hover:border-[var(--color-primary)]/60 transition-all text-xs select-none shadow-xs group whitespace-nowrap"
            >
              <span className="px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-semibold text-[10px] flex items-center gap-1 shrink-0">
                <GitBranch className="w-3 h-3 stroke-[2.5]" />
                ENGINE
              </span>
              <span className="font-medium text-[var(--color-text)]">
                Deterministic Test Generation
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] group-hover:translate-x-0.5 transition-all shrink-0" />
            </a>
          </div>

          {/* Main Headline */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-[var(--color-text)] tracking-tight leading-[1.15] mb-5">
            Automate Test Coverage with Deterministic Analysis & AI
          </h1>

          {/* Subtext */}
          <p className="text-base sm:text-lg text-[var(--color-text-secondary)] leading-relaxed mb-8 max-w-2xl mx-auto">
            CovAI parses your JavaScript and TypeScript source code, constructs
            Control Flow Graphs to locate untested branches, and generates
            runnable Jest test cases directly into your repository.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            <Button
              as={Link}
              to="/register"
              id="hero-cta-btn"
              variant="primary"
              size="lg"
              icon={ArrowRight}
              iconPosition="right"
              className="w-full sm:w-auto font-semibold"
            >
              Start Testing Free
            </Button>
            <Button
              as="a"
              href="#ide-preview"
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
            >
              View IDE Sandbox
            </Button>
          </div>

          {/* Developer Quickstart CLI Snippet */}
          <div className="inline-flex items-center gap-3 px-3.5 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] text-left shadow-none max-w-full overflow-hidden">
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--color-text-muted)] shrink-0 select-none">
              <Terminal className="w-3.5 h-3.5 text-[var(--color-primary)]" />
              <span>CLI</span>
            </div>
            <code className="text-xs sm:text-sm font-mono text-[var(--color-text)] truncate select-all">
              {cliCommand}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              title="Copy CLI command"
              aria-label="Copy CLI command to clipboard"
              className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors shrink-0 cursor-pointer"
            >
              {copied ? (
                <Check className="w-4 h-4 text-[var(--color-success)]" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Technical Highlights Grid */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4 pt-10 border-t border-[var(--color-border)]">
          {capabilities.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                className="flex items-start gap-3 p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)]"
              >
                <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center shrink-0 text-[var(--color-primary)]">
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">
                    {item.title}
                  </h3>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
