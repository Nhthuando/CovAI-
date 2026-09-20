import { useState } from "react";
import { motion } from "framer-motion";
import {
  CreditCard,
  Zap,
  Check,
  Sparkles,
  ArrowUpRight,
  Download,
  ShieldCheck,
  Clock,
  ChevronRight,
} from "lucide-react";
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
    <div
      style={{
        maxWidth: "920px",
        padding: "32px 28px 64px",
        fontFamily: "var(--font-sans)",
        color: "#e6edf3",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <h1
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: "#e6edf3",
            marginBottom: "6px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <CreditCard size={22} style={{ color: "#a78bfa" }} />
          Billing & Plans
        </h1>
        <p style={{ color: "#8b949e", fontSize: "13px", margin: 0 }}>
          Manage your subscription tier, AI quota consumption, and invoices.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        {/* Current Plan & Quota Card */}
        <div
          style={{
            background:
              "linear-gradient(180deg, rgba(124, 58, 237, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)",
            border: "1px solid rgba(124, 58, 237, 0.3)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: "16px",
              marginBottom: "24px",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "4px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: "rgba(124, 58, 237, 0.2)",
                    color: "#c4b5fd",
                    border: "1px solid rgba(124, 58, 237, 0.4)",
                  }}
                >
                  Active Subscription
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#4ade80",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#4ade80",
                    }}
                  />
                  Auto-renews Oct 20, 2026
                </span>
              </div>
              <h2
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "#e6edf3",
                  margin: 0,
                }}
              >
                Pro Developer Tier
              </h2>
              <p
                style={{
                  color: "#8b949e",
                  fontSize: "13px",
                  margin: "4px 0 0",
                }}
              >
                $19.00 billed monthly to Visa ending in 4242.
              </p>
            </div>

            <button
              onClick={() => {
                showToast({
                  type: "info",
                  title: "Billing Portal",
                  message: "Stripe customer billing portal opened.",
                });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "8px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                color: "#e6edf3",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Manage in Stripe
              <ArrowUpRight size={14} />
            </button>
          </div>

          {/* Usage Meters */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
              paddingTop: "20px",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Meter 1: AI Requests */}
            <div
              style={{
                background: "rgba(0, 0, 0, 0.25)",
                padding: "16px",
                borderRadius: "10px",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  color: "#8b949e",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <Sparkles size={13} style={{ color: "#a78bfa" }} />
                  AI Test Generation
                </span>
                <span style={{ color: "#e6edf3", fontWeight: 600 }}>42%</span>
              </div>
              <div
                style={{
                  height: "6px",
                  background: "rgba(255, 255, 255, 0.08)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "42%",
                    height: "100%",
                    background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#6e7681",
                  marginTop: "6px",
                  textAlign: "right",
                }}
              >
                420 / 1,000 requests used
              </div>
            </div>

            {/* Meter 2: Runner minutes */}
            <div
              style={{
                background: "rgba(0, 0, 0, 0.25)",
                padding: "16px",
                borderRadius: "10px",
                border: "1px solid rgba(255, 255, 255, 0.05)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  color: "#8b949e",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <Zap size={13} style={{ color: "#22d3ee" }} />
                  Test Runner Minutes
                </span>
                <span style={{ color: "#e6edf3", fontWeight: 600 }}>34%</span>
              </div>
              <div
                style={{
                  height: "6px",
                  background: "rgba(255, 255, 255, 0.08)",
                  borderRadius: "3px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "34%",
                    height: "100%",
                    background: "linear-gradient(90deg, #0284c7, #22d3ee)",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: "11px",
                  color: "#6e7681",
                  marginTop: "6px",
                  textAlign: "right",
                }}
              >
                68 / 200 minutes used
              </div>
            </div>
          </div>
        </div>

        {/* Plan Selection Cards */}
        <div>
          <h3
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "#e6edf3",
              marginBottom: "14px",
            }}
          >
            Available Plans
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "16px",
            }}
          >
            {plans.map((p) => (
              <div
                key={p.id}
                style={{
                  background: p.isCurrent
                    ? "rgba(124, 58, 237, 0.06)"
                    : "rgba(255, 255, 255, 0.02)",
                  border: p.isCurrent
                    ? "1.5px solid rgba(124, 58, 237, 0.5)"
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "12px",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  position: "relative",
                }}
              >
                {p.badge && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-10px",
                      right: "16px",
                      fontSize: "10px",
                      fontWeight: 700,
                      background: "#7c3aed",
                      color: "#fff",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {p.badge}
                  </span>
                )}

                <div>
                  <h4
                    style={{
                      fontSize: "15px",
                      fontWeight: 600,
                      color: "#e6edf3",
                      margin: 0,
                    }}
                  >
                    {p.name}
                  </h4>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "4px",
                      marginTop: "8px",
                      marginBottom: "6px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "24px",
                        fontWeight: 700,
                        color: "#fff",
                      }}
                    >
                      {p.price}
                    </span>
                    <span style={{ fontSize: "12px", color: "#8b949e" }}>
                      /{p.period}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#8b949e",
                      lineHeight: 1.5,
                      marginBottom: "16px",
                    }}
                  >
                    {p.desc}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      marginBottom: "20px",
                    }}
                  >
                    {p.features.map((feat, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          fontSize: "12px",
                          color: "#c9d1d9",
                        }}
                      >
                        <Check
                          size={13}
                          style={{ color: "#a78bfa", flexShrink: 0 }}
                        />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleSelectPlan(p.id)}
                  disabled={p.isCurrent}
                  style={{
                    width: "100%",
                    padding: "9px",
                    borderRadius: "8px",
                    background: p.isCurrent
                      ? "rgba(255, 255, 255, 0.05)"
                      : "linear-gradient(135deg, #7c3aed, #6366f1)",
                    border: p.isCurrent
                      ? "1px solid rgba(255, 255, 255, 0.1)"
                      : "none",
                    color: p.isCurrent ? "#8b949e" : "#fff",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: p.isCurrent ? "default" : "pointer",
                  }}
                >
                  {p.isCurrent ? "Current Plan" : `Switch to ${p.name}`}
                </motion.button>
              </div>
            ))}
          </div>
        </div>

        {/* Invoices Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.025)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "14px",
            padding: "24px",
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <h3
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: "#e6edf3",
                margin: 0,
              }}
            >
              Billing History & Invoices
            </h3>
            <p
              style={{ fontSize: "12px", color: "#8b949e", margin: "2px 0 0" }}
            >
              Download PDF receipts for your accounting and tax records.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {invoices.map((inv) => (
              <div
                key={inv.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  background: "rgba(0, 0, 0, 0.2)",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: "8px",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "#e6edf3",
                    }}
                  >
                    {inv.plan}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#6e7681",
                      marginTop: "2px",
                    }}
                  >
                    {inv.id} · {inv.date}
                  </div>
                </div>

                <div
                  style={{ display: "flex", alignItems: "center", gap: "16px" }}
                >
                  <span
                    style={{ fontSize: "13px", fontWeight: 600, color: "#fff" }}
                  >
                    {inv.amount}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#4ade80",
                      background: "rgba(34, 197, 94, 0.12)",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      border: "1px solid rgba(34, 197, 94, 0.25)",
                    }}
                  >
                    {inv.status}
                  </span>
                  <button
                    onClick={() => {
                      showToast({
                        type: "info",
                        title: "Download Started",
                        message: `Downloading invoice ${inv.id}.pdf`,
                      });
                    }}
                    title="Download Invoice"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#8b949e",
                      cursor: "pointer",
                      padding: 4,
                    }}
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
