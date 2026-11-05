import {
  Sparkles,
  ShieldCheck,
  Layers,
  Compass,
  Route,
  Network,
  Cpu,
  CheckCircle2,
  Zap,
} from "lucide-react";
import Button from "../../common/Button.jsx";

export default function SystemTestZeroStateBanner({
  onOpenGenerator,
  canGenerate = true,
}) {
  const dimensions = [
    {
      id: "dim-1",
      name: "Requirement & User Stories",
      desc: "Auto-discovers core user stories & CRUD flows (Read, Create, Update, Delete, Toggle, Cancel)",
      icon: Layers,
      color: "text-indigo-500 dark:text-indigo-400",
      bg: "bg-indigo-500/10 border-indigo-500/20",
    },
    {
      id: "dim-2",
      name: "User Journey & Workflows",
      desc: "Tests independent end-to-end user workflows: Setup → Action → Assert → Evidence",
      icon: Compass,
      color: "text-emerald-500 dark:text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/20",
    },
    {
      id: "dim-3",
      name: "Page & Route Coverage",
      desc: "Traverses client routes and application views detected in source code",
      icon: Route,
      color: "text-sky-500 dark:text-sky-400",
      bg: "bg-sky-500/10 border-sky-500/20",
    },
    {
      id: "dim-4",
      name: "API Endpoint Coverage",
      desc: "Verifies backend API endpoint responses and integration through UI interactions",
      icon: Network,
      color: "text-purple-500 dark:text-purple-400",
      bg: "bg-purple-500/10 border-purple-500/20",
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm overflow-hidden p-6 sm:p-10 space-y-8 animate-in fade-in duration-300 font-sans">
      {/* Hero Header */}
      <div className="max-w-3xl space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-600 dark:text-indigo-400 text-xs font-semibold">
          <Sparkles size={14} className="animate-pulse" />
          <span>AI Cold-Start Test Generator</span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-extrabold text-[var(--color-text)] tracking-tight">
          No System Tests Found in Snapshot
        </h2>

        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
          This project does not contain any end-to-end test specs yet. CovAI AI can analyze your application source (routes, interactive UI forms, backend APIs) and automatically generate a high-quality Playwright test suite covering all 4 system dimensions without manual coding.
        </p>
      </div>

      {/* 4 Dimensions Grid Preview */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
          <ShieldCheck size={16} className="text-indigo-500" />
          <span>Generated tests will measure 4 system testing dimensions:</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {dimensions.map((dim) => {
            const Icon = dim.icon;
            return (
              <div
                key={dim.id}
                className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 hover:bg-[var(--color-surface-secondary)]/70 transition-all flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2.5">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${dim.bg} ${dim.color}`}>
                    <Icon size={18} />
                  </div>
                  <h4 className="text-sm font-bold text-[var(--color-text)] leading-snug">
                    {dim.name}
                  </h4>
                  <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                    {dim.desc}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={13} />
                  <span>Ready to Auto-Generate</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quality & Token Guarantees */}
      <div className="p-4 rounded-xl bg-[var(--color-surface-secondary)]/60 border border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4 text-[var(--color-text-secondary)]">
          <span className="flex items-center gap-1.5 font-medium">
            <Cpu size={14} className="text-indigo-500" />
            AST Quality Gate (Setup → Action → Assert → Evidence)
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <Zap size={14} className="text-amber-500" />
            Token Budget Optimization (~60K Context Budget)
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <ShieldCheck size={14} className="text-emerald-500" />
            Engine: <strong className="text-[var(--color-text)]">Playwright (Web-First & 4-Dimensions)</strong>
          </span>
        </div>
      </div>

      {/* Primary Call-to-Action */}
      <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5">
        <Button
          variant="primary"
          size="lg"
          icon={Sparkles}
          disabled={!canGenerate}
          onClick={onOpenGenerator}
          className="font-bold text-sm px-6 py-3 shadow-lg hover:shadow-indigo-500/25 transition-all !bg-indigo-600 hover:!bg-indigo-500 text-white cursor-pointer"
        >
          Auto-Generate System Tests with AI
        </Button>

        <span className="text-xs text-[var(--color-text-muted)] self-center sm:self-auto">
          Once generated, the full system dashboard and scenario library will unlock automatically.
        </span>
      </div>
    </div>
  );
}
