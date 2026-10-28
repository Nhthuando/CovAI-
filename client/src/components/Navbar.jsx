import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Terminal, Menu, X, ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { NotificationCenter } from "./NotificationCenter";
import { ThemeSelector } from "./common/ThemeSelector";
import Button from "./common/Button";

export default function Navbar() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 12);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "Features", href: "#features" },
    { label: "IDE & Coverage", href: "#ide-preview" },
    { label: "Pipeline", href: "#workflow" },
    { label: "Pricing", href: "#pricing" },
  ];

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-200 border-b ${
        scrolled
          ? "bg-[var(--color-bg)]/95 border-[var(--color-border)] backdrop-blur-sm"
          : "bg-[var(--color-bg)]/80 border-transparent"
      }`}
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <a
          href="/"
          id="nav-logo"
          className="flex items-center gap-2.5 text-decoration-none group focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] rounded-[var(--radius-sm)]"
        >
          <div className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm select-none shrink-0">
            <Terminal className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-base tracking-tight text-[var(--color-text)]">
              CovAI
            </span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
              v2.4
            </span>
          </div>
        </a>

        {/* Desktop Nav Links */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              id={`nav-${link.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
              className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] rounded-[var(--radius-sm)] py-1"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Desktop Right Utilities (Theme Selector & Auth) */}
        <div className="hidden md:flex items-center gap-3">
          <ThemeSelector compact />

          {user ? (
            <div className="flex items-center gap-2">
              <NotificationCenter userId={user.id} />
              <Button
                as={Link}
                to="/projects"
                variant="secondary"
                size="sm"
                id="nav-dashboard"
              >
                Projects
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                as={Link}
                to="/login"
                variant="ghost"
                size="sm"
                id="nav-login"
              >
                Log in
              </Button>
              <Button
                as={Link}
                to="/register"
                variant="primary"
                size="sm"
                id="nav-signup"
                icon={ArrowRight}
                iconPosition="right"
              >
                Get Started
              </Button>
            </div>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeSelector compact />
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="w-9 h-9 rounded-[var(--radius-md)] flex items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] cursor-pointer"
          >
            {mobileOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 space-y-3">
          <div className="flex flex-col space-y-2">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="pt-3 border-t border-[var(--color-border)] flex flex-col gap-2">
            {user ? (
              <Button
                as={Link}
                to="/projects"
                variant="primary"
                size="md"
                className="w-full"
                onClick={() => setMobileOpen(false)}
              >
                Go to Projects
              </Button>
            ) : (
              <>
                <Button
                  as={Link}
                  to="/login"
                  variant="secondary"
                  size="md"
                  className="w-full"
                  onClick={() => setMobileOpen(false)}
                >
                  Log in
                </Button>
                <Button
                  as={Link}
                  to="/register"
                  variant="primary"
                  size="md"
                  className="w-full"
                  onClick={() => setMobileOpen(false)}
                >
                  Get Started Free
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
