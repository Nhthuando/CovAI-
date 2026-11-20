import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { NotificationCenter } from "./NotificationCenter";
import CovaiLogo from "./common/CovaiLogo";
import { ThemeSelector } from "./common/ThemeSelector";

const NAV_LINKS = [
  { label: "Sandbox", href: "#ide-preview" },
  { label: "Architecture", href: "#features" },
  { label: "3D Pyramid", href: "#bento-pyramid" },
  { label: "Pipeline", href: "#workflow" },
  { label: "Pricing", href: "#pricing" },
];

export default function Navbar() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-3 sm:px-6 pt-3.5 pointer-events-none">
      <nav
        aria-label="Primary navigation"
        className={`pointer-events-auto max-w-[1260px] mx-auto rounded-xl transition-all duration-200 px-4 sm:px-5 h-14 flex items-center justify-between lp-machined ${
          scrolled ? "shadow-lg" : ""
        }`}
      >
        {/* Brand Monograph */}
        <div className="flex items-center gap-3.5">
          <a
            href="/"
            id="nav-logo"
            className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-[var(--lp-signal)] rounded-md"
          >
            <CovaiLogo size={26} />
            <span className="lp-display font-bold text-base tracking-tight text-[var(--lp-ink)]">
              CovAI
            </span>
          </a>
        </div>

        {/* Center Navigation */}
        <div
          className="hidden md:flex items-center gap-1"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {NAV_LINKS.map((link, idx) => (
            <a
              key={link.label}
              href={link.href}
              id={`nav-${link.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              className="relative px-3.5 py-1.5 text-xs font-medium text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)] transition-colors rounded-lg"
            >
              {hoveredIdx === idx && (
                <span className="absolute inset-0 rounded-lg bg-[var(--lp-hover)] -z-10 transition-all duration-150" />
              )}
              {link.label}
            </a>
          ))}
        </div>

        {/* Right Actions */}
        <div className="hidden md:flex items-center gap-2.5">
          <ThemeSelector compact className="!rounded-lg" />
          {user ? (
            <div className="flex items-center gap-2.5">
              <NotificationCenter userId={user.id} />
              <Link
                to="/projects"
                id="nav-dashboard"
                className="lp-btn-primary px-3.5 py-1.5 rounded-lg text-xs"
              >
                Open workspace
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                id="nav-login"
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)] transition-colors"
              >
                Sign in
              </Link>
              <Link
                to="/register"
                id="nav-signup"
                className="lp-btn-primary px-3.5 py-1.5 rounded-lg text-xs"
              >
                Analyze repository
              </Link>
            </div>
          )}
        </div>

        {/* Mobile Toggle */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeSelector compact className="!rounded-lg" />
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="w-8 h-8 rounded-lg flex items-center justify-center border border-[var(--lp-line-strong)] bg-[var(--lp-surface-elevated)] text-[var(--lp-ink)] cursor-pointer"
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div className="pointer-events-auto md:hidden mt-2 mx-auto max-w-[1260px] rounded-xl lp-machined p-4 space-y-3">
          <div className="flex flex-col space-y-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 text-xs font-medium text-[var(--lp-ink-secondary)] hover:text-[var(--lp-ink)] hover:bg-[var(--lp-hover)] rounded-lg transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="pt-3 border-t border-[var(--lp-line)] flex flex-col gap-2">
            {user ? (
              <Link
                to="/projects"
                onClick={() => setMobileOpen(false)}
                className="lp-btn-primary w-full py-2 rounded-lg text-xs text-center"
              >
                Open workspace
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={() => setMobileOpen(false)}
                  className="lp-btn-secondary w-full py-2 rounded-lg text-xs text-center"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  onClick={() => setMobileOpen(false)}
                  className="lp-btn-primary w-full py-2 rounded-lg text-xs text-center"
                >
                  Analyze repository
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
