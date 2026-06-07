import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/month",
    desc: "Perfect for solo developers exploring AI test coverage.",
    cta: "Get started free",
    ctaHref: "#signup",
    featured: false,
    features: [
      "Up to 3 projects",
      "1 GitHub repo import",
      "Basic CFG visualization",
      "50 AI test generations/mo",
      "Coverage reports (7-day history)",
      "Community support",
    ],
    notIncluded: ["Team collaboration", "Priority AI queue", "Custom integrations"],
  },
  {
    id: "pro",
    name: "Pro Team",
    price: "$29",
    period: "/month per seat",
    desc: "Everything your engineering team needs to ship with confidence.",
    cta: "Start 14-day trial",
    ctaHref: "#signup-pro",
    featured: true,
    badge: "Most Popular",
    features: [
      "Unlimited projects",
      "Unlimited GitHub imports",
      "Advanced CFG + Complexity graphs",
      "Unlimited AI test generations",
      "90-day coverage history",
      "Team dashboard & PR integration",
      "Priority AI queue",
      "Slack & Jira integration",
      "Email support (24h SLA)",
    ],
    notIncluded: [],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    period: "",
    desc: "Tailored for large engineering orgs with compliance needs.",
    cta: "Contact sales",
    ctaHref: "#contact",
    featured: false,
    features: [
      "Everything in Pro Team",
      "SSO / SAML authentication",
      "On-premise deployment option",
      "Custom AI model fine-tuning",
      "Unlimited history & audit logs",
      "SLA guarantee (99.9% uptime)",
      "Dedicated account manager",
      "Custom integrations & API",
    ],
    notIncluded: [],
  },
];

export default function Pricing() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <section
      id="pricing"
      ref={ref}
      style={{
        padding: "7rem 1.5rem",
        background: "var(--surface-container)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative top line */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "1px",
        background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.4), rgba(124,58,237,0.4), transparent)",
      }} />

      {/* Background glow */}
      <div style={{
        position: "absolute",
        top: "30%",
        left: "50%",
        transform: "translateX(-50%)",
        width: "700px",
        height: "400px",
        borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(124,58,237,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          style={{ textAlign: "center", marginBottom: "4rem" }}
        >
          <span className="glass-pill" style={{
            padding: "0.375rem 1rem",
            fontSize: "0.7rem",
            fontWeight: "700",
            letterSpacing: "0.14em",
            color: "#7C3AED",
            textTransform: "uppercase",
          }}>
            PRICING
          </span>
          <h2 style={{
            marginTop: "1.25rem",
            fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
            fontWeight: "700",
            color: "#f0f6fc",
            letterSpacing: "-0.025em",
          }}>
            Simple, transparent pricing
          </h2>
          <p style={{
            marginTop: "1rem",
            color: "#8b949e",
            fontSize: "1.05rem",
            maxWidth: "460px",
            margin: "1rem auto 0",
          }}>
            Start free, scale as you grow. No hidden fees.
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "1.5rem",
          alignItems: "center",
        }}>
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.id}
              id={`pricing-${plan.id}`}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.15, ease: "easeOut" }}
              style={{
                position: "relative",
                borderRadius: "20px",
                padding: plan.featured ? "2.25rem 2rem" : "2rem",
                background: plan.featured
                  ? "linear-gradient(160deg, rgba(124,58,237,0.12) 0%, rgba(13,17,23,0.95) 60%)"
                  : "var(--surface-main)",
                transform: plan.featured ? "scale(1.03)" : "scale(1)",
                zIndex: plan.featured ? 1 : 0,
              }}
            >
              {/* Gradient border for featured */}
              {plan.featured && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "20px",
                  padding: "1.5px",
                  background: "linear-gradient(135deg, #7C3AED 0%, #22d3ee 50%, #7C3AED 100%)",
                  WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                  WebkitMaskComposite: "xor",
                  maskComposite: "exclude",
                  zIndex: 0,
                  pointerEvents: "none",
                  animation: "pulse-glow 3s ease-in-out infinite",
                }} />
              )}

              {!plan.featured && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "20px",
                  border: "1px solid rgba(255,255,255,0.07)",
                  pointerEvents: "none",
                }} />
              )}

              <div style={{ position: "relative", zIndex: 1 }}>
                {/* Badge */}
                {plan.badge && (
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    padding: "0.3rem 0.875rem",
                    borderRadius: "20px",
                    background: "linear-gradient(135deg, #7C3AED, #22d3ee)",
                    fontSize: "0.7rem",
                    fontWeight: "700",
                    color: "white",
                    letterSpacing: "0.05em",
                    marginBottom: "1.25rem",
                  }}>
                    ✦ {plan.badge}
                  </div>
                )}

                {/* Plan name */}
                <h3 style={{
                  fontSize: "1.1rem",
                  fontWeight: "700",
                  color: plan.featured ? "#f0f6fc" : "#8b949e",
                  marginBottom: "0.5rem",
                  letterSpacing: "-0.01em",
                }}>
                  {plan.name}
                </h3>

                {/* Price */}
                <div style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "0.25rem",
                  marginBottom: "0.75rem",
                }}>
                  <span style={{
                    fontSize: plan.price === "Custom" ? "2rem" : "2.8rem",
                    fontWeight: "800",
                    color: "#f0f6fc",
                    letterSpacing: "-0.03em",
                    lineHeight: 1,
                  }}>
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span style={{ color: "#484f58", fontSize: "0.85rem" }}>
                      {plan.period}
                    </span>
                  )}
                </div>

                {/* Desc */}
                <p style={{
                  color: "#8b949e",
                  fontSize: "0.875rem",
                  lineHeight: "1.6",
                  marginBottom: "1.75rem",
                  paddingBottom: "1.75rem",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}>
                  {plan.desc}
                </p>

                {/* CTA */}
                <motion.a
                  href={plan.ctaHref}
                  id={`pricing-cta-${plan.id}`}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    display: "block",
                    textAlign: "center",
                    padding: "0.875rem",
                    borderRadius: "10px",
                    textDecoration: "none",
                    fontSize: "0.95rem",
                    fontWeight: "600",
                    marginBottom: "1.75rem",
                    transition: "all 0.2s ease",
                    ...(plan.featured
                      ? {
                          background: "linear-gradient(135deg, #7C3AED, #9d5cf5)",
                          color: "white",
                          boxShadow: "0 0 24px rgba(124,58,237,0.4)",
                        }
                      : {
                          background: "rgba(255,255,255,0.04)",
                          color: "#f0f6fc",
                          border: "1px solid rgba(255,255,255,0.1)",
                        }),
                  }}
                >
                  {plan.cta}
                </motion.a>

                {/* Features */}
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                  {plan.features.map((feat) => (
                    <li
                      key={feat}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.625rem",
                        fontSize: "0.875rem",
                        color: "#c9d1d9",
                        lineHeight: "1.5",
                      }}
                    >
                      <span style={{
                        color: plan.featured ? "#22d3ee" : "#7C3AED",
                        flexShrink: 0,
                        fontSize: "0.8rem",
                        marginTop: "2px",
                      }}>✓</span>
                      {feat}
                    </li>
                  ))}
                  {plan.notIncluded.map((feat) => (
                    <li
                      key={feat}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.625rem",
                        fontSize: "0.875rem",
                        color: "#484f58",
                        lineHeight: "1.5",
                      }}
                    >
                      <span style={{ flexShrink: 0, fontSize: "0.8rem", marginTop: "2px" }}>✕</span>
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          style={{
            textAlign: "center",
            color: "#484f58",
            fontSize: "0.8rem",
            marginTop: "2.5rem",
          }}
        >
          All plans include a 14-day free trial. No credit card required to start.
        </motion.p>
      </div>
    </section>
  );
}
