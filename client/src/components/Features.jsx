import { useState, Suspense, lazy } from "react";
import {
  Layers,
  GitBranch,
  ShieldCheck,
  Users,
  Container,
  Monitor,
  Webhook,
  Code2,
  CheckCircle2,
  Terminal,
} from "lucide-react";

const Pyramid3DCanvas = lazy(() => import("./landing/Pyramid3DCanvas"));

const PYRAMID_LAYERS = [
  {
    id: "system",
    name: "System E2E flows",
    metric: "95.6%",
    engine: "Playwright + V8 trace",
    icon: Monitor,
    desc: "Multi-page browser journeys and network recovery.",
  },
  {
    id: "integration",
    name: "API contract matrix",
    metric: "97.8%",
    engine: "Supertest + PostgreSQL",
    icon: Webhook,
    desc: "HTTP contracts, RBAC permissions, and DB locks.",
  },
  {
    id: "unit",
    name: "Unit branch solver",
    metric: "98.4%",
    engine: "Babel AST + Vitest",
    icon: Code2,
    desc: "Cyclomatic decision nodes with deterministic mocks.",
  },
];

function BentoCard({ children, className = "", id }) {
  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty(
      "--mouse-x",
      `${e.clientX - rect.left}px`,
    );
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
    {
      op: "balance < total  ->  balance <= total",
      file: "checkout.ts:14",
      time: "12ms",
    },
    { op: "fxRate <= 0      ->  false", file: "settlement.ts:6", time: "8ms" },
    { op: "!signature       ->  true", file: "webhooks.ts:3", time: "15ms" },
  ];

  return (
    <section
      id="features"
      className="relative py-24 md:py-32 border-b border-[var(--lp-line)]"
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        <div className="max-w-xl mb-12 space-y-2.5">
          <h2 className="lp-display text-3xl sm:text-4xl font-bold text-[var(--lp-ink)] tracking-tight">
            Graph intelligence. Verified execution.
          </h2>
          <p className="text-sm sm:text-base text-[var(--lp-ink-secondary)]">
            AST branch mapping paired with mutation checks and isolated
            containers.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* CARD 1: 3D Three-Tier Test Pyramid */}
          <BentoCard id="bento-pyramid" className="lg:col-span-7">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span className="inline-flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[var(--lp-signal)]" />
                  <span>Three-tier test architecture</span>
                </span>
                <span className="text-[var(--lp-signal)] font-semibold">
                  {selectedLayer.metric} cov
                </span>
              </div>

              <h3 className="lp-display text-xl sm:text-2xl font-bold text-[var(--lp-ink)] mb-1.5">
                Unit, API contract, and browser coverage
              </h3>
              <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] mb-5">
                {selectedLayer.desc}
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
                    const LayerIcon = layer.icon;
                    return (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => setSelectedLayer(layer)}
                        className={`w-full p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[var(--lp-pill-active)] border-[var(--lp-line-strong)] text-[var(--lp-ink)] shadow-xs"
                            : "bg-[var(--lp-inset)] border-[var(--lp-line)] text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)]"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-semibold">
                          <span className="inline-flex items-center gap-2">
                            <LayerIcon
                              className={`w-3.5 h-3.5 ${
                                isSelected
                                  ? "text-[var(--lp-signal)]"
                                  : "text-[var(--lp-ink-muted)]"
                              }`}
                            />
                            <span>{layer.name}</span>
                          </span>
                          <span
                            className={`lp-mono ${
                              isSelected
                                ? "text-[var(--lp-signal)]"
                                : "text-[var(--lp-ink-muted)]"
                            }`}
                          >
                            {layer.metric}
                          </span>
                        </div>
                        <div className="text-[11px] lp-mono text-[var(--lp-ink-muted)] mt-1 pl-5.5">
                          {layer.engine}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </BentoCard>

          {/* CARD 2: Animated Directed Control Flow Graph Schematic */}
          <BentoCard id="feature-cfg-analysis" className="lg:col-span-5">
            <div className="relative z-10">
              <div className="flex items-center justify-between gap-2 mb-3 text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span className="inline-flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[var(--lp-signal)]" />
                  <span>Babel AST solver</span>
                </span>
                <span>Complexity M = 4</span>
              </div>

              <h3 className="lp-display text-xl sm:text-2xl font-bold text-[var(--lp-ink)] mb-1.5">
                Predicate branch isolation
              </h3>
              <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] mb-5">
                Traces forks and exception paths to target exact untested lines.
              </p>

              <div className="p-4 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)]">
                <svg
                  viewBox="0 0 360 175"
                  className="w-full h-40 overflow-visible"
                  aria-label="Animated Control Flow Graph execution tree"
                >
                  <path
                    d="M180 26 C180 55, 95 55, 95 85"
                    fill="none"
                    stroke="var(--lp-signal)"
                    strokeWidth="1.5"
                    className="lp-flow-edge"
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
                    className="lp-flow-edge"
                  />
                  <path
                    d="M95 85 C95 120, 145 125, 145 150"
                    fill="none"
                    stroke="var(--lp-signal)"
                    strokeWidth="1.5"
                    className="lp-flow-edge"
                  />
                  <path
                    d="M265 85 C265 120, 225 125, 225 150"
                    fill="none"
                    stroke="var(--lp-fault)"
                    strokeWidth="1.5"
                    className="lp-flow-edge"
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
                      {leaf.fault && (
                        <rect
                          x="-36"
                          y="-15"
                          width="72"
                          height="30"
                          rx="6"
                          fill="none"
                          stroke="var(--lp-fault)"
                          strokeWidth="1"
                          opacity="0.45"
                          className="animate-pulse"
                        />
                      )}
                      <rect
                        x="-32"
                        y="-11"
                        width="64"
                        height="22"
                        rx="4"
                        fill="var(--lp-surface)"
                        stroke={
                          leaf.fault
                            ? "var(--lp-fault)"
                            : "var(--lp-line-strong)"
                        }
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill={
                          leaf.fault
                            ? "var(--lp-fault)"
                            : "var(--lp-ink-secondary)"
                        }
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
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[var(--lp-signal)]" />
                  <span>Mutation guard</span>
                </span>
                <span className="text-[var(--lp-signal)] font-semibold">
                  99.2% killed
                </span>
              </div>

              <h3 className="lp-display text-xl font-bold text-[var(--lp-ink)] mb-1.5">
                Zero hollow assertions
              </h3>
              <p className="text-xs text-[var(--lp-ink-secondary)] mb-4">
                In-memory fault injection verifies every test catches logic
                breaks.
              </p>

              <div className="p-3 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] space-y-2">
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
                    <span className="inline-flex items-center gap-1 text-[var(--lp-signal)] text-[10px] shrink-0 ml-2">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{m.time}</span>
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
                <span className="inline-flex items-center gap-2">
                  <Users className="w-4 h-4 text-[var(--lp-signal)]" />
                  <span>Yjs CRDT sync</span>
                </span>
                <span>Monaco</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-[var(--lp-ink)] mb-1.5">
                Multiplayer suite editor
              </h3>
              <p className="text-xs text-[var(--lp-ink-secondary)] mb-4">
                Co-edit specs live alongside CovAI workers with synced cursors.
              </p>

              <div className="p-3 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] lp-mono text-[11px] space-y-2">
                <div className="flex items-center justify-between text-[10px] text-[var(--lp-ink-muted)] pb-1.5 border-b border-[var(--lp-line)]">
                  <span>session.spec.ts</span>
                  <span className="inline-flex items-center gap-1.5 text-[var(--lp-signal)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-signal)] animate-pulse" />
                    2 live
                  </span>
                </div>

                <div className="text-[var(--lp-ink-secondary)]">
                  it(&apos;rotates refresh cookie&apos;, async () =&gt; &#123;
                </div>

                <div className="pl-2.5 py-1 bg-[var(--lp-hover)] border-l-2 border-[var(--lp-ink)] text-[var(--lp-ink)] flex items-center justify-between">
                  <span>
                    const res = await rotateToken(c);
                    <span className="inline-block w-1.5 h-3.5 align-middle ml-0.5 bg-[var(--lp-ink)] lp-cursor-blink" />
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--lp-ink)] text-[var(--lp-bg)] text-[9px] font-semibold">
                    User
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
                <span className="inline-flex items-center gap-2">
                  <Container className="w-4 h-4 text-[var(--lp-signal)]" />
                  <span>Docker runner</span>
                </span>
                <span>Auto-mock</span>
              </div>

              <h3 className="lp-display text-xl font-bold text-[var(--lp-ink)] mb-1.5">
                Isolated container verification
              </h3>
              <p className="text-xs text-[var(--lp-ink-secondary)] mb-4">
                Runs every suite in sandboxed containers and auto-repairs
                imports.
              </p>

              <div className="p-3 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] lp-mono text-[11px] space-y-2">
                <div className="flex items-center gap-2 text-[var(--lp-ink-muted)] pb-1.5 border-b border-[var(--lp-line)]">
                  <Terminal className="w-3.5 h-3.5 shrink-0" />
                  <span>covai runner:exec --isolated</span>
                </div>
                <div className="text-[var(--lp-ink)] flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--lp-signal)] shrink-0" />
                  <span>Vite 8 + Prisma 7 mounted</span>
                </div>
                <div className="text-[var(--lp-ink-secondary)] flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--lp-signal)] shrink-0" />
                  <span>Stripe &amp; Redis sockets stubbed</span>
                </div>
                <div className="text-[var(--lp-signal)] font-semibold pt-1 flex items-center justify-between">
                  <span>24 passed, 0 failed</span>
                  <span className="text-[10px] text-[var(--lp-ink-muted)]">
                    1.18s
                  </span>
                </div>
              </div>
            </div>
          </BentoCard>
        </div>
      </div>
    </section>
  );
}
