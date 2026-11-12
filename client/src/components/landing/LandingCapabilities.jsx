import { useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "framer-motion";
import { SectionHead } from "./LandingPrimitives";
import { EASE } from "./landingUtils";

const STEPS = [
  {
    file: "cfg · validateOrder()",
    title: "Control Flow Graph analysis",
    desc: "Parses Abstract Syntax Trees to construct directed execution graphs. Pinpoints dead code, complex conditional branches, and unreached decision paths.",
  },
  {
    file: "validateOrder.test.js",
    title: "Automated Jest & Vitest synthesis",
    desc: "AI models generate runnable test cases tailored directly to uncovered branch predicates with precise assertions and minimal boilerplate.",
  },
  {
    file: "sandbox · runner",
    title: "Deterministic sandbox validation",
    desc: "Executes newly generated tests in an isolated sandbox runner before committing, verifying zero false positives or broken dependencies.",
  },
  {
    file: "coverage · summary",
    title: "Multi-vector coverage diagnostics",
    desc: "Line-by-line coverage metrics for statements, branches, functions, and lines with full Istanbul compatibility.",
  },
];

/* ---------- window panes ---------- */

function CfgPane() {
  return (
    <svg className="lp-cfg" viewBox="0 0 400 250" role="img" aria-label="Control flow graph with one uncovered branch">
      <path className="lp-cfg__edge lp-cfg__edge--hit" d="M200 44 V72" />
      <path className="lp-cfg__edge lp-cfg__edge--hit" d="M176 96 C130 100 110 110 110 134" />
      <path className="lp-cfg__edge lp-cfg__edge--miss" d="M224 96 C270 100 290 110 290 134" />
      <path className="lp-cfg__edge lp-cfg__edge--hit" d="M110 166 C110 190 150 200 180 208" />
      <path className="lp-cfg__edge lp-cfg__edge--miss" d="M290 166 C290 190 250 200 220 208" />
      <rect className="lp-cfg__node lp-cfg__node--hit" x="160" y="14" width="80" height="30" rx="6" />
      <text x="200" y="29">entry</text>
      <path className="lp-cfg__node lp-cfg__node--hit" d="M200 72 L236 96 L200 120 L164 96 Z" />
      <text x="200" y="96">qty &gt; 0</text>
      <rect className="lp-cfg__node lp-cfg__node--hit" x="60" y="134" width="100" height="32" rx="6" />
      <text x="110" y="150">reserve()</text>
      <rect className="lp-cfg__node lp-cfg__node--miss" x="240" y="134" width="100" height="32" rx="6" />
      <text x="290" y="150">reject()</text>
      <rect className="lp-cfg__node lp-cfg__node--hit" x="160" y="204" width="80" height="30" rx="6" />
      <text x="200" y="219">return</text>
    </svg>
  );
}

function CodePane() {
  const lines = [
    <><span className="tok-k">describe</span>(<span className="tok-s">&quot;validateOrder&quot;</span>, () =&gt; {"{"}</>,
    <>  <span className="tok-c">{"// covers branch: qty <= 0"}</span></>,
    <>  <span className="tok-k">it</span>(<span className="tok-s">&quot;rejects empty orders&quot;</span>, () =&gt; {"{"}</>,
    <>    <span className="tok-k">const</span> res = <span className="tok-f">validateOrder</span>({"{ qty: 0 }"});</>,
    <>    <span className="tok-f">expect</span>(res.ok).<span className="tok-f">toBe</span>(<span className="tok-k">false</span>);</>,
    <>    <span className="tok-f">expect</span>(res.reason).<span className="tok-f">toBe</span>(<span className="tok-s">&quot;EMPTY&quot;</span>);</>,
    <>  {"}"});</>,
    <>{"}"});</>,
  ];
  return (
    <div className="lp-mono">
      {lines.map((line, i) => (
        <motion.div
          key={i}
          className={`lp-code-line ${i >= 2 && i <= 6 ? "lp-code-line--hit" : ""}`}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.07 * i, duration: 0.3 }}
        >
          <i>{i + 1}</i>
          <span>{line}</span>
        </motion.div>
      ))}
    </div>
  );
}

function TerminalPane() {
  const rows = [
    <><span className="tok-dim">$</span> covai run --sandbox</>,
    <><span className="tok-dim">›</span> isolating runner … <span className="tok-ok">ready</span></>,
    <><span className="tok-ok">PASS</span> validateOrder.test.js</>,
    <>  <span className="tok-ok">✓</span> rejects empty orders <span className="tok-dim">(4 ms)</span></>,
    <>  <span className="tok-ok">✓</span> reserves stock when qty &gt; 0 <span className="tok-dim">(3 ms)</span></>,
    <><span className="tok-dim">Tests:</span> <span className="tok-ok">2 passed</span>, 2 total</>,
    <><span className="tok-dim">›</span> branch coverage <span className="tok-bad">50%</span> → <span className="tok-ok">100%</span></>,
  ];
  return (
    <div className="lp-mono">
      {rows.map((row, i) => (
        <motion.div
          key={i}
          className="lp-code-line"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.16 * i, duration: 0.2 }}
        >
          <span>{row}</span>
        </motion.div>
      ))}
    </div>
  );
}

function MetricsPane() {
  const metrics = [
    ["Statements", 96.4],
    ["Branches", 91.2],
    ["Functions", 100],
    ["Lines", 95.8],
  ];
  return (
    <div>
      {metrics.map(([label, value], i) => (
        <div className="lp-meter" key={label}>
          <div className="lp-meter__top">
            <span>{label}</span>
            <span className="lp-mono">{value.toFixed(1)}%</span>
          </div>
          <div className="lp-meter__track">
            <span style={{ width: `${value}%`, animationDelay: `${i * 90}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const PANES = [CfgPane, CodePane, TerminalPane, MetricsPane];

/**
 * Capability showcase: a tab list that auto-advances (the progress bar on the
 * active tab IS the timer — its animationend moves to the next tab) next to an
 * IDE window that swaps content. Hover / focus pauses it; click selects.
 */
export default function LandingCapabilities() {
  const ref = useRef(null);
  const tiltRef = useRef(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { margin: "-20% 0px -20% 0px" });
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const Pane = PANES[active];
  const running = inView && !paused && !reduced;

  const handleTilt = (event) => {
    const el = tiltRef.current;
    if (!el || reduced) return;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--tilt-x", (x * 7).toFixed(2));
    el.style.setProperty("--tilt-y", (-y * 5).toFixed(2));
  };

  const resetTilt = () => {
    tiltRef.current?.style.setProperty("--tilt-x", "0");
    tiltRef.current?.style.setProperty("--tilt-y", "0");
  };

  return (
    <section id="features" className="lp-section" ref={ref}>
      <div className="lp-container">
        <SectionHead
          layout="split"
          eyebrow="Platform capabilities"
          title="Engineered for test automation & coverage integrity"
          sub="Purpose-built developer tools designed to identify untested logic, prevent regressions, and eliminate manual test writing toil."
        />

        <div
          className={`lp-show ${running ? "" : "is-paused"}`}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div className="lp-show__tabs" role="tablist" aria-label="Platform capabilities">
            {STEPS.map((step, i) => {
              const isActive = i === active;
              return (
                <button
                  key={step.title}
                  type="button"
                  role="tab"
                  id={`cap-tab-${i}`}
                  aria-selected={isActive}
                  aria-controls="cap-panel"
                  className={`lp-tab ${isActive ? "is-active" : ""}`}
                  onClick={() => setActive(i)}
                >
                  <span className="lp-tab__rail" aria-hidden="true">
                    {isActive && !reduced && (
                      <span
                        key={active}
                        onAnimationEnd={() =>
                          setActive((prev) => (prev + 1) % STEPS.length)
                        }
                      />
                    )}
                  </span>
                  <span className="lp-tab__num lp-mono">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="lp-tab__body">
                    <span className="lp-tab__title">{step.title}</span>
                    <AnimatePresence initial={false}>
                      {isActive && (
                        <motion.span
                          className="lp-tab__desc"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.4, ease: EASE }}
                        >
                          <span>{step.desc}</span>
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className="lp-show__stage"
            ref={tiltRef}
            onPointerMove={handleTilt}
            onPointerLeave={resetTilt}
          >
            <div className="lp-show__backdrop" aria-hidden="true" />
            <div
              className="lp-window"
              role="tabpanel"
              id="cap-panel"
              aria-labelledby={`cap-tab-${active}`}
            >
              <div className="lp-window__bar lp-mono">
                <span className="lp-window__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={active}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                  >
                    {STEPS[active].file}
                  </motion.span>
                </AnimatePresence>
              </div>
              <div className="lp-window__body">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active}
                    className="lp-window__pane"
                    initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -16, filter: "blur(6px)" }}
                    transition={{ duration: 0.35, ease: EASE }}
                  >
                    <Pane />
                  </motion.div>
                </AnimatePresence>
                <div className="lp-window__glare" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
