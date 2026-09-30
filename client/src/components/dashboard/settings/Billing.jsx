import { useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Zap, Check, Download } from "lucide-react";
import { useToast } from "../ToastContext";

export default function Billing() {
  const { showToast } = useToast();
  const [currentPlan, setCurrentPlan] = useState("pro");

  const plans = [
    {
      id: "free",
      name: "Starter Free",
      price: "$0",
      period: "forever",
      desc: "For individual developers and hobby projects.",
      features: [
        "100 AI requests / month",
        "3 active projects",
        "Basic unit test generation",
        "Community support",
      ],
      isCurrent: currentPlan === "free",
    },
    {
      id: "pro",
      name: "Pro Developer",
      price: "$19",
      period: "per month",
      desc: "For professional developers needing deep coverage & AI.",
      badge: "POPULAR",
      features: [
        "1,000 AI requests / month",
        "Unlimited projects",
        "Skeleton + Full test suite generation",
        "Logic & CFG complexity graph",
        "Fast job queue priority",
        "Email support",
      ],
      isCurrent: currentPlan === "pro",
    },
    {
      id: "team",
      name: "Team & Enterprise",
      price: "$49",
      period: "per month",
      desc: "For teams requiring continuous testing and collaboration.",
      features: [
        "Unlimited AI test generation",
        "Dedicated runner instances",
        "Custom test frameworks",
        "SSO & 2FA security compliance",
        "24/7 dedicated support",
      ],
      isCurrent: currentPlan === "team",
    },
  ];

  const invoices = [
    {
      id: "INV-2026-09",
      date: "Sep 20, 2026",
      amount: "$19.00",
      status: "Paid",
      plan: "Pro Developer (Monthly)",
    },
    {
      id: "INV-2026-08",
      date: "Aug 20, 2026",
      amount: "$19.00",
      status: "Paid",
      plan: "Pro Developer (Monthly)",
    },
    {
      id: "INV-2026-07",
      date: "Jul 20, 2026",
      amount: "$19.00",
      status: "Paid",
      plan: "Pro Developer (Monthly)",
    },
  ];

  const handleSelectPlan = (planId) => {
    if (planId === currentPlan) return;
    setCurrentPlan(planId);
    showToast({
      type: "success",
      title: "Plan Changed",
      message: `You have selected the ${plans.find((p) => p.id === planId)?.name}.`,
    });
  };

  return (
    <div className="max-w-[920px] p-6 sm:p-8 font-sans text-[var(--color-text)]">
      {/* Header */}
      <div className="mb-7">
        <h1 className="text-lg font-bold text-[var(--color-text)] mb-1.5 flex items-center gap-2.5">
          <CreditCard size={20} className="text-[var(--color-primary)]" />
          Subscription & Billing
        </h1>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Manage your plan subscription, compute usage, and review past
          invoices.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Usage & Quota Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-5 pb-4 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
                <CreditCard size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">
                    Current Plan: Pro Developer
                  </h3>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/25">
                    Active
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  $19/month · Renews on October 20, 2026
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                showToast({
                  type: "info",
                  title: "Billing Portal",
                  message: "Redirecting to Stripe Customer Portal...",
                });
              }}
              className="px-3.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] text-xs font-semibold hover:bg-[var(--color-surface)] transition-colors cursor-pointer"
            >
              Manage Payment
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* AI Requests Usage */}
            <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
              <div className="flex justify-between items-center text-xs text-[var(--color-text-secondary)] mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Zap size={13} className="text-[var(--color-primary)]" />
                  AI Test Quota
                </span>
                <span className="text-[var(--color-text)] font-semibold font-mono">
                  64%
                </span>
              </div>
              <div className="h-1.5 w-full bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-primary)] rounded-full transition-all duration-300"
                  style={{ width: "64%" }}
                />
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] mt-1.5 text-right font-mono">
                642 / 1,000 requests used
              </div>
            </div>

            {/* Runner Minutes Usage */}
            <div className="p-4 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]">
              <div className="flex justify-between items-center text-xs text-[var(--color-text-secondary)] mb-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Zap size={13} className="text-[var(--color-info)]" />
                  Test Runner Minutes
                </span>
                <span className="text-[var(--color-text)] font-semibold font-mono">
                  34%
                </span>
              </div>
              <div className="h-1.5 w-full bg-[var(--color-surface-secondary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-info)] rounded-full transition-all duration-300"
                  style={{ width: "34%" }}
                />
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)] mt-1.5 text-right font-mono">
                68 / 200 minutes used
              </div>
            </div>
          </div>
        </div>

        {/* Plan Selection Cards */}
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">
            Available Plans
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p) => (
              <div
                key={p.id}
                className={`p-5 rounded-[var(--radius-lg)] flex flex-col justify-between transition-all ${
                  p.isCurrent
                    ? "bg-[var(--color-surface)] border-2 border-[var(--color-primary)]"
                    : "bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-border-subtle)]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-[var(--color-text)]">
                      {p.name}
                    </h4>
                    {p.badge && (
                      <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white">
                        {p.badge}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-2xl font-bold text-[var(--color-text)] font-mono">
                      {p.price}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      /{p.period}
                    </span>
                  </div>

                  <p className="text-xs text-[var(--color-text-secondary)] mb-4 leading-relaxed">
                    {p.desc}
                  </p>

                  <div className="flex flex-col gap-2 pt-3 border-t border-[var(--color-border)] mb-5">
                    {p.features.map((feat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-xs text-[var(--color-text)]"
                      >
                        <Check
                          size={13}
                          className="text-[var(--color-primary)] shrink-0"
                        />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectPlan(p.id)}
                  disabled={p.isCurrent}
                  className={`w-full py-2 px-3 rounded-[var(--radius-md)] text-xs font-semibold transition-colors ${
                    p.isCurrent
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] cursor-default border border-[var(--color-border)]"
                      : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white cursor-pointer shadow-xs"
                  }`}
                >
                  {p.isCurrent ? "Current Plan" : `Switch to ${p.name}`}
                </motion.button>
              </div>
            ))}
          </div>
        </div>

        {/* Invoices Card */}
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] p-6">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Billing History & Invoices
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
              Download PDF receipts for your accounting and tax records.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-3.5 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius-md)]"
              >
                <div>
                  <div className="text-xs font-semibold text-[var(--color-text)]">
                    {inv.plan}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] font-mono mt-0.5">
                    {inv.id} · {inv.date}
                  </div>
                </div>

                <div className="flex items-center gap-3.5">
                  <span className="text-xs font-semibold text-[var(--color-text)] font-mono">
                    {inv.amount}
                  </span>
                  <span className="text-[10px] text-[var(--color-success)] bg-[var(--color-success)]/10 border border-[var(--color-success)]/25 px-2 py-0.5 rounded-full font-medium">
                    {inv.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      showToast({
                        type: "info",
                        title: "Download Started",
                        message: `Downloading invoice ${inv.id}.pdf`,
                      });
                    }}
                    title="Download Invoice"
                    aria-label="Download Invoice"
                    className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                  >
                    <Download size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
