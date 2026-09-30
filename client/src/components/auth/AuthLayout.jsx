import { useState } from "react";
import { Link } from "react-router-dom";
import { Terminal, ArrowLeft, GitBranch, Cpu, ShieldCheck } from "lucide-react";
import AuthForm from "./AuthForm";
import ForgotPasswordForm from "./ForgotPasswordForm";
import ResetPasswordForm from "./ResetPasswordForm";
import CodePreview from "./CodePreview";
import ThemeSelector from "../common/ThemeSelector";

const ARCHITECTURE_PILLARS = [
  {
    icon: GitBranch,
    title: "Control Flow",
    desc: "AST branch graph",
  },
  {
    icon: Cpu,
    title: "Test Synthesis",
    desc: "Targeted Jest suites",
  },
  {
    icon: ShieldCheck,
    title: "Sandbox Runner",
    desc: "Isolated execution",
  },
];

export default function AuthLayout({ initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);

  const toggleMode = () =>
    setMode((m) => (m === "login" ? "register" : "login"));

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-[var(--color-bg)] text-[var(--color-text)] transition-colors duration-150">
      {/* ══════════════════════════════════════════════════════
          LEFT PANEL — Technical Showcase (Desktop only)
          ══════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col justify-between p-8 lg:p-12 xl:p-16 bg-[var(--color-surface)] border-r border-[var(--color-border)]">
        {/* Brand Header */}
        <div className="flex items-center justify-between">
          <Link
            to="/"
            id="auth-logo"
            className="inline-flex items-center gap-2.5 text-decoration-none focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] rounded-[var(--radius-sm)]"
          >
            <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm shrink-0">
              <Terminal className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-[var(--color-text)]">
                CovAI
              </span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                v2.4
              </span>
            </div>
          </Link>
        </div>

        {/* Center Technical Showcase */}
        <div className="max-w-[500px] w-full mx-auto my-auto py-6 space-y-6">
          <div>
            <h2 className="text-2xl xl:text-3xl font-bold tracking-tight text-[var(--color-text)] leading-snug mb-2.5">
              Automated Test Coverage & Deterministic Branch Verification
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
              CovAI synthesizes targeted unit test suites, detects missing logic
              paths in your Control Flow Graphs, and executes tests in a secure
              sandbox.
            </p>
          </div>

          {/* Interactive Monaco-style Code Preview */}
          <CodePreview />
        </div>

        {/* Bottom Platform Pillars */}
        <div className="grid grid-cols-3 gap-3 pt-6 border-t border-[var(--color-border)] max-w-[500px] w-full mx-auto">
          {ARCHITECTURE_PILLARS.map((pillar, i) => {
            const Icon = pillar.icon;
            return (
              <div
                key={i}
                className="p-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)]"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)] mb-0.5">
                  <Icon className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" />
                  <span className="truncate">{pillar.title}</span>
                </div>
                <p className="text-[11px] text-[var(--color-text-secondary)] truncate">
                  {pillar.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          RIGHT PANEL — Form Container
          ══════════════════════════════════════════════════════ */}
      <div className="flex flex-col justify-between p-6 sm:p-10 lg:p-12 xl:p-16">
        {/* Top bar: Back to home + Theme Selector */}
        <div className="flex items-center justify-between w-full h-8">
          <Link
            to="/"
            id="auth-back-home"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] rounded-[var(--radius-sm)] py-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to home</span>
          </Link>

          <ThemeSelector compact />
        </div>

        {/* Center: Auth Form */}
        <div className="my-auto py-8">
          {mode === "forgot_password" ? (
            <ForgotPasswordForm setMode={setMode} />
          ) : mode === "reset_password" ? (
            <ResetPasswordForm />
          ) : (
            <AuthForm mode={mode} onToggleMode={toggleMode} setMode={setMode} />
          )}
        </div>

        {/* Bottom footer note */}
        <div className="pt-6 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)]">
          <span>
            © {new Date().getFullYear()} CovAI Platform. Protected by isolated
            test sandbox.
          </span>
        </div>
      </div>
    </div>
  );
}
