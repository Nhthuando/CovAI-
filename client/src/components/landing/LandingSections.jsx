import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  animate,
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from "framer-motion";
import {
  Activity,
  ArrowRight,
  Boxes,
  Check,
  Minus,
  Network,
  Plus,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  Workflow,
} from "lucide-react";
import Covy from "./LandingMascot";
import { Reveal, SectionHead } from "./LandingPrimitives";
import { EASE, trackSpot } from "./landingUtils";

function CountUp({ to, suffix = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return undefined;
    const controls = animate(0, to, {
      duration: reduced ? 0 : 1.6,
      ease: EASE,
      onUpdate: (latest) => setValue(Math.round(latest)),
    });
    return () => controls.stop();
  }, [inView, reduced, to]);

  return (
    <span ref={ref}>
      {value}
      {suffix}
    </span>
  );
}

/* ============================================================
   PROOF
   ============================================================ */

const PROOF_CHIPS = [
  { icon: Terminal, label: "Jest & Vitest unit tests" },
  { icon: Network, label: "Supertest integration tests" },
  { icon: Workflow, label: "Playwright system tests" },
  { icon: Boxes, label: "Babel AST parsing" },
  { icon: Activity, label: "Istanbul-compatible coverage" },
  { icon: ShieldCheck, label: "Isolated sandbox runner" },
  { icon: Sparkles, label: "Gemini-powered synthesis" },
  { icon: Users, label: "Realtime collaboration" },
];

const STATS = [
  { to: 4, suffix: "", label: "Coverage metrics: statements, branches, functions, lines" },
  { to: 3, suffix: "", label: "Test levels in one workspace: unit, integration, system" },
  { to: 100, suffix: "%", label: "Of generated tests run in the sandbox before you commit" },
];

export function LandingProof() {
  // duplicated once so the marquee can loop seamlessly
  const chips = [...PROOF_CHIPS, ...PROOF_CHIPS];
  return (
    <section className="lp-section lp-proof" aria-label="Supported tooling">
      <div className="lp-marquee">
        <div className="lp-marquee__track">
          {chips.map((chip, i) => {
            const Icon = chip.icon;
            return (
              <span
                className="lp-chip"
                key={`${chip.label}-${i}`}
                aria-hidden={i >= PROOF_CHIPS.length}
              >
                <Icon />
                {chip.label}
              </span>
            );
          })}
        </div>
      </div>
      <div className="lp-container">
        <div className="lp-stats">
          {STATS.map((stat, i) => (
            <Reveal className="lp-stat" key={stat.label} delay={i * 0.08}>
              <div className="lp-stat__value">
                <CountUp to={stat.to} suffix={stat.suffix} />
              </div>
              <p className="lp-stat__label">{stat.label}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PRICING
   ============================================================ */

const PLANS = [
  {
    id: "community",
    name: "Community",
    price: "$0",
    period: "forever",
    desc: "Essential automated coverage analysis for open source developers and solo engineers.",
    cta: "Start Free",
    ctaTo: "/register",
    featured: false,
    features: [
      "Up to 3 active repositories",
      "GitHub repo integration & zip upload",
      "Control Flow Graph (CFG) visualizer",
      "50 AI test suite generations / month",
      "Statement & branch coverage diagnostics",
      "Community forum support",
    ],
    excluded: [
      "Continuous CI/CD PR regression checks",
      "Private on-premise execution sandbox",
      "Custom LLM test model fine-tuning",
    ],
  },
  {
    id: "pro",
    name: "Developer Pro",
    price: "$24",
    period: "/mo per seat",
    desc: "Complete test automation and coverage verification for professional engineering teams.",
    cta: "Start 14-Day Trial",
    ctaTo: "/register",
    featured: true,
    badge: "Recommended",
    features: [
      "Unlimited repositories",
      "Advanced CFG branch path solver",
      "Unlimited Jest & Vitest generations",
      "Deterministic sandbox test execution",
      "GitHub Pull Request coverage gate",
      "Mock & fixture automatic synthesis",
      "Email & Slack engineering support",
    ],
    excluded: [
      "Private on-premise execution sandbox",
      "Custom LLM test model fine-tuning",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "annual",
    desc: "High-security coverage orchestration and sandbox runners for large engineering organizations.",
    cta: "Contact Sales",
    ctaTo: "/login",
    featured: false,
    features: [
      "Everything in Developer Pro",
      "Self-hosted / on-premise test runner",
      "Monorepo & multi-package orchestration",
      "Custom LLM fine-tuning on internal APIs",
      "SSO / SAML 2.0 authentication",
      "SOC2 compliance documentation & audit logs",
      "Dedicated Technical Account Manager & SLA",
    ],
    excluded: [],
  },
];

export function LandingPricing() {
  return (
    <section id="pricing" className="lp-section">
      <div className="lp-container">
        <SectionHead
          eyebrow="Transparent pricing"
          title="Predictable plans for engineering teams"
          sub="Free forever for open source developers. Scale as your test suite and team velocity increase."
        />
        <div className="lp-pricing">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.id} delay={i * 0.08}>
              <article
                id={`pricing-${plan.id}`}
                className={`lp-card lp-plan ${plan.featured ? "lp-plan--featured" : "lp-spot"}`}
                style={{ height: "100%" }}
                onPointerMove={trackSpot}
              >
                <div className="lp-plan__head">
                  <h3 className="lp-plan__name">{plan.name}</h3>
                  {plan.badge && <span className="lp-plan__badge">{plan.badge}</span>}
                </div>
                <div className="lp-plan__price">
                  <strong className="lp-mono">{plan.price}</strong>
                  <span className="lp-plan__period lp-mono">{plan.period}</span>
                </div>
                <p className="lp-plan__desc">{plan.desc}</p>
                <Link
                  to={plan.ctaTo}
                  id={`pricing-cta-${plan.id}`}
                  className={`lp-btn lp-btn--block lp-shine ${
                    plan.featured ? "lp-btn--light" : "lp-btn--ghost"
                  }`}
                >
                  {plan.cta}
                </Link>
                <ul className="lp-plan__list">
                  {plan.features.map((feat) => (
                    <li key={feat}>
                      <Check />
                      <span>{feat}</span>
                    </li>
                  ))}
                  {plan.excluded.map((feat) => (
                    <li key={feat} className="is-off">
                      <Minus />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
        <p className="lp-footnote">
          All paid plans include a 14-day free trial. No credit card required to
          get started.
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   FAQ
   ============================================================ */

const FAQS = [
  {
    q: "Which languages and test frameworks does CovAI support?",
    a: "CovAI analyzes JavaScript and TypeScript projects. It generates and runs unit tests with Jest and Vitest, API integration tests with Supertest, and system tests with Playwright.",
  },
  {
    q: "Do AI-generated tests go straight into my repository?",
    a: "No. Every generated suite is executed in an isolated sandbox first, and you review the diff before anything is applied to your code.",
  },
  {
    q: "How is coverage measured?",
    a: "Your code is instrumented with Istanbul-compatible tooling to report statements, branches, functions and lines. A Control Flow Graph per function shows exactly which decision paths are still unreached.",
  },
  {
    q: "Can my whole team work in the same project?",
    a: "Yes. Invite teammates as Owner, Editor or Viewer. The editor is collaborative in real time, so everyone sees the same code, tests and coverage.",
  },
  {
    q: "Which AI model writes the tests?",
    a: "Test synthesis runs on Google Gemini models, and you can pick the model per project. Deterministic analysis decides what needs testing; the model only writes the test code.",
  },
];

export function LandingFaq() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="lp-section lp-section--alt">
      <div className="lp-container lp-faq">
        <div className="lp-faq__aside">
          <SectionHead
            eyebrow="FAQ"
            title="Frequently asked questions"
            sub="Still have questions? Create a free workspace and try it on your own repository."
            layout="left"
          />
          <Covy pose="think" className="lp-faq__covy" />
          <Link to="/register" className="lp-btn lp-btn--primary lp-shine">
            Get Started Free
            <ArrowRight className="lp-btn__arrow" />
          </Link>
        </div>
        <div className="lp-faq__list">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal
                key={item.q}
                delay={i * 0.05}
                className={`lp-faq__item ${isOpen ? "is-open" : ""}`}
              >
                <button
                  type="button"
                  className="lp-faq__q"
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  {item.q}
                  <Plus />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-panel-${i}`}
                      className="lp-faq__a"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                    >
                      <p>{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
