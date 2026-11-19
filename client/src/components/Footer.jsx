import { useState } from "react";
import { Link } from "react-router-dom";

const FOOTER_COLS = [
  {
    heading: "Platform",
    links: [
      { label: "Branch synthesis sandbox", href: "#ide-preview" },
      { label: "3D test architecture", href: "#bento-pyramid" },
      { label: "Core subsystems", href: "#features" },
      { label: "Verification pipeline", href: "#workflow" },
      { label: "Pricing & estimator", href: "#pricing" },
    ],
  },
  {
    heading: "Subsystems",
    links: [
      { label: "Babel AST & CFG solver", href: "#feature-cfg-analysis" },
      { label: "Vitest & Jest synthesis", href: "#feature-test-synthesis" },
      { label: "Mutation fault guard", href: "#feature-coverage-metrics" },
      { label: "Docker container runner", href: "#feature-sandbox-execution" },
      {
        label: "Technical specifications",
        href: "https://github.com/Nhthuando/CovAI-/tree/develop/docs/specs",
      },
    ],
  },
  {
    heading: "Governance",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
      { label: "Data telemetry", href: "/telemetry" },
      { label: "Container isolation", href: "#feature-sandbox-execution" },
    ],
  },
];

export default function Footer() {
  const [magOffset, setMagOffset] = useState({ x: 0, y: 0 });

  const handleMagneticMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    setMagOffset({
      x: (e.clientX - centerX) * 0.16,
      y: (e.clientY - centerY) * 0.2,
    });
  };

  const resetMagnetic = () => setMagOffset({ x: 0, y: 0 });

  return (
    <footer
      id="footer"
      className="relative bg-[#050608] pt-20 pb-12 overflow-hidden text-slate-400"
    >
      <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6">
        {/* Architectural Finale CTA Box */}
        <div className="relative rounded-2xl lp-machined p-8 sm:p-14 mb-20 overflow-hidden">
          <div
            className="pointer-events-none absolute -top-32 right-0 w-[520px] h-[320px] rounded-full blur-[120px] opacity-20"
            style={{
              background: "radial-gradient(circle, #38bdf8 0%, transparent 70%)",
            }}
          />

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="max-w-xl space-y-3">
              <h2 className="lp-display text-3xl sm:text-4xl font-bold text-white tracking-tight leading-[1.12]">
                Inspect your repository&apos;s Control Flow Graph today.
              </h2>
              <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
                Import a repository from GitHub or upload an archive to locate
                untested branch predicates and run container-verified test
                synthesis.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div
                onMouseMove={handleMagneticMove}
                onMouseLeave={resetMagnetic}
                className="inline-block"
              >
                <Link
                  to="/register"
                  style={{
                    transform: `translate3d(${magOffset.x}px, ${magOffset.y}px, 0)`,
                  }}
                  className="lp-btn-primary px-6 py-3.5 rounded-lg text-sm inline-block transition-transform duration-150"
                >
                  Create workspace
                </Link>
              </div>

              <Link
                to="/login"
                className="lp-btn-secondary px-5 py-3.5 rounded-lg text-sm inline-block"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>

        {/* Footer Columns */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10 pb-14 border-b border-[#161a24]">
          <div className="md:col-span-2 space-y-4">
            <a
              href="/"
              id="footer-logo"
              className="inline-flex items-center gap-2.5"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="1.5"
                  y="1.5"
                  width="21"
                  height="21"
                  rx="5"
                  stroke="#F1F5F9"
                  strokeWidth="1.5"
                />
                <path
                  d="M7.5 12L10.5 9M7.5 12L10.5 15M7.5 12H16.5"
                  stroke="#38BDF8"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="lp-display font-bold text-base text-white">
                CovAI
              </span>
            </a>

            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-sm">
              Static Control Flow Graph analysis, multi-tier test generation,
              and isolated Docker runner verification for software engineering
              teams.
            </p>

            <div className="inline-flex items-center gap-2 text-xs lp-mono text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8]" />
              <span>AST workers &amp; Docker runners operational</span>
            </div>
          </div>

          {FOOTER_COLS.map((col) => (
            <div key={col.heading} className="space-y-3">
              <h4 className="text-xs font-semibold text-white">
                {col.heading}
              </h4>
              <ul className="space-y-2.5 list-none p-0 m-0 text-xs">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("/") ? (
                      <Link
                        to={link.href}
                        className="text-slate-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    ) : link.href.startsWith("http") ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        className="text-slate-400 hover:text-white transition-colors"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>© {new Date().getFullYear()} CovAI. All rights reserved.</div>
          <div className="flex items-center gap-5">
            <Link to="/privacy" className="hover:text-slate-300 transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-slate-300 transition-colors">
              Terms
            </Link>
            <Link to="/telemetry" className="hover:text-slate-300 transition-colors">
              Telemetry
            </Link>
          </div>
        </div>

        {/* Architectural Watermark */}
        <div
          aria-hidden="true"
          className="mt-8 select-none pointer-events-none text-center overflow-hidden"
        >
          <div
            className="lp-display font-bold tracking-tighter leading-none text-[18vw] sm:text-[15vw]"
            style={{
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.005) 90%, transparent 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            COVAI
          </div>
        </div>
      </div>
    </footer>
  );
}
