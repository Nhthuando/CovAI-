import { motion } from "framer-motion";

const FOOTER_COLS = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "Pricing", href: "#pricing" },
      { label: "Changelog", href: "#" },
      { label: "Roadmap", href: "#" },
      { label: "API Docs", href: "#" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#about" },
      { label: "Blog", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Contact", href: "#contact" },
      { label: "Press Kit", href: "#" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy Policy", href: "#" },
      { label: "Terms of Service", href: "#" },
      { label: "Cookie Policy", href: "#" },
      { label: "Security", href: "#" },
    ],
  },
];

const SOCIAL = [
  { id: "twitter", icon: "𝕏", label: "Twitter", href: "#" },
  { id: "github",  icon: "⌥", label: "GitHub",  href: "#" },
  { id: "discord", icon: "◉", label: "Discord", href: "#" },
  { id: "linkedin",icon: "in", label: "LinkedIn",href: "#" },
];

export default function Footer() {
  return (
    <footer
      id="footer"
      style={{
        background: "#080c11",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "4rem 1.5rem 2rem",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top gradient line */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "1px",
        background: "linear-gradient(90deg, transparent, rgba(124,58,237,0.4), transparent)",
      }} />

      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Main grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr",
          gap: "2.5rem",
          marginBottom: "3.5rem",
        }}>
          {/* Brand column */}
          <div>
            <a
              href="/"
              id="footer-logo"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                textDecoration: "none",
                marginBottom: "1rem",
              }}
            >
              <div style={{
                width: "30px",
                height: "30px",
                borderRadius: "7px",
                background: "linear-gradient(135deg, #7C3AED 0%, #22d3ee 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "12px",
                fontWeight: "700",
                color: "white",
              }}>T</div>
              <span style={{
                fontSize: "1rem",
                fontWeight: "700",
                color: "#f0f6fc",
              }}>
                TestCov<span style={{
                  background: "linear-gradient(90deg, #7C3AED, #22d3ee)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}>AI</span>
              </span>
            </a>
            <p style={{
              color: "#484f58",
              fontSize: "0.875rem",
              lineHeight: "1.75",
              maxWidth: "280px",
              marginBottom: "1.5rem",
            }}>
              AI-powered test coverage analysis and Jest test generation for
              modern JavaScript development teams.
            </p>
            {/* Social icons */}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              {SOCIAL.map((s) => (
                <motion.a
                  key={s.id}
                  href={s.href}
                  id={`footer-social-${s.id}`}
                  aria-label={s.label}
                  whileHover={{ scale: 1.1, color: "#f0f6fc" }}
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "8px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#484f58",
                    fontSize: "0.8rem",
                    fontWeight: "700",
                    textDecoration: "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  {s.icon}
                </motion.a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_COLS.map((col) => (
            <div key={col.heading}>
              <h4 style={{
                fontSize: "0.75rem",
                fontWeight: "700",
                letterSpacing: "0.1em",
                color: "#8b949e",
                textTransform: "uppercase",
                marginBottom: "1.25rem",
              }}>
                {col.heading}
              </h4>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      style={{
                        color: "#484f58",
                        textDecoration: "none",
                        fontSize: "0.875rem",
                        transition: "color 0.2s ease",
                      }}
                      onMouseEnter={(e) => (e.target.style.color = "#8b949e")}
                      onMouseLeave={(e) => (e.target.style.color = "#484f58")}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div style={{
          paddingTop: "2rem",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
        }}>
          <p style={{ color: "#30363d", fontSize: "0.8rem" }}>
            © {new Date().getFullYear()} TestCovAI. All rights reserved.
          </p>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            {["Privacy", "Terms", "Cookies"].map((item) => (
              <a
                key={item}
                href="#"
                style={{
                  color: "#30363d",
                  textDecoration: "none",
                  fontSize: "0.8rem",
                  transition: "color 0.2s ease",
                }}
                onMouseEnter={(e) => (e.target.style.color = "#484f58")}
                onMouseLeave={(e) => (e.target.style.color = "#30363d")}
              >
                {item}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
