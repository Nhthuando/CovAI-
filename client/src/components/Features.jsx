import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const FEATURES = [
  {
    id: "ai-coverage",
    icon: "🧠",
    iconBg: "rgba(124,58,237,0.15)",
    iconColor: "#9d5cf5",
    title: "AI Coverage Analysis",
    desc: "Deep learning models analyze your test suite and pinpoint exactly which code paths remain untested, with confidence scoring.",
    tag: "Core",
    tagColor: "#7C3AED",
  },
  {
    id: "instant-mock",
    icon: "⚡",
    iconBg: "rgba(34,211,238,0.12)",
    iconColor: "#22d3ee",
    title: "Instant Mock Generation",
    desc: "Automatically generate Jest mocks for any module — APIs, databases, file systems — with a single command.",
    tag: "Automation",
    tagColor: "#22d3ee",
  },
  {
    id: "cfg-visual",
    icon: "🗺",
    iconBg: "rgba(251,191,36,0.12)",
    iconColor: "#fbbf24",
    title: "CFG Visualization",
    desc: "Interactive Control Flow Graph visualizer reveals unreachable branches and complex decision paths at a glance.",
    tag: "Visual",
    tagColor: "#fbbf24",
  },
  {
    id: "cyclomatic",
    icon: "📊",
    iconBg: "rgba(74,222,128,0.1)",
    iconColor: "#4ade80",
    title: "Cyclomatic Complexity",
    desc: "Measure and track code complexity over time. Get AI recommendations on refactoring high-complexity functions.",
    tag: "Metrics",
    tagColor: "#4ade80",
  },
  {
    id: "test-skeleton",
    icon: "🧪",
    iconBg: "rgba(249,115,22,0.12)",
    iconColor: "#fb923c",
    title: "Jest Test Skeleton",
    desc: "Generate runnable test skeletons for any function. From bare stubs to fully-mocked integration tests in seconds.",
    tag: "Generate",
    tagColor: "#fb923c",
  },
  {
    id: "github-import",
    icon: "🔗",
    iconBg: "rgba(139,92,246,0.1)",
    iconColor: "#a78bfa",
    title: "GitHub Integration",
    desc: "Import repositories directly from GitHub. Track coverage drift across branches, PRs, and commits in real-time.",
    tag: "Integration",
    tagColor: "#a78bfa",
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" } },
};

export default function Features() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="features"
      ref={ref}
      style={{
        padding: "7rem 1.5rem",
        background: "var(--surface-container)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative top gradient */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "1px",
        background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.5), rgba(34,211,238,0.3), transparent)",
      }} />

      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
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
            color: "#22d3ee",
            textTransform: "uppercase",
          }}>
            CAPABILITIES
          </span>
          <h2 style={{
            marginTop: "1.25rem",
            fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
            fontWeight: "700",
            color: "#f0f6fc",
            letterSpacing: "-0.025em",
            lineHeight: "1.15",
          }}>
            Unmatched capabilities for{" "}
            <span className="text-gradient-violet">every team</span>
          </h2>
          <p style={{
            marginTop: "1rem",
            color: "#8b949e",
            fontSize: "1.05rem",
            maxWidth: "560px",
            margin: "1rem auto 0",
            lineHeight: "1.65",
          }}>
            Everything you need to ship confidently — from first commit to
            production deployment.
          </p>
        </motion.div>

        {/* Feature Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "1.25rem",
          }}
        >
          {FEATURES.map((feature) => (
            <motion.div
              key={feature.id}
              id={`feature-${feature.id}`}
              variants={cardVariants}
              className="border-beam"
              style={{
                background: "var(--surface-main)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "16px",
                padding: "1.75rem",
                cursor: "default",
                zIndex: 0,
              }}
            >
              {/* Icon + Tag */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem" }}>
                <div style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  background: feature.iconBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.5rem",
                  border: `1px solid ${feature.iconColor}22`,
                }}>
                  {feature.icon}
                </div>
                <span style={{
                  fontSize: "0.65rem",
                  fontWeight: "700",
                  letterSpacing: "0.1em",
                  padding: "3px 10px",
                  borderRadius: "20px",
                  background: `${feature.tagColor}18`,
                  color: feature.tagColor,
                  border: `1px solid ${feature.tagColor}30`,
                }}>
                  {feature.tag}
                </span>
              </div>

              {/* Text */}
              <h3 style={{
                fontSize: "1.05rem",
                fontWeight: "700",
                color: "#f0f6fc",
                marginBottom: "0.6rem",
                letterSpacing: "-0.01em",
              }}>
                {feature.title}
              </h3>
              <p style={{
                color: "#8b949e",
                fontSize: "0.88rem",
                lineHeight: "1.7",
              }}>
                {feature.desc}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
