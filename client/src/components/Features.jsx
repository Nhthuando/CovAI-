import { useState, Suspense, lazy } from "react";

const Pyramid3DCanvas = lazy(() => import("./landing/Pyramid3DCanvas"));

const PYRAMID_LAYERS = [
  {
    id: "system",
    name: "System E2E flows",
    metric: "95.6% coverage",
    engine: "Playwright Headless + V8 DOM trace",
    desc: "Exercises multi-page checkout journeys, iframe challenges, and network recovery paths in a real browser.",
  },
  {
    id: "integration",
    name: "Integration & API contracts",
    metric: "97.8% coverage",
    engine: "Supertest + ephemeral PostgreSQL",
    desc: "Verifies HTTP status codes, role permissions (Owner, Editor, Viewer), and database transaction locks.",
  },
  {
    id: "unit",
    name: "Unit AST & branch predicates",
    metric: "98.4% coverage",
    engine: "Babel AST + Vitest & Jest",
    desc: "Solves cyclomatic decision nodes and guard clauses with deterministic mocks.",
  },
];

function BentoCard({ children, className = "", id }) {
  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  };

  return (
    <div
      id={id}
      onMouseMove={handleMouseMove}
      className={`lp-card rounded-xl p-6 sm:p-7 flex flex-col justify-between ${className}`}
    >
      {children}
    </div>
  );
}

export default function Features() {
  const [selectedLayer, setSelectedLayer] = useState(PYRAMID_LAYERS[2]);
  const [activeMutant, setActiveMutant] = useState(0);

  const mutants = [
    { op: "balance < total  ->  balance <= total", file: "checkout.ts:14", time: "12ms" },
    { op: "fxRate <= 0      ->  false", file: "settlement.ts:6", time: "8ms" },
    { op: "!signature       ->  true", file: "webhooks.ts:3", time: "15ms" },
  ];

  return (
    <section
      id="features"
      className="relative py-24 md:py-32 border-b border-[var(--lp-line)]"
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mb-14 space-y-3">
          <h2 className="lp-display text-3xl sm:text-4xl font-bold text-[var(--lp-ink)] tracking-tight">
            Built around static graph analysis and container execution
          </h2>
          <p className="text-sm sm:text-base text-[var(--lp-ink-secondary)] leading-relaxed">
            Instead of prompting an LLM blindly on raw files, CovAI extracts the
            Abstract Syntax Tree, computes branch complexity, and verifies every
            generated assertion against mutation faults.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* CARD 1: 3D Three-Tier Test Pyramid */}
          <BentoCard id="bento-pyramid" className="lg:col-span-7">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span>Three-tier test architecture</span>
                <span className="text-[var(--lp-signal)] font-semibold">{selectedLayer.metric}</span>
              </div>

              <h3 className="lp-display text-xl sm:text-2xl font-bold text-[var(--lp-ink)] mb-2">
                Correlated unit, API contract, and browser coverage
              </h3>
              <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] mb-5">
                Select any layer to elevate its 3D stratum and inspect how
                branch coverage maps across the stack.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                <div className="sm:col-span-6 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] overflow-hidden">
                  <Suspense
                    fallback={
                      <div className="h-[240px] flex items-center justify-center text-xs lp-mono text-[var(--lp-ink-muted)]">
                        Rendering 3D pyramid...
                      </div>
                    }
                  >
                    <Pyramid3DCanvas activeTier={selectedLayer.id} />
                  </Suspense>
                </div>

                <div className="sm:col-span-6 space-y-2">
                  {PYRAMID_LAYERS.map((layer) => {
                    const isSelected = selectedLayer.id === layer.id;
                    return (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => setSelectedLayer(layer)}
                        className={`w-full p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[var(--lp-pill-active)] border-[var(--lp-line-strong)] text-[var(--lp-ink)] shadow-xs"
                            : "bg-[var(--lp-inset)] border-[var(--lp-line)] text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)]"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span>{layer.name}</span>
                          <span
                            className={`lp-mono ${
                              isSelected ? "text-[var(--lp-signal)]" : "text-[var(--lp-ink-muted)]"
                            }`}
                          >
                            {layer.metric}
                          </span>
                        </div>
                        <div className="text-[11px] lp-mono text-[var(--lp-ink-muted)] mt-1">
                          {layer.engine}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-4 pt-3.5 border-t border-[var(--lp-line)] text-xs text-[var(--lp-ink-secondary)]">
              {selectedLayer.desc}
            </div>
          </BentoCard>

          {/* CARD 2: Directed Control Flow Graph Schematic */}
          <BentoCard id="feature-cfg-analysis" className="lg:col-span-5">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span>Babel AST graph solver</span>
                <span>McCabe complexity M = 4</span>
              </div>

              <h3 className="lp-display text-xl sm:text-2xl font-bold text-[var(--lp-ink)] mb-2">
                Control Flow Graph predicate isolation
              </h3>
              <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] mb-5">
                Traces every conditional fork, ternary expression, and exception
                clause so generated tests target exact line predicates.
              </p>

              <div className="p-4 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)]">
                <svg
                  viewBox="0 0 360 175"
                  className="w-full h-40 overflow-visible"
                  aria-label="Control Flow Graph execution tree"
                >
                  <path
                    d="M180 26 C180 55, 95 55, 95 85"
                    fill="none"
                    stroke="var(--lp-signal)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M180 26 C180 55, 265 55, 265 85"
                    fill="none"
                    stroke="var(--lp-ink-muted)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M95 85 C95 120, 60 125, 60 150"
                    fill="none"
                    stroke="var(--lp-signal)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M95 85 C95 120, 145 125, 145 150"
                    fill="none"
                    stroke="var(--lp-signal)"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M265 85 C265 120, 225 125, 225 150"
                    fill="none"
                    stroke="var(--lp-fault)"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  <path
                    d="M265 85 C265 120, 305 125, 305 150"
                    fill="none"
                    stroke="var(--lp-signal)"
                    strokeWidth="1.5"
                  />

                  <g transform="translate(180, 22)">
                    <rect
                      x="-48"
                      y="-12"
                      width="96"
                      height="24"
                      rx="5"
                      fill="var(--lp-surface)"
                      stroke="var(--lp-ink)"
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill="var(--lp-ink)"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      fnEntry(ctx)
                    </text>
                  </g>

                  <g transform="translate(95, 85)">
                    <rect
                      x="-52"
                      y="-12"
                      width="104"
                      height="24"
                      rx="5"
                      fill="var(--lp-surface)"
                      stroke="var(--lp-signal)"
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill="var(--lp-signal)"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      if (auth.valid)
                    </text>
                  </g>

                  <g transform="translate(265, 85)">
                    <rect
                      x="-54"
                      y="-12"
                      width="108"
                      height="24"
                      rx="5"
                      fill="var(--lp-surface)"
                      stroke="var(--lp-ink-muted)"
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill="var(--lp-ink-secondary)"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      if (quota &lt; max)
                    </text>
                  </g>

                  {[
                    { x: 60, label: "200 OK", fault: false },
                    { x: 145, label: "Refresh", fault: false },
                    { x: 225, label: "429 Fault", fault: true },
                    { x: 305, label: "Commit", fault: false },
                  ].map((leaf, i) => (
                    <g key={i} transform={`translate(${leaf.x}, 150)`}>
                      <rect
                        x="-32"
                        y="-11"
                        width="64"
                        height="22"
                        rx="4"
                        fill="var(--lp-surface)"
                        stroke={leaf.fault ? "var(--lp-fault)" : "var(--lp-line-strong)"}
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill={leaf.fault ? "var(--lp-fault)" : "var(--lp-ink-secondary)"}
                        fontSize="9.5"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {leaf.label}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>

            <div className="relative z-10 mt-3 pt-3 border-t border-[var(--lp-line)] flex items-center justify-between text-xs lp-mono text-[var(--lp-ink-secondary)]">
              <span>3 of 4 leaves covered</span>
              <span className="text-[var(--lp-fault)]">1 untested branch</span>
            </div>
          </BentoCard>

          {/* CARD 3: Mutation Fault Injection */}
          <BentoCard id="feature-coverage-metrics" className="lg:col-span-4">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span>Mutation verification</span>
                <span className="text-[var(--lp-signal)] font-semibold">99.2% kill rate</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-[var(--lp-ink)] mb-2">
                Guard against hollow assertions
              </h3>
              <p className="text-xs text-[var(--lp-ink-secondary)] mb-5">
                Flips relational operators and boolean guards in memory to verify
                that your test suite fails when logic breaks.
              </p>

              <div className="p-3.5 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] space-y-2">
                {mutants.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveMutant(idx)}
                    className={`w-full px-3 py-2 rounded border text-left text-[11px] lp-mono flex items-center justify-between transition-colors cursor-pointer ${
                      activeMutant === idx
                        ? "bg-[var(--lp-pill-active)] border-[var(--lp-line-strong)] text-[var(--lp-ink)] shadow-xs"
                        : "bg-transparent border-[var(--lp-line)] text-[var(--lp-ink-secondary)]"
                    }`}
                  >
                    <span className="truncate">{m.op}</span>
                    <span className="text-[var(--lp-signal)] text-[10px] shrink-0 ml-2">
                      Killed ({m.time})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </BentoCard>

          {/* CARD 4: Yjs Multiplayer Workspace */}
          <BentoCard id="feature-test-synthesis" className="lg:col-span-4">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span>Yjs CRDT sync</span>
                <span>Monaco editor</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-[var(--lp-ink)] mb-2">
                Multiplayer test editing
              </h3>
              <p className="text-xs text-[var(--lp-ink-secondary)] mb-5">
                Engineers and QA leads co-edit test suites alongside the CovAI
                worker with conflict-free cursor synchronization.
              </p>

              <div className="p-3.5 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] lp-mono text-[11px] space-y-2">
                <div className="flex items-center justify-between text-[10px] text-[var(--lp-ink-muted)] pb-1.5 border-b border-[var(--lp-line)]">
                  <span>session.spec.ts</span>
                  <span>2 active cursors</span>
                </div>

                <div className="text-[var(--lp-ink-secondary)]">
                  it(&apos;rotates refresh cookie&apos;, async () =&gt; &#123;
                </div>

                <div className="pl-2.5 py-1 bg-[var(--lp-hover)] border-l-2 border-[var(--lp-ink)] text-[var(--lp-ink)] flex items-center justify-between">
                  <span>const res = await rotateToken(cookie);</span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--lp-ink)] text-[var(--lp-bg)] text-[9px] font-semibold">
                    Thuan
                  </span>
                </div>

                <div className="pl-2.5 py-1 bg-[var(--lp-signal-bg)] border-l-2 border-[var(--lp-signal)] text-[var(--lp-ink)] flex items-center justify-between">
                  <span>expect(res.status).toBe(200);</span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--lp-signal)] text-white text-[9px] font-semibold">
                    CovAI
                  </span>
                </div>

                <div className="text-[var(--lp-ink-muted)]">&#125;);</div>
              </div>
            </div>
          </BentoCard>

          {/* CARD 5: Ephemeral Docker Container Runner */}
          <BentoCard id="feature-sandbox-execution" className="lg:col-span-4">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span>Ephemeral Docker runner</span>
                <span>Auto-mocking</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-[var(--lp-ink)] mb-2">
                Pre-commit container verification
              </h3>
              <p className="text-xs text-[var(--lp-ink-secondary)] mb-5">
                Every generated spec runs inside an isolated container before it
                is presented in your workspace—broken imports are repaired
                automatically.
              </p>

              <div className="p-3.5 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] lp-mono text-[11px] space-y-1.5">
                <div className="text-[var(--lp-ink-muted)]">
                  $ covai runner:exec --isolated
                </div>
                <div className="text-[var(--lp-ink)]">
                  Detected Vite 8 + Prisma 7 environment
                </div>
                <div className="text-[var(--lp-ink-secondary)]">
                  Stubbed external Stripe &amp; Redis sockets
                </div>
                <div className="text-[var(--lp-signal)] font-semibold pt-1">
                  24 passed, 0 failed (1.18s)
                </div>
              </div>
            </div>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}
