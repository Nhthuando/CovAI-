import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { FolderGit2, GitBranch, Cpu, Container, ArrowUpRight } from "lucide-react";

const Pipeline3DStage = lazy(() => import("./landing/Pipeline3DStage"));

const PIPELINE_STEPS = [
  {
    index: 0,
    num: "01",
    icon: FolderGit2,
    phase: "Snapshot",
    title: "Index source tree & runners",
    desc: "Resolves workspaces, Prisma schemas, and Vitest/Jest/Playwright configs.",
    telemetry: {
      header: "git@github.com:org/core-api.git @ 3174aaa",
      badge: "428 files",
      geometryLabel: "Cubic Directory Lattice",
      code: [
        "Workspaces: client/, server/, shared/",
        "Runners: Vitest 2.1, Jest ESM, Playwright 1.50",
        "Indexed 1,842 functions & route handlers",
      ],
      metricLabel: "Snapshot time",
      metricValue: "420 ms",
    },
  },
  {
    index: 1,
    num: "02",
    icon: GitBranch,
    phase: "AST & CFG",
    title: "Build Control Flow Graphs",
    desc: "Parses Babel AST edges to pinpoint branches with zero test hits.",
    telemetry: {
      header: "server/src/services/testValidation.service.js",
      badge: "5 gaps found",
      geometryLabel: "Directed AST Tree",
      code: [
        "IfStatement [line 42] -> !token || token.expired (0 hits)",
        "SwitchCase  [line 67] -> case 'RATE_LIMITED'     (0 hits)",
        "CatchClause [line 88] -> catch (sandboxErr)      (0 hits)",
      ],
      metricLabel: "Cyclomatic complexity",
      metricValue: "M = 18",
    },
  },
  {
    index: 2,
    num: "03",
    icon: Cpu,
    phase: "Synthesis",
    title: "Generate Unit, API & E2E suites",
    desc: "BullMQ dispatches missing predicates to produce runnable specs with mocks.",
    telemetry: {
      header: "BullMQ worker #04 · Synthesis stream",
      badge: "+32 specs",
      geometryLabel: "Helical Synthesis Matrix",
      code: [
        "Unit: 18 branch assertions for testValidation.spec.js",
        "Integration: 8 role-permission contract tests",
        "System: 6 Playwright checkout recovery flows",
      ],
      metricLabel: "Coverage delta",
      metricValue: "44.2% -> 96.8%",
    },
  },
  {
    index: 3,
    num: "04",
    icon: Container,
    phase: "Verification",
    title: "Execute in isolated Docker",
    desc: "Runs generated suites inside containers and checks mutation kill rates.",
    telemetry: {
      header: "Pull Request #214 · Verification report",
      badge: "142 / 142 pass",
      geometryLabel: "Verified Geodesic Core",
      code: [
        "Container run: 142 passed, 0 failed, 0 flaky",
        "V8 branch coverage: 96.8% (+52.6% vs base)",
        "Mutation fault kill rate: 99.1% verified",
      ],
      metricLabel: "Gate status",
      metricValue: "Ready to merge",
    },
  },
];

export default function Workflow() {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef([]);

  useEffect(() => {
    const observers = [];

    stepRefs.current.forEach((el, idx) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setActiveStep(idx);
            }
          });
        },
        {
          rootMargin: "-25% 0px -45% 0px",
          threshold: 0.25,
        }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const current = PIPELINE_STEPS[activeStep] || PIPELINE_STEPS[0];

  return (
    <section
      id="workflow"
      className="relative py-24 md:py-32 border-b border-[var(--lp-line)]"
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        <div className="max-w-xl mb-12 space-y-2.5">
          <h2 className="lp-display text-3xl sm:text-4xl font-bold text-[var(--lp-ink)] tracking-tight">
            Four-stage verification pipeline
          </h2>
          <p className="text-sm sm:text-base text-[var(--lp-ink-secondary)]">
            Select any stage to morph the 3D topology from AST parsing to verified PR.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: 4 Sequential Stage Cards */}
          <div className="lg:col-span-5 space-y-4">
            {PIPELINE_STEPS.map((step, idx) => {
              const isActive = activeStep === idx;
              const StepIcon = step.icon;
              return (
                <div
                  key={step.num}
                  id={`workflow-step-${step.num}`}
                  ref={(el) => (stepRefs.current[idx] = el)}
                  onClick={() => setActiveStep(idx)}
                  className={`p-5 rounded-xl border transition-all duration-200 cursor-pointer ${
                    isActive
                      ? "bg-[var(--lp-surface)] border-[var(--lp-line-strong)] shadow-sm"
                      : "bg-[var(--lp-inset)] border-[var(--lp-line)] opacity-65 hover:opacity-100"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs lp-mono mb-2">
                    <span className={`inline-flex items-center gap-2 ${isActive ? "text-[var(--lp-signal)] font-semibold" : "text-[var(--lp-ink-muted)]"}`}>
                      <StepIcon className="w-3.5 h-3.5" />
                      <span>{step.num} {step.phase}</span>
                    </span>
                    <span className="text-[var(--lp-ink-muted)]">{step.telemetry.badge}</span>
                  </div>

                  <h3 className="lp-display text-lg font-bold text-[var(--lp-ink)] mb-1">
                    {step.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Right Column: Sticky 3D Morphing Stage + Telemetry */}
          <div className="lg:col-span-7 lg:sticky lg:top-24">
            <div className="rounded-xl lp-machined overflow-hidden">
              <div className="px-5 py-3.5 bg-[var(--lp-surface)] border-b border-[var(--lp-line)] flex items-center justify-between gap-2 text-xs lp-mono">
                <div className="flex items-center gap-1.5">
                  {PIPELINE_STEPS.map((s, i) => (
                    <button
                      key={s.num}
                      type="button"
                      onClick={() => setActiveStep(i)}
                      className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                        activeStep === i
                          ? "bg-[var(--lp-pill-active)] text-[var(--lp-ink)] border border-[var(--lp-line-strong)] shadow-xs"
                          : "text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)]"
                      }`}
                    >
                      {s.num}
                    </button>
                  ))}
                </div>

                <span className="text-[var(--lp-ink-secondary)]">
                  {current.telemetry.geometryLabel}
                </span>
              </div>

              <div className="p-6 space-y-5">
                <Suspense
                  fallback={
                    <div className="h-[230px] rounded-xl bg-[var(--lp-inset)] border border-[var(--lp-line)] flex items-center justify-center text-xs lp-mono text-[var(--lp-ink-muted)]">
                      Loading 3D pipeline topology...
                    </div>
                  }
                >
                  <Pipeline3DStage activeStage={activeStep} />
                </Suspense>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--lp-line)]">
                  <div>
                    <div className="text-xs lp-mono text-[var(--lp-ink-muted)]">
                      {current.telemetry.header}
                    </div>
                    <h4 className="lp-display text-xl font-bold text-[var(--lp-ink)] mt-0.5">
                      {current.title}
                    </h4>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-[var(--lp-signal-bg)] border border-[var(--lp-signal-border)] text-xs lp-mono text-[var(--lp-signal)] font-medium self-start sm:self-auto">
                    {current.telemetry.badge}
                  </span>
                </div>

                <div className="p-4 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] lp-mono text-xs space-y-2">
                  {current.telemetry.code.map((line, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-3 ${
                        line.includes("0 hits")
                          ? "text-[var(--lp-fault)]"
                          : "text-[var(--lp-ink-secondary)]"
                      }`}
                    >
                      <span className="text-[var(--lp-ink-muted)] select-none">
                        0{i + 1}
                      </span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] lp-mono text-[var(--lp-ink-muted)]">
                      {current.telemetry.metricLabel}
                    </div>
                    <div className="text-base font-bold lp-mono text-[var(--lp-ink)]">
                      {current.telemetry.metricValue}
                    </div>
                  </div>

                  <Link
                    to="/register"
                    id="workflow-cta"
                    className="lp-btn-primary px-5 py-2.5 rounded-lg text-xs sm:text-sm inline-flex items-center gap-1.5"
                  >
                    <span>Run on your repo</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
