import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Minus, Layers, ShieldCheck, Building2, ArrowUpRight } from "lucide-react";

const PLANS = [
  {
    id: "community",
    name: "Starter",
    icon: Layers,
    monthlyPrice: "$0",
    annualPrice: "$0",
    period: "free forever",
    desc: "AST and CFG coverage diagnostics for solo builders.",
    cta: "Create free workspace",
    ctaTo: "/register",
    featured: false,
    features: [
      "Up to 3 active repositories",
      "GitHub sync and zip upload",
      "3D & 2D Control Flow Graph viewer",
      "60 test generations / month",
      "Branch coverage reports",
    ],
    excluded: [
      "API contract matrix & Playwright E2E",
      "Mutation fault injection guard",
      "Self-hosted container runner pool",
    ],
  },
  {
    id: "pro",
    name: "Team",
    icon: ShieldCheck,
    monthlyPrice: "$29",
    annualPrice: "$24",
    period: "per seat / mo",
    desc: "Full 3-tier synthesis, Docker runner, and multiplayer IDE.",
    cta: "Start 14-day trial",
    ctaTo: "/register",
    featured: true,
    badge: "Recommended",
    features: [
      "Unlimited repositories & monorepos",
      "Unit CFG, Supertest API, Playwright E2E",
      "Gemini 2.5 Pro test synthesis",
      "Docker container runner & auto-repair",
      "Mutation verification & PR gates",
      "Real-time Yjs multiplayer editor",
    ],
    excluded: ["Self-hosted VPC runner cluster"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    icon: Building2,
    monthlyPrice: "Custom",
    annualPrice: "Custom",
    period: "annual",
    desc: "Private runners, custom model routing, and RBAC.",
    cta: "Contact sales",
    ctaTo: "/login",
    featured: false,
    features: [
      "Everything in Team",
      "Self-hosted Kubernetes runner fleet",
      "Custom model routing & internal specs",
      "RBAC permissions (Owner, Editor, Viewer)",
      "SAML 2.0 SSO & audit export",
      "Dedicated solutions architect",
    ],
    excluded: [],
  },
];

export default function Pricing() {
  const [teamSize, setTeamSize] = useState(18);
  const [kloc, setKloc] = useState(120);
  const [annual, setAnnual] = useState(true);

  const hoursSavedPerMonth = Math.round(teamSize * 14.5 + kloc * 0.45);
  const synthesizedTests = Math.round(kloc * 11.4 + teamSize * 22).toLocaleString();
  const projectedCoverage = Math.min(98.8, 92.4 + Math.log10(kloc) * 2.1).toFixed(1);

  return (
    <section
      id="pricing"
      className="relative py-24 md:py-32 border-b border-[var(--lp-line)]"
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6">
        {/* Heading */}
        <div className="max-w-xl mb-10 space-y-2.5">
          <h2 className="lp-display text-3xl sm:text-4xl font-bold text-[var(--lp-ink)] tracking-tight">
            Impact estimator &amp; pricing
          </h2>
          <p className="text-sm sm:text-base text-[var(--lp-ink-secondary)]">
            Dial your team and codebase size, then pick a workspace tier.
          </p>
        </div>

        {/* Interactive Estimator Panel */}
        <div className="mb-14 p-6 sm:p-8 rounded-xl lp-machined">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div>
                <div className="flex items-center justify-between text-xs sm:text-sm mb-2.5">
                  <span className="text-[var(--lp-ink-secondary)]">
                    Engineering team size
                  </span>
                  <span className="lp-mono text-[var(--lp-ink)] font-semibold">
                    {teamSize} engineers
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={150}
                  value={teamSize}
                  onChange={(e) => setTeamSize(Number(e.target.value))}
                  aria-label="Engineering team size"
                  className="lp-slider"
                />
                <div className="flex justify-between text-[11px] lp-mono text-[var(--lp-ink-muted)] mt-1.5">
                  <span>2</span>
                  <span>75</span>
                  <span>150</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs sm:text-sm mb-2.5">
                  <span className="text-[var(--lp-ink-secondary)]">
                    Repository size
                  </span>
                  <span className="lp-mono text-[var(--lp-ink)] font-semibold">
                    {kloc}k lines of code
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={500}
                  step={10}
                  value={kloc}
                  onChange={(e) => setKloc(Number(e.target.value))}
                  aria-label="Repository size in thousands of lines of code"
                  className="lp-slider"
                />
                <div className="flex justify-between text-[11px] lp-mono text-[var(--lp-ink-muted)] mt-1.5">
                  <span>10k LOC</span>
                  <span>250k LOC</span>
                  <span>500k LOC</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)]">
                <div className="text-xs text-[var(--lp-ink-muted)]">
                  Test writing saved
                </div>
                <div className="text-2xl sm:text-3xl font-bold lp-mono text-[var(--lp-ink)] mt-1.5">
                  {hoursSavedPerMonth}h
                  <span className="text-xs text-[var(--lp-ink-muted)] font-normal">
                    /mo
                  </span>
                </div>
                <div className="text-[11px] lp-mono text-[var(--lp-ink-secondary)] mt-1">
                  Across {teamSize} engineers
                </div>
              </div>

              <div className="p-4 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)]">
                <div className="text-xs text-[var(--lp-ink-muted)]">
                  Generated assertions
                </div>
                <div className="text-2xl sm:text-3xl font-bold lp-mono text-[var(--lp-ink)] mt-1.5">
                  {synthesizedTests}
                </div>
                <div className="text-[11px] lp-mono text-[var(--lp-ink-secondary)] mt-1">
                  Unit, API &amp; E2E specs
                </div>
              </div>

              <div className="p-4 rounded-lg bg-[var(--lp-signal-bg)] border border-[var(--lp-signal-border)]">
                <div className="text-xs text-[var(--lp-ink-secondary)]">
                  Projected coverage
                </div>
                <div className="text-2xl sm:text-3xl font-bold lp-mono text-[var(--lp-signal)] mt-1.5">
                  {projectedCoverage}%
                </div>
                <div className="text-[11px] lp-mono text-[var(--lp-ink-secondary)] mt-1">
                  Container-verified
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
          <div className="inline-flex items-center p-1 rounded-lg bg-[var(--lp-pill-bg)] border border-[var(--lp-line)]">
            <button
              type="button"
              onClick={() => setAnnual(false)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                !annual
                  ? "bg-[var(--lp-pill-active)] text-[var(--lp-ink)] shadow-xs"
                  : "text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)]"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setAnnual(true)}
              className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                annual
                  ? "bg-[var(--lp-pill-active)] text-[var(--lp-ink)] shadow-xs"
                  : "text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)]"
              }`}
            >
              Annual (20% off)
            </button>
          </div>

          <span className="text-xs text-[var(--lp-ink-muted)]">
            All paid tiers include a 14-day trial with full Docker runner access.
          </span>
        </div>

        {/* 3-Column Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
          {PLANS.map((plan) => {
            const displayPrice = annual ? plan.annualPrice : plan.monthlyPrice;
            const PlanIcon = plan.icon;
            return (
              <div
                key={plan.id}
                id={`pricing-${plan.id}`}
                className={`rounded-xl p-6 sm:p-7 flex flex-col justify-between relative ${
                  plan.featured
                    ? "lp-machined lp-beam-frame"
                    : "bg-[var(--lp-surface)] border border-[var(--lp-line)]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <h3 className="lp-display text-lg font-bold text-[var(--lp-ink)] inline-flex items-center gap-2">
                      <PlanIcon className={`w-4 h-4 ${plan.featured ? "text-[var(--lp-signal)]" : "text-[var(--lp-ink-muted)]"}`} />
                      <span>{plan.name}</span>
                    </h3>
                    {plan.badge && (
                      <span className="px-2.5 py-0.5 rounded bg-[var(--lp-signal-bg)] border border-[var(--lp-signal-border)] text-[var(--lp-signal)] text-[11px] lp-mono font-medium">
                        {plan.badge}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="text-4xl font-bold lp-mono text-[var(--lp-ink)] tracking-tight">
                      {displayPrice}
                    </span>
                    <span className="text-xs lp-mono text-[var(--lp-ink-muted)]">
                      {plan.period}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-[var(--lp-ink-secondary)] leading-relaxed mb-6 min-h-[42px]">
                    {plan.desc}
                  </p>

                  <Link
                    to={plan.ctaTo}
                    id={`pricing-cta-${plan.id}`}
                    className={`w-full py-2.5 px-4 rounded-lg text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 mb-7 ${
                      plan.featured ? "lp-btn-primary" : "lp-btn-secondary"
                    }`}
                  >
                    <span>{plan.cta}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>

                  <div className="border-t border-[var(--lp-line)] pt-5 space-y-2.5">
                    {plan.features.map((feat) => (
                      <div
                        key={feat}
                        className="flex items-start gap-2.5 text-xs text-[var(--lp-ink)]"
                      >
                        <Check className="w-4 h-4 text-[var(--lp-signal)] shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </div>
                    ))}
                    {plan.excluded.map((feat) => (
                      <div
                        key={feat}
                        className="flex items-start gap-2.5 text-xs text-[var(--lp-ink-muted)]"
                      >
                        <Minus className="w-4 h-4 text-[var(--lp-ink-muted)] shrink-0 mt-0.5 opacity-60" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
