import { useState, Suspense, lazy } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Copy,
  Check,
  GitBranch,
  FolderGit2,
  ScanLine,
  ArrowUpRight,
  Terminal,
  Cpu,
  ShieldCheck,
} from "lucide-react";
import TechMarquee from "./landing/TechMarquee";

const CfgWebGLCore = lazy(() => import("./landing/CfgWebGLCore"));

const PRESET_REPOS = [
  {
    repo: "acme/payment-kernel",
    before: "58.3%",
    after: "98.4%",
    branchesFixed: 5,
    duration: "1.42s",
  },
  {
    repo: "stripe-labs/webhook-router",
    before: "61.0%",
    after: "97.8%",
    branchesFixed: 8,
    duration: "1.68s",
  },
  {
    repo: "nexus/session-authority",
    before: "49.5%",
    after: "96.9%",
    branchesFixed: 11,
    duration: "1.94s",
  },
];

export default function Hero() {
  const [repoInput, setRepoInput] = useState(PRESET_REPOS[0].repo);
  const [scanPulse, setScanPulse] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(PRESET_REPOS[0]);
  const [copied, setCopied] = useState(false);

  const cliCommand = "npx covai-cli analyze --tier=all";

  const handleCopy = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSimulateScan = (e) => {
    if (e) e.preventDefault();
    setIsScanning(true);
    setScanPulse((p) => p + 1);

    const matched =
      PRESET_REPOS.find((r) =>
        repoInput.toLowerCase().includes(r.repo.split("/")[1])
      ) || {
        repo: repoInput || "org/repository",
        before: "54.2%",
        after: "97.6%",
        branchesFixed: 7,
        duration: "1.51s",
      };

    setTimeout(() => {
      setIsScanning(false);
      setScanResult(matched);
    }, 550);
  };

  return (
    <>
      <section
        id="hero"
        className="relative pt-28 pb-16 md:pt-36 md:pb-24 overflow-hidden"
      >
        {/* Subtle Architectural Grid */}
        <div className="absolute inset-0 lp-draft-grid lp-radial-fade pointer-events-none" />
        <div
          className="absolute -top-48 left-1/2 -translate-x-1/2 w-[920px] h-[460px] rounded-full pointer-events-none blur-[150px] opacity-20"
          style={{
            background:
              "radial-gradient(circle, var(--lp-signal) 0%, transparent 70%)",
          }}
        />

        <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-9 items-center">
            {/* Left Column */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="lg:col-span-7 text-left space-y-6"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--lp-surface)] border border-[var(--lp-line)] text-xs lp-mono text-[var(--lp-ink-secondary)]">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--lp-signal)] opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--lp-signal)]" />
                </span>
                <GitBranch className="w-3.5 h-3.5 text-[var(--lp-signal)]" />
                <span>AST branch solver + Docker runner</span>
              </div>

              <h1 className="lp-display text-4xl sm:text-5xl xl:text-[58px] font-bold tracking-tight leading-[1.06] text-[var(--lp-ink)] max-w-[16ch]">
                Map untested branches. Ship verified tests.
              </h1>

              <p className="text-base sm:text-lg text-[var(--lp-ink-secondary)] leading-relaxed max-w-[46ch]">
                Static Control Flow Graphs pinpoint missing coverage. Isolated Docker containers verify every generated suite.
              </p>

              {/* Interactive Repository Scan Simulator */}
              <div className="p-3.5 rounded-xl lp-machined max-w-2xl">
                <form
                  onSubmit={handleSimulateScan}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                >
                  <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-[var(--lp-inset)] border border-[var(--lp-line)] focus-within:border-[var(--lp-signal)] transition-colors">
                    <FolderGit2 className="w-4 h-4 text-[var(--lp-ink-muted)] shrink-0" />
                    <span className="text-xs lp-mono text-[var(--lp-ink-muted)] select-none">
                      github.com/
                    </span>
                    <input
                      type="text"
                      value={repoInput}
                      onChange={(e) => setRepoInput(e.target.value)}
                      aria-label="Repository path to simulate CFG scan"
                      placeholder="org/repository"
                      className="w-full bg-transparent text-xs sm:text-sm lp-mono text-[var(--lp-ink)] placeholder-[var(--lp-ink-muted)] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    className="lp-btn-primary px-4 py-2.5 rounded-lg text-xs sm:text-sm cursor-pointer shrink-0 inline-flex items-center justify-center gap-1.5"
                  >
                    <ScanLine className={`w-3.5 h-3.5 ${isScanning ? "animate-pulse" : ""}`} />
                    <span>{isScanning ? "Scanning AST..." : "Simulate scan"}</span>
                  </button>
                </form>

                <div className="mt-3 px-1 flex flex-wrap items-center justify-between gap-2 text-xs lp-mono">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {PRESET_REPOS.map((item) => (
                      <button
                        key={item.repo}
                        type="button"
                        onClick={() => {
                          setRepoInput(item.repo);
                          setScanResult(item);
                          setScanPulse((p) => p + 1);
                        }}
                        className={`px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                          repoInput === item.repo
                            ? "bg-[var(--lp-pill-active)] border-[var(--lp-line-strong)] text-[var(--lp-ink)]"
                            : "bg-transparent border-[var(--lp-line)] text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)]"
                        }`}
                      >
                        {item.repo}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-[var(--lp-ink-secondary)]">
                    <span className="text-[var(--lp-fault)]">{scanResult.before}</span>
                    <span className="text-[var(--lp-ink-muted)]">&rarr;</span>
                    <span className="text-[var(--lp-signal)] font-semibold">
                      {scanResult.after}
                    </span>
                    <span className="text-[var(--lp-ink-muted)]">
                      +{scanResult.branchesFixed} branches ({scanResult.duration})
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Row */}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to="/register"
                  id="hero-cta-btn"
                  className="lp-btn-primary px-5 py-2.5 rounded-lg text-sm inline-flex items-center gap-1.5"
                >
                  <span>Connect repository</span>
                  <ArrowUpRight className="w-4 h-4" />
                </Link>

                <a
                  href="#ide-preview"
                  className="lp-btn-secondary px-4 py-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5"
                >
                  <Terminal className="w-3.5 h-3.5 text-[var(--lp-signal)]" />
                  <span>Live sandbox</span>
                </a>

                <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--lp-surface)] border border-[var(--lp-line)] text-xs lp-mono">
                  <span className="text-[var(--lp-ink-muted)] select-none">$</span>
                  <code className="text-[var(--lp-ink)] select-all">{cliCommand}</code>
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-label="Copy CLI command"
                    className="p-1 rounded hover:bg-[var(--lp-hover)] text-[var(--lp-ink-muted)] hover:text-[var(--lp-ink)] transition-colors cursor-pointer"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-[var(--lp-signal)]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Structural Telemetry Readout */}
              <div className="pt-5 grid grid-cols-3 gap-5 max-w-lg border-t border-[var(--lp-line)]">
                <div className="flex items-start gap-2.5">
                  <GitBranch className="w-4 h-4 text-[var(--lp-signal)] mt-1 shrink-0" />
                  <div>
                    <div className="text-xl font-bold lp-mono text-[var(--lp-ink)]">96.4%</div>
                    <div className="text-xs text-[var(--lp-ink-muted)]">Branch target</div>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Cpu className="w-4 h-4 text-[var(--lp-ink-secondary)] mt-1 shrink-0" />
                  <div>
                    <div className="text-xl font-bold lp-mono text-[var(--lp-ink)]">1.4s</div>
                    <div className="text-xs text-[var(--lp-ink-muted)]">AST graph build</div>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-[var(--lp-signal)] mt-1 shrink-0" />
                  <div>
                    <div className="text-xl font-bold lp-mono text-[var(--lp-ink)]">0 flaky</div>
                    <div className="text-xs text-[var(--lp-ink-muted)]">Docker verified</div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Right Column: Interactive 3D WebGL AST & CFG Core */}
            <div className="lg:col-span-5">
              <Suspense
                fallback={
                  <div className="w-full h-[500px] rounded-xl lp-machined flex items-center justify-center text-xs lp-mono text-[var(--lp-ink-muted)]">
                    Loading 3D Control Flow Graph...
                  </div>
                }
              >
                <CfgWebGLCore
                  scanPulse={scanPulse}
                  repoName={repoInput || "acme/payment-kernel"}
                />
              </Suspense>
            </div>
          </div>
        </div>
      </section>

      <TechMarquee />
    </>
  );
}
