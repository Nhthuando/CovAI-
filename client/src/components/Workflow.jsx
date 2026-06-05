import { useRef } from "react";
import { motion, useInView } from "framer-motion";

const STEPS = [
  {
    num: "01",
    icon: "📁",
    title: "Upload Code",
    desc: "Zip your JavaScript project or connect directly via GitHub URL. We support monorepos and complex project structures.",
    color: "#7C3AED",
    glowColor: "rgba(124,58,237,0.25)",
  },
  {
    num: "02",
    icon: "🔬",
    title: "AI Analysis",
    desc: "Our AI engine builds the Control Flow Graph, calculates Cyclomatic Complexity, and identifies uncovered branches.",
    color: "#22d3ee",
    glowColor: "rgba(34,211,238,0.2)",
  },
  {
    num: "03",
    icon: "🧪",
    title: "Generate Tests",
    desc: "Receive auto-generated Jest test skeletons tailored to your uncovered paths. Ready to run, no configuration needed.",
    color: "#fb923c",
    glowColor: "rgba(251,146,60,0.2)",
  },
  {
    num: "04",
    icon: "🚀",
    title: "Improve Quality",
    desc: "Track coverage improvements over time, compare snapshots, and watch your quality score climb toward 100%.",
    color: "#4ade80",
    glowColor: "rgba(74,222,128,0.2)",
  },
];

export default function Workflow() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      id="workflow"
      ref={ref}
      style={{
        padding: "7rem 1.5rem",
        background: "var(--surface-main)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background radial */}
      <div style={{
        position: "absolute",
        bottom: "-200px",
        right: "-200px",
        width: "600px",
        height: "600px",
        borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(34,211,238,0.04) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          style={{ textAlign: "center", marginBottom: "5rem" }}
        >
          <span className="glass-pill" style={{
            padding: "0.375rem 1rem",
            fontSize: "0.7rem",
            fontWeight: "700",
            letterSpacing: "0.14em",
            color: "#fb923c",
            textTransform: "uppercase",
          }}>
            HOW IT WORKS
          </span>
          <h2 style={{
            marginTop: "1.25rem",
            fontSize: "clamp(1.8rem, 4vw, 2.8rem)",
            fontWeight: "700",
            color: "#f0f6fc",
            letterSpacing: "-0.025em",
          }}>
            From upload to{" "}
            <span className="text-gradient-violet">100% coverage</span>
            <br />
            in four steps
          </h2>
        </motion.div>

        {/* Steps */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "0",
          position: "relative",
        }}>
          {/* Connector line (desktop) */}
          <div style={{
            position: "absolute",
            top: "52px",
            left: "12.5%",
            right: "12.5%",
            height: "1px",
            background: "linear-gradient(90deg, rgba(124,58,237,0.4), rgba(34,211,238,0.3), rgba(251,146,60,0.3), rgba(74,222,128,0.4))",
            zIndex: 0,
            display: "none",
          }} className="step-connector" />

          {STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              id={`workflow-step-${i + 1}`}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.15, ease: "easeOut" }}
              style={{
                position: "relative",
                padding: "0 1.5rem",
                textAlign: "center",
                zIndex: 1,
              }}
            >
              {/* Connector dot + line */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.75rem", position: "relative" }}>
                {/* Left dash line */}
                {i > 0 && (
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={isInView ? { scaleX: 1 } : {}}
                    transition={{ duration: 0.6, delay: i * 0.15 + 0.3 }}
                    style={{
                      position: "absolute",
                      right: "50%",
                      top: "50%",
                      width: "50%",
                      height: "1px",
                      background: `linear-gradient(90deg, transparent, ${step.color}50)`,
                      transformOrigin: "left",
                    }}
                  />
                )}
                {/* Right dash line */}
                {i < STEPS.length - 1 && (
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={isInView ? { scaleX: 1 } : {}}
                    transition={{ duration: 0.6, delay: i * 0.15 + 0.3 }}
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      width: "50%",
                      height: "1px",
                      background: `linear-gradient(90deg, ${step.color}50, transparent)`,
                      transformOrigin: "right",
                    }}
                  />
                )}

                {/* Step icon circle */}
                <motion.div
                  whileHover={{ scale: 1.1, boxShadow: `0 0 30px ${step.glowColor}` }}
                  style={{
                    width: "72px",
                    height: "72px",
                    borderRadius: "50%",
                    background: `radial-gradient(circle, ${step.color}20, ${step.color}08)`,
                    border: `2px solid ${step.color}50`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.75rem",
                    boxShadow: `0 0 20px ${step.glowColor}`,
                    cursor: "default",
                    position: "relative",
                    zIndex: 2,
                    background: "var(--surface-main)",
                    transition: "box-shadow 0.3s ease",
                  }}
                >
                  {step.icon}
                </motion.div>
              </div>

              {/* Step number */}
              <div style={{
                fontSize: "0.65rem",
                fontWeight: "700",
                letterSpacing: "0.15em",
                color: step.color,
                marginBottom: "0.5rem",
              }}>
                STEP {step.num}
              </div>

              {/* Title */}
              <h3 style={{
                fontSize: "1.1rem",
                fontWeight: "700",
                color: "#f0f6fc",
                marginBottom: "0.75rem",
                letterSpacing: "-0.01em",
              }}>
                {step.title}
              </h3>

              {/* Desc */}
              <p style={{
                color: "#8b949e",
                fontSize: "0.875rem",
                lineHeight: "1.7",
              }}>
                {step.desc}
              </p>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.8 }}
          style={{ textAlign: "center", marginTop: "4rem" }}
        >
          <motion.a
            href="#pricing"
            id="workflow-cta"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.875rem 2rem",
              borderRadius: "10px",
              background: "rgba(124,58,237,0.1)",
              border: "1px solid rgba(124,58,237,0.3)",
              color: "#9d5cf5",
              textDecoration: "none",
              fontSize: "0.95rem",
              fontWeight: "600",
              transition: "all 0.2s ease",
            }}
          >
            See pricing plans →
          </motion.a>
        </motion.div>
      </div>
    </section>
  );
}
