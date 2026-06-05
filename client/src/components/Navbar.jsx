import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "Features", href: "#features" },
    { label: "How It Works", href: "#workflow" },
    { label: "Pricing", href: "#pricing" },
    { label: "About", href: "#about" },
  ];

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: "0 1.5rem",
        transition: "all 0.4s ease",
        background: scrolled
          ? "rgba(13, 17, 23, 0.85)"
          : "rgba(13, 17, 23, 0.2)",
        backdropFilter: scrolled ? "blur(16px)" : "blur(4px)",
        WebkitBackdropFilter: scrolled ? "blur(16px)" : "blur(4px)",
        borderBottom: scrolled
          ? "1px solid rgba(255,255,255,0.06)"
          : "1px solid transparent",
      }}
    >
      <div
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "64px",
        }}
      >
        {/* Logo */}
        <a
          href="/"
          id="nav-logo"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background:
                "linear-gradient(135deg, #7C3AED 0%, #22d3ee 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              fontWeight: "700",
              color: "white",
              boxShadow: "0 0 16px rgba(124,58,237,0.5)",
            }}
          >
            T
          </div>
          <span
            style={{
              fontSize: "1.1rem",
              fontWeight: "700",
              color: "#f0f6fc",
              letterSpacing: "-0.02em",
            }}
          >
            TestCov
            <span
              style={{
                background:
                  "linear-gradient(90deg, #7C3AED, #22d3ee)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              AI
            </span>
          </span>
        </a>

        {/* Desktop Nav Links */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "2rem",
          }}
          className="hidden md:flex"
        >
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              id={`nav-${link.label.toLowerCase().replace(/\s/g, "-")}`}
              style={{
                color: "#8b949e",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: "500",
                transition: "color 0.2s ease",
              }}
              onMouseEnter={(e) => (e.target.style.color = "#f0f6fc")}
              onMouseLeave={(e) => (e.target.style.color = "#8b949e")}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Auth Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link
            to="/login"
            id="nav-login"
            style={{
              color: "#8b949e",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: "500",
              padding: "0.375rem 0.75rem",
              transition: "color 0.2s ease",
            }}
            onMouseEnter={(e) => (e.target.style.color = "#f0f6fc")}
            onMouseLeave={(e) => (e.target.style.color = "#8b949e")}
          >
            Log in
          </Link>
          <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/register"
              id="nav-signup"
              style={{
                background:
                  "linear-gradient(135deg, #7C3AED 0%, #9d5cf5 100%)",
                color: "white",
                textDecoration: "none",
                fontSize: "0.875rem",
                fontWeight: "600",
                padding: "0.5rem 1.25rem",
                borderRadius: "8px",
                boxShadow: "0 0 16px rgba(124,58,237,0.35)",
                display: "inline-block",
              }}
            >
              Sign up free
            </Link>
          </motion.div>
        </div>
      </div>
    </motion.nav>
  );
}
