import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  FileCode,
  FolderGit2,
  Network,
} from "lucide-react";
import Covy from "./LandingMascot";
import { Reveal, SectionHead } from "./LandingPrimitives";
import { EASE, trackSpot } from "./landingUtils";

const inViewOnce = { once: true, margin: "-80px" };

/* ============================================================
   BENTO — dark tiles, each with a small live illustration
   ============================================================ */

/** Two collaborators' carets drifting over a shared file. */
function CollabArt() {
  const reduced = useReducedMotion();
  const drift = (path) =>
    reduced
      ? undefined
      : {
          animate: path,
          transition: { duration: 9, repeat: Infinity, ease: "easeInOut" },
        };
  return (
    <div className="lp-art lp-art--code lp-mono">
      <div className="lp-code-line"><i>12</i><span><span className="tok-k">export function</span> <span className="tok-f">validateOrder</span>(order) {"{"}</span></div>
      <div className="lp-code-line"><i>13</i><span>  <span className="tok-k">if</span> (order.qty &lt;= 0) {"{"}</span></div>
      <div className="lp-code-line"><i>14</i><span>    <span className="tok-k">return</span> {"{ ok: "}<span className="tok-k">false</span>{", reason: "}<span className="tok-s">&quot;EMPTY&quot;</span>{" };"}</span></div>
      <div className="lp-code-line"><i>15</i><span>  {"}"}</span></div>
      <div className="lp-code-line"><i>16</i><span>  <span className="tok-k">return</span> <span className="tok-f">reserve</span>(order);</span></div>
      <div className="lp-code-line"><i>17</i><span>{"}"}</span></div>
      <motion.span
        className="lp-caret"
        style={{ "--c": "var(--lp-brand)", left: "38%", top: "26%" }}
        {...drift({ x: [0, 70, 70, 10, 0], y: [0, 0, 26, 26, 0] })}
      >
        <b>Owner</b>
      </motion.span>
      <motion.span
        className="lp-caret"
        style={{ "--c": "var(--lp-mint)", left: "56%", top: "62%" }}
        {...drift({ x: [0, -90, -40, 30, 0], y: [0, -26, -52, -26, 0] })}
      >
        <b>Editor</b>
      </motion.span>
    </div>
  );
}

/** Pull-request checks resolving one after another. */
function GateArt() {
  const checks = [
    ["unit tests", "128 passed"],
    ["coverage / branches", "91.2%  +4.1"],
    ["coverage gate", "required ≥ 85%"],
  ];
  return (
    <div className="lp-art lp-art--list lp-mono">
      {checks.map(([name, value], i) => (
        <motion.div
          className="lp-check"
          key={name}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={inViewOnce}
          transition={{ delay: 0.25 + i * 0.22, duration: 0.5, ease: EASE }}
        >
          <motion.span
            className="lp-check__mark"
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={inViewOnce}
            transition={{ delay: 0.5 + i * 0.22, type: "spring", stiffness: 420, damping: 16 }}
          >
            <Check />
          </motion.span>
          <span>{name}</span>
          <span className="lp-check__value">{value}</span>
        </motion.div>
      ))}
      <motion.div
        className="lp-check__verdict"
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={inViewOnce}
        transition={{ delay: 1.2, duration: 0.5, ease: EASE }}
      >
        All checks passed · ready to merge
      </motion.div>
    </div>
  );
}

function MockArt() {
  return (
    <div className="lp-art lp-art--code lp-mono">
      <div className="lp-code-line"><span><span className="tok-f">jest</span>.<span className="tok-f">mock</span>(<span className="tok-s">&quot;./mailer&quot;</span>);</span></div>
      <div className="lp-code-line"><span>db.findUser</span></div>
      <div className="lp-code-line"><span>  .<span className="tok-f">mockResolvedValue</span>(</span></div>
      <div className="lp-code-line"><span>    fixtures.user<span className="lp-blink" /></span></div>
      <div className="lp-code-line"><span>  );</span></div>
    </div>
  );
}

/** Unit / integration / system: three levels filling up. */
function LevelsArt() {
  const levels = [
    ["Unit", 0.94, "var(--lp-brand)"],
    ["Integration", 0.72, "var(--lp-mint)"],
    ["System", 0.5, "var(--lp-warn)"],
  ];
  return (
    // The observer sits on the wrapper: a bar scaled to 0 has no area to observe.
    <motion.div
      className="lp-art lp-art--levels"
      initial="empty"
      whileInView="filled"
      viewport={inViewOnce}
    >
      {levels.map(([label, amount, color], i) => (
        <div className="lp-level" key={label}>
          <span className="lp-level__label lp-mono">{label}</span>
          <span className="lp-level__track">
            <motion.span
              style={{ background: color }}
              variants={{
                empty: { scaleX: 0 },
                filled: {
                  scaleX: amount,
                  transition: { delay: 0.2 + i * 0.15, duration: 1.1, ease: EASE },
                },
              }}
            />
          </span>
        </div>
      ))}
    </motion.div>
  );
}

/** Coverage trend line drawing itself. */
function TrendArt() {
  const line = "M4 78 L40 70 L76 74 L112 52 L148 58 L184 36 L220 40 L256 18 L296 12";
  return (
    <div className="lp-art lp-art--trend">
      <svg viewBox="0 0 300 92" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="lp-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--lp-brand)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--lp-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d={`${line} L296 92 L4 92 Z`}
          fill="url(#lp-trend-fill)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={inViewOnce}
          transition={{ delay: 0.9, duration: 0.8 }}
        />
        <motion.path
          d={line}
          fill="none"
          stroke="var(--lp-brand)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={inViewOnce}
          transition={{ duration: 1.6, ease: EASE }}
        />
      </svg>
      <span className="lp-art__caption lp-mono">coverage · last 8 runs</span>
    </div>
  );
}

const TILES = [
  {
    area: "a",
    Art: CollabArt,
    title: "Realtime collaborative editor",
    desc: "Edit code and tests together with live cursors and presence, with Owner, Editor and Viewer roles per project.",
  },
  {
    area: "b",
    Art: GateArt,
    title: "GitHub & CI gates",
    desc: "Import repositories and flag coverage regressions before code merges to main.",
  },
  {
    area: "c",
    Art: MockArt,
    title: "Mock & fixture synthesis",
    desc: "Deterministic mocks for modules, HTTP endpoints and database clients.",
  },
  {
    area: "d",
    Art: LevelsArt,
    title: "Integration & system tests",
    desc: "API scenarios and end-to-end flows beside your unit tests.",
  },
  {
    area: "e",
    Art: TrendArt,
    title: "Quality dashboard",
    desc: "Cyclomatic complexity and coverage trends in one view.",
  },
];

export function LandingBento() {
  return (
    <section id="more" className="lp-section">
      <div className="lp-container">
        <SectionHead
          layout="left"
          eyebrow="One workspace"
          title="Everything a test workflow needs"
        />
        <div className="lp-tiles">
          {TILES.map(({ area, Art, title, desc }, i) => (
            <Reveal
              key={title}
              delay={i * 0.06}
              className={`lp-tiles__cell lp-tiles__cell--${area}`}
            >
              <article className="lp-tile lp-spot" onPointerMove={trackSpot}>
                <Art />
                <div className="lp-tile__body">
                  <h3 className="lp-tile__title">{title}</h3>
                  <p className="lp-tile__desc">{desc}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   WORKFLOW — a pipeline rail whose stages light up in sequence
   ============================================================ */

const PIPELINE = [
  {
    icon: FolderGit2,
    title: "Repository Ingestion",
    desc: "Import code directly from GitHub or upload a local archive. CovAI parses project ASTs, configs, and dependencies.",
    out: "AST + project map",
  },
  {
    icon: Network,
    title: "Control Flow Analysis",
    desc: "Constructs Control Flow Graphs per function to discover uncovered branch predicates and evaluate cyclomatic complexity.",
    out: "CFG per function",
  },
  {
    icon: FileCode,
    title: "Test Suite Synthesis",
    desc: "Targeted Jest and Vitest suites are synthesized with accurate mocks and assertions for uncovered paths.",
    out: "*.test.js suites",
  },
  {
    icon: CheckCircle2,
    title: "Sandbox Verification",
    desc: "Executes the synthesized tests in an isolated runner to ensure they pass and measurably boost coverage.",
    out: "coverage delta",
  },
];

const STAGE_MS = 2400;

export function LandingWorkflow() {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: "-25% 0px -25% 0px" });
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!inView || reduced || held) return undefined;
    const id = setInterval(
      () => setActive((prev) => (prev + 1) % PIPELINE.length),
      STAGE_MS,
    );
    return () => clearInterval(id);
  }, [inView, reduced, held]);

  return (
    <section id="workflow" className="lp-section lp-section--alt">
      <div className="lp-container">
        <SectionHead
          layout="split"
          eyebrow="Execution pipeline"
          title="How CovAI analyzes and tests code"
          sub="A deterministic four-stage pipeline designed for accuracy, repeatability, and immediate developer adoption."
        />
        <Reveal>
          <ol
            ref={ref}
            className="lp-pipe"
            style={{ "--active": active }}
            onPointerLeave={() => setHeld(false)}
          >
            <li className="lp-pipe__rail" aria-hidden="true">
              <span className="lp-pipe__fill" />
            </li>
            {PIPELINE.map((stage, i) => {
              const Icon = stage.icon;
              const state =
                i === active ? "is-active" : i < active ? "is-done" : "";
              return (
                <li
                  key={stage.title}
                  className={`lp-stage-col ${state}`}
                  onPointerEnter={() => {
                    setHeld(true);
                    setActive(i);
                  }}
                >
                  <span className="lp-stage-col__node">
                    <Icon />
                  </span>
                  <span className="lp-stage-col__num lp-mono">
                    Stage {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="lp-stage-col__title">{stage.title}</h3>
                  <p className="lp-stage-col__desc">{stage.desc}</p>
                  <span className="lp-stage-col__out lp-mono">
                    <ArrowRight />
                    {stage.out}
                  </span>
                </li>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================
   CTA
   ============================================================ */

export function LandingCta() {
  return (
    <section id="get-started" className="lp-cta-wrap lp-section--alt">
      <div className="lp-container">
        <Reveal className="lp-cta lp-night">
          <span className="lp-cta__dots" aria-hidden="true" />
          <span className="lp-cta__beam" aria-hidden="true" />
          {["tl", "tr", "bl", "br"].map((corner) => (
            <span
              key={corner}
              className={`lp-cross lp-cross--${corner}`}
              aria-hidden="true"
            />
          ))}
          <Covy pose="shield" className="lp-cta__covy lp-cta__covy--1" />
          <Covy pose="cheer" className="lp-cta__covy lp-cta__covy--2" />
          <h2 className="lp-cta__title">Ship code that is actually tested</h2>
          <p className="lp-cta__sub">
            Import a repository and see your first coverage map in minutes.
          </p>
          <div className="lp-cta__actions">
            <Link to="/register" className="lp-btn lp-btn--light lp-shine">
              Start Testing Free
              <ArrowRight className="lp-btn__arrow" />
            </Link>
            <Link to="/login" className="lp-btn lp-btn--ghost">
              Log in
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
