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
      className="relative py-24 md:py-32 border-b border-[#161a24]"
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        {/* Clean Editorial Heading */}
        <div className="max-w-2xl mb-14 space-y-3">
          <h2 className="lp-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Built around static graph analysis and container execution
          </h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Instead of prompting an LLM blindly on raw files, CovAI extracts the
            Abstract Syntax Tree, computes branch complexity, and verifies every
            generated assertion against mutation faults.
          </p>
        </div>

        {/* Asymmetrical 12-Col Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* CARD 1 (Large - 7 cols): Interactive 3D Three-Tier Test Pyramid */}
          <BentoCard id="bento-pyramid" className="lg:col-span-7">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-slate-400">
                <span>Three-tier test architecture</span>
                <span className="text-[#38bdf8]">{selectedLayer.metric}</span>
              </div>

              <h3 className="lp-display text-xl sm:text-2xl font-bold text-white mb-2">
                Correlated unit, API contract, and browser coverage
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 mb-5">
                Select any layer to elevate its 3D stratum and inspect how
                branch coverage maps across the stack.
              </p>

              {/* Split 3D WebGL Pyramid + Layer Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                <div className="sm:col-span-6 rounded-lg bg-[#050608] border border-[#161a24] overflow-hidden">
                  <Suspense
                    fallback={
                      <div className="h-[240px] flex items-center justify-center text-xs lp-mono text-slate-500">
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
                            ? "bg-[#11151f] border-[#2e384f] text-white"
                            : "bg-[#06080c] border-[#161a24] text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span>{layer.name}</span>
                          <span
                            className={`lp-mono ${
                              isSelected ? "text-[#38bdf8]" : "text-slate-500"
                            }`}
                          >
                            {layer.metric}
                          </span>
                        </div>
                        <div className="text-[11px] lp-mono text-slate-500 mt-1">
                          {layer.engine}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-4 pt-3.5 border-t border-[#161a24] text-xs text-slate-300">
              {selectedLayer.desc}
            </div>
          </BentoCard>

          {/* CARD 2 (5 cols): Directed Control Flow Graph Schematic */}
          <BentoCard id="feature-cfg-analysis" className="lg:col-span-5">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-slate-400">
                <span>Babel AST graph solver</span>
                <span>McCabe complexity M = 4</span>
              </div>

              <h3 className="lp-display text-xl sm:text-2xl font-bold text-white mb-2">
                Control Flow Graph predicate isolation
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 mb-5">
                Traces every conditional fork, ternary expression, and exception
                clause so generated tests target exact line predicates.
              </p>

              {/* Monochromatic + Cobalt/Vermilion Technical SVG Schematic */}
              <div className="p-4 rounded-lg bg-[#050608] border border-[#161a24]">
                <svg
                  viewBox="0 0 360 175"
                  className="w-full h-40 overflow-visible"
                  aria-label="Control Flow Graph execution tree"
                >
                  <path
                    d="M180 26 C180 55, 95 55, 95 85"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M180 26 C180 55, 265 55, 265 85"
                    fill="none"
                    stroke="#475569"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M95 85 C95 120, 60 125, 60 150"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M95 85 C95 120, 145 125, 145 150"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M265 85 C265 120, 225 125, 225 150"
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  <path
                    d="M265 85 C265 120, 305 125, 305 150"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                  />

                  <g transform="translate(180, 22)">
                    <rect
                      x="-48"
                      y="-12"
                      width="96"
                      height="24"
                      rx="5"
                      fill="#0b0e14"
                      stroke="#e2e8f0"
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill="#f1f5f9"
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
                      fill="#0b0e14"
                      stroke="#38bdf8"
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill="#38bdf8"
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
                      fill="#0b0e14"
                      stroke="#64748b"
                      strokeWidth="1.2"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill="#cbd5e1"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      if (quota &lt; max)
                    </text>
                  </g>

                  {[
                    { x: 60, label: "200 OK", stroke: "#334155", text: "#cbd5e1" },
                    { x: 145, label: "Refresh", stroke: "#334155", text: "#cbd5e1" },
                    { x: 225, label: "429 Fault", stroke: "#f43f5e", text: "#f43f5e" },
                    { x: 305, label: "Commit", stroke: "#334155", text: "#cbd5e1" },
                  ].map((leaf, i) => (
                    <g key={i} transform={`translate(${leaf.x}, 150)`}>
                      <rect
                        x="-32"
                        y="-11"
                        width="64"
                        height="22"
                        rx="4"
                        fill="#080a0f"
                        stroke={leaf.stroke}
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill={leaf.text}
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

            <div className="relative z-10 mt-3 pt-3 border-t border-[#161a24] flex items-center justify-between text-xs lp-mono text-slate-400">
              <span>3 of 4 leaves covered</span>
              <span className="text-[#f43f5e]">1 untested branch</span>
            </div>
          </BentoCard>

          {/* CARD 3 (4 cols): Mutation Fault Injection */}
          <BentoCard id="feature-coverage-metrics" className="lg:col-span-4">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-slate-400">
                <span>Mutation verification</span>
                <span className="text-[#38bdf8]">99.2% kill rate</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-white mb-2">
                Guard against hollow assertions
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Flips relational operators and boolean guards in memory to verify
                that your test suite fails when logic breaks.
              </p>

              <div className="p-3.5 rounded-lg bg-[#050608] border border-[#161a24] space-y-2">
                {mutants.map((m, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveMutant(idx)}
                    className={`w-full px-3 py-2 rounded border text-left text-[11px] lp-mono flex items-center justify-between transition-colors cursor-pointer ${
                      activeMutant === idx
                        ? "bg-[#10141d] border-[#2c3548] text-white"
                        : "bg-transparent border-[#141821] text-slate-400"
                    }`}
                  >
                    <span className="truncate">{m.op}</span>
                    <span className="text-[#38bdf8] text-[10px] shrink-0 ml-2">
                      Killed ({m.time})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </BentoCard>

          {/* CARD 4 (4 cols): Yjs Multiplayer Workspace */}
          <BentoCard id="feature-test-synthesis" className="lg:col-span-4">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-slate-400">
                <span>Yjs CRDT sync</span>
                <span>Monaco editor</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-white mb-2">
                Multiplayer test editing
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Engineers and QA leads co-edit test suites alongside the CovAI
                worker with conflict-free cursor synchronization.
              </p>

              <div className="p-3.5 rounded-lg bg-[#050608] border border-[#161a24] lp-mono text-[11px] space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-500 pb-1.5 border-b border-[#161a24]">
                  <span>session.spec.ts</span>
                  <span>2 active cursors</span>
                </div>

                <div className="text-slate-400">
                  it(&apos;rotates refresh cookie&apos;, async () =&gt; &#123;
                </div>

                <div className="pl-2.5 py-1 bg-white/[0.04] border-l-2 border-slate-200 text-slate-100 flex items-center justify-between">
                  <span>const res = await rotateToken(cookie);</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[9px] text-black font-semibold">
                    Thuan
                  </span>
                </div>

                <div className="pl-2.5 py-1 bg-[#38bdf8]/10 border-l-2 border-[#38bdf8] text-slate-100 flex items-center justify-between">
                  <span>expect(res.status).toBe(200);</span>
                  <span className="px-1.5 py-0.5 rounded bg-[#38bdf8] text-[9px] text-black font-semibold">
                    CovAI
                  </span>
                </div>

                <div className="text-slate-500">&#125;);</div>
              </div>
            </div>
          </BentoCard>

          {/* CARD 5 (4 cols): Ephemeral Docker Container Runner */}
          <BentoCard id="feature-sandbox-execution" className="lg:col-span-4">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-slate-400">
                <span>Ephemeral Docker runner</span>
                <span>Auto-mocking</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-white mb-2">
                Pre-commit container verification
              </h3>
              <p className="text-xs text-slate-400 mb-5">
                Every generated spec runs inside an isolated container before it
                is presented in your workspace—broken imports are repaired
                automatically.
              </p>

              <div className="p-3.5 rounded-lg bg-[#050608] border border-[#161a24] lp-mono text-[11px] space-y-1.5">
                <div className="text-slate-500">
                  $ covai runner:exec --isolated
                </div>
                <div className="text-slate-300">
                  Detected Vite 8 + Prisma 7 environment
                </div>
                <div className="text-slate-400">
                  Stubbed external Stripe &amp; Redis sockets
                </div>
                <div className="text-[#38bdf8] pt-1">
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
