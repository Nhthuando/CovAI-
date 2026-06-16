import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Hls from "hls.js";

const HLS_URL =
  "https://stream.mux.com/kimF2ha9zLrX64H00UgLGPflCzNtl1T0215MlAmeOztv8.m3u8";

// Typewriter hook
function useTypewriter(words, speed = 80, pause = 2000) {
  const [displayed, setDisplayed] = useState("");
  const [wordIdx, setWordIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = words[wordIdx % words.length];
    let timeout;
    if (!deleting && charIdx < word.length) {
      timeout = setTimeout(() => setCharIdx((c) => c + 1), speed);
    } else if (!deleting && charIdx === word.length) {
      timeout = setTimeout(() => setDeleting(true), pause);
    } else if (deleting && charIdx > 0) {
      timeout = setTimeout(() => setCharIdx((c) => c - 1), speed / 2);
    } else {
      setDeleting(false);
      setWordIdx((i) => (i + 1) % words.length);
    }
    setDisplayed(word.slice(0, charIdx));
    return () => clearTimeout(timeout);
  }, [charIdx, deleting, wordIdx, words, speed, pause]);

  return displayed;
}

export default function Hero() {
  const videoRef = useRef(null);
  const [videoError, setVideoError] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const typewriterText = useTypewriter(
    ["your email", "team@company.com", "dev@startup.io"],
    80,
    2000
  );

  // HLS Video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true });
      hls.loadSource(HLS_URL);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, () => setVideoError(true));
      return () => hls.destroy();
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = HLS_URL;
    } else {
      setVideoError(true);
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (email) setSubmitted(true);
  };

  return (
    <section
      id="hero"
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        minHeight: "600px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Background Video or Fallback */}
      {!videoError ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.35,
            filter: "saturate(0.6) brightness(0.5)",
          }}
        />
      ) : (
        /* Animated Gradient Fallback */
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124,58,237,0.3) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(34,211,238,0.12) 0%, transparent 60%), #0D1117",
          }}
        />
      )}

      {/* Grid Pattern Overlay */}
      <div
        className="bg-grid"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />

      {/* Dark Gradient Overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(to bottom, rgba(13,17,23,0.3) 0%, rgba(13,17,23,0.1) 50%, rgba(13,17,23,0.9) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 10,
          textAlign: "center",
          padding: "0 1.5rem",
          maxWidth: "860px",
          width: "100%",
        }}
      >
        {/* Tagline pill */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}
        >

        </motion.div>

        {/* Main Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35 }}
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(2.8rem, 7vw, 5.2rem)",
            lineHeight: "1.08",
            color: "#f0f6fc",
            marginBottom: "1.5rem",
            fontWeight: "400",
          }}
        >
          A NEW WAY TO{" "}
          <em style={{ fontStyle: "italic" }}>THINK AND CREATE</em>
          <br />
          <span className="text-gradient-violet">TEST COVERAGE</span> WITH AI
        </motion.h1>

        {/* Subtext */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          style={{
            color: "#8b949e",
            fontSize: "clamp(1rem, 2.5vw, 1.15rem)",
            lineHeight: "1.7",
            maxWidth: "580px",
            margin: "0 auto 2.5rem",
          }}
        >
          Upload your JavaScript project, let AI analyze coverage, generate
          Jest tests, and visualize control flow — all in one cinematic
          interface.
        </motion.p>

        {/* CTA / Email Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.65 }}
          style={{ display: "flex", justifyContent: "center" }}
        >
          <AnimatePresence mode="wait">
            {!showEmailForm && !submitted && (
              <motion.button
                key="cta-button"
                id="hero-cta-btn"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                whileHover={{ scale: 1.05, boxShadow: "0 0 40px rgba(124,58,237,0.5)" }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowEmailForm(true)}
                style={{
                  background:
                    "linear-gradient(135deg, #7C3AED 0%, #9d5cf5 60%, #22d3ee 100%)",
                  color: "white",
                  border: "none",
                  padding: "0.875rem 2.5rem",
                  borderRadius: "12px",
                  fontSize: "1rem",
                  fontWeight: "600",
                  cursor: "pointer",
                  boxShadow: "0 0 24px rgba(124,58,237,0.4), 0 8px 32px rgba(0,0,0,0.3)",
                  fontFamily: "var(--font-sans)",
                  letterSpacing: "0.01em",
                }}
              >
                Get early access →
              </motion.button>
            )}

            {showEmailForm && !submitted && (
              <motion.form
                key="email-form"
                id="hero-email-form"
                initial={{ opacity: 0, x: 40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -40 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                onSubmit={handleSubmit}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                <div
                  className="liquid-glass"
                  style={{
                    borderRadius: "10px",
                    overflow: "hidden",
                  }}
                >
                  <input
                    id="hero-email-input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={`Enter ${typewriterText}|`}
                    required
                    style={{
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      padding: "0.875rem 1.25rem",
                      color: "#f0f6fc",
                      fontSize: "0.95rem",
                      fontFamily: "var(--font-sans)",
                      width: "260px",
                    }}
                  />
                </div>
                <motion.button
                  id="hero-submit-btn"
                  type="submit"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  style={{
                    background:
                      "linear-gradient(135deg, #7C3AED 0%, #9d5cf5 100%)",
                    color: "white",
                    border: "none",
                    padding: "0.875rem 1.5rem",
                    borderRadius: "10px",
                    fontSize: "0.95rem",
                    fontWeight: "600",
                    cursor: "pointer",
                    fontFamily: "var(--font-sans)",
                    boxShadow: "0 0 20px rgba(124,58,237,0.4)",
                  }}
                >
                  Notify me
                </motion.button>
              </motion.form>
            )}

            {submitted && (
              <motion.div
                key="submitted"
                id="hero-success-msg"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.875rem 2rem",
                  borderRadius: "12px",
                  background: "rgba(34,211,238,0.08)",
                  border: "1px solid rgba(34,211,238,0.3)",
                  color: "#22d3ee",
                  fontSize: "1rem",
                  fontWeight: "500",
                }}
              >
                <span style={{ fontSize: "1.25rem" }}>✓</span>
                You&apos;re on the list! We&apos;ll reach out soon.
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Social proof */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.9 }}
          style={{
            marginTop: "2.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            color: "#484f58",
            fontSize: "0.8rem",
          }}
        >
          <div style={{ display: "flex", gap: "-4px" }}>
            {["👨‍💻", "👩‍💻", "🧑‍💻"].map((emoji, i) => (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: "#161b22",
                  border: "2px solid #0D1117",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.875rem",
                  marginLeft: i === 0 ? 0 : "-8px",
                }}
              >
                {emoji}
              </span>
            ))}
          </div>
          <span>Join 200+ developers already on the waitlist</span>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        style={{
          position: "absolute",
          bottom: "2rem",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
          color: "#484f58",
          fontSize: "0.7rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ fontSize: "1.2rem" }}
        >
          ↓
        </motion.div>
        scroll
      </motion.div>
    </section>
  );
}
