import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { Check, Minus } from "lucide-react";
import { Reveal, SectionHead } from "./LandingPrimitives";
import { EASE, trackSpot } from "./landingUtils";

/**
 * "Coverage at every level": what coverage MEANS for unit, integration and
 * system tests. Mirrors the Unified Dashboard model
 * (unit = code coverage, integration = API endpoint coverage,
 * system = flow coverage). Numbers below are illustrative sample data.
 */
const LEVELS = [
  {
    key: "unit",
    name: "Unit",
    tools: "Jest · Vitest",
    color: "var(--lp-unit)",
    value: 92.8,
    metric: "Code coverage",
    question: "Is every line and branch executed?",
    measure:
      "Statements, branches, functions and lines, traced per function on its Control Flow Graph.",
    evidence: [
      { tag: "12", name: "if (order.qty <= 0) {", hit: true },
      { tag: "13", name: "  return reject(order);", hit: false },
      { tag: "15", name: "return reserve(order);", hit: true },
    ],
    hitLabel: "hit",
    missLabel: "missed",
  },
  {
    key: "integration",
    name: "Integration",
    tools: "Supertest · Playwright API",
    color: "var(--lp-integration)",
    value: 85.2,
    metric: "API endpoint coverage",
    question: "Is every API endpoint exercised?",
    measure:
      "Endpoints discovered from your routes, matched against the requests your API tests actually make.",
    evidence: [
      { tag: "GET", name: "/api/orders", hit: true },
      { tag: "POST", name: "/api/orders", hit: true },
      { tag: "DELETE", name: "/api/orders/:id", hit: false },
    ],
    hitLabel: "tested",
    missLabel: "untested",
  },
  {
    key: "system",
    name: "System",
    tools: "Playwright E2E",
    color: "var(--lp-system)",
    value: 76.9,
    metric: "Flow coverage",
    question: "Is every user journey verified end to end?",
    measure:
      "User flows through the running application, each backed by recorded evidence from the test run.",
    evidence: [
      { tag: "FLOW", name: "Sign in → Projects", hit: true },
      { tag: "FLOW", name: "Import repo → Run tests", hit: true },
      { tag: "FLOW", name: "Invite member → Accept", hit: false },
    ],
    hitLabel: "verified",
    missLabel: "no test",
  },
];

function Percent({ value, active }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    const controls = animate(0, value, {
      duration: reduced ? 0 : 1.6,
      ease: EASE,
      onUpdate: (latest) => setShown(latest),
    });
    return () => controls.stop();
  }, [active, reduced, value]);

  return <>{shown.toFixed(1)}%</>;
}

function LevelCard({ level, index }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <Reveal delay={index * 0.1} style={{ height: "100%" }}>
      <article
        ref={ref}
        className="lp-lvl lp-spot"
        style={{ "--lvl": level.color }}
        onPointerMove={trackSpot}
      >
        <header className="lp-lvl__head">
          <div>
            <span className="lp-lvl__index lp-mono">
              Level {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="lp-lvl__name">{level.name} tests</h3>
          </div>
          <span className="lp-lvl__tools lp-mono">{level.tools}</span>
        </header>

        <div className="lp-lvl__gauge">
          <div className="lp-ring">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle className="lp-ring__track" cx="50" cy="50" r="42" />
              <motion.circle
                className="lp-ring__value"
                cx="50"
                cy="50"
                r="42"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: inView ? level.value / 100 : 0 }}
                transition={{ duration: 1.6, ease: EASE }}
              />
            </svg>
            <span className="lp-ring__num lp-mono">
              <Percent value={level.value} active={inView} />
            </span>
          </div>
          <div>
            <span className="lp-lvl__metric lp-mono">{level.metric}</span>
            <p className="lp-lvl__question">{level.question}</p>
          </div>
        </div>

        <p className="lp-lvl__measure">{level.measure}</p>

        <motion.ul
          className="lp-lvl__evidence lp-mono"
          initial="hidden"
          animate={inView ? "show" : "hidden"}
          variants={{ show: { transition: { staggerChildren: 0.14, delayChildren: 0.5 } } }}
        >
          {level.evidence.map((row) => (
            <motion.li
              key={row.tag + row.name}
              className={`lp-ev ${row.hit ? "" : "is-miss"}`}
              variants={{
                hidden: { opacity: 0, x: -10 },
                show: { opacity: 1, x: 0, transition: { duration: 0.5, ease: EASE } },
              }}
            >
              <span className="lp-ev__tag">{row.tag}</span>
              <span className="lp-ev__name">{row.name}</span>
              <span className="lp-ev__state">
                {row.hit ? <Check /> : <Minus />}
                {row.hit ? level.hitLabel : level.missLabel}
              </span>
            </motion.li>
          ))}
        </motion.ul>
      </article>
    </Reveal>
  );
}

export default function LandingCoverage() {
  return (
    <section id="coverage" className="lp-section lp-section--alt">
      <div className="lp-container">
        <SectionHead
          layout="split"
          eyebrow="Coverage at every level"
          title="Unit, integration and system coverage in one model"
          sub="Each test level answers a different question, so CovAI measures each one differently, then puts all three side by side."
        />
        <div className="lp-levels">
          {LEVELS.map((level, i) => (
            <LevelCard key={level.key} level={level} index={i} />
          ))}
        </div>
        <Reveal className="lp-levels__foot" delay={0.2}>
          <span>
            All three levels roll up into the Unified Testing &amp; Quality
            Dashboard for every project.
          </span>
          <span className="lp-mono">Figures shown are sample data.</span>
        </Reveal>
      </div>
    </section>
  );
}
