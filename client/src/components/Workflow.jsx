import { useState, useEffect, useRef, Suspense, lazy } from "react";
import { Link } from "react-router-dom";

const Pipeline3DStage = lazy(() => import("./landing/Pipeline3DStage"));

const PIPELINE_STEPS = [
  {
    index: 0,
    num: "01",
    phase: "Repository snapshot",
    title: "Index source tree and dependency graph",
    desc: "Import from GitHub or upload a zip archive. CovAI resolves your package structure, TypeScript paths, Prisma models, and test runner configuration.",
    telemetry: {
      header: "git@github.com:org/core-api.git @ 3174aaa",
      badge: "428 files indexed",
      geometryLabel: "3D Cubic Directory Lattice",
      code: [
        "Resolved workspaces: client/, server/, shared/",
        "Detected runners: Vitest 2.1, Jest ESM, Playwright 1.50",
        "Indexed 1,842 exported functions and route handlers",
      ],
      metricLabel: "Snapshot time",
      metricValue: "420 ms",
    },
  },
  {
    index: 1,
    num: "02",
    phase: "AST & CFG construction",
    title: "Compile functions into Control Flow Graphs",
    desc: "Each function is parsed with Babel AST into basic blocks and directed decision edges, exposing branches that have zero test hits.",
    telemetry: {
      header: "server/src/services/testValidation.service.js",
      badge: "5 untested predicates",
      geometryLabel: "3D Directed AST Execution Tree",
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
    phase: "Multi-layer synthesis",
    title: "Generate targeted unit, API, and E2E suites",
    desc: "BullMQ workers dispatch the isolated branch predicates to Gemini models, producing runnable specs with deterministic database and network mocks.",
    telemetry: {
      header: "BullMQ worker #04 · Synthesis stream",
      badge: "+32 specs written",
      geometryLabel: "3D Helical Synthesis Matrix",
      code: [
        "Unit: generated 18 branch assertions for testValidation.spec.js",
        "Integration: generated 8 role-permission contract tests",
        "System: generated 6 Playwright checkout recovery flows",
      ],
      metricLabel: "Coverage delta",
      metricValue: "44.2% -> 96.8%",
    },
  },
  {
    index: 3,
    num: "04",
    phase: "Container verification",
    title: "Execute in Docker before opening a pull request",
    desc: "Every generated test suite runs inside an isolated container and passes mutation checks before being committed to your branch.",
    telemetry: {
      header: "Pull Request #214 · Verification report",
      badge: "142 / 142 passing",
      geometryLabel: "3D Verified Geodesic Sphere",
      code: [
        "Container execution: 142 passed, 0 failed, 0 flaky",
        "Istanbul V8 branch coverage: 96.8% (+52.6% vs base)",
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
        },
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
      className="relative py-24 md:py-32 border-b border-[#161a24]"
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        {/* Clean Editorial Heading */}
        <div className="max-w-2xl mb-14 space-y-3">
          <h2 className="lp-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Four-stage verification pipeline
          </h2>
          <p className="text-sm sm:text-base text-slate-400">
            Scroll or select any stage to morph the 3D topology and inspect how
            source files move from AST parsing to a verified pull request.
          </p>
        </div>

        {/* Split Scroll-Pinned Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: 4 Sequential Stage Cards (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            {PIPELINE_STEPS.map((step, idx) => {
              const isActive = activeStep === idx;
              return (
                <div
                  key={step.num}
                  id={`workflow-step-${step.num}`}
                  ref={(el) => (stepRefs.current[idx] = el)}
                  onClick={() => setActiveStep(idx)}
                  className={`p-6 rounded-xl border transition-all duration-200 cursor-pointer ${
                    isActive
                      ? "bg-[#0b0e14] border-[#2e374d]"
                      : "bg-[#07090d] border-[#151922] opacity-60 hover:opacity-90"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs lp-mono mb-2.5">
                    <span
                      className={isActive ? "text-[#38bdf8]" : "text-slate-500"}
                    >
                      {step.num} / {step.phase}
                    </span>
                    <span className="text-slate-500">
                      {step.telemetry.badge}
                    </span>
                  </div>

                  <h3 className="lp-display text-lg sm:text-xl font-bold text-white mb-2">
                    {step.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Right Column: Sticky 3D Morphing Stage + Live Telemetry (7 cols) */}
          <div className="lg:col-span-7 lg:sticky lg:top-24">
            <div className="rounded-xl lp-machined overflow-hidden">
              {/* Top Stage Bar */}
              <div className="px-5 py-3.5 bg-[#07090d] border-b border-[#181c26] flex items-center justify-between gap-2 text-xs lp-mono">
                <div className="flex items-center gap-1.5">
                  {PIPELINE_STEPS.map((s, i) => (
                    <button
                      key={s.num}
                      type="button"
                      onClick={() => setActiveStep(i)}
                      className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                        activeStep === i
                          ? "bg-[#161b26] text-white border border-[#2a3347]"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {s.num}
                    </button>
                  ))}
                </div>

                <span className="text-slate-400">
                  {current.telemetry.geometryLabel}
                </span>
              </div>

              <div className="p-6 space-y-5">
                {/* Interactive 3D Morphing Geometry Canvas */}
                <Suspense
                  fallback={
                    <div className="h-[230px] rounded-xl bg-[#06080c] border border-[#181c26] flex items-center justify-center text-xs lp-mono text-slate-500">
                      Loading 3D pipeline topology...
                    </div>
                  }
                >
                  <Pipeline3DStage activeStage={activeStep} />
                </Suspense>

                {/* Stage Readout */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#161a24]">
                  <div>
                    <div className="text-xs lp-mono text-slate-500">
                      {current.telemetry.header}
                    </div>
                    <h4 className="lp-display text-xl font-bold text-white mt-0.5">
                      {current.title}
                    </h4>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-[#10141e] border border-[#22293a] text-xs lp-mono text-[#38bdf8] self-start sm:self-auto">
                    {current.telemetry.badge}
                  </span>
                </div>

                {/* Output Log */}
                <div className="p-4 rounded-lg bg-[#050608] border border-[#161a24] lp-mono text-xs space-y-2">
                  {current.telemetry.code.map((line, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-3 ${
                        line.includes("0 hits")
                          ? "text-[#f43f5e]"
                          : "text-slate-300"
                      }`}
                    >
                      <span className="text-slate-600 select-none">
                        0{i + 1}
                      </span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>

                {/* Bottom Action */}
                <div className="pt-2 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] lp-mono text-slate-500">
                      {current.telemetry.metricLabel}
                    </div>
                    <div className="text-base font-bold lp-mono text-white">
                      {current.telemetry.metricValue}
                    </div>
                  </div>

                  <Link
                    to="/register"
                    id="workflow-cta"
                    className="lp-btn-primary px-5 py-2.5 rounded-lg text-xs sm:text-sm"
                  >
                    Run pipeline on your repository
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
