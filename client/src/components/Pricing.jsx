import { Link } from "react-router-dom";
import { Check, Minus } from "lucide-react";
import Badge from "./common/Badge";
import Button from "./common/Button";
import Card from "./common/Card";

const PLANS = [
  {
    id: "community",
    name: "Community",
    price: "$0",
    period: "forever",
    desc: "Essential automated coverage analysis for open source developers and solo engineers.",
    cta: "Start Free",
    ctaTo: "/register",
    ctaVariant: "outline",
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
    ctaVariant: "primary",
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
    ctaVariant: "secondary",
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

export default function Pricing() {
  return (
    <section
      id="pricing"
      className="py-20 md:py-28 bg-[var(--color-bg)] border-b border-[var(--color-border)]"
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-14">
          <Badge variant="primary" size="md" className="mb-3" pill>
            TRANSPARENT PRICING
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)] tracking-tight mb-3">
            Predictable Plans for Engineering Teams
          </h2>
          <p className="text-sm sm:text-base text-[var(--color-text-secondary)]">
            Free forever for open source developers. Scale as your test suite
            and team velocity increase.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {PLANS.map((plan) => (
            <Card
              key={plan.id}
              id={`pricing-${plan.id}`}
              className={`p-6 sm:p-7 flex flex-col justify-between relative ${
                plan.featured
                  ? "border-2 border-[var(--color-primary)] bg-[var(--color-surface)] shadow-sm"
                  : "border border-[var(--color-border)] bg-[var(--color-surface)]"
              }`}
            >
              <div>
                {/* Header info */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-[var(--color-text)]">
                    {plan.name}
                  </h3>
                  {plan.badge && (
                    <Badge variant="primary" size="sm">
                      {plan.badge}
                    </Badge>
                  )}
                </div>

                {/* Price block */}
                <div className="flex items-baseline gap-1.5 mb-3">
                  <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--color-text)] font-mono">
                    {plan.price}
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)] font-mono">
                    {plan.period}
                  </span>
                </div>

                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-6 min-h-[36px]">
                  {plan.desc}
                </p>

                {/* CTA Button */}
                <Button
                  as={Link}
                  to={plan.ctaTo}
                  id={`pricing-cta-${plan.id}`}
                  variant={plan.ctaVariant}
                  size="md"
                  className="w-full mb-6 font-semibold"
                >
                  {plan.cta}
                </Button>

                {/* Features divider */}
                <div className="border-t border-[var(--color-border)] pt-5 space-y-2.5">
                  <div className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Included capabilities
                  </div>
                  {plan.features.map((feat) => (
                    <div
                      key={feat}
                      className="flex items-start gap-2 text-xs text-[var(--color-text)]"
                    >
                      <Check className="w-3.5 h-3.5 text-[var(--color-success)] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                  {plan.excluded.map((feat) => (
                    <div
                      key={feat}
                      className="flex items-start gap-2 text-xs text-[var(--color-text-muted)]"
                    >
                      <Minus className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Footnote */}
        <p className="text-center text-xs text-[var(--color-text-muted)] mt-10">
          All paid plans include a 14-day free trial. No credit card required to
          get started.
        </p>
      </div>
    </section>
  );
}
