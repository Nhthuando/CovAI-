import { Component, lazy, Suspense, useCallback, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Loader2,
} from "lucide-react";

const CfgScene = lazy(() => import("./CfgScene"));

const CLI_COMMAND = "npx covai-cli analyze --coverage";

// Technical-drawing style callouts around the graph (no icon bubbles).
const ANNOTATIONS = [
  { label: "Control flow analysis", side: "left" },
  { label: "AI test synthesis", side: "right" },
  { label: "Sandbox validation", side: "left" },
  { label: "Realtime collaboration", side: "right" },
];

/** WebGL can fail (old GPU, disabled context). Never take the page down with it. */
class SceneBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("[LandingHero] WebGL scene failed, hiding 3D stage:", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.9, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function LandingHero() {
  const reduced = useReducedMotion();
  const heroRef = useRef(null);
  const [coverage, setCoverage] = useState(46);
  const [copied, setCopied] = useState(false);

  const handlePointerMove = useCallback((event) => {
    const el = heroRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("[LandingHero] Could not copy CLI command:", error);
    }
  };

  const done = coverage >= 100;

  return (
    <section
      id="hero"
      ref={heroRef}
      className="lp-hero lp-night"
      onPointerMove={reduced ? undefined : handlePointerMove}
    >
      <div className="lp-aurora" aria-hidden="true">
        <div className="lp-aurora__blob lp-aurora__blob--1" />
        <div className="lp-aurora__blob lp-aurora__blob--2" />
        <div className="lp-aurora__blob lp-aurora__blob--3" />
        <div className="lp-aurora__cursor" />
        <div className="lp-aurora__grid" />
      </div>

      <div className="lp-container lp-hero__inner">
        <motion.div initial="hidden" animate="show">
          <motion.a href="#features" className="lp-tag" variants={rise} custom={0}>
            <span className="lp-tag__key lp-mono">ENGINE</span>
            Deterministic analysis + AI test generation
            <ChevronRight />
          </motion.a>

          <motion.h1 className="lp-hero__title" variants={rise} custom={1}>
            Find every untested branch.
            <span className="lp-hero__accent">Let AI write the test.</span>
          </motion.h1>

          <motion.p className="lp-hero__lead" variants={rise} custom={2}>
            CovAI parses your JavaScript and TypeScript source code, constructs
            Control Flow Graphs to locate untested branches, and generates
            runnable test cases directly into your repository.
          </motion.p>

          <motion.div className="lp-hero__actions" variants={rise} custom={3}>
            <Link
              to="/register"
              id="hero-cta-btn"
              className="lp-btn lp-btn--light lp-shine"
            >
              Start Testing Free
              <ArrowRight className="lp-btn__arrow" />
            </Link>
            <a href="#features" className="lp-btn lp-btn--ghost">
              See how it works
            </a>
          </motion.div>

          <motion.div variants={rise} custom={4}>
            <div className="lp-cli lp-mono">
              <span className="lp-cli__prompt">$</span>
              <code>{CLI_COMMAND}</code>
              <button
                type="button"
                onClick={handleCopy}
                title="Copy CLI command"
                aria-label="Copy CLI command to clipboard"
              >
                {copied ? <Check /> : <Copy />}
              </button>
            </div>
          </motion.div>
        </motion.div>

        <motion.div
          className="lp-stage"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="lp-stage__halo" aria-hidden="true" />
          <div className="lp-orbit lp-orbit--lg" aria-hidden="true">
            <span className="lp-orbit__dot" />
          </div>
          <div className="lp-orbit lp-orbit--sm" aria-hidden="true">
            <span className="lp-orbit__dot" />
          </div>

          <div className="lp-stage__canvas">
            <SceneBoundary>
              <Suspense fallback={null}>
                <CfgScene onCoverage={setCoverage} reduced={Boolean(reduced)} />
              </Suspense>
            </SceneBoundary>
          </div>

          {ANNOTATIONS.map((note, i) => (
            <motion.span
              key={note.label}
              className={`lp-note lp-note--${note.side} lp-note--${i + 1}`}
              initial={{ opacity: 0, x: note.side === "left" ? -12 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.9 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
            >
              <i className="lp-mono">{String(i + 1).padStart(2, "0")}</i>
              {note.label}
            </motion.span>
          ))}

          <div className="lp-hud lp-hud--coverage" aria-live="off">
            <div className="lp-hud__label">
              <span>Branch coverage</span>
              <span className="lp-pulse" />
            </div>
            <div className="lp-hud__value lp-mono">{coverage}%</div>
            <div className="lp-hud__bar">
              <span style={{ width: `${coverage}%` }} />
            </div>
          </div>

          <div className="lp-hud lp-hud--test">
            <div className="lp-hud__row lp-mono">
              <CheckCircle2 />
              auth.service.test.js
            </div>
            <div
              className={`lp-hud__row lp-mono ${done ? "" : "lp-hud__row--pending"}`}
            >
              {done ? <CheckCircle2 /> : <Loader2 className="animate-spin" />}
              {done ? "Sandbox verified" : "Generating tests…"}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
